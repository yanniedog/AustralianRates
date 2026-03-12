(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var sc = window.AR.sectionConfig || {};
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var tabState = state && state.state ? state.state : {};
    var clientLog = utils.clientLog || function () {};
    var MAX_PIVOT_ROWS = 10000;

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
        return JSON.stringify(stableParams(buildFilterParams()));
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

        var renderers = $.extend($.pivotUtilities.renderers, $.pivotUtilities.plotly_renderers);
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
        if (!opts.skipStatus) setPivotStatus(opts.message || 'Refreshing default pivot grid...');
    }

    function fetchRatesPage(params) {
        var q = new URLSearchParams(params || {});
        return fetch(apiBase + '/rates?' + q.toString(), { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ' for /rates');
                return response.json();
            });
    }

    async function fetchAllRateRows(baseParams, onProgress) {
        var page = 1;
        var lastPage = 1;
        var total = 0;
        var rows = [];
        var truncated = false;
        do {
            var params = {};
            Object.keys(baseParams || {}).forEach(function (key) { params[key] = baseParams[key]; });
            params.page = String(page);
            params.size = '1000';
            var response = await fetchRatesPage(params);
            var chunk = Array.isArray(response.data) ? response.data : [];
            total = Number(response.total || total || chunk.length || 0);
            lastPage = Math.max(1, Number(response.last_page || 1));
            rows = rows.concat(chunk);
            if (rows.length >= MAX_PIVOT_ROWS) {
                rows = rows.slice(0, MAX_PIVOT_ROWS);
                truncated = true;
            }
            if (typeof onProgress === 'function') {
                onProgress({
                    page: page,
                    lastPage: lastPage,
                    loaded: rows.length,
                    total: total,
                    truncated: truncated,
                });
            }
            if (truncated) break;
            page += 1;
        } while (page <= lastPage);
        return { rows: rows, total: total || rows.length, truncated: truncated };
    }

    function loadPivotData(options) {
        var opts = options || {};
        if (!els.pivotOutput) return Promise.resolve();

        var fp = buildFilterParams();
        var fingerprint = JSON.stringify(stableParams(fp));

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
        var statusPrefix = opts.statusPrefix || 'Loading default pivot grid... ';
        pivotLoadFingerprint = fingerprint;
        tabState.pivotLoading = true;
        setPivotStatus(opts.statusMessage || 'Loading default pivot grid...');
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
            if (data.length === 0) {
                setPivotStatus('No data returned. Try broadening your filters or date range.');
                tabState.pivotLoaded = false;
                tabState.pivotFingerprint = '';
                clientLog('warn', 'Pivot load returned no data');
                return { rows: 0 };
            }

            if (payload.truncated) {
                setPivotStatus(
                    'Loaded ' + data.length.toLocaleString() + ' of ' + Number(payload.total || data.length).toLocaleString() +
                    ' rows (capped at 10,000). Drag fields to refine the default grid.'
                );
            } else {
                setPivotStatus(
                    'Loaded ' + data.length.toLocaleString() + ' rows. Drag fields to refine the default grid.'
                );
            }

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
            setPivotStatus('Error loading pivot data: ' + String(err.message || err));
            tabState.pivotLoaded = false;
            tabState.pivotFingerprint = '';
            clientLog('error', 'Pivot load failed', {
                message: err && err.message ? err.message : String(err),
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
                statusMessage: opts.statusMessage || 'Preparing default pivot grid...',
                statusPrefix: opts.statusPrefix || 'Preparing default pivot grid... ',
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
            statusMessage: opts.statusMessage || 'Loading default pivot grid...',
            statusPrefix: opts.statusPrefix || 'Loading default pivot grid... ',
        });
    }

    window.AR.pivot = {
        ensurePivotLoaded: ensurePivotLoaded,
        invalidatePivot: invalidatePivot,
        loadPivotData: loadPivotData,
        preloadPivotData: preloadPivotData,
    };
})();
