/**
 * Fetches the server-precomputed `/snapshot` bundle for the current section + scope and
 * exposes a synchronous `lookup(url)` helper so `ar-network.js` can short-circuit the
 * per-endpoint requests (site-ui, filters, overview, latest-all, changes,
 * executive-summary, rba, cpi, analytics/series) to zero network round-trips once the
 * bundle has loaded.
 *
 * Scope is derived from URL state: `?chart_window=30D&preset=consumer-default` fetches
 * the matching precomputed snapshot (same scope strings as chart_request_cache). When
 * the user later changes filters / windows beyond what the snapshot covers, the lookup
 * returns null and the request falls through to the live (still-cached) endpoints.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var CHART_WINDOWS = ['30D', '90D', '180D', '1Y', 'ALL'];

    var SNAPSHOT = {
        ready: null,
        payload: null,
        data: null,
        scope: 'default',
        chartWindow: null,
        preset: null,
        loadedAt: 0,
        failed: false,
        pendingStartedAt: 0,
    };
    window.AR.snapshot = SNAPSHOT;

    // `allowedKeys` are the query params that may appear on an incoming URL without
    // disqualifying it from snapshot lookup. `chart_window` and `preset` are not listed
    // here because they are validated separately against the loaded snapshot's scope.
    var PATTERN_MATCHERS = [
        { suffix: '/site-ui', dataKey: 'siteUi', allowedKeys: [] },
        { suffix: '/filters', dataKey: 'filters', allowedKeys: [] },
        { suffix: '/overview', dataKey: 'overview', allowedKeys: ['section'] },
        { suffix: '/latest-all', dataKey: 'latestAll', allowedKeys: ['limit'] },
        { suffix: '/changes', dataKey: 'changes', allowedKeys: ['limit', 'offset'] },
        { suffix: '/executive-summary', dataKey: 'executiveSummary', allowedKeys: ['window_days'] },
        { suffix: '/rba/history', dataKey: 'rbaHistory', allowedKeys: [] },
        { suffix: '/cpi/history', dataKey: 'cpiHistory', allowedKeys: [] },
        { suffix: '/analytics/series', dataKey: 'analyticsSeries', allowedKeys: ['representation', 'compact'], requiresDayRepresentation: true },
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

    function normalizeChartWindow(raw) {
        if (!raw) return null;
        var v = String(raw).trim().toUpperCase();
        return CHART_WINDOWS.indexOf(v) >= 0 ? v : null;
    }

    function normalizePreset(raw) {
        if (!raw) return null;
        var v = String(raw).trim().toLowerCase();
        return v === 'consumer-default' ? 'consumer-default' : null;
    }

    /** URL chart_window / preset match the loaded snapshot's scope. */
    function urlScopeMatchesLoaded(parsedUrl) {
        var urlWindow = normalizeChartWindow(parsedUrl.searchParams.get('chart_window'));
        var urlPreset = normalizePreset(parsedUrl.searchParams.get('preset'));
        return urlWindow === SNAPSHOT.chartWindow && urlPreset === SNAPSHOT.preset;
    }

    function hasOnlyAllowedParams(parsedUrl, allowedKeys) {
        var allowed = Array.isArray(allowedKeys) ? allowedKeys : [];
        var extra = false;
        parsedUrl.searchParams.forEach(function (_value, key) {
            if (extra) return;
            if (key === 'cache_bust') return;
            if (key === 'chart_window' || key === 'preset') return; // validated via scope compare
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

    function satisfiesMatcherRules(parsedUrl, matcher) {
        if (!hasOnlyAllowedParams(parsedUrl, matcher.allowedKeys)) return false;
        if (matcher.requiresDayRepresentation) {
            var rep = String(parsedUrl.searchParams.get('representation') || '').trim().toLowerCase();
            if (rep && rep !== 'day') return false;
        }
        return true;
    }

    /** Identifies whether `url` COULD be served by the snapshot regardless of load state. */
    function isSnapshottableUrl(url) {
        var parsed = parseUrl(url);
        if (!parsed) return false;
        var matcher = matchPattern(parsed);
        if (!matcher) return false;
        return satisfiesMatcherRules(parsed, matcher);
    }

    /** Returns the cached response body for `url` when the snapshot is loaded and contains it; otherwise null. */
    function lookup(url) {
        if (!SNAPSHOT.data) return null;
        var parsed = parseUrl(url);
        if (!parsed) return null;
        var matcher = matchPattern(parsed);
        if (!matcher) return null;
        if (!satisfiesMatcherRules(parsed, matcher)) return null;
        if (!urlScopeMatchesLoaded(parsed)) return null;
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

    function scopeFromState() {
        // Read chart_window/preset from `window.location.search` (public URL state).
        // Clients may override this before calling start() via window.AR.snapshot.setScope(...).
        try {
            var params = new URLSearchParams(window.location.search || '');
            return {
                chartWindow: normalizeChartWindow(params.get('chart_window')),
                preset: normalizePreset(params.get('preset')),
            };
        } catch (_err) {
            return { chartWindow: null, preset: null };
        }
    }

    function buildSnapshotUrl(apiBase, chartWindow, preset) {
        var url = String(apiBase).replace(/\/+$/, '') + '/snapshot';
        var qs = [];
        if (chartWindow) qs.push('chart_window=' + encodeURIComponent(chartWindow));
        if (preset) qs.push('preset=' + encodeURIComponent(preset));
        return qs.length ? url + '?' + qs.join('&') : url;
    }

    function start() {
        if (SNAPSHOT.ready) return SNAPSHOT.ready;
        var base = window.AR && window.AR.config && window.AR.config.apiBase;
        if (!base) return null;
        var scope = scopeFromState();
        SNAPSHOT.chartWindow = scope.chartWindow;
        SNAPSHOT.preset = scope.preset;
        SNAPSHOT.pendingStartedAt = Date.now();
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = window.setTimeout(function () {
            if (controller) {
                try { controller.abort(); } catch (_err) { /* ignore */ }
            }
        }, 10000);
        var url = buildSnapshotUrl(base, scope.chartWindow, scope.preset);
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
                SNAPSHOT.scope = String(payload.scope || 'default');
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
