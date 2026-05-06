#!/usr/bin/env node
/**
 * Cross-platform helpers for D1 recovery runbook (Stage 0.4, A, B worklist).
 * Usage: node d1-recovery-ops.mjs <preflight|stage-a|worklist> [--out=dir]
 * Requires repo-root .env with ADMIN_API_TOKEN. Uses HL admin mount as canonical base.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const BASE = 'https://www.australianrates.com/api/home-loan-rates'

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

function authHeaders() {
  const token = String(process.env.ADMIN_API_TOKEN || '').trim()
  if (!token) {
    console.error('ADMIN_API_TOKEN missing from environment or .env')
    process.exit(1)
  }
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...init.headers },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { _parse_error: true, raw: text.slice(0, 500) }
  }
  return { res, data, text }
}

async function preflight() {
  const url = `${BASE}/admin/logs/system?format=jsonl&limit=200&level=info`
  const res = await fetch(url, { headers: authHeaders() })
  const text = await res.text()
  if (!res.ok) {
    console.error('preflight HTTP', res.status, text.slice(0, 200))
    process.exit(1)
  }
  const re =
    /queue_message_(ok|completed|succeeded)|daily_lender_fetch_completed|product_detail_fetch_completed/
  const lines = text.split('\n').filter(Boolean)
  let n = 0
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      const code = String(o.code || '')
      if (re.test(code)) n++
    } catch {
      /* ignore */
    }
  }
  if (n <= 0) {
    console.error('Stage 0.4 FAIL: no queue consumer success signatures in last 200 info logs')
    process.exit(1)
  }
  console.log('Stage 0.4 PASS: consumer activity signals count=', n)
}

async function stageA(outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const stateUrl = `${BASE}/admin/diagnostics/d1-budget-state`
  const { res: sRes, data: state } = await fetchJson(stateUrl)
  if (!sRes.ok) {
    console.error('d1-budget-state', sRes.status, state)
    process.exit(1)
  }
  fs.writeFileSync(path.join(outDir, 'A_state.json'), JSON.stringify(state, null, 2), 'utf8')

  const logsUrl = `${BASE}/admin/logs/system?format=jsonl&limit=2000&level=warn`
  const lRes = await fetch(logsUrl, { headers: authHeaders() })
  const warnText = await lRes.text()
  if (!lRes.ok) {
    console.error('warn logs', lRes.status)
    process.exit(1)
  }
  const sup = (warnText.match(/d1_public_package_refresh_ancillary_side_effects_suppressed/g) || []).length
  fs.writeFileSync(path.join(outDir, 'A_suppression_count_7d.txt'), String(sup), 'utf8')

  const gapsUrl = `${BASE}/admin/diagnostics/coverage-gaps?refresh=1`
  const { res: gRes, data: gaps } = await fetchJson(gapsUrl)
  if (!gRes.ok) {
    console.error('coverage-gaps', gRes.status, gaps)
    process.exit(1)
  }
  fs.writeFileSync(path.join(outDir, 'A_coverage_gaps.json'), JSON.stringify(gaps, null, 2), 'utf8')
  const rowCount = Array.isArray(gaps?.report?.rows) ? gaps.report.rows.length : 0
  console.log('coverage gaps row count:', rowCount)

  let metricSource = 'bundle_kv_advisory'
  const cfUrl = `${BASE}/admin/cloudflare/d1-usage?days=7`
  const cfRes = await fetch(cfUrl, { headers: authHeaders() })
  if (cfRes.ok) {
    const cfText = await cfRes.text()
    fs.writeFileSync(path.join(outDir, 'A_t0_cf.json'), cfText, 'utf8')
    metricSource = 'cloudflare_d1_usage_graphql'
  } else {
    const bundleUrl = `${BASE}/admin/diagnostics/status-debug-bundle?sections=integrity_pulse`
    const bRes = await fetch(bundleUrl, { headers: authHeaders() })
    const bText = await bRes.text()
    if (!bRes.ok) {
      console.error('fallback bundle failed', bRes.status)
      process.exit(1)
    }
    fs.writeFileSync(path.join(outDir, 'A_t0_bundle.json'), bText, 'utf8')
  }
  const readAt = new Date().toISOString()
  fs.writeFileSync(
    path.join(outDir, 'A_metric_source.txt'),
    `metric_source=${metricSource} read_at=${readAt}\n`,
    'utf8',
  )

  const emerg = String(state.emergency_minimum_writes)
  const noness = String(state.nonessential_disabled)
  const writes = Number(state.writes_today)
  const wlimit = Number(state.daily_write_limit)
  const reads = Number(state.reads_today)
  const rlimit = Number(state.daily_read_limit)

  if (emerg === 'true' || noness === 'true') {
    console.error('FAIL gate1: budget unsafe')
    process.exit(1)
  }
  if (wlimit > 0 && writes / wlimit > 0.7) {
    console.error('FAIL gate2: writes_today > 70% of limit')
    process.exit(1)
  }
  if (rlimit > 0 && reads / rlimit > 0.85) {
    console.error('FAIL gate3: reads_today > 85% of limit')
    process.exit(1)
  }
  if (sup >= 3) {
    console.error(`FAIL gate4: suppression count ${sup} >= 3`)
    process.exit(1)
  }
  console.log('PASS Stage A — proceed to Stage B')
}

async function worklist(outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const gapsUrl = `${BASE}/admin/diagnostics/coverage-gaps?refresh=1`
  const { res, data } = await fetchJson(gapsUrl)
  if (!res.ok) {
    console.error('coverage-gaps', res.status, data)
    process.exit(1)
  }
  const rows = Array.isArray(data?.report?.rows) ? data.report.rows : []
  const tsvLines = rows.map((r) => {
    const lender = String(r.lender_code || '').trim()
    const cd = String(r.collection_date || '').trim()
    const dk = String(r.dataset_kind || '').trim()
    return `${lender}\t${cd}\t${dk}`
  })
  const outPath = path.join(outDir, 'B_worklist_batch.tsv')
  fs.writeFileSync(outPath, ['lender_code\tcollection_date\tdataset_kind', ...tsvLines].join('\n'), 'utf8')
  console.log('Wrote', outPath, 'lines', tsvLines.length)
}

const cmd = process.argv[2] || ''
const outArg = process.argv.find((a) => a.startsWith('--out='))
const outDir = outArg ? outArg.slice(6) : path.join(process.cwd(), 'tmp_assess')

loadDotEnv(path.join(process.cwd(), '.env'))

if (cmd === 'preflight') {
  await preflight()
} else if (cmd === 'stage-a') {
  await stageA(outDir)
} else if (cmd === 'worklist') {
  await worklist(outDir)
} else {
  console.error('Usage: node d1-recovery-ops.mjs <preflight|stage-a|worklist> [--out=dir]')
  process.exit(1)
}
