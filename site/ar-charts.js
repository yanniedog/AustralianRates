(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var tabState = state && state.state ? state.state : {};
    var clientLog = utils.clientLog || function () {};
    var esc = window._arEsc;
    var MAX_CHART_POINTS = 1000;

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

    function safeEsc(value) {
        return typeof esc === 'function' ? esc(value) : String(value || '');
    }

    function safeHref(value) {
        return String(value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function pickPointUrl(row) {
        if (!row || typeof row !== 'object') return '';
        var productUrl = String(row.product_url || '').trim();
        if (/^https?:\/\//i.test(productUrl)) return productUrl;
        return '';
    }

    function pointDetailHtml(row) {
        if (!row) return '';
        var productName = String(row.product_name || '').trim() || 'Unknown product';
        var bankName = String(row.bank_name || '').trim() || 'Unknown bank';
        var collectionDate = String(row.collection_date || '').trim() || 'Unknown date';
        var rateVal = Number(row.interest_rate);
        var comparisonVal = Number(row.comparison_rate);
        var url = pickPointUrl(row);
        var lines = [
            '<strong>' + safeEsc(productName) + '</strong>',
            '<span>' + safeEsc(bankName) + '</span>',
            '<span>Date: ' + safeEsc(collectionDate) + '</span>',
            '<span>Interest: ' + (Number.isFinite(rateVal) ? safeEsc(rateVal.toFixed(3) + '%') : '\u2014') + '</span>',
            '<span>Comparison: ' + (Number.isFinite(comparisonVal) ? safeEsc(comparisonVal.toFixed(3) + '%') : '\u2014') + '</span>',
        ];
        if (url) {
            lines.push('<a class="chart-point-link" href="' + safeHref(url) + '" target="_blank" rel="noopener noreferrer">Open product page</a>');
        } else {
            lines.push('<span>No URL available for this point.</span>');
        }
        return lines.join('');
    }

    function clearPointDetails() {
        if (!els.chartPointDetails) return;
        els.chartPointDetails.hidden = true;
        els.chartPointDetails.innerHTML = '';
    }

    function bindChartPointClick(rowsByTrace) {
        if (!els.chartOutput || !els.chartPointDetails) return;

        els.chartOutput.on('plotly_click', function (ev) {
            var points = ev && ev.points ? ev.points : [];
            if (!points.length) return;

            var point = points[0];
            var curveIndex = Number(point.curveNumber);
            var pointIndex = Number(point.pointNumber);
            if (!Number.isFinite(pointIndex) && point.pointIndex != null) {
                pointIndex = Number(point.pointIndex);
            }
            if (!Number.isFinite(pointIndex) && Array.isArray(point.pointNumber) && point.pointNumber.length) {
                pointIndex = Number(point.pointNumber[0]);
            }
            var traceRows = rowsByTrace[curveIndex] || [];
            var row = traceRows[pointIndex] || null;
            if (!row) {
                clearPointDetails();
                return;
            }

            els.chartPointDetails.innerHTML = pointDetailHtml(row);
            els.chartPointDetails.hidden = false;
        });
    }

    function buildGroupedTraces(data, xField, yField, groupField, chartType) {
        var groups = {};
        data.forEach(function (row) {
            var key = String(row[groupField] || 'Unknown');
            if (!groups[key]) {
                groups[key] = { points: [], firstRow: null };
            }
            groups[key].points.push({
                x: row[xField],
                y: Number(row[yField]),
                row: row,
            });
            if (!groups[key].firstRow) groups[key].firstRow = row;
        });

        var traces = [];
        var rowsByTrace = [];
        Object.keys(groups).sort().forEach(function (key) {
            var g = groups[key];
            var points = g.points.slice();
            points.sort(function (a, b) {
                var ax = a.x;
                var bx = b.x;
                if (ax === bx) return 0;
                if (typeof ax === 'number' && typeof bx === 'number') return ax - bx;
                return String(ax).localeCompare(String(bx));
            });

            var x = points.map(function (p) { return p.x; });
            var y = points.map(function (p) { return p.y; });

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
            rowsByTrace.push(points.map(function (p) { return p.row; }));
        });

        return { traces: traces, rowsByTrace: rowsByTrace };
    }

    function buildUngroupedTrace(data, xField, yField, chartType) {
        var points = data.map(function (r) {
            return { x: r[xField], y: Number(r[yField]), row: r };
        });

        points.sort(function (a, b) {
            var ax = a.x;
            var bx = b.x;
            if (ax === bx) return 0;
            if (typeof ax === 'number' && typeof bx === 'number') return ax - bx;
            return String(ax).localeCompare(String(bx));
        });

        var trace = {
            x: points.map(function (p) { return p.x; }),
            y: points.map(function (p) { return p.y; }),
            type: chartType,
            name: yField,
        };
        if (chartType === 'scatter') {
            trace.mode = 'lines+markers';
            trace.marker = { size: 4 };
        }

        return { traces: [trace], rowsByTrace: [points.map(function (p) { return p.row; })] };
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
        var narrow = window.innerWidth <= 760;
        var chartHeight = Math.max(280, Math.min(500, window.innerHeight - 200));
        return {
            title: narrow ? '' : (yLabel + ' by ' + xLabel),
            xaxis: { title: narrow ? '' : xLabel },
            yaxis: { title: narrow ? '' : yLabel },
            hovermode: 'closest',
            legend: narrow
                ? { orientation: 'h', y: -0.25, font: { size: 10 } }
                : { orientation: 'h', y: -0.2 },
            margin: narrow
                ? { t: 20, l: 40, r: 10, b: 60 }
                : { t: 50, l: 60, r: 20, b: 80 },
            height: chartHeight,
        };
    }

    function fetchRatesPage(params) {
        var query = new URLSearchParams(params || {});
        return fetch(apiBase + '/rates?' + query.toString())
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

    function sampleRows(rows, maxPoints) {
        if (!Array.isArray(rows) || rows.length <= maxPoints) {
            return { rows: Array.isArray(rows) ? rows : [], sampled: false };
        }
        var step = rows.length / maxPoints;
        var sampled = [];
        for (var i = 0; i < maxPoints; i++) {
            var idx = Math.min(rows.length - 1, Math.floor(i * step));
            sampled.push(rows[idx]);
        }
        var lastRow = rows[rows.length - 1];
        if (sampled[sampled.length - 1] !== lastRow) {
            sampled[sampled.length - 1] = lastRow;
        }
        return { rows: sampled, sampled: true };
    }

    async function drawChart() {
        if (!els.chartOutput) return;
        if (els.chartStatus) els.chartStatus.textContent = 'Checking chart point count...';
        clearPointDetails();
        clientLog('info', 'Chart load started');

        try {
            var fields = getChartFieldValues();
            var baseParams = buildFilterParams();
            baseParams.sort = fields.xField || 'collection_date';
            baseParams.dir = 'asc';

            var payload = await fetchAllRateRows(baseParams, function (progress) {
                if (!els.chartStatus) return;
                els.chartStatus.textContent =
                    'Loading chart data... ' +
                    progress.loaded.toLocaleString() + ' of ' +
                    progress.total.toLocaleString() + ' rows (' +
                    progress.page + '/' + progress.lastPage + ' pages).';
            });
            var total = Number(payload.total || 0);
            var fullRows = payload.rows || [];
            if (!Number.isFinite(total) || total <= 0 || fullRows.length === 0) {
                if (els.chartStatus) els.chartStatus.textContent = 'No data to chart. Adjust filters or date range.';
                Plotly.purge(els.chartOutput);
                clearPointDetails();
                clientLog('warn', 'Chart load returned no data');
                return;
            }

            var sampled = sampleRows(fullRows, MAX_CHART_POINTS);
            var data = sampled.rows;
            var chartData = buildTraces(data, fields.xField, fields.yField, fields.groupField, fields.chartType);
            var traces = chartData.traces || [];
            var layout = buildLayout(fields.xField, fields.yField);
            await Plotly.newPlot(els.chartOutput, traces, layout, { responsive: true });
            bindChartPointClick(chartData.rowsByTrace || []);
            clearPointDetails();

            tabState.chartDrawn = true;
            if (els.chartStatus) {
                els.chartStatus.textContent = sampled.sampled
                    ? 'Chart rendered from a ' + data.length.toLocaleString() + '-point sample of ' + total.toLocaleString() + ' rows. Use export for the full dataset.'
                    : 'Chart rendered (' + data.length.toLocaleString() + ' data points).';
            }
            clientLog('info', 'Chart load completed', {
                points: data.length,
                sampled: sampled.sampled,
                traceCount: traces.length,
                total: total,
            });
        } catch (err) {
            if (els.chartStatus) els.chartStatus.textContent = 'Error: ' + String(err.message || err);
            clearPointDetails();
            clientLog('error', 'Chart load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.charts = { drawChart: drawChart };
})();
