/**
 * Fetches the server-precomputed `/snapshot` bundle for the current section + scope and
 * exposes synchronous lookups so `ar-network.js` can short-circuit per-endpoint requests
 * to zero round-trips once a matching scope has been loaded.
 *
 * The public report pages boot on a non-empty chart window even when the URL omits
 * `chart_window`, so we treat the section default as the initial scope:
 * home loans / savings = 90D, term deposits = 30D.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var CHART_WINDOWS = ['30D', '90D', '180D', '1Y', 'ALL'];
    var WARM_WINDOWS = ['30D', '90D', '180D', '1Y', 'ALL'];

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
        bundles: {},
        pendingByScope: {},
        warmStarted: false,
    };
    window.AR.snapshot = SNAPSHOT;

    // `allowedKeys` are query params that may appear without disqualifying snapshot lookup.
    // `chart_window` and `preset` are resolved separately into a bundle scope.
    var PATTERN_MATCHERS = [
        { suffix: '/site-ui', dataKey: 'siteUi', allowedKeys: [] },
        { suffix: '/filters', dataKey: 'filters', allowedKeys: [] },
        { suffix: '/overview', dataKey: 'overview', allowedKeys: ['section'] },
        { suffix: '/latest-all', dataKey: 'latestAll', allowedKeys: ['limit', 'mode'] },
        { suffix: '/changes', dataKey: 'changes', allowedKeys: ['limit', 'offset'] },
        { suffix: '/executive-summary', dataKey: 'executiveSummary', allowedKeys: ['window_days'] },
        { suffix: '/rba/history', dataKey: 'rbaHistory', allowedKeys: [] },
        { suffix: '/cpi/history', dataKey: 'cpiHistory', allowedKeys: [] },
        {
            suffix: '/analytics/series',
            dataKey: 'analyticsSeries',
            allowedKeys: ['representation', 'compact', 'sort', 'dir', 'mode'],
            requiresDayRepresentation: true,
            requiredParams: { sort: 'collection_date', dir: 'asc' },
        },
        { suffix: '/analytics/report-plot', dataKey: 'reportPlotMoves', allowedKeys: ['mode'], requiredParams: { mode: 'moves' } },
        { suffix: '/analytics/report-plot', dataKey: 'reportPlotBands', allowedKeys: ['mode'], requiredParams: { mode: 'bands' } },
    ];

    function activeSection() {
        return (window.AR && window.AR.section)
            || (document.body && document.body.getAttribute('data-ar-section'))
            || 'home-loans';
    }

    function defaultChartWindowForSection(section) {
        var name = String(section || '').trim().toLowerCase();
        if (name === 'term-deposits') return '30D';
        if (name === 'home-loans' || name === 'savings') return '90D';
        return null;
    }

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
        var value = String(raw).trim().toUpperCase();
        return CHART_WINDOWS.indexOf(value) >= 0 ? value : null;
    }

    function normalizePreset(raw) {
        if (!raw) return null;
        var value = String(raw).trim().toLowerCase();
        return value === 'consumer-default' ? 'consumer-default' : null;
    }

    function isDefaultLikeParam(key, value) {
        var param = String(key || '').trim().toLowerCase();
        var text = String(value == null ? '' : value).trim().toLowerCase();
        if (!text) return false;
        return param === 'min_rate' && Number(text) === 0.01;
    }

    function resolveScope(chartWindow, preset) {
        if (preset === 'consumer-default' && chartWindow) return 'preset:consumer-default:window:' + chartWindow;
        if (preset === 'consumer-default') return 'preset:consumer-default';
        if (chartWindow) return 'window:' + chartWindow;
        return 'default';
    }

    function bundleKey(chartWindow, preset) {
        return resolveScope(chartWindow, preset);
    }

    function activateBundle(bundle) {
        if (!bundle || !bundle.data) return null;
        SNAPSHOT.payload = bundle.payload;
        SNAPSHOT.data = bundle.data;
        SNAPSHOT.scope = bundle.scope;
        SNAPSHOT.chartWindow = bundle.chartWindow;
        SNAPSHOT.preset = bundle.preset;
        SNAPSHOT.loadedAt = bundle.loadedAt;
        SNAPSHOT.failed = false;
        return bundle;
    }

    function storeBundle(payload, chartWindow, preset, activate) {
        if (!payload || !payload.data) return null;
        var scope = String(payload.scope || resolveScope(chartWindow, preset));
        var bundle = {
            payload: payload,
            data: payload.data,
            scope: scope,
            chartWindow: chartWindow || null,
            preset: preset || null,
            loadedAt: Date.now(),
            inlined: !!payload.__inline,
        };
        SNAPSHOT.bundles[scope] = bundle;
        if (activate !== false) activateBundle(bundle);
        return bundle;
    }

    function bundleForScope(chartWindow, preset) {
        return SNAPSHOT.bundles[bundleKey(chartWindow, preset)] || null;
    }

    function hasOnlyAllowedParams(parsedUrl, allowedKeys) {
        var allowed = Array.isArray(allowedKeys) ? allowedKeys : [];
        var extra = false;
        parsedUrl.searchParams.forEach(function (_value, key) {
            if (extra) return;
            if (key === 'cache_bust') return;
            if (key === 'chart_window' || key === 'preset') return;
            if (isDefaultLikeParam(key, _value)) return;
            if (allowed.indexOf(key) >= 0) return;
            extra = true;
        });
        return !extra;
    }

    function candidateMatchers(parsedUrl) {
        var basePath = apiBasePath();
        if (!basePath) return [];
        var pathname = parsedUrl.pathname || '';
        if (pathname.indexOf(basePath) !== 0) return [];
        var relative = pathname.slice(basePath.length) || '/';
        var matches = [];
        for (var i = 0; i < PATTERN_MATCHERS.length; i++) {
            var matcher = PATTERN_MATCHERS[i];
            if (relative === matcher.suffix || relative === matcher.suffix + '/') matches.push(matcher);
        }
        return matches;
    }

    function resolveMatcher(parsedUrl) {
        var matches = candidateMatchers(parsedUrl);
        for (var i = 0; i < matches.length; i++) {
            if (satisfiesMatcherRules(parsedUrl, matches[i])) return matches[i];
        }
        return null;
    }

    function satisfiesMatcherRules(parsedUrl, matcher) {
        if (!hasOnlyAllowedParams(parsedUrl, matcher.allowedKeys)) return false;
        if (matcher.requiresDayRepresentation) {
            var rep = String(parsedUrl.searchParams.get('representation') || '').trim().toLowerCase();
            if (rep && rep !== 'day') return false;
        }
        if (matcher.requiredParams) {
            var required = matcher.requiredParams;
            var keys = Object.keys(required);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var actual = parsedUrl.searchParams.get(key);
                if (actual == null || String(actual) !== String(required[key])) return false;
            }
        }
        if (matcher.dataKey === 'latestAll') {
            var mode = String(parsedUrl.searchParams.get('mode') || '').trim().toLowerCase();
            if (mode && mode !== 'all') return false;
        }
        if (matcher.dataKey === 'analyticsSeries') {
            var analyticsMode = String(parsedUrl.searchParams.get('mode') || '').trim().toLowerCase();
            if (analyticsMode && analyticsMode !== 'all') return false;
        }
        return true;
    }

    function resolveRequestScope(parsedUrl) {
        if (!parsedUrl) return { chartWindow: null, preset: null };
        var chartWindow = normalizeChartWindow(parsedUrl.searchParams.get('chart_window'));
        var preset = normalizePreset(parsedUrl.searchParams.get('preset'));
        return { chartWindow: chartWindow, preset: preset };
    }

    function bundleForScopeLessRequest(preset) {
        if (SNAPSHOT.data && String(SNAPSHOT.preset || '') === String(preset || '')) {
            return bundleForScope(SNAPSHOT.chartWindow, SNAPSHOT.preset) || {
                payload: SNAPSHOT.payload,
                data: SNAPSHOT.data,
                scope: SNAPSHOT.scope,
                chartWindow: SNAPSHOT.chartWindow,
                preset: SNAPSHOT.preset,
                loadedAt: SNAPSHOT.loadedAt,
            };
        }
        var exact = bundleForScope(null, preset || null);
        if (exact) return exact;
        var keys = Object.keys(SNAPSHOT.bundles);
        for (var i = 0; i < keys.length; i++) {
            var bundle = SNAPSHOT.bundles[keys[i]];
            if (String(bundle && bundle.preset || '') === String(preset || '')) return bundle;
        }
        return null;
    }

    function bundleForUrl(parsedUrl) {
        var requested = resolveRequestScope(parsedUrl);
        if (requested.chartWindow) return bundleForScope(requested.chartWindow, requested.preset);
        return bundleForScopeLessRequest(requested.preset);
    }

    function dispatchReady(payload) {
        try {
            window.dispatchEvent(new CustomEvent('AR:snapshot-ready', { detail: payload || null }));
        } catch (_err) {
            /* ignore */
        }
    }

    function scopeFromState() {
        try {
            var params = new URLSearchParams(window.location.search || '');
            var chartWindow = normalizeChartWindow(params.get('chart_window'));
            var preset = normalizePreset(params.get('preset'));
            if (!chartWindow) chartWindow = defaultChartWindowForSection(activeSection());
            return { chartWindow: chartWindow, preset: preset };
        } catch (_err) {
            return {
                chartWindow: defaultChartWindowForSection(activeSection()),
                preset: null,
            };
        }
    }

    function buildSnapshotUrl(apiBase, chartWindow, preset) {
        var url = String(apiBase).replace(/\/+$/, '') + '/snapshot';
        var qs = [];
        if (chartWindow) qs.push('chart_window=' + encodeURIComponent(chartWindow));
        if (preset) qs.push('preset=' + encodeURIComponent(preset));
        return qs.length ? url + '?' + qs.join('&') : url;
    }

    function fetchScopeBundle(scope, options) {
        var nextScope = scope || scopeFromState();
        var chartWindow = nextScope.chartWindow || null;
        var preset = nextScope.preset || null;
        var key = bundleKey(chartWindow, preset);
        var existing = SNAPSHOT.bundles[key];
        if (existing) {
            if (options && options.activate !== false) activateBundle(existing);
            return Promise.resolve(existing.payload);
        }
        if (SNAPSHOT.pendingByScope[key]) return SNAPSHOT.pendingByScope[key];

        var base = window.AR && window.AR.config && window.AR.config.apiBase;
        if (!base) return null;

        SNAPSHOT.pendingStartedAt = Date.now();
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = window.setTimeout(function () {
            if (!controller) return;
            try { controller.abort(); } catch (_err) { /* ignore */ }
        }, 10000);
        var url = buildSnapshotUrl(base, chartWindow, preset);
        var promise = fetch(url, {
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
                var bundle = storeBundle(payload, chartWindow, preset, !(options && options.activate === false));
                if (!bundle) return null;
                if (!options || options.activate !== false) {
                    SNAPSHOT.ready = Promise.resolve(bundle.payload);
                    dispatchReady(bundle.payload);
                }
                return bundle.payload;
            })
            .catch(function () {
                if (!options || options.activate !== false) {
                    SNAPSHOT.failed = true;
                    dispatchReady(null);
                }
                return null;
            })
            .finally(function () {
                window.clearTimeout(timeoutId);
                delete SNAPSHOT.pendingByScope[key];
            });

        SNAPSHOT.pendingByScope[key] = promise;
        return promise;
    }

    function maybeWarmReportWindows() {
        if (SNAPSHOT.warmStarted) return;
        var current = scopeFromState();
        if (!current.chartWindow) return;
        SNAPSHOT.warmStarted = true;
        window.setTimeout(function () {
            WARM_WINDOWS.filter(function (value) {
                return value !== current.chartWindow;
            }).forEach(function (value, index) {
                window.setTimeout(function () {
                    fetchScopeBundle({ chartWindow: value, preset: current.preset }, { activate: false }).catch(function () {
                        return null;
                    });
                }, index * 120);
            });
        }, 800);
    }

    function adoptInlineSnapshot(payload) {
        if (!payload || !payload.data) return false;
        payload.__inline = true;
        var scope = scopeFromState();
        var bundle = storeBundle(payload, scope.chartWindow, scope.preset, true);
        if (!bundle) return false;
        SNAPSHOT.inlined = true;
        SNAPSHOT.ready = Promise.resolve(bundle.payload);
        dispatchReady(bundle.payload);
        maybeWarmReportWindows();
        return true;
    }

    /** Identifies whether `url` could be served by some snapshot bundle. */
    function isSnapshottableUrl(url) {
        var parsed = parseUrl(url);
        if (!parsed) return false;
        return !!resolveMatcher(parsed);
    }

    /** Returns the cached response body for `url` when a matching scope bundle is loaded. */
    function lookup(url) {
        var parsed = parseUrl(url);
        if (!parsed) return null;
        var matcher = resolveMatcher(parsed);
        if (!matcher) return null;
        var bundle = bundleForUrl(parsed);
        if (!bundle || !bundle.data) return null;
        activateBundle(bundle);
        var value = bundle.data[matcher.dataKey];
        return value == null ? null : value;
    }

    function start(scope, options) {
        var targetScope = scope || scopeFromState();
        var key = bundleKey(targetScope.chartWindow, targetScope.preset);
        var existing = SNAPSHOT.bundles[key];
        if (existing) {
            if (!options || options.activate !== false) activateBundle(existing);
            SNAPSHOT.ready = Promise.resolve(existing.payload);
            return SNAPSHOT.ready;
        }

        // Prefer a snapshot already inlined by the Pages middleware.
        var inline = window.AR && window.AR.snapshotInline;
        if (inline && !SNAPSHOT.inlined && (!scope || key === bundleKey(scopeFromState().chartWindow, scopeFromState().preset))) {
            if (adoptInlineSnapshot(inline)) return SNAPSHOT.ready;
        }

        var started = fetchScopeBundle(targetScope, options);
        if (!started) return null;
        if (!options || options.activate !== false) {
            SNAPSHOT.ready = started;
            started.then(function () {
                maybeWarmReportWindows();
            });
        }
        return started;
    }

    /** Wait up to `timeoutMs` for the active scope bundle to resolve. */
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

    /** Wait for the specific snapshot scope implied by `url` if it is snapshottable. */
    function awaitUrl(url, timeoutMs) {
        var parsed = parseUrl(url);
        if (!parsed) return Promise.resolve(null);
        var matcher = resolveMatcher(parsed);
        if (!matcher) return Promise.resolve(null);
        var requested = resolveRequestScope(parsed);
        var targetScope = requested.chartWindow
            ? requested
            : { chartWindow: SNAPSHOT.chartWindow || scopeFromState().chartWindow, preset: requested.preset };
        var pending = start(targetScope, { activate: true });
        if (!pending) return Promise.resolve(null);
        var deadline = Math.max(0, Number(timeoutMs) || 0);
        return Promise.race([
            pending.then(function () {
                var bundle = bundleForUrl(parsed);
                return bundle && bundle.data ? bundle.data : null;
            }),
            new Promise(function (resolve) { window.setTimeout(function () { resolve(null); }, deadline); }),
        ]);
    }

    SNAPSHOT.start = start;
    SNAPSHOT.lookup = lookup;
    SNAPSHOT.isSnapshottableUrl = isSnapshottableUrl;
    SNAPSHOT.awaitReady = awaitReady;
    SNAPSHOT.awaitUrl = awaitUrl;

    start();
})();
