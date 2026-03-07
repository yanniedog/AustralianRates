(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var chartUi = window.AR.chartUi || {};
    var chartRenderer = window.AR.chartRenderer || {};
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var tabState = state && state.state ? state.state : {};
    var clientLog = utils.clientLog || function () {};
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var MAX_CHART_POINTS = 1000;
    var MAX_FETCH_ROWS = 10000;
    var chartState = {
        focusedTraceIndex: -1,
        traceCount: 0,
    };

    function getChartFields() {
        return chartUi && chartUi.getChartFields
            ? chartUi.getChartFields()
            : {
                xField: els.chartX ? els.chartX.value : 'collection_date',
                yField: els.chartY ? els.chartY.value : 'interest_rate',
                groupField: els.chartGroup ? els.chartGroup.value : '',
                chartType: els.chartType ? els.chartType.value : 'scatter',
                seriesLimit: els.chartSeriesLimit ? els.chartSeriesLimit.value : '12',
            };
    }

    function labelFor(field) {
        return chartUi && chartUi.fieldLabel ? chartUi.fieldLabel(field) : String(field || '');
    }

    function formatValue(field, value) {
        return chartUi && chartUi.formatFieldValue
            ? chartUi.formatFieldValue(field, value)
            : String(value == null ? '' : value);
    }

    function formatMetric(field, value) {
        return chartUi && chartUi.formatMetricValue
            ? chartUi.formatMetricValue(field, value)
            : String(value == null ? '' : value);
    }

    function safeHref(value) {
        return String(value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function pickPointUrl(row) {
        if (!row || typeof row !== 'object') return '';
        var productUrl = String(row.product_url || '').trim();
        return /^https?:\/\//i.test(productUrl) ? productUrl : '';
    }

    function pointDetailHtml(row, fields) {
        if (!row) return '';
        var name = String(row.product_name || row.account_name || '').trim() || 'Unknown product';
        var bank = String(row.bank_name || '').trim() || 'Unknown bank';
        var url = pickPointUrl(row);
        var extraMetric = '';
        if (fields.yField !== 'comparison_rate' && Number.isFinite(Number(row.comparison_rate))) {
            extraMetric = '<span>' + esc(labelFor('comparison_rate')) + ': ' + esc(formatMetric('comparison_rate', row.comparison_rate)) + '</span>';
        }
        return [
            '<strong>' + esc(name) + '</strong>',
            '<span>' + esc(bank) + '</span>',
            '<span>' + esc(labelFor(fields.xField)) + ': ' + esc(formatValue(fields.xField, row[fields.xField])) + '</span>',
            '<span>' + esc(labelFor(fields.yField)) + ': ' + esc(formatMetric(fields.yField, row[fields.yField])) + '</span>',
            extraMetric,
            url
                ? '<a class="chart-point-link" href="' + safeHref(url) + '" target="_blank" rel="noopener noreferrer">Open product page</a>'
                : '<span>No product page is available for this point.</span>',
        ].filter(Boolean).join('');
    }

    function clearPointDetails() {
        if (!els.chartPointDetails) return;
        els.chartPointDetails.hidden = true;
        els.chartPointDetails.innerHTML = '';
    }

    function resetChartOutputEvents() {
        if (!els.chartOutput || typeof els.chartOutput.removeAllListeners !== 'function') return;
        els.chartOutput.removeAllListeners('plotly_click');
    }

    function bindChartPointClick(rowsByTrace, fields) {
        if (!els.chartOutput || typeof els.chartOutput.on !== 'function') return;
        resetChartOutputEvents();
        els.chartOutput.on('plotly_click', function (event) {
            var points = event && event.points ? event.points : [];
            if (!points.length) return;
            var point = points[0];
            var traceRows = rowsByTrace[Number(point.curveNumber)] || [];
            var row = traceRows[Number(point.pointNumber)] || null;
            if (!row) {
                clearPointDetails();
                return;
            }
            els.chartPointDetails.innerHTML = pointDetailHtml(row, fields);
            els.chartPointDetails.hidden = false;
        });
    }

    function fetchRatesPage(params) {
        var query = new URLSearchParams(params || {});
        return fetch(apiBase + '/rates?' + query.toString()).then(function (response) {
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
            Object.keys(baseParams || {}).forEach(function (key) {
                params[key] = baseParams[key];
            });
            params.page = String(page);
            params.size = '1000';

            var response = await fetchRatesPage(params);
            var chunk = Array.isArray(response.data) ? response.data : [];
            total = Number(response.total || total || chunk.length || 0);
            lastPage = Math.max(1, Number(response.last_page || 1));
            rows = rows.concat(chunk);

            if (rows.length >= MAX_FETCH_ROWS) {
                rows = rows.slice(0, MAX_FETCH_ROWS);
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

    function buildStatusText(payload, meta) {
        var parts = [];
        parts.push(payload.truncated
            ? 'Loaded the 10,000-row chart cap from ' + payload.total.toLocaleString() + ' rows.'
            : 'Loaded ' + payload.total.toLocaleString() + ' rows.');
        if (meta.totalSeries > 1) {
            parts.push('Showing ' + meta.visibleSeries.toLocaleString() + ' of ' + meta.totalSeries.toLocaleString() + ' series.');
        }
        parts.push(meta.sampled
            ? 'Rendered ' + meta.renderedPoints.toLocaleString() + ' sampled points from ' + meta.sourcePoints.toLocaleString() + ' visible points.'
            : 'Rendered ' + meta.renderedPoints.toLocaleString() + ' points.');
        return parts.join(' ');
    }

    function applyTraceFocus(traceIndex) {
        if (!els.chartOutput || !els.chartOutput.data || !els.chartOutput.data.length) return;
        var nextFocus = Number(traceIndex) === chartState.focusedTraceIndex ? -1 : Number(traceIndex);
        var opacity = [];
        var lineWidths = [];
        var markerSizes = [];
        var markerLineWidths = [];

        chartState.focusedTraceIndex = nextFocus;
        for (var i = 0; i < chartState.traceCount; i++) {
            var focused = nextFocus === -1 || i === nextFocus;
            opacity.push(focused ? 0.98 : 0.16);
            lineWidths.push(focused ? 4 : 2.6);
            markerSizes.push(focused ? 8 : 6);
            markerLineWidths.push(focused ? 1.4 : 0.8);
        }

        Plotly.restyle(els.chartOutput, {
            opacity: opacity,
            'line.width': lineWidths,
            'marker.size': markerSizes,
            'marker.line.width': markerLineWidths,
        });
        if (chartUi && chartUi.setFocusedSeries) chartUi.setFocusedSeries(nextFocus);
    }

    async function drawChart() {
        if (!els.chartOutput) return;
        if (chartUi && chartUi.setPendingState) chartUi.setPendingState('Checking chart point count...');
        else if (els.chartStatus) els.chartStatus.textContent = 'Checking chart point count...';
        clearPointDetails();
        clientLog('info', 'Chart load started');

        try {
            var fields = getChartFields();
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
                Plotly.purge(els.chartOutput);
                clearPointDetails();
                if (els.chartStatus) els.chartStatus.textContent = 'No data to chart. Adjust filters or date range.';
                if (chartUi && chartUi.renderSummary) chartUi.renderSummary(null, fields);
                if (chartUi && chartUi.renderSeriesRail) chartUi.renderSeriesRail(null, -1);
                clientLog('warn', 'Chart load returned no data');
                return;
            }

            var chartData = chartRenderer && chartRenderer.buildChart
                ? chartRenderer.buildChart(fullRows, fields, MAX_CHART_POINTS)
                : { traces: [], rowsByTrace: [], meta: null };

            if (!chartData.traces.length) {
                Plotly.purge(els.chartOutput);
                clearPointDetails();
                if (els.chartStatus) els.chartStatus.textContent = 'No numeric values are available for this chart configuration.';
                if (chartUi && chartUi.renderSummary) chartUi.renderSummary(null, fields);
                if (chartUi && chartUi.renderSeriesRail) chartUi.renderSeriesRail(null, -1);
                clientLog('warn', 'Chart load produced no traceable numeric points');
                return;
            }

            chartData.meta.payloadTruncated = !!payload.truncated;
            chartState.focusedTraceIndex = -1;
            chartState.traceCount = chartData.traces.length;

            await Plotly.newPlot(
                els.chartOutput,
                chartData.traces,
                chartRenderer.buildLayout(fields, chartData),
                chartRenderer.buildPlotConfig()
            );

            bindChartPointClick(chartData.rowsByTrace, fields);
            clearPointDetails();
            if (chartUi && chartUi.renderSummary) chartUi.renderSummary(chartData.meta, fields);
            if (chartUi && chartUi.renderSeriesRail) chartUi.renderSeriesRail(chartData.meta, -1);

            tabState.chartDrawn = true;
            if (els.chartStatus) els.chartStatus.textContent = buildStatusText(payload, chartData.meta);

            clientLog('info', 'Chart load completed', {
                points: chartData.meta.renderedPoints,
                sampled: chartData.meta.sampled,
                traceCount: chartData.traces.length,
                total: total,
                hiddenSeries: chartData.meta.hiddenSeries,
                truncated: !!payload.truncated,
            });
        } catch (error) {
            clearPointDetails();
            Plotly.purge(els.chartOutput);
            if (els.chartStatus) els.chartStatus.textContent = 'Error: ' + String(error && error.message ? error.message : error);
            if (chartUi && chartUi.renderSummary) chartUi.renderSummary(null, getChartFields());
            if (chartUi && chartUi.renderSeriesRail) chartUi.renderSeriesRail(null, -1);
            clientLog('error', 'Chart load failed', {
                message: error && error.message ? error.message : String(error),
            });
        }
    }

    if (chartUi && chartUi.bindUi) chartUi.bindUi(drawChart, applyTraceFocus);
    if (chartUi && chartUi.setIdleState) chartUi.setIdleState();
    if (chartUi && chartUi.syncPresetButtons) chartUi.syncPresetButtons(getChartFields());

    window.AR.charts = {
        drawChart: drawChart,
    };
})();
