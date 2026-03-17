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
    var network = window.AR.network || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var clientLog = utils.clientLog || function () {};
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };

    var chartState = {
        rows: [],
        totalRows: 0,
        truncated: false,
        loadedRepresentation: 'change',
        stale: false,
        fallbackReason: '',
        selectedSeriesKeys: [],
        spotlightSeriesKey: '',
        spotlightDate: '',
        marketFocusKey: '',
        mainChart: null,
        detailChart: null,
    };
    var responsiveSyncTimer = 0;
    var resizeObserver = null;
    var chartLoadPromise = null;

    function fields() {
        var defaultView = (window.AR.chartConfig && window.AR.chartConfig.defaultView) ? window.AR.chartConfig.defaultView() : 'lenders';
        return chartUi.getChartFields ? chartUi.getChartFields() : { view: defaultView, yField: 'interest_rate', density: 'standard' };
    }

    function payloadMeta() {
        return {
            totalRows: chartState.totalRows,
            truncated: chartState.truncated,
            representation: chartState.loadedRepresentation,
        };
    }

    function resetSelection() {
        chartState.selectedSeriesKeys = [];
        chartState.spotlightSeriesKey = '';
        chartState.spotlightDate = '';
        chartState.marketFocusKey = '';
    }

    function disposeChart(instance) {
        if (instance && typeof instance.dispose === 'function' && !instance.isDisposed()) instance.dispose();
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
        if (!model || !model.meta) return 'WAIT';
        var parts = [Number(chartState.totalRows || 0).toLocaleString() + ' rows'];
        if (chartState.fallbackReason) parts.push('day fallback');
        if (currentFields.view === 'market' && model.market) {
            parts.push(model.market.categories.length.toLocaleString() + ' curve points');
            parts.push(model.market.snapshotDateDisplay || '');
            return parts.filter(Boolean).join(' | ');
        }
        if (currentFields.view === 'timeRibbon' && model.timeRibbon) {
            parts.push(model.timeRibbon.categories.length + ' dates');
            parts.push(model.timeRibbon.termLabel || '');
            return parts.filter(Boolean).join(' | ');
        }
        if (currentFields.view === 'tdTermTime' && model.tdTermTime) {
            parts.push(model.tdTermTime.terms.length + ' terms');
            return parts.filter(Boolean).join(' | ');
        }
        if (currentFields.view === 'lenders') {
            parts.push(model.meta.visibleLenders.toLocaleString() + '/' + model.meta.totalLenders.toLocaleString() + ' lenders');
        } else {
            parts.push(model.meta.visibleSeries.toLocaleString() + '/' + model.meta.totalSeries.toLocaleString() + ' series');
        }
        return parts.join(' | ');
    }

    function chartErrorMessage() {
        return 'Chart unavailable right now. Try Update chart again.';
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
        [0, 120, 320].forEach(function (delay) { setTimeout(resizeCharts, delay); });
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
            document.getElementById('chart'),
            document.getElementById('history')
        ].forEach(function (element) {
            if (element) resizeObserver.observe(element);
        });
    }

    function chartVisible() {
        return !!(els.chartOutput && window.getComputedStyle(els.chartOutput).display !== 'none');
    }

    function scheduleResponsiveSync() {
        scheduleResizeCharts();
        if (responsiveSyncTimer) window.clearTimeout(responsiveSyncTimer);
        responsiveSyncTimer = window.setTimeout(function () {
            responsiveSyncTimer = 0;
            if (!chartState.rows.length || !chartVisible()) {
                resizeCharts();
                return;
            }
            renderFromCache();
        }, 150);
    }

    function renderFromCache() {
        if (!chartState.rows.length) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            clearOutput('WAIT');
            return;
        }

        var currentFields = fields();
        var model = chartData.buildChartModel(chartState.rows, currentFields, chartState);
        if (currentFields.view === 'market' && (!model.market || !model.market.categories || !model.market.categories.length)) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            clearOutput('No curve data');
            if (chartUi.setStatus) chartUi.setStatus('No curve data');
            return;
        }
        if (currentFields.view === 'timeRibbon' && (!model.timeRibbon || !model.timeRibbon.categories || !model.timeRibbon.categories.length)) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            clearOutput('No time ribbon data');
            if (chartUi.setStatus) chartUi.setStatus('No time ribbon data');
            return;
        }
        if (currentFields.view === 'tdTermTime' && (!model.tdTermTime || !model.tdTermTime.terms || !model.tdTermTime.terms.length)) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            clearOutput('No term vs time data');
            if (chartUi.setStatus) chartUi.setStatus('No term vs time data');
            return;
        }
        if (currentFields.view === 'lenders' && (!model.lenderRanking || !model.lenderRanking.entries.length)) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            clearOutput('No lender match');
            if (chartUi.setStatus) chartUi.setStatus('No lender match');
            return;
        }
        var timeViews = currentFields.view === 'timeRibbon' || currentFields.view === 'tdTermTime';
        if (!timeViews && currentFields.view !== 'market' && (!model.visibleSeries.length || !model.surface.cells.length)) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            clearOutput('No numeric values');
            if (chartUi.setStatus) chartUi.setStatus('No numeric values');
            return;
        }

        if (chartUi.clearErrorState) chartUi.clearErrorState();
        chartState.selectedSeriesKeys = model.selectedKeys.slice();
        if (model.spotlight && model.spotlight.series) {
            chartState.spotlightSeriesKey = model.spotlight.series.key;
            chartState.spotlightDate = model.spotlight.date || '';
        }
        if (model.market && model.market.focusBucket) {
            chartState.marketFocusKey = model.market.focusBucket.key;
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
        if (chartUi.setStatus) chartUi.setStatus(chartState.stale ? 'STALE' : statusText(model, currentFields));

        tabState.chartDrawn = true;
        scheduleResizeCharts();
    }

    function handleMainChartClick(params) {
        if (!params) return;
        if (fields().view === 'market') {
            var nextBucketKey = params.data && params.data.bucketKey
                ? String(params.data.bucketKey)
                : (params.name ? String(params.name) : '');
            if (nextBucketKey) chartState.marketFocusKey = nextBucketKey;
            if (!chartState.stale) renderFromCache();
            return;
        }
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
        var currentFields = fields();
        params.sort = 'collection_date';
        params.dir = 'asc';
        var dayRepViews = currentFields.view === 'market' || currentFields.view === 'timeRibbon' || currentFields.view === 'tdTermTime';
        params.representation = dayRepViews ? 'day' : (currentFields.representation || 'change');
        return params;
    }

    async function drawChart() {
        if (!els.chartOutput) return;
        if (chartLoadPromise) return chartLoadPromise;
        disposeCharts();
        chartState.fallbackReason = '';
        if (chartUi.clearErrorState) chartUi.clearErrorState();
        if (chartUi.setPendingState) chartUi.setPendingState('LOAD');
        clientLog('info', 'Chart load started', { apiBase: config && config.apiBase ? config.apiBase : '' });

        chartLoadPromise = (async function () {
            var payload = await chartData.fetchAllRateRows(buildBaseParams(), function (progress) {
                if (chartUi.setStatus) {
                    chartUi.setStatus('LOAD ' + progress.loaded.toLocaleString() + '/' + progress.total.toLocaleString() + ' ' + progress.page + '/' + progress.lastPage);
                }
            });

            chartState.rows = payload.rows || [];
            chartState.totalRows = Number(payload.total || chartState.rows.length || 0);
            chartState.truncated = !!payload.truncated;
            chartState.loadedRepresentation = payload.representation || buildBaseParams().representation || 'change';
            chartState.stale = false;
            chartState.fallbackReason = payload.fallbackReason || '';
            if (els.chartRepresentation && payload.representation && els.chartRepresentation.value !== payload.representation) {
                els.chartRepresentation.value = payload.representation;
            }
            resetSelection();

            if (!chartState.rows.length) {
                clientLog('info', 'Chart load returned no rows', { section: (window.AR && window.AR.section) || 'unknown' });
                if (chartUi.clearErrorState) chartUi.clearErrorState();
                clearOutput('No data');
                if (chartUi.setStatus) chartUi.setStatus('No data');
                return;
            }

            renderFromCache();
            clientLog('info', 'Chart load completed', {
                rows: chartState.rows.length,
                totalRows: chartState.totalRows,
                truncated: chartState.truncated,
            });
        })().catch(function (error) {
            chartState.fallbackReason = '';
            var chartOutputStillPresent = typeof document !== 'undefined' && document.getElementById('chart-output');
            if (!chartOutputStillPresent) return;
            var userMessage = describeError(error, chartErrorMessage());
            var isTimeout = (network && typeof network.isTimeoutError === 'function' && network.isTimeoutError(error)) || (error && error.code === 'timeout');
            var logData = {
                section: (window.AR && window.AR.section) || 'unknown',
                userMessage: userMessage,
                code: error && error.code,
                timedOut: !!isTimeout,
            };
            if (error && (error.status != null || error.url)) {
                logData.status = error.status;
                logData.url = error.url ? String(error.url).slice(0, 500) : undefined;
            }
            if (error && error.bodySnippet) logData.bodySnippet = String(error.bodySnippet).slice(0, 200);
            clientLog('error', 'Chart load failed', logData);
            if (config && config.apiBase) {
                fetch(config.apiBase + '/debug-log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        location: 'ar-charts.js:drawChart',
                        message: 'Chart load failed',
                        data: logData,
                        timestamp: Date.now(),
                    }),
                }).catch(function () {});
            }
            clearOutput('Error loading chart');
            if (chartUi.setErrorState) chartUi.setErrorState(userMessage);
            if (chartUi.setStatus) chartUi.setStatus('Error loading chart');
        }).finally(function () {
            chartLoadPromise = null;
        });

        return chartLoadPromise;
    }

    function refreshFromCache(reason) {
        if (reason === 'representation') {
            drawChart();
            return;
        }
        if ((fields().view === 'market' || fields().view === 'timeRibbon' || fields().view === 'tdTermTime') && chartState.loadedRepresentation !== 'day') {
            drawChart();
            return;
        }
        if (!chartState.rows.length) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            if (chartUi.setIdleState) chartUi.setIdleState();
            return;
        }
        if (chartState.stale) {
            if (chartUi.markStale) chartUi.markStale('STALE');
            return;
        }
        renderFromCache();
        if (chartUi.setStatus) chartUi.setStatus('LIVE ' + fields().view + (reason ? ' | ' + reason : ''));
    }

    function toggleSeries(seriesKey) {
        if (!seriesKey) return;
        if (fields().view === 'market' || fields().view === 'timeRibbon' || fields().view === 'tdTermTime') {
            if (fields().view === 'market') chartState.marketFocusKey = seriesKey;
            if (!chartState.stale) renderFromCache();
            return;
        }
        var next = chartState.selectedSeriesKeys.slice();
        var index = next.indexOf(seriesKey);
        if (index >= 0) next.splice(index, 1);
        else next.push(seriesKey);
        chartState.selectedSeriesKeys = next;
        chartState.spotlightSeriesKey = seriesKey;
        chartState.spotlightDate = '';
        if (!chartState.stale) renderFromCache();
    }

    function markStale(message) {
        chartState.stale = true;
        if (chartUi.markStale) chartUi.markStale(message || 'STALE');
    }

    if (chartUi.bindUi) {
        chartUi.bindUi({
            onControlChange: function () { refreshFromCache('control'); },
            onSeriesToggle: toggleSeries,
            onViewChange: function () { refreshFromCache('view'); },
        });
    }
    if (chartUi.setPendingState) chartUi.setPendingState('Loading');
    else if (chartUi.setIdleState) chartUi.setIdleState();

    [document.getElementById('notes'), document.getElementById('filter-bar')].forEach(function (details) {
        if (details && details.tagName === 'DETAILS') details.addEventListener('toggle', scheduleResponsiveSync);
    });

    window.addEventListener('resize', scheduleResponsiveSync);
    window.addEventListener('orientationchange', scheduleResponsiveSync);
    window.addEventListener('ar:tab-changed', scheduleResponsiveSync);
    window.addEventListener('ar:ui-mode-changed', scheduleResponsiveSync);
    window.addEventListener('ar:theme-changed', scheduleResponsiveSync);
    window.addEventListener('beforeunload', disconnectResizeObserver);

    window.AR.charts = {
        drawChart: drawChart,
        markStale: markStale,
        refreshFromCache: refreshFromCache,
    };
})();
