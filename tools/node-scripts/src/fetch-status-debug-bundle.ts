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
const DEBUG_ENDPOINT = 'http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be';
const DEBUG_SESSION_ID = 'a0a9c5';

function debugLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
  // #region agent log
  fetch(DEBUG_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a0a9c5'},body:JSON.stringify({sessionId:DEBUG_SESSION_ID,runId:'status_bundle_fetch',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

function argValue(flag: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1).trim() : undefined;
}

async function fetchBundle(url: string): Promise<unknown> {
  debugLog('H5', 'fetch-status-debug-bundle.ts:fetchBundle:start', 'status_bundle_fetch_started', {
    origin: ORIGIN,
    hasToken: Boolean(token),
    urlHasQuery: url.includes('?'),
  });
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
  debugLog('H6', 'fetch-status-debug-bundle.ts:fetchBundle:response', 'status_bundle_fetch_response', {
    status: res.status,
    ok: res.ok,
    statusText: res.statusText,
  });
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
    const payload = data as {
      ok?: unknown;
      health?: { latest?: { overall_ok?: unknown; failures?: unknown; economic?: { summary?: Record<string, unknown> } } };
    };
    debugLog('H7', 'fetch-status-debug-bundle.ts:main:bundle_snapshot', 'status_bundle_runtime_snapshot', {
      ok: payload?.ok ?? null,
      overallOk: payload?.health?.latest?.overall_ok ?? null,
      failures: Array.isArray(payload?.health?.latest?.failures) ? payload.health.latest.failures : null,
      economicSummary: payload?.health?.latest?.economic?.summary ?? null,
    });
    const findings = ((payload?.health?.latest?.economic as { findings?: Array<{ code?: unknown; sample?: unknown }> } | undefined)?.findings) ?? [];
    const errorStatusFinding = findings.find((f) => String(f?.code ?? '') === 'economic_error_status_rows');
    debugLog('H9', 'fetch-status-debug-bundle.ts:main:error_status_rows', 'economic_error_status_rows_snapshot', {
      sample: Array.isArray(errorStatusFinding?.sample) ? errorStatusFinding?.sample : [],
      findingCodes: findings.map((f) => String(f?.code ?? '')),
    });
    const text = `${JSON.stringify(data, null, 2)}\n`;
    if (outPath) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(outPath, text, 'utf8');
      debugLog('H8', 'fetch-status-debug-bundle.ts:main:write', 'status_bundle_written_to_file', {
        outPath,
        bytes: text.length,
      });
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
