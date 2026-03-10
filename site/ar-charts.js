(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var chartData = window.AR.chartData || {};
    var chartEcharts = window.AR.chartEcharts || {};
    var chartSummary = window.AR.chartSummary || {};
    var chartUi = window.AR.chartUi || {};
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var clientLog = utils.clientLog || function () {};

    var chartState = {
        rows: [],
        totalRows: 0,
        truncated: false,
        stale: false,
        selectedSeriesKeys: [],
        spotlightSeriesKey: '',
        spotlightDate: '',
        mainChart: null,
        detailChart: null,
    };
    var responsiveSyncTimer = 0;
    var resizeObserver = null;

    function fields() {
        var defaultView = (window.AR.chartConfig && window.AR.chartConfig.defaultView) ? window.AR.chartConfig.defaultView() : 'lenders';
        return chartUi.getChartFields ? chartUi.getChartFields() : { view: defaultView, yField: 'interest_rate', density: 'standard' };
    }

    function payloadMeta() {
        return {
            totalRows: chartState.totalRows,
            truncated: chartState.truncated,
        };
    }

    function resetSelection() {
        chartState.selectedSeriesKeys = [];
        chartState.spotlightSeriesKey = '';
        chartState.spotlightDate = '';
    }

    function disposeChart(instance) {
        if (instance && typeof instance.dispose === 'function' && !instance.isDisposed()) {
            instance.dispose();
        }
        return null;
    }

    function disposeCharts() {
        chartState.mainChart = disposeChart(chartState.mainChart);
        chartState.detailChart = disposeChart(chartState.detailChart);
    }

    function clearOutput(message) {
        disposeCharts();
        if (chartUi.setCanvasPlaceholder) chartUi.setCanvasPlaceholder(message);
        if (chartUi.renderSummary) chartUi.renderSummary(null, fields(), payloadMeta(), chartState.stale);
        if (chartUi.renderSeriesRail) chartUi.renderSeriesRail(null, chartState);
        if (chartUi.renderSpotlight) chartUi.renderSpotlight(null, fields());
        if (chartSummary && chartSummary.clear) chartSummary.clear(message);
    }

    function statusText(model, currentFields) {
        if (!model || !model.meta) return 'Render a chart to answer the current scenario.';
        var parts = [];
        parts.push('Loaded ' + Number(chartState.totalRows || 0).toLocaleString() + ' rows.');
        if (currentFields.view === 'lenders') {
            parts.push('Lenders view ranks ' +
                model.meta.visibleLenders.toLocaleString() + ' of ' +
                model.meta.totalLenders.toLocaleString() + ' lenders for the current slice.');
        } else {
            parts.push(currentFields.view.charAt(0).toUpperCase() + currentFields.view.slice(1) + ' view shows ' +
                model.meta.visibleSeries.toLocaleString() + ' of ' + model.meta.totalSeries.toLocaleString() + ' product series.');
        }
        if (chartState.truncated) parts.push('Results hit the 10,000-row fetch cap.');
        return parts.join(' ');
    }

    function ensureCharts() {
        if (!els.chartOutput || !els.chartDetailOutput) return;
        if (!chartState.mainChart) {
            els.chartOutput.innerHTML = '';
            chartState.mainChart = chartEcharts.ensureChart(els.chartOutput, null);
        }
        if (!chartState.detailChart) {
            els.chartDetailOutput.innerHTML = '';
            chartState.detailChart = chartEcharts.ensureChart(els.chartDetailOutput, null);
        }
        observeChartContainers();
    }

    function resizeCharts() {
        if (chartState.mainChart && !chartState.mainChart.isDisposed()) chartState.mainChart.resize();
        if (chartState.detailChart && !chartState.detailChart.isDisposed()) chartState.detailChart.resize();
    }

    function scheduleResizeCharts() {
        [0, 120, 320].forEach(function (delay) {
            setTimeout(resizeCharts, delay);
        });
    }

    function disconnectResizeObserver() {
        if (!resizeObserver || typeof resizeObserver.disconnect !== 'function') return;
        resizeObserver.disconnect();
        resizeObserver = null;
    }

    function observeChartContainers() {
        if (typeof window.ResizeObserver === 'undefined') return;
        disconnectResizeObserver();
        resizeObserver = new window.ResizeObserver(function () {
            scheduleResponsiveSync();
        });
        [
            els.chartOutput,
            els.chartDetailOutput,
            els.chartOutput && els.chartOutput.parentElement,
            els.chartDetailOutput && els.chartDetailOutput.parentElement,
            document.querySelector('#panel-charts .chart-canvas-shell'),
            document.querySelector('#panel-charts .chart-series-rail'),
            document.querySelector('#panel-charts .chart-shell')
        ].forEach(function (element) {
            if (!element) return;
            resizeObserver.observe(element);
        });
    }

    function chartsPanelVisible() {
        if (!els.panelCharts) return false;
        if (els.panelCharts.hidden || !els.panelCharts.classList.contains('active')) return false;
        return window.getComputedStyle(els.panelCharts).display !== 'none';
    }

    function scheduleResponsiveSync() {
        scheduleResizeCharts();
        if (responsiveSyncTimer) window.clearTimeout(responsiveSyncTimer);
        responsiveSyncTimer = window.setTimeout(function () {
            responsiveSyncTimer = 0;
            if (!chartState.rows.length || !chartsPanelVisible()) {
                resizeCharts();
                return;
            }
            renderFromCache();
        }, 150);
    }

    function renderFromCache() {
        if (!chartState.rows.length) {
            clearOutput('No chart data is cached yet.');
            return;
        }

        var currentFields = fields();
        var model = chartData.buildChartModel(chartState.rows, currentFields, chartState);
        if (currentFields.view === 'lenders' && (!model.lenderRanking || !model.lenderRanking.entries.length)) {
            clearOutput('No lender matches are available for this configuration.');
            if (chartUi.setStatus) chartUi.setStatus('No lender matches are available for this configuration.');
            return;
        }
        if (!model.visibleSeries.length || !model.surface.cells.length) {
            clearOutput('No numeric values are available for this configuration.');
            if (chartUi.setStatus) chartUi.setStatus('No numeric values are available for this configuration.');
            return;
        }

        chartState.selectedSeriesKeys = model.selectedKeys.slice();
        if (model.spotlight && model.spotlight.series) {
            chartState.spotlightSeriesKey = model.spotlight.series.key;
            chartState.spotlightDate = model.spotlight.date || '';
        }

        ensureCharts();
        chartEcharts.renderMainChart(chartState.mainChart, els.chartOutput, currentFields.view, model, currentFields, {
            onMainClick: handleMainChartClick,
        });
        chartEcharts.renderDetailChart(chartState.detailChart, els.chartDetailOutput, model, currentFields);

        if (chartUi.renderSummary) chartUi.renderSummary(model, currentFields, payloadMeta(), chartState.stale);
        if (chartUi.renderSeriesRail) chartUi.renderSeriesRail(model, chartState);
        if (chartUi.renderSpotlight) chartUi.renderSpotlight(model, currentFields);
        if (chartSummary && chartSummary.render) chartSummary.render(model, currentFields);
        if (chartUi.setStatus) chartUi.setStatus(chartState.stale ? 'Filters changed. Redraw to fetch fresh chart rows.' : statusText(model, currentFields));

        tabState.chartDrawn = true;
        scheduleResizeCharts();
    }

    function handleMainChartClick(params) {
        if (!params) return;
        var nextSeriesKey = '';
        if (params.data && params.data.seriesKey) {
            nextSeriesKey = String(params.data.seriesKey);
        } else if (params.seriesId) {
            nextSeriesKey = String(params.seriesId);
        } else if (params.seriesName) {
            var currentFields = fields();
            var model = chartData.buildChartModel(chartState.rows, currentFields, chartState);
            var match = model.visibleSeries.find(function (series) { return series.name === params.seriesName; });
            nextSeriesKey = match ? match.key : chartState.spotlightSeriesKey;
        }

        if (nextSeriesKey) {
            if (nextSeriesKey !== chartState.spotlightSeriesKey) chartState.spotlightDate = '';
            chartState.spotlightSeriesKey = nextSeriesKey;
        }
        if (params.data && params.data.date) chartState.spotlightDate = String(params.data.date);
        if (!chartState.stale) renderFromCache();
    }

    function buildBaseParams() {
        var params = buildFilterParams() || {};
        params.sort = 'collection_date';
        params.dir = 'asc';
        return params;
    }

    async function drawChart() {
        if (!els.chartOutput) return;
        disposeCharts();
        if (chartUi.setPendingState) chartUi.setPendingState('Loading chart data...');
        clientLog('info', 'Chart load started', { apiBase: config && config.apiBase ? config.apiBase : '' });

        try {
            var payload = await chartData.fetchAllRateRows(buildBaseParams(), function (progress) {
                if (chartUi.setStatus) {
                    chartUi.setStatus(
                        'Loading chart data... ' +
                        progress.loaded.toLocaleString() + ' of ' +
                        progress.total.toLocaleString() + ' rows (' +
                        progress.page + '/' + progress.lastPage + ' pages).'
                    );
                }
            });

            chartState.rows = payload.rows || [];
            chartState.totalRows = Number(payload.total || chartState.rows.length || 0);
            chartState.truncated = !!payload.truncated;
            chartState.stale = false;
            resetSelection();

            if (!chartState.rows.length) {
            clearOutput('No data returned. Adjust filters or date range.');
            if (chartUi.setStatus) chartUi.setStatus('No data matched the scenario. Adjust filters or date range.');
            return;
        }

            renderFromCache();
            clientLog('info', 'Chart load completed', {
                rows: chartState.rows.length,
                totalRows: chartState.totalRows,
                truncated: chartState.truncated,
            });
        } catch (error) {
            clearOutput('Chart rendering failed.');
            if (chartUi.setStatus) {
                chartUi.setStatus('Error: ' + String(error && error.message ? error.message : error));
            }
            clientLog('error', 'Chart load failed', {
                message: error && error.message ? error.message : String(error),
            });
        }
    }

    function refreshFromCache(reason) {
        if (!chartState.rows.length) {
            if (chartUi.setStatus) chartUi.setStatus('Choose a view, adjust the metric or density, then draw.');
            return;
        }
        if (chartState.stale) {
            if (chartUi.markStale) chartUi.markStale('Filters changed. Redraw to fetch fresh chart rows.');
            return;
        }
        renderFromCache();
        if (chartUi.setStatus) {
            chartUi.setStatus('Updated ' + fields().view + ' view from cached rows' + (reason ? ' after ' + reason + '.' : '.'));
        }
    }

    function toggleSeries(seriesKey) {
        if (!seriesKey) return;
        var next = chartState.selectedSeriesKeys.slice();
        var currentIndex = next.indexOf(seriesKey);
        if (currentIndex >= 0) next.splice(currentIndex, 1);
        else next.push(seriesKey);
        chartState.selectedSeriesKeys = next;
        chartState.spotlightSeriesKey = seriesKey;
        chartState.spotlightDate = '';
        if (!chartState.stale) renderFromCache();
    }

    function markStale(message) {
        chartState.stale = true;
        if (chartUi.markStale) chartUi.markStale(message);
    }

    if (chartUi.bindUi) {
        chartUi.bindUi({
            onControlChange: function () { refreshFromCache('control change'); },
            onSeriesToggle: toggleSeries,
            onViewChange: function () { refreshFromCache('view switch'); },
        });
    }
    if (chartUi.setIdleState) chartUi.setIdleState();
    [
        document.querySelector('.chart-advanced'),
        document.getElementById('market-notes'),
        document.getElementById('filter-bar')
    ].forEach(function (details) {
        if (!details || details.tagName !== 'DETAILS') return;
        details.addEventListener('toggle', scheduleResponsiveSync);
    });

    window.addEventListener('resize', scheduleResponsiveSync);
    window.addEventListener('orientationchange', scheduleResponsiveSync);
    window.addEventListener('ar:tab-changed', function (event) {
        var tab = event && event.detail ? event.detail.tab : '';
        if (tab === 'charts') scheduleResponsiveSync();
    });
    window.addEventListener('ar:ui-mode-changed', scheduleResponsiveSync);

    window.AR.charts = {
        drawChart: drawChart,
        markStale: markStale,
        refreshFromCache: refreshFromCache,
    };
    window.addEventListener('beforeunload', disconnectResizeObserver);
})();
