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

    /** Keys that may appear on cacheable public `/analytics/report-plot` URLs (keep in sync with ar-chart-data.js). */
    var REPORT_PLOT_ALLOWED_KEYS = [
        'mode',
        'security_purpose',
        'repayment_type',
        'rate_structure',
        'lvr_tier',
        'feature_set',
        'account_type',
        'rate_type',
        'deposit_tier',
        'balance_min',
        'balance_max',
        'dataset_mode',
    ];

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
        {
            suffix: '/analytics/report-plot',
            dataKey: 'reportPlotMoves',
            allowedKeys: REPORT_PLOT_ALLOWED_KEYS,
            requiredParams: { mode: 'moves' },
        },
        {
            suffix: '/analytics/report-plot',
            dataKey: 'reportPlotBands',
            allowedKeys: REPORT_PLOT_ALLOWED_KEYS,
            requiredParams: { mode: 'bands' },
        },
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

    function searchParamsToParamRecord(searchParams) {
        var p = {};
        if (!searchParams || typeof searchParams.forEach !== 'function') return p;
        searchParams.forEach(function (value, key) {
            p[String(key || '')] = value;
        });
        return p;
    }

    function isKnownChartWindowValue(value) {
        var text = String(value || '').trim().toUpperCase();
        return text === '' || CHART_WINDOWS.indexOf(text) >= 0;
    }

    function isDefaultishMinRateVal(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text) return true;
        return Number(text) === 0.01;
    }

    function isDisabledCompareEdgeCasesVal(value) {
        var text = String(value == null ? '' : value).trim().toLowerCase();
        return text === '0' || text === 'false' || text === 'no' || text === 'off';
    }

    /** Mirrors ar-chart-data.js hasNoSelectiveFilters + isCacheablePublicChartRequest for snapshot scope. */
    function isCacheablePublicRequestParams(sectionName, params, requestKind) {
        if (!params || typeof params !== 'object') return false;
        if (params.bank || params.banks) return false;
        if (params.include_removed === 'true') return false;
        if (params.include_manual === 'true') return false;
        if (isDisabledCompareEdgeCasesVal(params.exclude_compare_edge_cases)) return false;
        if (params.start_date || params.end_date) return false;
        if (!isKnownChartWindowValue(params.chart_window)) return false;
        if (params.dataset_mode && String(params.dataset_mode).trim() !== 'all') return false;
        if (requestKind === 'series' && params.mode && String(params.mode).trim() !== 'all') return false;

        var section = String(sectionName || '').trim().toLowerCase();
        if (section === 'home-loans') {
            var rawDefault = !params.security_purpose
                && !params.repayment_type
                && !params.rate_structure
                && !params.lvr_tier
                && !params.feature_set
                && isDefaultishMinRateVal(params.min_rate)
                && !params.max_rate
                && !params.min_comparison_rate
                && !params.max_comparison_rate;
            var consumerPreset = params.security_purpose === 'owner_occupied'
                && params.repayment_type === 'principal_and_interest'
                && params.rate_structure === 'variable'
                && params.lvr_tier === 'lvr_80-85%'
                && !params.feature_set
                && isDefaultishMinRateVal(params.min_rate)
                && !params.max_rate
                && !params.min_comparison_rate
                && !params.max_comparison_rate;
            return rawDefault || consumerPreset;
        }
        if (section === 'savings') {
            var savingsRawDefault = !params.account_type
                && !params.rate_type
                && !params.deposit_tier
                && !params.balance_min
                && !params.balance_max
                && isDefaultishMinRateVal(params.min_rate)
                && !params.max_rate;
            var savingsPreset = params.account_type === 'savings'
                && !params.rate_type
                && !params.deposit_tier
                && !params.balance_min
                && !params.balance_max
                && isDefaultishMinRateVal(params.min_rate)
                && !params.max_rate;
            return savingsRawDefault || savingsPreset;
        }
        if (section === 'term-deposits') {
            return !params.term_months
                && !params.deposit_tier
                && !params.interest_payment
                && !params.balance_min
                && !params.balance_max
                && isDefaultishMinRateVal(params.min_rate)
                && !params.max_rate;
        }
        return false;
    }

    function isConsumerPresetParamsShape(sectionName, params) {
        var section = String(sectionName || '').trim().toLowerCase();
        if (section === 'home-loans') {
            return params.security_purpose === 'owner_occupied'
                && params.repayment_type === 'principal_and_interest'
                && params.rate_structure === 'variable'
                && params.lvr_tier === 'lvr_80-85%'
                && !params.feature_set;
        }
        if (section === 'savings') {
            return params.account_type === 'savings';
        }
        return false;
    }

    /** Which snapshot KV row `/snapshot` fetch should use for the browser location (HTML inline alignment). */
    function inferSnapshotScopeForPage(section, searchParams) {
        var name = String(section || '').trim().toLowerCase();
        var chartWindow = normalizeChartWindow(searchParams.get('chart_window'))
            || defaultChartWindowForSection(name);
        if (name === 'term-deposits') return { chartWindow: chartWindow, preset: null };
        if (String(searchParams.get('view') || '').trim().toLowerCase() === 'analyst') {
            return { chartWindow: chartWindow, preset: null };
        }
        if (name === 'home-loans' || name === 'savings') {
            var explicit = normalizePreset(searchParams.get('preset'));
            if (explicit === 'consumer-default') return { chartWindow: chartWindow, preset: 'consumer-default' };
            return { chartWindow: chartWindow, preset: 'consumer-default' };
        }
        return { chartWindow: chartWindow, preset: null };
    }

    /** Which snapshot bundle satisfies this chart API URL (report-plot / series). */
    function inferSnapshotScopeForChartRequest(section, searchParams, requestKind) {
        var rk = String(requestKind || 'report-plot');
        var name = String(section || '').trim().toLowerCase();
        var chartWindow = normalizeChartWindow(searchParams.get('chart_window'))
            || defaultChartWindowForSection(name);
        if (name === 'term-deposits') return { chartWindow: chartWindow, preset: null };
        var explicit = normalizePreset(searchParams.get('preset'));
        if (explicit === 'consumer-default') {
            return { chartWindow: chartWindow, preset: 'consumer-default' };
        }
        var p = searchParamsToParamRecord(searchParams);
        if (!isCacheablePublicRequestParams(name, p, rk)) {
            return { chartWindow: chartWindow, preset: null };
        }
        if (isConsumerPresetParamsShape(name, p)) return { chartWindow: chartWindow, preset: 'consumer-default' };
        /** Public home/savings default slice: URL often omits consumer fields (syncUrlState strips some). Match consumer snapshot + middleware. */
        if (name === 'home-loans' || name === 'savings') {
            try {
                var pageView = new URLSearchParams(window.location.search || '').get('view');
                if (String(pageView || '').trim().toLowerCase() === 'analyst') {
                    return { chartWindow: chartWindow, preset: null };
                }
            } catch (_e) {
                /* ignore */
            }
            return { chartWindow: chartWindow, preset: 'consumer-default' };
        }
        return { chartWindow: chartWindow, preset: null };
    }

    function relativeApiPath(parsedUrl) {
        var basePath = apiBasePath();
        if (!basePath || !parsedUrl) return '';
        var pathname = parsedUrl.pathname || '';
        if (pathname.indexOf(basePath) !== 0) return '';
        return pathname.slice(basePath.length) || '/';
    }

    function isAnalyticsChartRequestPath(relative) {
        return relative === '/analytics/series' || relative === '/analytics/series/'
            || relative === '/analytics/report-plot' || relative === '/analytics/report-plot/';
    }

    function bundleKey(chartWindow, preset) {
        return resolveScope(chartWindow, preset);
    }

    function requestKey(chartWindow, preset, wantsLite) {
        return (wantsLite === false ? 'full:' : 'lite:') + bundleKey(chartWindow, preset);
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

    function storeBundle(payload, chartWindow, preset, activate, options) {
        if (!payload || !payload.data) return null;
        var wantsLite = !(options && options.lite === false);
        var scope = String(payload.scope || resolveScope(chartWindow, preset));
        var bundle = SNAPSHOT.bundles[scope] || {
            payload: null,
            data: null,
            scope: scope,
            chartWindow: chartWindow || null,
            preset: preset || null,
            loadedAt: 0,
            inlined: false,
            full: false,
        };
        if (!wantsLite || !bundle.full) {
            bundle.payload = payload;
            bundle.data = payload.data;
        }
        bundle.chartWindow = chartWindow || null;
        bundle.preset = preset || null;
        bundle.loadedAt = Date.now();
        bundle.inlined = bundle.inlined || !!payload.__inline;
        if (!wantsLite) bundle.full = true;
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
        if (matcher.dataKey === 'reportPlotMoves' || matcher.dataKey === 'reportPlotBands') {
            var datasetMode = String(parsedUrl.searchParams.get('dataset_mode') || '').trim().toLowerCase();
            if (datasetMode && datasetMode !== 'all') return false;
        }
        return true;
    }

    function bundleForUrl(parsedUrl) {
        if (!parsedUrl) return null;
        var section = activeSection();
        var rel = relativeApiPath(parsedUrl);
        var scopeParts = isAnalyticsChartRequestPath(rel)
            ? inferSnapshotScopeForChartRequest(
                section,
                parsedUrl.searchParams,
                rel.indexOf('report-plot') >= 0 ? 'report-plot' : 'series',
            )
            : inferSnapshotScopeForPage(section, new URLSearchParams(window.location.search || ''));
        return bundleForScope(scopeParts.chartWindow, scopeParts.preset);
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
            return inferSnapshotScopeForPage(activeSection(), new URLSearchParams(window.location.search || ''));
        } catch (_err) {
            return {
                chartWindow: defaultChartWindowForSection(activeSection()),
                preset: null,
            };
        }
    }

    function buildSnapshotUrl(apiBase, chartWindow, preset, wantsLite) {
        var url = String(apiBase).replace(/\/+$/, '') + '/snapshot';
        var qs = [];
        if (chartWindow) qs.push('chart_window=' + encodeURIComponent(chartWindow));
        if (preset) qs.push('preset=' + encodeURIComponent(preset));
        if (wantsLite !== false) qs.push('lite=1');
        return qs.length ? url + '?' + qs.join('&') : url;
    }

    function fetchScopeBundle(scope, options) {
        var opts = options || {};
        var wantsLite = opts.lite !== false;
        var nextScope = scope || scopeFromState();
        var chartWindow = nextScope.chartWindow || null;
        var preset = nextScope.preset || null;
        var key = bundleKey(chartWindow, preset);
        var existing = SNAPSHOT.bundles[key];
        if (existing && (wantsLite || existing.full)) {
            if (opts.activate !== false) activateBundle(existing);
            return Promise.resolve(existing.payload);
        }
        var pendingKey = requestKey(chartWindow, preset, wantsLite);
        if (SNAPSHOT.pendingByScope[pendingKey]) return SNAPSHOT.pendingByScope[pendingKey];

        var base = window.AR && window.AR.config && window.AR.config.apiBase;
        if (!base) return null;

        SNAPSHOT.pendingStartedAt = Date.now();
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = window.setTimeout(function () {
            if (!controller) return;
            try { controller.abort(); } catch (_err) { /* ignore */ }
        }, 10000);
        var url = buildSnapshotUrl(base, chartWindow, preset, wantsLite);
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
                var bundle = storeBundle(payload, chartWindow, preset, !(opts.activate === false), { lite: wantsLite });
                if (!bundle) return null;
                if (opts.activate !== false) {
                    SNAPSHOT.ready = Promise.resolve(bundle.payload);
                    dispatchReady(bundle.payload);
                }
                return bundle.payload;
            })
            .catch(function () {
                if (opts.activate !== false) {
                    SNAPSHOT.failed = true;
                    dispatchReady(null);
                }
                return null;
            })
            .finally(function () {
                window.clearTimeout(timeoutId);
                delete SNAPSHOT.pendingByScope[pendingKey];
            });

        SNAPSHOT.pendingByScope[pendingKey] = promise;
        return promise;
    }

    function enqueueWarm(scope, options) {
        return fetchScopeBundle(scope, options) || Promise.resolve(null);
    }

    function maybeWarmReportWindows() {
        if (SNAPSHOT.warmStarted) return;
        SNAPSHOT.warmStarted = true;
        var baseScope = scopeFromState();
        window.setTimeout(function () {
            enqueueWarm(baseScope, { activate: false, lite: false });
            CHART_WINDOWS.forEach(function (chartWindow) {
                if (String(chartWindow || '') === String(baseScope.chartWindow || '')) return;
                var nextScope = { chartWindow: chartWindow, preset: baseScope.preset };
                enqueueWarm(nextScope, { activate: false, lite: false });
            });
        }, 0);
    }

    function adoptInlineSnapshot(payload) {
        if (!payload || !payload.data) return false;
        payload.__inline = true;
        var pageScope = scopeFromState();
        var bundle = storeBundle(payload, pageScope.chartWindow, pageScope.preset, true, { lite: true });
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
        var wantsLite = !options || options.lite !== false;
        if (existing && (wantsLite || existing.full)) {
            if (!options || options.activate !== false) activateBundle(existing);
            SNAPSHOT.ready = Promise.resolve(existing.payload);
            return SNAPSHOT.ready;
        }

        // Prefer a snapshot already inlined by the Pages middleware (scope must match page + inline payload).
        var inline = window.AR && window.AR.snapshotInline;
        var pageScope = scopeFromState();
        var pageKey = bundleKey(pageScope.chartWindow, pageScope.preset);
        if (
            wantsLite
            && inline
            && !SNAPSHOT.inlined
            && String(inline.scope || '') === pageKey
            && (!scope || bundleKey(targetScope.chartWindow, targetScope.preset) === pageKey)
        ) {
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
        var section = activeSection();
        var rel = relativeApiPath(parsed);
        var targetScope = isAnalyticsChartRequestPath(rel)
            ? inferSnapshotScopeForChartRequest(
                section,
                parsed.searchParams,
                rel.indexOf('report-plot') >= 0 ? 'report-plot' : 'series',
            )
            : inferSnapshotScopeForPage(section, new URLSearchParams(window.location.search || ''));
        var wantsFull = isAnalyticsChartRequestPath(rel);
        var pending = start(targetScope, wantsFull ? { activate: true, lite: false } : { activate: true });
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
    SNAPSHOT.ensureFullScope = function (scope) {
        return fetchScopeBundle(scope || scopeFromState(), { activate: false, lite: false });
    };
    SNAPSHOT.getBundle = function (chartWindow, preset) {
        return bundleForScope(chartWindow || null, preset || null);
    };
    SNAPSHOT.listBundles = function () {
        return Object.keys(SNAPSHOT.bundles).map(function (key) { return SNAPSHOT.bundles[key]; });
    };
    SNAPSHOT.lookup = lookup;
    SNAPSHOT.isSnapshottableUrl = isSnapshottableUrl;
    SNAPSHOT.awaitReady = awaitReady;
    SNAPSHOT.awaitUrl = awaitUrl;

    start();
})();
