/**
 * Multi-section API diagnostics and lightweight benchmark.
 *
 * Flags: --quick (or DOCTOR_QUICK=1): fewer bench reps, no warmup, subset of bench paths.
 */

const DEFAULT_TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const ORIGIN = new URL(DEFAULT_TEST_URL).origin;
const QUICK =
  process.argv.includes('--quick') ||
  ['1', 'true', 'yes'].includes(String(process.env.DOCTOR_QUICK || '').trim().toLowerCase());
const BENCH_N = QUICK
  ? Math.max(2, Math.floor(Number(process.env.DIAG_BENCH_N_QUICK || 3)))
  : Math.max(3, Math.floor(Number(process.env.DIAG_BENCH_N || 20)));
const BENCH_WARMUP_N = QUICK ? 0 : Math.max(0, Math.floor(Number(process.env.DIAG_BENCH_WARMUP_N || 1)));
const P95_TARGET_MS = Math.max(1, Math.floor(Number(process.env.DIAG_P95_TARGET_MS || 500)));
const EXPORT_P95_TARGET_MS = Math.max(1, Math.floor(Number(process.env.DIAG_EXPORT_P95_TARGET_MS || 4000)));
const DATASET_P95_OVERRIDES: Record<string, { default: number; exportJson: number }> = {
  'home-loans': { default: P95_TARGET_MS, exportJson: Math.max(P95_TARGET_MS, 1800) },
  savings: { default: P95_TARGET_MS, exportJson: Math.max(P95_TARGET_MS, 1200) },
  'term-deposits': { default: P95_TARGET_MS, exportJson: EXPORT_P95_TARGET_MS },
};

const DATASETS = [
  { key: 'home-loans', base: '/api/home-loan-rates' },
  { key: 'savings', base: '/api/savings-rates' },
  { key: 'term-deposits', base: '/api/term-deposit-rates' },
];

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferRowsAndTotal(payload: any): { rows: any[]; total: number } {
  if (!payload || typeof payload !== 'object') return { rows: [], total: 0 };
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.data) ? payload.data : [];
  const total =
    payload.total != null
      ? asNumber(payload.total, rows.length)
      : payload.count != null
        ? asNumber(payload.count, rows.length)
        : rows.length;
  return { rows, total };
}

async function requestJson(pathname: string): Promise<any> {
  const url = `${ORIGIN}${pathname}`;
  const start = Date.now();
  const res = await fetch(url);
  const durationMs = Date.now() - start;
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    url,
    status: res.status,
    durationMs,
    textLength: text.length,
    json,
    text,
  };
}

