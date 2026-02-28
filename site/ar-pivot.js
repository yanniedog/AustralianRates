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

    var pivotFieldLabels = sc.pivotFieldLabels || {};

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

    function fetchRatesPage(params) {
        var q = new URLSearchParams(params || {});
        return fetch(apiBase + '/rates?' + q.toString())
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
            if (typeof onProgress === 'function') {
                onProgress({
                    page: page,
                    lastPage: lastPage,
                    loaded: rows.length,
                    total: total,
                });
            }
            page += 1;
        } while (page <= lastPage);
        return { rows: rows, total: total || rows.length };
    }

    async function loadPivotData() {
        if (!els.pivotOutput) return;
        if (els.pivotStatus) els.pivotStatus.textContent = 'Loading data for pivot...';
        clientLog('info', 'Pivot load started');

        try {
            var fp = buildFilterParams();
            var payload = await fetchAllRateRows(fp, function (progress) {
                if (!els.pivotStatus) return;
                els.pivotStatus.textContent =
                    'Loading data for pivot... ' +
                    progress.loaded.toLocaleString() + ' of ' +
                    progress.total.toLocaleString() + ' rows (' +
                    progress.page + '/' + progress.lastPage + ' pages).';
            });
            var data = payload.rows || [];
            if (data.length === 0) {
                if (els.pivotStatus) els.pivotStatus.textContent = 'No data returned. Try broadening your filters or date range.';
                clientLog('warn', 'Pivot load returned no data');
                return;
            }
            if (els.pivotStatus) {
                els.pivotStatus.textContent =
                    'Loaded ' + data.length.toLocaleString() + ' rows across all pages. Drag fields to configure the pivot.';
            }
            clientLog('info', 'Pivot load completed', {
                rows: data.length,
                total: Number(payload.total || data.length),
            });

            var pivotData = data.map(pivotRowFromApi);
            registerPivotFormatters();

            var renderers = $.extend($.pivotUtilities.renderers, $.pivotUtilities.plotly_renderers);
            var defaults = sc.pivotDefaults || {};
            var rateAggregator = ($.pivotUtilities.aggregators && $.pivotUtilities.aggregators[defaults.aggregator]) ? defaults.aggregator : 'Average';

            var narrow = window.innerWidth <= 760;
            var pivotMargin = narrow ? 30 : 80;
            var pivotWidth = Math.min(1100, window.innerWidth - pivotMargin);
            var pivotHeight = Math.max(280, Math.min(500, window.innerHeight - 200));

            $(els.pivotOutput).empty().pivotUI(pivotData, {
                rows: defaults.rows || ['Bank'],
                cols: defaults.cols || [],
                vals: defaults.vals || ['Interest Rate (%)'],
                aggregatorName: rateAggregator,
                renderers: renderers,
                rendererName: 'Table',
                rendererOptions: {
                    plotly: { width: pivotWidth, height: pivotHeight },
                },
                localeStrings: { totals: 'Averages' },
            }, true);
            tabState.pivotLoaded = true;
        } catch (err) {
            if (els.pivotStatus) els.pivotStatus.textContent = 'Error loading pivot data: ' + String(err.message || err);
            clientLog('error', 'Pivot load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.pivot = { loadPivotData: loadPivotData };
})();
