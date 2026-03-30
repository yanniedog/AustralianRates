/**
 * Test that ADMIN_API_TOKEN in .env can access production logfiles on www.australianrates.com.
 * Run via node test-logs-api.js (loads .env from repo root).
 */

import { buildAdminHeaders, resolveAdminToken, resolveEnvOrigin } from './lib/admin-api';

const ORIGIN = resolveEnvOrigin(['API_BASE']);
const BASE = `${ORIGIN}/api/home-loan-rates/admin/logs/system`;

const token = resolveAdminToken(['ADMIN_API_TOKEN', 'ADMIN_API_TOKENS']);

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN (or ADMIN_API_TOKENS) in environment. Set it in repo root .env.');
    process.exit(1);
  }

  const headers = buildAdminHeaders(token, 'application/json, application/x-ndjson, text/plain');

  let passed = 0;
  let failed = 0;

  // 1. GET /admin/logs/system/stats
  try {
    const res = await fetch(`${BASE}/stats`, { headers });
    if (res.status === 401) {
      console.error('Logs API returned 401 Unauthorized. Token is invalid or not accepted.');
      failed += 1;
    } else if (!res.ok) {
      console.error(`Logs stats: HTTP ${res.status} ${res.statusText}`);
      failed += 1;
    } else {
      const data = (await res.json()) as { ok?: boolean; count?: number };
      if (data?.ok !== true) {
        console.error('Logs stats: response missing ok:true', data);
        failed += 1;
      } else {
        console.log(`Logs stats: ok (count=${data?.count ?? 'n/a'})`);
        passed += 1;
      }
    }
  } catch (e) {
    console.error('Logs stats request failed:', (e as Error).message);
    failed += 1;
  }

  // 2. GET /admin/logs/system?limit=1&format=jsonl
  try {
    const res = await fetch(`${BASE}?limit=1&format=jsonl`, { headers });
    if (res.status === 401) {
      console.error('Logs system (jsonl) returned 401 Unauthorized.');
      failed += 1;
    } else if (!res.ok) {
      console.error(`Logs system: HTTP ${res.status} ${res.statusText}`);
      failed += 1;
    } else {
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      if (contentType.includes('ndjson') || contentType.includes('json')) {
        const lines = text.trim().split('\n').filter(Boolean);
        console.log(`Logs system (jsonl): ok (${lines.length} line(s) returned)`);
        passed += 1;
      } else {
        console.log('Logs system: ok (text response)');
        passed += 1;
      }
    }
  } catch (e) {
    console.error('Logs system request failed:', (e as Error).message);
    failed += 1;
  }

  // 3. GET /admin/logs/system/actionable?limit=5
  try {
    const res = await fetch(`${BASE}/actionable?limit=5`, { headers });
    if (res.status === 401) {
      console.error('Logs actionable returned 401 Unauthorized.');
      failed += 1;
    } else if (!res.ok) {
      console.error(`Logs actionable: HTTP ${res.status} ${res.statusText}`);
      failed += 1;
    } else {
      const data = (await res.json()) as { ok?: boolean; count?: number };
      if (data?.ok !== true) {
        console.error('Logs actionable: response missing ok:true', data);
        failed += 1;
      } else {
        console.log(`Logs actionable: ok (issues=${data?.count ?? 'n/a'})`);
        passed += 1;
      }
    }
  } catch (e) {
    console.error('Logs actionable request failed:', (e as Error).message);
    failed += 1;
  }

  console.log('');
  if (failed > 0) {
    console.error(`Result: ${passed} passed, ${failed} failed. Token is not fit for logfile access.`);
    process.exit(1);
  }
  console.log(`Result: ${passed} passed. API token can access logfiles on ${ORIGIN}.`);
  process.exit(0);
}

main();