async function benchmark(pathname: string, n: number): Promise<{ avgMs: number; p50Ms: number; p95Ms: number; non200: number }> {
  const durations: number[] = [];
  let non200 = 0;
  for (let i = 0; i < BENCH_WARMUP_N; i += 1) {
    const warmup = await fetch(`${ORIGIN}${pathname}`);
    if (warmup.status !== 200) non200 += 1;
    await warmup.arrayBuffer();
  }
  for (let i = 0; i < n; i += 1) {
    const start = Date.now();
    const res = await fetch(`${ORIGIN}${pathname}`);
    durations.push(Date.now() - start);
    if (res.status !== 200) non200 += 1;
    await res.arrayBuffer();
  }
  const avg = durations.reduce((sum, x) => sum + x, 0) / durations.length;
  return {
    avgMs: Number(avg.toFixed(1)),
    p50Ms: Number(percentile(durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
    non200,
  };
}

async function runDatasetDiagnostics(dataset: { key: string; base: string }): Promise<any> {
  const base = dataset.base;
  const out = {
    dataset: dataset.key,
    failures: [] as string[],
    checks: [] as Array<{ name: string; status: number; ms: number }>,
    benchmark: [] as Array<{ path: string; avgMs: number; p50Ms: number; p95Ms: number; non200: number; pass: boolean }>,
  };

  const pushCheck = (name: string, r: { status: number; durationMs: number }) => {
    out.checks.push({ name, status: r.status, ms: r.durationMs });
  };

  const [health, filters, rates, latest, latestAll, exportJson] = await Promise.all([
    requestJson(`${base}/health`),
    requestJson(`${base}/filters`),
    requestJson(`${base}/rates?page=1&size=1&source_mode=all`),
    requestJson(`${base}/latest?limit=5&source_mode=all`),
    requestJson(`${base}/latest-all?limit=50&source_mode=all`),
    requestJson(`${base}/export?format=json&source_mode=all`),
  ]);

  pushCheck('health', health);
  if (health.status !== 200) out.failures.push(`health status ${health.status}`);

  pushCheck('filters', filters);
  if (filters.status !== 200) out.failures.push(`filters status ${filters.status}`);

  pushCheck('rates', rates);
  if (rates.status !== 200 || !rates.json) out.failures.push(`rates status ${rates.status}`);
  const ratesShape = inferRowsAndTotal(rates.json);

  pushCheck('latest', latest);
  if (latest.status !== 200 || !latest.json) out.failures.push(`latest status ${latest.status}`);
  const latestShape = inferRowsAndTotal(latest.json);
  if (latest.status === 200 && latestShape.rows.length > 0) {
    const first = latestShape.rows[0] as Record<string, unknown>;
    if (!first || !first.collection_date) out.failures.push('latest shape missing collection_date');
    if (!first || !first.product_key) out.failures.push('latest shape missing product_key');
  }

  pushCheck('latest-all', latestAll);
  if (latestAll.status !== 200 || !latestAll.json) out.failures.push(`latest-all status ${latestAll.status}`);
  const latestAllShape = inferRowsAndTotal(latestAll.json);
  if (latestAll.status === 200 && !Array.isArray(latestAllShape.rows)) {
    out.failures.push('latest-all rows is not an array');
  }

  const productKey = (latestShape.rows[0] && latestShape.rows[0].product_key) || null;
  if (productKey) {
    const encoded = encodeURIComponent(String(productKey));
    const timeseries = await requestJson(`${base}/timeseries?product_key=${encoded}&limit=5&source_mode=all`);
    pushCheck('timeseries', timeseries);
    if (timeseries.status !== 200) out.failures.push(`timeseries status ${timeseries.status}`);
    const timeseriesShape = inferRowsAndTotal(timeseries.json);
    for (const row of timeseriesShape.rows) {
      const record = row as Record<string, unknown>;
      if (record.product_key && String(record.product_key) !== String(productKey)) {
        out.failures.push('timeseries returned mixed product_key values');
        break;
      }
    }
  }

  pushCheck('export(json)', exportJson);
  if (exportJson.status !== 200 || !exportJson.json) out.failures.push(`export(json) status ${exportJson.status}`);
  const exportShape = inferRowsAndTotal(exportJson.json);

  const analytics = await requestJson(`${base}/analytics/series`);
  pushCheck('analytics/series', analytics);
  if (analytics.status !== 200 || !analytics.json || analytics.json.ok !== true) {
    out.failures.push(`analytics/series status ${analytics.status} or ok!=true`);
  }
  if (analytics.json && typeof analytics.json.count !== 'number') {
    out.failures.push('analytics/series missing numeric count');
  }

  if (dataset.key === 'home-loans') {
    const [siteUi, cpi, rba] = await Promise.all([
      requestJson(`${base}/site-ui`),
      requestJson(`${base}/cpi/history`),
      requestJson(`${base}/rba/history`),
    ]);
    pushCheck('site-ui', siteUi);
    if (siteUi.status !== 200 || !siteUi.json || siteUi.json.ok !== true) {
      out.failures.push(`site-ui status ${siteUi.status} or ok!=true`);
    }
    pushCheck('cpi/history', cpi);
    if (cpi.status !== 200 || !cpi.json || cpi.json.ok !== true) {
      out.failures.push(`cpi/history status ${cpi.status} or ok!=true`);
    }
    pushCheck('rba/history', rba);
    if (rba.status !== 200 || !rba.json || rba.json.ok !== true) {
      out.failures.push(`rba/history status ${rba.status} or ok!=true`);
    }
  }

  if (ratesShape.total === 0 && exportShape.total > 0) {
    out.failures.push(`contradiction: rates total=0 but export total=${exportShape.total}`);
  }
  if (rates.status === 200 && rates.json && !Array.isArray((rates.json as any).data)) {
    out.failures.push('rates response missing data array');
  }
  if (rates.status === 200 && rates.json && typeof (rates.json as any).last_page !== 'number') {
    out.failures.push('rates response missing numeric last_page');
  }
  if (!Array.isArray(latestShape.rows)) out.failures.push('latest response shape invalid');
  if (!Array.isArray(latestAllShape.rows)) out.failures.push('latest-all response shape invalid');
  if (latestShape.total > 0 && latestAllShape.total === 0) {
    out.failures.push('latest-all returned zero rows while latest returned data');
  }

  const benchTargets = QUICK
    ? [`${base}/filters`, `${base}/latest?limit=200&source_mode=all`]
    : [
        `${base}/rates?page=1&size=50&source_mode=all`,
        `${base}/latest?limit=200&source_mode=all`,
        `${base}/latest-all?limit=200&source_mode=all`,
        `${base}/filters`,
        `${base}/export?format=json&source_mode=all&limit=500`,
      ];
  for (const pathname of benchTargets) {
    const stats = await benchmark(pathname, BENCH_N);
    const thresholds = DATASET_P95_OVERRIDES[dataset.key] || { default: P95_TARGET_MS, exportJson: EXPORT_P95_TARGET_MS };
    const isExportPath = pathname.includes('/export?format=json');
    const threshold = isExportPath ? thresholds.exportJson : thresholds.default;
    const pass = stats.non200 === 0 && stats.p95Ms <= threshold;
    out.benchmark.push({ path: pathname, ...stats, pass });
    if (!pass) out.failures.push(`benchmark failed for ${pathname} (p95=${stats.p95Ms}ms, target=${threshold}ms, non200=${stats.non200})`);
  }

  return out;
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('AustralianRates API Diagnostics');
  console.log('========================================');
  console.log(`Origin: ${ORIGIN}`);
  console.log(`Quick mode: ${QUICK}`);
  console.log(`Bench repetitions: ${BENCH_N}`);
  console.log(`Bench warmup requests per endpoint: ${BENCH_WARMUP_N}`);
  console.log(`P95 target: ${P95_TARGET_MS}ms`);
  console.log(`Time: ${new Date().toISOString()}`);

  const results: any[] = [];
  for (const dataset of DATASETS) {
    console.log(`\n--- ${dataset.key} ---`);
    const result = await runDatasetDiagnostics(dataset);
    results.push(result);
    for (const check of result.checks) {
      console.log(`${check.name.padEnd(18)} status=${check.status} ms=${check.ms}`);
    }
    for (const bench of result.benchmark) {
      console.log(`bench ${bench.path} avg=${bench.avgMs} p50=${bench.p50Ms} p95=${bench.p95Ms} pass=${bench.pass}`);
    }
    if (result.failures.length) {
      console.log('failures:');
      for (const failure of result.failures) console.log(`  - ${failure}`);
    } else {
      console.log('no failures');
    }
  }

  const allFailures = results.flatMap((r) => r.failures.map((f: string) => `[${r.dataset}] ${f}`));
  console.log('\n========================================');
  if (allFailures.length === 0) {
    console.log('RESULT: PASS');
    console.log('All diagnostics and benchmarks passed.');
  } else {
    console.log('RESULT: FAIL');
    console.log(`Failure count: ${allFailures.length}`);
    for (const failure of allFailures) console.log(`- ${failure}`);
    process.exit(1);
  }
}

void main();
