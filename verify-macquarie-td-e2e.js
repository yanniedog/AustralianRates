'use strict';

/**
 * E2E verification for Macquarie term-deposit ingestion (business TD excluded from index).
 * 1) Live Macquarie CDR index matches the same filter as the worker (no BB001, TD001 present).
 * 2) Production public latest TD API shows retail TD001 rows for Macquarie Bank (proves rates in DB).
 * Optional: coverage rows (see env below).
 *
 * Env:
 *   TEST_URL / API_BASE – site origin (default https://www.australianrates.com/)
 *   MACQUARIE_TD_REQUIRE_COVERAGE=1 – also require a lender_dataset_runs row with expected=1, completed>=1, pending=0
 *   MACQUARIE_TD_VERIFY_MIN_DATE – with REQUIRE_COVERAGE, only rows on/after this date count
 *   MACQUARIE_TD_E2E_MAX_WAIT_MS / MACQUARIE_TD_E2E_POLL_MS – poll when waiting for coverage (optional)
 */

const DEFAULT_ORIGIN = 'https://www.australianrates.com';

function originFromEnv() {
  const raw = process.env.TEST_URL || process.env.API_BASE || DEFAULT_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function isTermDepositProduct(p) {
  const cat = String(p.productCategory || p.category || p.type || '').toUpperCase();
  const name = String(p.name || p.productName || '').toUpperCase();
  if (cat.includes('TERM_DEPOSIT')) return true;
  if (name.includes('TERM DEPOSIT') || name.includes('FIXED DEPOSIT')) return true;
  return false;
}

function includeMacquarieTdIndex(p) {
  if (!isTermDepositProduct(p)) return false;
  const name = String(p.name || p.productName || '').toUpperCase();
  if (name.includes('BUSINESS BANKING')) return false;
  return true;
}

async function fetchMacquarieCdrIndexProductIds() {
  const url = 'https://api.macquariebank.io/cds-au/v1/banking/products';
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'x-v': '4', 'x-min-v': '1' },
  });
  if (!res.ok) {
    throw new Error(`Macquarie CDR index HTTP ${res.status}`);
  }
  const j = JSON.parse(await res.text());
  const products = j.data?.products || [];
  const ids = [];
  for (const p of products) {
    if (!includeMacquarieTdIndex(p)) continue;
    const id = String(p.productId || p.id || '').trim();
    if (id) ids.push(id);
  }
  return { ids, rawCount: products.length };
}

async function fetchProductionCoverage(origin) {
  const u = `${origin}/api/term-deposit-rates/coverage?lender_code=macquarie&limit=80`;
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`coverage HTTP ${res.status} ${u}`);
  }
  return res.json();
}

