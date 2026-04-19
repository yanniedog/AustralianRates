/**
 * Pages Functions middleware that inlines the server-precomputed /snapshot JSON
 * into the initial HTML response, so the client has `window.AR.snapshotInline`
 * set before any `<script>` tag runs and `ar-snapshot.js` can skip its `/snapshot`
 * fetch.
 *
 * This file intentionally mirrors `functions/_middleware.js` so Pages projects
 * configured with `site` as the root directory still pick up the middleware.
 */

// Keep in sync with `SNAPSHOT_INLINE_RESPONSE_MAX_BYTES` in workers/api/src/utils/snapshot-inline-trim.ts
const MAX_INLINE_BYTES = 400000;
// Budget for the fallback HTTP subrequest. Only used when the CHART_CACHE_KV
// binding is not attached to the Pages project (direct KV reads are effectively
// free and do not need a timeout).
const SNAPSHOT_FETCH_TIMEOUT_MS = 1500;
/** Matches `SNAPSHOT_PAYLOAD_VERSION` in workers/api/src/db/snapshot-cache.ts. Bump together. */
const SNAPSHOT_KV_VERSION = 6;
const SECTION_KV_KEY = {
    'home-loan-rates': 'home_loans',
    'savings-rates': 'savings',
    'term-deposit-rates': 'term_deposits',
};

function resolveSection(pathname) {
    const clean = String(pathname || '').replace(/\/index\.html$/i, '').replace(/\/+$/, '/');
    if (clean === '/' || clean === '') return 'home-loan-rates';
    if (clean === '/savings/') return 'savings-rates';
    if (clean === '/term-deposits/') return 'term-deposit-rates';
    return null;
}

function normaliseChartWindow(value) {
    if (!value) return '';
    const upper = String(value).trim().toUpperCase();
    return ['30D', '90D', '180D', '1Y', 'ALL'].indexOf(upper) >= 0 ? upper : '';
}

function normalisePreset(value) {
    if (!value) return '';
    const lower = String(value).trim().toLowerCase();
    return lower === 'consumer-default' ? 'consumer-default' : '';
}

function defaultChartWindowForSection(section) {
    if (section === 'term-deposit-rates') return '30D';
    if (section === 'home-loan-rates' || section === 'savings-rates') return '90D';
    return '';
}

function buildScope(chartWindow, preset) {
    if (preset === 'consumer-default' && chartWindow) return 'preset:consumer-default:window:' + chartWindow;
    if (preset === 'consumer-default') return 'preset:consumer-default';
    if (chartWindow) return 'window:' + chartWindow;
    return 'default';
}

async function fetchSnapshotFromKv(env, sectionApiName, chartWindow, preset) {
    if (!env || !env.CHART_CACHE_KV) return null;
    const dbSection = SECTION_KV_KEY[sectionApiName];
    if (!dbSection) return null;
    const scope = buildScope(chartWindow, preset);
    const inlineKey = 'snapshot-inline:v' + SNAPSHOT_KV_VERSION + ':' + dbSection + ':' + scope;
    try {
        const body = await env.CHART_CACHE_KV.get(inlineKey);
        if (!body) return { ok: false, reason: 'kv-miss', url: 'kv:' + inlineKey };
        const parsed = JSON.parse(body);
        const wrapped = JSON.stringify({
            ok: true,
            section: parsed.section,
            scope: parsed.scope,
            builtAt: parsed.builtAt,
            data: parsed.data,
        });
        return { ok: true, body: wrapped, source: 'kv' };
    } catch (err) {
        const message = err && err.message ? String(err.message) : 'unknown';
        return { ok: false, reason: 'kv-error:' + message.slice(0, 60).replace(/[^A-Za-z0-9_.:-]/g, '_') };
    }
}

async function fetchSnapshotWithTimeout(origin, section, params) {
    const qs = new URLSearchParams();
    const chartWindow = normaliseChartWindow(params.get('chart_window')) || defaultChartWindowForSection(section);
    const preset = normalisePreset(params.get('preset'));
    if (chartWindow) qs.set('chart_window', chartWindow);
    if (preset) qs.set('preset', preset);
    qs.set('lite', '1');
    const url = origin + '/api/' + section + '/snapshot' + (qs.toString() ? '?' + qs.toString() : '');

    const timeoutPromise = new Promise(function (resolve) {
        setTimeout(function () { resolve(null); }, SNAPSHOT_FETCH_TIMEOUT_MS);
    });
    try {
        const response = await Promise.race([
            fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } }),
            timeoutPromise,
        ]);
        if (!response) {
            return { ok: false, reason: 'timeout', url };
        }
        if (!response.ok) {
            return { ok: false, reason: 'http-' + response.status, url };
        }
        const body = await Promise.race([response.text(), timeoutPromise]);
        if (!body) {
            return { ok: false, reason: 'body-timeout', url };
        }
        return { ok: true, body };
    } catch (err) {
        const message = err && err.message ? String(err.message) : String(err || 'unknown');
        return { ok: false, reason: 'error:' + message.slice(0, 60).replace(/[^A-Za-z0-9_.:-]/g, '_'), url };
    }
}

function wrapOriginalResponse(response, marker) {
    const mutable = new Response(response.body, response);
    mutable.headers.set('X-AR-Snapshot-Inline', marker);
    return mutable;
}

function inlineScriptFor(snapshotJson) {
    const safe = String(snapshotJson)
        .replace(/<\/script>/gi, '<\\/script>')
        .replace(/<!--/g, '<\\!--')
        .replace(/-->/g, '--\\>');
    return '<script>window.AR=window.AR||{};window.AR.snapshotInline=' + safe + ';</script>';
}

export async function onRequest(context) {
    const { request, next, env } = context;
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return next();

    const url = new URL(request.url);
    const section = resolveSection(url.pathname);
    if (!section) return next();

    const accept = (request.headers.get('accept') || '').toLowerCase();
    if (!accept.includes('text/html')) return next();

    const originalResponse = await next();
    const contentType = (originalResponse.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return wrapOriginalResponse(originalResponse, 'bypass-html');

    const chartWindow = normaliseChartWindow(url.searchParams.get('chart_window')) || defaultChartWindowForSection(section);
    const preset = normalisePreset(url.searchParams.get('preset'));

    const kvBound = !!(env && env.CHART_CACHE_KV);
    let result = await fetchSnapshotFromKv(env, section, chartWindow, preset);
    if (!result || !result.ok) {
        result = await fetchSnapshotWithTimeout(url.origin, section, url.searchParams);
    }
    if (!result.ok) {
        const diag = kvBound ? 'kv+' : 'kv-';
        return wrapOriginalResponse(originalResponse, 'miss:' + diag + ':' + result.reason);
    }
    const snapshotJson = result.body;
    if (snapshotJson.length > MAX_INLINE_BYTES) {
        return wrapOriginalResponse(originalResponse, 'bypass-size:' + snapshotJson.length);
    }

    const scriptTag = inlineScriptFor(snapshotJson);
    const rewriter = new HTMLRewriter().on('head', {
        element(el) {
            el.prepend(scriptTag, { html: true });
        },
    });
    const rewritten = rewriter.transform(originalResponse);
    const out = new Response(rewritten.body, rewritten);
    out.headers.set('X-AR-Snapshot-Inline', 'hit');
    out.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    return out;
}
