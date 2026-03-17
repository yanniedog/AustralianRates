/**
 * Fetch latest production logfile from www.australianrates.com.
 * Requires ADMIN_API_TOKEN in repo root .env.
 * Usage: node fetch-production-logs.js [--errors] [--warn] [--actionable] [--limit=N]
 */

const ORIGIN = process.env.API_BASE
  ? new URL(process.env.API_BASE).origin
  : 'https://www.australianrates.com';
const BASE = `${ORIGIN}/api/home-loan-rates/admin/logs/system`;

const token = (
  process.env.ADMIN_API_TOKEN ||
  process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
  process.env.ADMIN_TEST_TOKEN ||
  process.env.LOCAL_ADMIN_API_TOKEN ||
  ''
).trim();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/x-ndjson',
    },
  });
  if (res.status === 401) {
    throw new Error('401 Unauthorized: ADMIN_API_TOKEN invalid or missing');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/x-ndjson, text/plain',
    },
  });
  if (res.status === 401) {
    throw new Error('401 Unauthorized: ADMIN_API_TOKEN invalid or missing');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment. Set it in repo root .env.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const limit = Math.min(
    10000,
    Math.max(1, parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '1000', 10))
  );
  const doErrors = args.includes('--errors') || args.length === 0;
  const doWarn = args.includes('--warn');
  const doActionable = args.includes('--actionable') || args.length === 0;
  const doStats = args.includes('--stats') || args.length === 0;

  try {
    if (doStats) {
      const stats = await fetchJson<{ ok: boolean; count?: number; latest_ts?: string }>(
        `${BASE}/stats`
      );
      console.log(JSON.stringify(stats, null, 2));
    }
    if (doActionable) {
      const actionable = await fetchJson<{ ok: boolean; count?: number; issues?: unknown[] }>(
        `${BASE}/actionable?limit=50`
      );
      console.log(JSON.stringify(actionable, null, 2));
    }
    if (doErrors) {
      const text = await fetchText(`${BASE}?format=jsonl&limit=${limit}&level=error`);
      process.stdout.write(text);
      if (!text.endsWith('\n') && text.length > 0) process.stdout.write('\n');
    }
    if (doWarn) {
      const text = await fetchText(`${BASE}?format=jsonl&limit=${limit}&level=warn`);
      process.stdout.write(text);
      if (!text.endsWith('\n') && text.length > 0) process.stdout.write('\n');
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main();
