/**
 * Fetch latest production logfile from www.australianrates.com.
 * Requires ADMIN_API_TOKEN in repo root .env.
 * Always fetches a fresh copy from the production API; never reads from local files.
 * If you redirect output to a local file (e.g. errors.jsonl), delete that file after processing.
 * Usage: node fetch-production-logs.js [--errors] [--warn] [--actionable] [--stats] [--fail-on-actionable] [--limit=N] [--since=ISO]
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

const FETCH_TIMEOUT_MS = 60_000;
const DEBUG_ENDPOINT = 'http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be';
const DEBUG_SESSION_ID = '7e559c';

function emitDebugLog(
  location: string,
  message: string,
  hypothesisId: string,
  runId: string,
  data: Record<string, unknown>,
): void {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DEBUG_SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      location,
      message,
      data,
      runId,
      hypothesisId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/x-ndjson',
    },
  });
  clearTimeout(to);
  if (res.status === 401) {
    throw new Error('401 Unauthorized: ADMIN_API_TOKEN invalid or missing');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/x-ndjson, text/plain',
    },
  });
  clearTimeout(to);
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
  const failOnActionable = args.includes('--fail-on-actionable');
  const sinceArg = args.find((a) => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.slice('--since='.length).trim() : '';
  const runId = `doctor-${Date.now()}`;
  emitDebugLog('tools/node-scripts/src/fetch-production-logs.ts:main', 'fetch-production-logs started', 'H1', runId, {
    doStats,
    doActionable,
    failOnActionable,
    doErrors,
    doWarn,
    limit,
    since: since || null,
  });

  const queryParams = (base: string, extra: Record<string, string> = {}): string => {
    const params = new URLSearchParams(extra);
    if (since) params.set('since', since);
    const sep = base.includes('?') ? '&' : '?';
    return params.toString() ? `${base}${sep}${params}` : base;
  };

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
      const issues = Array.isArray(actionable.issues) ? actionable.issues : [];
      emitDebugLog(
        'tools/node-scripts/src/fetch-production-logs.ts:actionable',
        'actionable payload received',
        'H2',
        runId,
        {
          ok: actionable.ok === true,
          issueCount: issues.length,
          topIssues: issues.slice(0, 8).map((issue) => {
            const row = issue as Record<string, unknown>;
            return {
              code: String(row.code ?? ''),
              title: String(row.title ?? ''),
              latest_source: String(row.latest_source ?? ''),
              latest_message: String(row.latest_message ?? ''),
              count: Number(row.count ?? 0),
            };
          }),
        },
      );
      if (failOnActionable) {
        emitDebugLog(
          'tools/node-scripts/src/fetch-production-logs.ts:fail-gate',
          'evaluating fail-on-actionable gate',
          'H3',
          runId,
          {
            actionableOk: actionable.ok === true,
            issueCount: issues.length,
            shouldExitNonZero: !actionable.ok || issues.length > 0,
          },
        );
        if (!actionable.ok) {
          console.error('[fetch-production-logs] --fail-on-actionable: actionable response ok=false.');
          process.exit(1);
        }
        if (issues.length > 0) {
          console.error(
            `[fetch-production-logs] --fail-on-actionable: ${issues.length} actionable issue group(s). See JSON above.`,
          );
          process.exit(1);
        }
      }
    }
    if (doErrors) {
      const url = queryParams(`${BASE}`, { format: 'jsonl', limit: String(limit), level: 'error' });
      const text = await fetchText(url);
      process.stdout.write(text);
      if (!text.endsWith('\n') && text.length > 0) process.stdout.write('\n');
    }
    if (doWarn) {
      const url = queryParams(`${BASE}`, { format: 'jsonl', limit: String(limit), level: 'warn' });
      const text = await fetchText(url);
      process.stdout.write(text);
      if (!text.endsWith('\n') && text.length > 0) process.stdout.write('\n');
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
