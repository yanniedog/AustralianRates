(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var tabState = state && state.state ? state.state : {};

    var pivotFieldLabels = {
        collection_date: 'Date',
        bank_name: 'Bank',
        interest_rate: 'Interest Rate (%)',
        comparison_rate: 'Comparison Rate (%)',
        rate_structure: 'Structure',
        security_purpose: 'Purpose',
        repayment_type: 'Repayment',
        lvr_tier: 'LVR',
        feature_set: 'Feature',
        product_name: 'Product',
        annual_fee: 'Annual Fee ($)',
        rba_cash_rate: 'Cash Rate (%)',
        run_source: 'Source',
        parsed_at: 'Checked At',
        source_url: 'Source URL',
        data_quality_flag: 'Quality',
    };

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

    function loadPivotData() {
        if (!els.pivotOutput) return;
        if (els.pivotStatus) els.pivotStatus.textContent = 'Loading data for pivot...';

        var fp = buildFilterParams();
        fp.size = '10000';
        fp.page = '1';
        var q = new URLSearchParams(fp);

        fetch(apiBase + '/rates?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (response) {
                var data = response.data || [];
                if (data.length === 0) {
                    if (els.pivotStatus) els.pivotStatus.textContent = 'No data returned. Try broadening your filters or date range.';
                    return;
                }
                var total = response.total || data.length;
                var warning = total > 10000 ? ' (showing first 10,000 of ' + total.toLocaleString() + ' rows)' : '';
                var meta = response.meta || {};
                var mix = meta.source_mix || {};
                var scheduled = Number(mix.scheduled || 0).toLocaleString();
                var manual = Number(mix.manual || 0).toLocaleString();
                var mode = String(meta.source_mode || 'all');
                if (els.pivotStatus) els.pivotStatus.textContent = 'Loaded ' + data.length.toLocaleString() + ' rows' + warning + ' [mode=' + mode + ', scheduled=' + scheduled + ', manual=' + manual + ']. Drag fields to configure the pivot.';

                var pivotData = data.map(pivotRowFromApi);
                registerPivotFormatters();

                var renderers = $.extend($.pivotUtilities.renderers, $.pivotUtilities.plotly_renderers);
                var rateAggregator = ($.pivotUtilities.aggregators && $.pivotUtilities.aggregators['Average (as %)']) ? 'Average (as %)' : 'Average';

                $(els.pivotOutput).empty().pivotUI(pivotData, {
                    rows: ['Bank'],
                    cols: ['Structure'],
                    vals: ['Interest Rate (%)'],
                    aggregatorName: rateAggregator,
                    renderers: renderers,
                    rendererName: 'Table',
                    rendererOptions: {
                        plotly: { width: Math.min(1100, window.innerWidth - 80), height: 500 },
                    },
                    localeStrings: { totals: 'Averages' },
                }, true);
                tabState.pivotLoaded = true;
            })
            .catch(function (err) {
                if (els.pivotStatus) els.pivotStatus.textContent = 'Error loading pivot data: ' + String(err.message || err);
            });
    }

    window.AR.pivot = { loadPivotData: loadPivotData };
})();
