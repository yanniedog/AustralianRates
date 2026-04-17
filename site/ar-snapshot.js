/**
 * Fetches the server-precomputed `/snapshot` bundle for the current section and exposes
 * a synchronous `lookup(url)` helper so `ar-network.js` can short-circuit the per-endpoint
 * requests (site-ui, filters, overview, latest-all, changes, executive-summary, rba, cpi)
 * to zero network round-trips after the snapshot has loaded.
 *
 * Heavy endpoints (analytics/series, report-plot) keep their own caches and are not
 * short-circuited here; the snapshot payload carries their precomputed bodies under
 * `reportPlotMoves` / `reportPlotBands` for callers that want to consume them directly.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var SNAPSHOT = {
        ready: null,
        payload: null,
        data: null,
        loadedAt: 0,
        failed: false,
        pendingStartedAt: 0,
    };
    window.AR.snapshot = SNAPSHOT;

    var PATTERN_MATCHERS = [
        { suffix: '/site-ui', dataKey: 'siteUi', allowedKeys: [] },
        { suffix: '/filters', dataKey: 'filters', allowedKeys: [] },
        { suffix: '/overview', dataKey: 'overview', allowedKeys: ['section'] },
        { suffix: '/latest-all', dataKey: 'latestAll', allowedKeys: ['limit'] },
        { suffix: '/changes', dataKey: 'changes', allowedKeys: ['limit', 'offset'] },
        { suffix: '/executive-summary', dataKey: 'executiveSummary', allowedKeys: ['window_days'] },
        { suffix: '/rba/history', dataKey: 'rbaHistory', allowedKeys: [] },
        { suffix: '/cpi/history', dataKey: 'cpiHistory', allowedKeys: [] },
    ];

    function apiBasePath() {
        var base = window.AR && window.AR.config && window.AR.config.apiBase;
        if (!base) return '';
        try {
            return new URL(String(base), window.location.href).pathname.replace(/\/+$/, '');
        } catch (_err) {
            return String(base).replace(/^https?:\/\/[^\/]+/, '').replace(/\/+$/, '');
        }
    }

    function parseUrl(url) {
        try {
            return new URL(String(url || ''), window.location.href);
        } catch (_err) {
            return null;
        }
    }

    function hasOnlyAllowedParams(parsedUrl, allowedKeys) {
        var allowed = Array.isArray(allowedKeys) ? allowedKeys : [];
        var extra = false;
        parsedUrl.searchParams.forEach(function (_value, key) {
            if (extra) return;
            if (key === 'cache_bust') return;
            if (allowed.indexOf(key) >= 0) return;
            extra = true;
        });
        return !extra;
    }

    function matchPattern(parsedUrl) {
        var basePath = apiBasePath();
        if (!basePath) return null;
        var pathname = parsedUrl.pathname || '';
        if (pathname.indexOf(basePath) !== 0) return null;
        var relative = pathname.slice(basePath.length) || '/';
        for (var i = 0; i < PATTERN_MATCHERS.length; i++) {
            var matcher = PATTERN_MATCHERS[i];
            if (relative === matcher.suffix || relative === matcher.suffix + '/') {
                return matcher;
            }
        }
        return null;
    }

    /** Identifies whether `url` COULD be served by the snapshot regardless of whether it's loaded yet. */
    function isSnapshottableUrl(url) {
        var parsed = parseUrl(url);
        if (!parsed) return false;
        var matcher = matchPattern(parsed);
        if (!matcher) return false;
        return hasOnlyAllowedParams(parsed, matcher.allowedKeys);
    }

    /** Returns the cached response body for `url` when the snapshot is loaded and contains it; otherwise null. */
    function lookup(url) {
        if (!SNAPSHOT.data) return null;
        var parsed = parseUrl(url);
        if (!parsed) return null;
        var matcher = matchPattern(parsed);
        if (!matcher) return null;
        if (!hasOnlyAllowedParams(parsed, matcher.allowedKeys)) return null;
        var value = SNAPSHOT.data[matcher.dataKey];
        if (value == null) return null;
        return value;
    }

    function dispatchReady(payload) {
        try {
            window.dispatchEvent(new CustomEvent('AR:snapshot-ready', { detail: payload || null }));
        } catch (_err) {
            /* ignore */
        }
    }

    function start() {
        if (SNAPSHOT.ready) return SNAPSHOT.ready;
        var base = window.AR && window.AR.config && window.AR.config.apiBase;
        if (!base) return null;
        SNAPSHOT.pendingStartedAt = Date.now();
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = window.setTimeout(function () {
            if (controller) {
                try { controller.abort(); } catch (_err) { /* ignore */ }
            }
        }, 10000);
        var url = String(base).replace(/\/+$/, '') + '/snapshot';
        SNAPSHOT.ready = fetch(url, {
            method: 'GET',
            cache: 'default',
            signal: controller ? controller.signal : undefined,
        })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (payload) {
                if (payload && payload.ok === false) return null;
                var body = payload && payload.data ? payload.data : null;
                if (!body) return null;
                SNAPSHOT.payload = payload;
                SNAPSHOT.data = body;
                SNAPSHOT.loadedAt = Date.now();
                dispatchReady(payload);
                return payload;
            })
            .catch(function () {
                SNAPSHOT.failed = true;
                dispatchReady(null);
                return null;
            })
            .finally(function () {
                window.clearTimeout(timeoutId);
            });
        return SNAPSHOT.ready;
    }

    /** Wait up to `timeoutMs` for the snapshot to resolve; resolves with null on timeout. */
    function awaitReady(timeoutMs) {
        if (!SNAPSHOT.ready) {
            var started = start();
            if (!started) return Promise.resolve(null);
        }
        var deadline = Math.max(0, Number(timeoutMs) || 0);
        return Promise.race([
            SNAPSHOT.ready.then(function () { return SNAPSHOT.data; }),
            new Promise(function (resolve) { window.setTimeout(function () { resolve(null); }, deadline); }),
        ]);
    }

    SNAPSHOT.start = start;
    SNAPSHOT.lookup = lookup;
    SNAPSHOT.isSnapshottableUrl = isSnapshottableUrl;
    SNAPSHOT.awaitReady = awaitReady;

    // Kick off immediately so the bundle races script loading and the first user-driven fetch.
    start();
})();
