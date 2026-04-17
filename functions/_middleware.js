/**
 * Pages Functions middleware that inlines the server-precomputed /snapshot JSON
 * into the initial HTML response, so the client has `window.AR.snapshotInline`
 * set before any `<script>` tag runs and `ar-snapshot.js` can skip its `/snapshot`
 * fetch.
 *
 * See docs/snapshot-v2 plan. Plain JS (no TypeScript) to avoid any chance of
 * compilation issues inside the Pages build pipeline.
 */

const MAX_INLINE_BYTES = 400000;
// Worst-case budget for the snapshot subrequest + body read. The abort signal
// covers the FULL duration including `response.text()` — for a 260 KB KV-hot
// consumer-default body the body read is the dominant cost, so we give it a
// generous ceiling. The middleware will pass-through to Pages output on miss so
// a slow origin never blocks document delivery.
const SNAPSHOT_FETCH_TIMEOUT_MS = 1500;

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

async function fetchSnapshotWithTimeout(origin, section, params) {
    const qs = new URLSearchParams();
    const chartWindow = normaliseChartWindow(params.get('chart_window'));
    const preset = normalisePreset(params.get('preset'));
    if (chartWindow) qs.set('chart_window', chartWindow);
    if (preset) qs.set('preset', preset);
    const url = origin + '/api/' + section + '/snapshot' + (qs.toString() ? '?' + qs.toString() : '');

    const timeoutMarker = { timedOut: false };
    const timeoutPromise = new Promise(function (resolve) {
        setTimeout(function () { timeoutMarker.timedOut = true; resolve(null); }, SNAPSHOT_FETCH_TIMEOUT_MS);
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
    const { request, next } = context;
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

    const result = await fetchSnapshotWithTimeout(url.origin, section, url.searchParams);
    if (!result.ok) return wrapOriginalResponse(originalResponse, 'miss:' + result.reason);
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
