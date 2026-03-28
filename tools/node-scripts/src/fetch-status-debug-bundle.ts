/**
 * Fetch consolidated admin status debug bundle from production (or API_BASE).
 * Requires ADMIN_API_TOKEN in repo root .env.
 * Usage: node fetch-status-debug-bundle.js [--out=file.json] [--sections=a,b] [--include-probe-payloads]
 *   [--refresh-coverage] [--refresh-lender-universe] [--since=ISO] [--log-limit=N]
 */

const ORIGIN = process.env.API_BASE
  ? new URL(process.env.API_BASE).origin
  : 'https://www.australianrates.com';
const BASE = `${ORIGIN}/api/home-loan-rates/admin/diagnostics/status-debug-bundle`;

const token = (
  process.env.ADMIN_API_TOKEN ||
  process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
  process.env.ADMIN_TEST_TOKEN ||
  process.env.LOCAL_ADMIN_API_TOKEN ||
  ''
).trim();

const FETCH_TIMEOUT_MS = 120_000;

function argValue(flag: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1).trim() : undefined;
}

async function fetchBundle(url: string): Promise<unknown> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  clearTimeout(to);
  if (res.status === 401) {
    throw new Error('401 Unauthorized: ADMIN_API_TOKEN invalid or missing');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<unknown>;
}

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment. Set it in repo root .env.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const outPath = argValue('--out');
  const params = new URLSearchParams();
  const sections = argValue('--sections');
  if (sections) params.set('sections', sections);
  if (args.includes('--include-probe-payloads')) params.set('include_probe_payloads', '1');
  if (args.includes('--refresh-coverage')) params.set('refresh_coverage', '1');
  if (args.includes('--refresh-lender-universe')) params.set('refresh_lender_universe', '1');
  const since = argValue('--since');
  if (since) params.set('since', since);
  const logLimit = argValue('--log-limit');
  if (logLimit) params.set('log_limit', logLimit);

  const q = params.toString();
  const url = q ? `${BASE}?${q}` : BASE;

  try {
    const data = await fetchBundle(url);
    const text = `${JSON.stringify(data, null, 2)}\n`;
    if (outPath) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(outPath, text, 'utf8');
      console.error(`Wrote ${outPath}`);
    } else {
      process.stdout.write(text);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main();
