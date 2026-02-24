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

    var yLabels = {
        interest_rate: 'Interest Rate (%)',
        comparison_rate: 'Comparison Rate (%)',
        annual_fee: 'Annual Fee ($)',
        rba_cash_rate: 'RBA Cash Rate (%)',
    };
    var xLabels = {
        collection_date: 'Date',
        bank_name: 'Bank',
        rate_structure: 'Structure',
        lvr_tier: 'LVR',
        feature_set: 'Feature',
    };

    function getChartFieldValues() {
        return {
            xField: els.chartX ? els.chartX.value : 'collection_date',
            yField: els.chartY ? els.chartY.value : 'interest_rate',
            groupField: els.chartGroup ? els.chartGroup.value : '',
            chartType: els.chartType ? els.chartType.value : 'scatter',
        };
    }

    function buildGroupedTraces(data, xField, yField, groupField, chartType) {
        var groups = {};
        data.forEach(function (row) {
            var key = String(row[groupField] || 'Unknown');
            if (!groups[key]) {
                groups[key] = { x: [], y: [], firstRow: null };
            }
            groups[key].x.push(row[xField]);
            groups[key].y.push(Number(row[yField]));
            if (!groups[key].firstRow) groups[key].firstRow = row;
        });
        var traces = [];
        Object.keys(groups).sort().forEach(function (key) {
            var g = groups[key];
            var x = g.x;
            var y = g.y;
            var pairs = x.map(function (xv, i) { return [xv, y[i]]; });
            pairs.sort(function (a, b) {
                var ax = a[0];
                var bx = b[0];
                if (ax === bx) return 0;
                if (typeof ax === 'number' && typeof bx === 'number') return ax - bx;
                return String(ax).localeCompare(String(bx));
            });
            x = pairs.map(function (p) { return p[0]; });
            y = pairs.map(function (p) { return p[1]; });
            var traceName = key;
            if (groupField === 'product_key' && g.firstRow) {
                var r = g.firstRow;
                traceName = [r.bank_name, r.product_name, r.lvr_tier, r.rate_structure].filter(Boolean).join(' | ');
            }
            var trace = { x: x, y: y, name: traceName, type: chartType };
            if (chartType === 'scatter') {
                trace.mode = 'lines+markers';
                trace.marker = { size: 4 };
            }
            traces.push(trace);
        });
        return traces;
    }

    function buildUngroupedTrace(data, xField, yField, chartType) {
        var trace = {
            x: data.map(function (r) { return r[xField]; }),
            y: data.map(function (r) { return Number(r[yField]); }),
            type: chartType,
            name: yField,
        };
        if (chartType === 'scatter') {
            trace.mode = 'lines+markers';
            trace.marker = { size: 4 };
        }
        return [trace];
    }

    function buildTraces(data, xField, yField, groupField, chartType) {
        if (groupField) {
            return buildGroupedTraces(data, xField, yField, groupField, chartType);
        }
        return buildUngroupedTrace(data, xField, yField, chartType);
    }

    function buildLayout(xField, yField) {
        var yLabel = yLabels[yField] || yField;
        var xLabel = xLabels[xField] || xField;
        return {
            title: yLabel + ' by ' + xLabel,
            xaxis: { title: xLabel },
            yaxis: { title: yLabel },
            hovermode: 'closest',
            legend: { orientation: 'h', y: -0.2 },
            margin: { t: 50, l: 60, r: 20, b: 80 },
            height: 500,
        };
    }

    function drawChart() {
        if (!els.chartOutput) return;
        if (els.chartStatus) els.chartStatus.textContent = 'Loading chart data...';

        var fp = buildFilterParams();
        fp.size = '10000';
        fp.page = '1';
        fp.sort = els.chartX ? els.chartX.value : 'collection_date';
        fp.dir = 'asc';
        var q = new URLSearchParams(fp);

        fetch(apiBase + '/rates?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (response) {
                var data = response.data || [];
                if (data.length === 0) {
                    if (els.chartStatus) els.chartStatus.textContent = 'No data to chart. Adjust filters or date range.';
                    Plotly.purge(els.chartOutput);
                    return;
                }
                var fields = getChartFieldValues();
                var traces = buildTraces(data, fields.xField, fields.yField, fields.groupField, fields.chartType);
                var layout = buildLayout(fields.xField, fields.yField);
                Plotly.newPlot(els.chartOutput, traces, layout, { responsive: true });
                tabState.chartDrawn = true;
                var total = response.total || data.length;
                var suffix = total > 10000 ? ' (charted first 10,000 of ' + total.toLocaleString() + ')' : ' (' + data.length.toLocaleString() + ' data points)';
                var meta = response.meta || {};
                var mix = meta.source_mix || {};
                var scheduled = Number(mix.scheduled || 0).toLocaleString();
                var manual = Number(mix.manual || 0).toLocaleString();
                var mode = String(meta.source_mode || 'all');
                if (els.chartStatus) els.chartStatus.textContent = 'Chart rendered' + suffix + ' [mode=' + mode + ', scheduled=' + scheduled + ', manual=' + manual + ']';
            })
            .catch(function (err) {
                if (els.chartStatus) els.chartStatus.textContent = 'Error: ' + String(err.message || err);
            });
    }

    window.AR.charts = { drawChart: drawChart };
})();
