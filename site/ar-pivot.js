(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var sc = window.AR.sectionConfig || {};
    var utils = window.AR.utils || {};
    var network = window.AR.network || {};
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var tabState = state && state.state ? state.state : {};
    var clientLog = utils.clientLog || function () {};
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };

    var pivotFieldLabels = sc.pivotFieldLabels || {};
    var pivotLoadPromise = null;
    var pivotLoadFingerprint = '';
    var pivotRequestToken = 0;
    var preloadTimerId = null;

    function pivotRowFromApi(apiRow) {
        var out = {};
        var key;
        for (key in pivotFieldLabels) {
            if (Object.prototype.hasOwnProperty.call(apiRow, key)) {
                out[pivotFieldLabels[key]] = apiRow[key];
            }
        }
        return out;
    }

    function registerPivotFormatters() {
        if (typeof $ === 'undefined' || !$.pivotUtilities || !$.pivotUtilities.aggregators) return;
        var aggregators = $.pivotUtilities.aggregators;
        var Average = aggregators['Average'];
        var Sum = aggregators['Sum'];
        if (Average) {
            aggregators['Average (as %)'] = function () {
                var a = Average.apply(this, arguments);
                var origFormat = a.format;
                a.format = function (x) {
                    var n = Number(x);
                    return Number.isFinite(n) ? n.toFixed(2) + '%' : (origFormat ? origFormat(x) : String(x));
                };
                return a;
            };
        }
        if (Sum) {
            aggregators['Sum (as $)'] = function () {
                var s = Sum.apply(this, arguments);
                var origFormat = s.format;
                s.format = function (x) {
                    var n = Number(x);
                    return Number.isFinite(n) ? '$' + n.toFixed(2) : (origFormat ? origFormat(x) : String(x));
                };
                return s;
            };
        }
    }

    function stableParams(params) {
        var normalized = {};
        Object.keys(params || {}).sort().forEach(function (key) {
            normalized[key] = params[key];
        });
        return normalized;
    }

    function currentPivotFingerprint() {
        var params = stableParams(buildFilterParams());
        params.representation = els.pivotRepresentation ? String(els.pivotRepresentation.value || 'change') : 'change';
        return JSON.stringify(params);
    }

    function setPivotStatus(message) {
        if (els.pivotStatus) els.pivotStatus.textContent = String(message || '');
    }

    function isPivotFresh(fingerprint) {
        return !!(tabState.pivotLoaded &&
            tabState.pivotFingerprint === fingerprint &&
            els.pivotOutput &&
            els.pivotOutput.childElementCount);
    }

    function buildPivotUiOptions() {
        registerPivotFormatters();

        var renderers = {};
        var baseRenderers = $.pivotUtilities.renderers || {};
        ['Table', 'Table Barchart'].forEach(function (name) {
            if (baseRenderers[name]) renderers[name] = baseRenderers[name];
        });
        if (!Object.keys(renderers).length) renderers = baseRenderers;
        var defaults = sc.pivotDefaults || {};
        var rateAggregator = ($.pivotUtilities.aggregators && $.pivotUtilities.aggregators[defaults.aggregator]) ? defaults.aggregator : 'Average';

        var narrow = window.innerWidth <= 760;
        var pivotMargin = narrow ? 30 : 80;
        var pivotWidth = Math.min(1100, window.innerWidth - pivotMargin);
        var pivotHeight = Math.max(280, Math.min(500, window.innerHeight - 200));

        return {
            rows: defaults.rows || ['Bank'],
            cols: defaults.cols || [],
            vals: defaults.vals || ['Interest Rate (%)'],
            aggregatorName: rateAggregator,
            renderers: renderers,
            rendererName: defaults.rendererName || 'Table',
            rendererOptions: {
                plotly: { width: pivotWidth, height: pivotHeight },
            },
            localeStrings: { totals: 'Averages' },
        };
    }

    function invalidatePivot(options) {
        var opts = options || {};
        if (preloadTimerId) {
            window.clearTimeout(preloadTimerId);
            preloadTimerId = null;
        }
        pivotRequestToken += 1;
        pivotLoadPromise = null;
        pivotLoadFingerprint = '';
        tabState.pivotLoaded = false;
        tabState.pivotFingerprint = '';
        tabState.pivotLoading = false;
        if (opts.clearOutput && els.pivotOutput) els.pivotOutput.innerHTML = '';
        if (!opts.skipStatus) setPivotStatus(opts.message || 'Refreshing advanced analysis...');
    }

    function fetchAllRateRows(baseParams, onProgress) {
        var params = {};
        Object.keys(baseParams || {}).forEach(function (key) { params[key] = baseParams[key]; });
        params.representation = els.pivotRepresentation ? String(els.pivotRepresentation.value || 'change') : 'change';
        var request = requestJson
            ? requestJson(apiBase + '/analytics/pivot', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                requestLabel: 'Pivot rows',
                timeoutMs: 20000,
                retryCount: 0,
            }).then(function (result) { return result.data; })
            : fetch((window.AR.network && window.AR.network.appendCacheBust ? window.AR.network.appendCacheBust(apiBase + '/analytics/pivot') : apiBase + '/analytics/pivot'), {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ' for /analytics/pivot');
                return response.json();
            });
        return request.then(function (payload) {
            var rows = Array.isArray(payload.rows) ? payload.rows : [];
            var total = Number(payload.total || rows.length || 0);
            var representation = String(payload.representation || params.representation || 'day');
            var fallbackReason = payload.fallback_reason ? String(payload.fallback_reason) : '';
            if (typeof onProgress === 'function') {
                onProgress({
                    page: 1,
                    lastPage: 1,
                    loaded: rows.length,
                    total: total,
                    truncated: false,
                });
            }
            return {
                rows: rows,
                total: total,
                truncated: false,
                representation: representation,
                fallbackReason: fallbackReason,
            };
        });
    }

    function loadPivotData(options) {
        var opts = options || {};
        if (!els.pivotOutput) return Promise.resolve();

        var fp = buildFilterParams();
        var fingerprint = currentPivotFingerprint();

        if (!opts.force && isPivotFresh(fingerprint)) {
            return Promise.resolve({ reused: true });
        }

        if (!opts.force && pivotLoadPromise && pivotLoadFingerprint === fingerprint) {
            return pivotLoadPromise;
        }

        if (preloadTimerId) {
            window.clearTimeout(preloadTimerId);
            preloadTimerId = null;
        }

        var requestToken = ++pivotRequestToken;
        var statusPrefix = opts.statusPrefix || 'Loading advanced analysis... ';
        pivotLoadFingerprint = fingerprint;
        tabState.pivotLoading = true;
        setPivotStatus(opts.statusMessage || 'Loading advanced analysis...');
        clientLog('info', 'Pivot load started', {
            reason: opts.reason || 'manual',
            section: window.AR.section || 'home-loans',
        });

        pivotLoadPromise = fetchAllRateRows(fp, function (progress) {
            if (requestToken !== pivotRequestToken) return;
            setPivotStatus(
                statusPrefix +
                progress.loaded.toLocaleString() + ' of ' +
                progress.total.toLocaleString() + ' rows (' +
                progress.page + '/' + progress.lastPage + ' pages).'
            );
        }).then(function (payload) {
            if (requestToken !== pivotRequestToken) return { superseded: true };

            var data = payload.rows || [];
            var effectiveRepresentation = String(payload.representation || (els.pivotRepresentation ? els.pivotRepresentation.value : 'change') || 'change');
            if (els.pivotRepresentation && els.pivotRepresentation.value !== effectiveRepresentation) {
                els.pivotRepresentation.value = effectiveRepresentation;
            }
            fingerprint = currentPivotFingerprint();
            if (data.length === 0) {
                setPivotStatus('No data returned. Try broadening your filters or date range.');
                tabState.pivotLoaded = false;
                tabState.pivotFingerprint = '';
                clientLog('warn', 'Pivot load returned no data');
                return { rows: 0 };
            }

            setPivotStatus(
                'Loaded ' + data.length.toLocaleString() + ' rows.' +
                (payload.fallbackReason ? ' Daily fallback applied.' : '') +
                ' Drag fields to refine the current analysis.'
            );

            clientLog('info', 'Pivot load completed', {
                rows: data.length,
                total: Number(payload.total || data.length),
                truncated: !!payload.truncated,
                reason: opts.reason || 'manual',
            });

            $(els.pivotOutput).empty().pivotUI(data.map(pivotRowFromApi), buildPivotUiOptions(), true);
            tabState.pivotLoaded = true;
            tabState.pivotFingerprint = fingerprint;
            return { rows: data.length };
        }).catch(function (err) {
            if (requestToken !== pivotRequestToken) return { superseded: true };
            setPivotStatus('Error loading advanced analysis: ' + describeError(err, 'Analysis rows could not be loaded.'));
            tabState.pivotLoaded = false;
            tabState.pivotFingerprint = '';
            clientLog('error', 'Pivot load failed', {
                message: describeError(err, 'Analysis rows could not be loaded.'),
                reason: opts.reason || 'manual',
            });
            return { error: true };
        }).finally(function () {
            if (requestToken !== pivotRequestToken) return;
            tabState.pivotLoading = false;
            pivotLoadPromise = null;
            pivotLoadFingerprint = '';
        });

        return pivotLoadPromise;
    }

    function preloadPivotData(options) {
        var opts = options || {};
        var fingerprint = currentPivotFingerprint();

        if (!opts.force && isPivotFresh(fingerprint)) return Promise.resolve({ reused: true });

        if (preloadTimerId) window.clearTimeout(preloadTimerId);
        preloadTimerId = window.setTimeout(function () {
            preloadTimerId = null;
            loadPivotData({
                force: !!opts.force,
                reason: opts.reason || 'preload',
                statusMessage: opts.statusMessage || 'Preparing advanced analysis...',
                statusPrefix: opts.statusPrefix || 'Preparing advanced analysis... ',
            });
        }, opts.immediate ? 0 : (typeof opts.delay === 'number' ? opts.delay : 700));

        return Promise.resolve({ scheduled: true });
    }

    function ensurePivotLoaded(options) {
        var opts = options || {};
        var fingerprint = currentPivotFingerprint();
        if (isPivotFresh(fingerprint)) return Promise.resolve({ reused: true });
        return loadPivotData({
            force: !!opts.force,
            reason: opts.reason || 'ensure-visible',
            statusMessage: opts.statusMessage || 'Loading advanced analysis...',
            statusPrefix: opts.statusPrefix || 'Loading advanced analysis... ',
        });
    }

    window.AR.pivot = {
        ensurePivotLoaded: ensurePivotLoaded,
        invalidatePivot: invalidatePivot,
        loadPivotData: loadPivotData,
        preloadPivotData: preloadPivotData,
    };
})();
