/**
 * Multi-section API diagnostics and lightweight benchmark.
 *
 * Usage:
 *   node diagnose-api.js
 *
 * Optional env:
 *   TEST_URL=https://www.australianrates.com/
 *   DIAG_BENCH_N=10
 *   DIAG_P95_TARGET_MS=500
 */

const DEFAULT_TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/'
const ORIGIN = new URL(DEFAULT_TEST_URL).origin
const BENCH_N = Math.max(1, Math.floor(Number(process.env.DIAG_BENCH_N || 10)))
const P95_TARGET_MS = Math.max(1, Math.floor(Number(process.env.DIAG_P95_TARGET_MS || 500)))

const DATASETS = [
  { key: 'home-loans', base: '/api/home-loan-rates' },
  { key: 'savings', base: '/api/savings-rates' },
  { key: 'term-deposits', base: '/api/term-deposit-rates' },
]

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1)
  return sorted[idx]
}

function asNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function inferRowsAndTotal(payload) {
  if (!payload || typeof payload !== 'object') {
    return { rows: [], total: 0 }
  }
  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(payload.data)
      ? payload.data
      : []
  const total = payload.total != null
    ? asNumber(payload.total, rows.length)
    : payload.count != null
      ? asNumber(payload.count, rows.length)
      : rows.length
  return { rows, total }
}

async function requestJson(path) {
  const url = `${ORIGIN}${path}`
  const start = Date.now()
  const res = await fetch(url)
  const durationMs = Date.now() - start
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return {
    url,
    status: res.status,
    durationMs,
    textLength: text.length,
    json,
    text,
  }
}

async function benchmark(path, n) {
  const durations = []
  let non200 = 0
  for (let i = 0; i < n; i += 1) {
    const start = Date.now()
    const res = await fetch(`${ORIGIN}${path}`)
    const end = Date.now()
    durations.push(end - start)
    if (res.status !== 200) non200 += 1
    await res.arrayBuffer()
  }
  const avg = durations.reduce((sum, x) => sum + x, 0) / durations.length
  return {
    avgMs: Number(avg.toFixed(1)),
    p50Ms: Number(percentile(durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
    non200,
  }
}

async function runDatasetDiagnostics(dataset) {
  const base = dataset.base
  const out = {
    dataset: dataset.key,
    failures: [],
    checks: [],
    benchmark: [],
  }

  const health = await requestJson(`${base}/health`)
  out.checks.push({ name: 'health', status: health.status, ms: health.durationMs })
  if (health.status !== 200) out.failures.push(`health status ${health.status}`)

  const filters = await requestJson(`${base}/filters`)
  out.checks.push({ name: 'filters', status: filters.status, ms: filters.durationMs })
  if (filters.status !== 200) out.failures.push(`filters status ${filters.status}`)

  const rates = await requestJson(`${base}/rates?page=1&size=1&source_mode=all`)
  out.checks.push({ name: 'rates', status: rates.status, ms: rates.durationMs })
  if (rates.status !== 200 || !rates.json) {
    out.failures.push(`rates status ${rates.status}`)
  }
  const ratesShape = inferRowsAndTotal(rates.json)

  const latest = await requestJson(`${base}/latest?limit=5&source_mode=all`)
  out.checks.push({ name: 'latest', status: latest.status, ms: latest.durationMs })
  if (latest.status !== 200 || !latest.json) {
    out.failures.push(`latest status ${latest.status}`)
  }
  const latestShape = inferRowsAndTotal(latest.json)

  let timeseries = null
  const productKey = (latestShape.rows[0] && latestShape.rows[0].product_key) || null
  if (productKey) {
    const encoded = encodeURIComponent(String(productKey))
    timeseries = await requestJson(`${base}/timeseries?product_key=${encoded}&limit=5&source_mode=all`)
    out.checks.push({ name: 'timeseries', status: timeseries.status, ms: timeseries.durationMs })
    if (timeseries.status !== 200) out.failures.push(`timeseries status ${timeseries.status}`)
  }

  const exportJson = await requestJson(`${base}/export?format=json&source_mode=all`)
  out.checks.push({ name: 'export(json)', status: exportJson.status, ms: exportJson.durationMs })
  if (exportJson.status !== 200 || !exportJson.json) {
    out.failures.push(`export(json) status ${exportJson.status}`)
  }
  const exportShape = inferRowsAndTotal(exportJson.json)

  // Contradiction check: list endpoint empty while export has rows.
  if (ratesShape.total === 0 && exportShape.total > 0) {
    out.failures.push(`contradiction: rates total=0 but export total=${exportShape.total}`)
  }

  // Parse-shape check for rows/count support.
  if (!Array.isArray(latestShape.rows)) {
    out.failures.push('latest response shape invalid')
  }

  const benchTargets = [
    `${base}/rates?page=1&size=50&source_mode=all`,
    `${base}/latest?limit=200&source_mode=all`,
    `${base}/filters`,
  ]
  for (const path of benchTargets) {
    const stats = await benchmark(path, BENCH_N)
    const pass = stats.non200 === 0 && stats.p95Ms <= P95_TARGET_MS
    out.benchmark.push({
      path,
      ...stats,
      pass,
    })
    if (!pass) {
      out.failures.push(`benchmark failed for ${path} (p95=${stats.p95Ms}ms, non200=${stats.non200})`)
    }
  }

  return out
}

async function main() {
  console.log('========================================')
  console.log('AustralianRates API Diagnostics')
  console.log('========================================')
  console.log(`Origin: ${ORIGIN}`)
  console.log(`Bench repetitions: ${BENCH_N}`)
  console.log(`P95 target: ${P95_TARGET_MS}ms`)
  console.log(`Time: ${new Date().toISOString()}`)

  const results = []
  for (const dataset of DATASETS) {
    console.log(`\n--- ${dataset.key} ---`)
    const result = await runDatasetDiagnostics(dataset)
    results.push(result)
    for (const check of result.checks) {
      console.log(`${check.name.padEnd(12)} status=${check.status} ms=${check.ms}`)
    }
    for (const bench of result.benchmark) {
      console.log(`bench ${bench.path} avg=${bench.avgMs} p50=${bench.p50Ms} p95=${bench.p95Ms} pass=${bench.pass}`)
    }
    if (result.failures.length) {
      console.log('failures:')
      for (const failure of result.failures) {
        console.log(`  - ${failure}`)
      }
    } else {
      console.log('no failures')
    }
  }

  const allFailures = results.flatMap((r) => r.failures.map((f) => `[${r.dataset}] ${f}`))

  console.log('\n========================================')
  if (allFailures.length === 0) {
    console.log('PASS: all diagnostics checks succeeded')
    console.log('========================================')
    process.exit(0)
  }
  console.log('FAIL: diagnostics detected issues')
  for (const failure of allFailures) {
    console.log(`- ${failure}`)
  }
  console.log('========================================')
  process.exit(1)
}

main().catch((error) => {
  console.error('Fatal diagnostic error:', error)
  process.exit(1)
})
