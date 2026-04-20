'use strict';

/**
 * POST to production admin chart-cache refresh (recomputes D1 + KV snapshot bundles).
 * Requires ADMIN_API_TOKEN in the environment or repo root .env (KEY=value lines).
 */

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  raw.split(/\r?\n/).forEach(function (line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  });
}

async function main() {
  loadDotEnv();
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN (set in environment or .env).');
    process.exit(1);
  }
  const base = process.env.CHART_CACHE_REFRESH_URL || 'https://www.australianrates.com/api/home-loan-rates/admin/chart-cache/refresh';
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + String(token).trim(),
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    console.error('HTTP ' + res.status);
    process.exit(1);
  }
  if (body && body.ok === false) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