async function fetchMacquarieLatestRows(origin) {
  const u = `${origin}/api/term-deposit-rates/latest?bank=Macquarie%20Bank&limit=40&source_mode=all&mode=daily`;
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`latest HTTP ${res.status} ${u}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sortCoverageRows(rows) {
  return [...rows].sort((a, b) => {
    const dc = String(b.collection_date || '').localeCompare(String(a.collection_date || ''));
    if (dc !== 0) return dc;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
}

/** Post-fix healthy run: one expected product, detail completed, nothing pending. */
function findHealthyExpectedOneRow(rows, minDate) {
  const list = minDate ? rows.filter((r) => String(r.collection_date || '') >= minDate) : rows;
  return list.find(
    (r) =>
      Number(r.expected_detail_count) === 1 &&
      Number(r.pending_detail_count) === 0 &&
      Number(r.completed_detail_count) >= 1,
  );
}

async function assertMacquarieCdrIndexFilter() {
  const cdr = await fetchMacquarieCdrIndexProductIds();
  const hasBb = cdr.ids.includes('BB001MBLTDA001');
  const hasTd = cdr.ids.includes('TD001MBLTDA001');
  if (hasBb) {
    throw new Error(`CDR index filter still includes BB001MBLTDA001. ids=${JSON.stringify(cdr.ids)}`);
  }
  if (!hasTd) {
    throw new Error(`expected TD001MBLTDA001 in filtered index. ids=${JSON.stringify(cdr.ids)}`);
  }
  console.log('[macquarie-td-e2e] OK: CDR index excludes BB001, includes TD001 (filtered count=%s)', cdr.ids.length);
}

async function assertMacquarieLatestTd001(origin) {
  const latestTd = await fetchMacquarieLatestRows(origin);
  const tdRows = Array.isArray(latestTd.rows) ? latestTd.rows : [];
  const td001 = tdRows.filter((r) => String(r.product_id || '').toUpperCase().includes('TD001'));
  if (tdRows.length === 0) {
    throw new Error('no Macquarie Bank daily TD latest rows');
  }
  if (td001.length === 0) {
    throw new Error('latest rows missing TD001 retail product_id');
  }
  const rate = Number(td001[0].interest_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`unexpected interest_rate on TD001 row: ${td001[0].interest_rate}`);
  }
  console.log('[macquarie-td-e2e] OK: latest API has %s TD001 row(s), sample rate=%s', td001.length, rate);
}

async function assertCoverageHealthyIfRequired(origin, minDateEnv) {
  const requireCov = String(process.env.MACQUARIE_TD_REQUIRE_COVERAGE || '').trim() === '1';
  if (!requireCov) {
    console.log('[macquarie-td-e2e] OK: coverage check skipped (set MACQUARIE_TD_REQUIRE_COVERAGE=1 to enforce)');
    return;
  }

  const coverage = await fetchProductionCoverage(origin);
  const rows = Array.isArray(coverage.rows) ? coverage.rows : [];
  if (rows.length === 0) {
    throw new Error('no lender_dataset_runs rows for macquarie term_deposits');
  }

  const sorted = sortCoverageRows(rows);
  console.log(
    '[macquarie-td-e2e] coverage newest updated_at=%s expected=%s pending=%s',
    sorted[0]?.updated_at,
    sorted[0]?.expected_detail_count,
    sorted[0]?.pending_detail_count,
  );

  const healthy = findHealthyExpectedOneRow(rows, minDateEnv || undefined);
  if (!healthy) {
    throw new Error(
      'no coverage row with expected=1, completed>=1, pending=0' +
        (minDateEnv ? ` (on/after ${minDateEnv})` : ''),
    );
  }
  console.log(
    '[macquarie-td-e2e] OK: coverage row collection_date=%s expected=1 completed=%s pending=0',
    healthy.collection_date,
    healthy.completed_detail_count,
  );
}

async function runProductionChecks(origin, minDateEnv) {
  await assertMacquarieLatestTd001(origin);
  await assertCoverageHealthyIfRequired(origin, minDateEnv);
  return { ok: true };
}

async function main() {
  const origin = originFromEnv();
  const minDateEnv = String(process.env.MACQUARIE_TD_VERIFY_MIN_DATE || '').trim();
  const maxWaitMs = Math.max(0, Number(process.env.MACQUARIE_TD_E2E_MAX_WAIT_MS || 0));
  const pollMs = Math.max(5000, Number(process.env.MACQUARIE_TD_E2E_POLL_MS || 30000));

  console.log('[macquarie-td-e2e] origin=%s maxWaitMs=%s requireCoverage=%s', origin, maxWaitMs, process.env.MACQUARIE_TD_REQUIRE_COVERAGE || '0');

  await assertMacquarieCdrIndexFilter();

  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await runProductionChecks(origin, minDateEnv);
      console.log('[macquarie-td-e2e] PASS (attempt %s)', attempt);
      process.exit(0);
    } catch (e) {
      const message = (e && e.message) || String(e);
      console.error('[macquarie-td-e2e] attempt %s not ready: %s', attempt, message);
      if (Date.now() >= deadline) {
        console.error('[macquarie-td-e2e] FAIL after wait budget exhausted');
        process.exit(1);
      }
      const wait = Math.min(pollMs, Math.max(0, deadline - Date.now()));
      if (wait <= 0) break;
      console.log('[macquarie-td-e2e] retry in %sms...', wait);
      await sleep(wait);
    }
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('[macquarie-td-e2e] ERROR', err);
  process.exit(1);
});
