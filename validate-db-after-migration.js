'use strict';

try {
  require('dotenv').config();
} catch {
  // dotenv optional
}

/**
 * Validate DB after 0032 migration: no significant front-end data loss.
 * - Fetches admin /db/audit for table row counts
 * - Asserts historical_* and latest_* have positive rows
 * - Calls public API latest/timeseries and asserts non-empty where expected
 * Requires ADMIN_API_TOKEN in .env for audit; public endpoints need no auth.
 */

const ORIGIN = process.env.API_BASE
  ? new URL(process.env.API_BASE).origin
  : 'https://www.australianrates.com';

const token = (
  process.env.ADMIN_API_TOKEN ||
  process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
  ''
).trim();

async function fetchJson(path, options = {}) {
  const url = `${ORIGIN}${path}`;
  const res = await fetch(url, {
    headers: options.headers || {},
    ...options,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function getCount(payload, tableName) {
  if (!payload?.tables) return null;
  const t = payload.tables.find((r) => r.name === tableName);
  return t ? t.row_count : null;
}

async function main() {
  const failures = [];
  console.log('========================================');
  console.log('DB validation after migration 0032');
  console.log('========================================');
  console.log('Origin:', ORIGIN);

  const frontEndTables = [
    'historical_loan_rates',
    'historical_savings_rates',
    'historical_term_deposit_rates',
    'latest_home_loan_series',
    'latest_savings_series',
    'latest_td_series',
  ];

  if (token) {
    const audit = await fetchJson('/api/home-loan-rates/admin/db/audit', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (audit.status !== 200 || !audit.json?.ok) {
      failures.push('admin db/audit failed or not ok');
    } else {
      console.log('\nTable row counts (admin/db/audit):');
      for (const tableName of frontEndTables) {
        const n = getCount(audit.json, tableName);
        if (n === null) {
          console.log(`  ${tableName}: (not in audit)`);
        } else {
          console.log(`  ${tableName}: ${n.toLocaleString()}`);
          if (n < 0) failures.push(`${tableName} row_count negative`);
          if (tableName.startsWith('historical_') && n === 0) {
            failures.push(`${tableName} has zero rows - possible data loss`);
          }
          if (tableName.startsWith('latest_') && n === 0) {
            failures.push(`${tableName} has zero rows - possible data loss`);
          }
        }
      }
    }
  } else {
    console.log('\nNo ADMIN_API_TOKEN - skipping admin/db/audit (table counts).');
  }

  const datasets = [
    { key: 'home-loans', base: '/api/home-loan-rates' },
    { key: 'savings', base: '/api/savings-rates' },
    { key: 'term-deposits', base: '/api/term-deposit-rates' },
  ];

  console.log('\nPublic API (latest + timeseries):');
  for (const d of datasets) {
    const latest = await fetchJson(`${d.base}/latest?limit=10&source_mode=all`);
    if (latest.status !== 200) {
      failures.push(`[${d.key}] latest status ${latest.status}`);
    } else {
      const rows = latest.json?.rows ?? latest.json?.data ?? [];
      const total = latest.json?.total ?? latest.json?.count ?? rows.length;
      console.log(`  ${d.key} latest: status=${latest.status} rows=${rows.length} total=${total}`);
      if (rows.length > 0) {
        const first = rows[0];
        if (!first.collection_date) failures.push(`[${d.key}] latest row missing collection_date`);
        if (!first.product_key) failures.push(`[${d.key}] latest row missing product_key`);
        const productKey = first.product_key;
        if (productKey) {
          const ts = await fetchJson(
            `${d.base}/timeseries?product_key=${encodeURIComponent(productKey)}&limit=5&source_mode=all`
          );
          if (ts.status !== 200) {
            failures.push(`[${d.key}] timeseries status ${ts.status}`);
          } else {
            const tsRows = ts.json?.rows ?? ts.json?.data ?? [];
            console.log(`  ${d.key} timeseries (1 product): status=${ts.status} points=${tsRows.length}`);
          }
        }
      } else if (total === 0) {
        failures.push(`[${d.key}] latest returned zero rows - possible data loss`);
      }
    }
  }

  console.log('\n========================================');
  if (failures.length === 0) {
    console.log('RESULT: PASS - No significant front-end data loss detected.');
    process.exit(0);
  } else {
    console.log('RESULT: FAIL');
    failures.forEach((f) => console.log('  -', f));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
