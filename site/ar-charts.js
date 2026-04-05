(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var chartData = window.AR.chartData || {};
    var chartEcharts = window.AR.chartEcharts || {};
    var economicOverlays = window.AR.chartEconomicOverlays || {};
    var chartLightweight = window.AR.chartLightweight || {};
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

    function freshStatusLineState() {
        return {
            view: '',
            text: '',
            pinnedText: '',
            hoveringBar: false,
        };
    }

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var chartState = {
        rows: [],
        totalRows: 0,
        truncated: false,
        loadedRepresentation: 'change',
        loadedChartWindow: '',
        stale: false,
        fallbackReason: '',
        selectedSeriesKeys: [],
        spotlightSeriesKey: '',
        spotlightDate: '',
        marketFocusKey: '',
        tdCurveFrameIndex: null,
        tdCurveDates: [],
        tdCurveFrames: [],
        economicOverlayIds: [],
        economicOverlaySeries: [],
        mainChart: null,
        detailChart: null,
        lwcMain: null,
        lwcDetail: null,
        lwcNeedsRedraw: false,
        renderGen: 0,
        pendingReload: false,
        statusLine: freshStatusLineState(),
        includedRateStructures: null,
    };
    var HL_RATE_STRUCTURES = [
        { value: 'variable', label: 'Variable' },
        { value: 'fixed_1yr', label: '1y fixed' },
        { value: 'fixed_2yr', label: '2y fixed' },
        { value: 'fixed_3yr', label: '3y fixed' },
        { value: 'fixed_4yr', label: '4y fixed' },
        { value: 'fixed_5yr', label: '5y fixed' },
    ];
    var structureFiltersBound = false;
    var responsiveSyncTimer = 0;
    var resizeObserver = null;
    var chartLoadPromise = null;
    function fields() {
        var defaultView;
        if (window.AR.chartConfig && window.AR.chartConfig.defaultView) {
            defaultView = window.AR.chartConfig.defaultView();
        } else if (section === 'savings') {
            defaultView = 'economicReport';
        } else if (section === 'term-deposits') {
            defaultView = 'termDepositReport';
        } else {
            defaultView = 'homeLoanReport';
        }
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

    function resetStatusLine() {
        chartState.statusLine = freshStatusLineState();
    }

    function disposeChart(instance) {
        if (instance && typeof instance.dispose === 'function' && !instance.isDisposed()) instance.dispose();
        return null;
    }

    function disposeCharts() {
        chartState.mainChart = disposeChart(chartState.mainChart);
        chartState.detailChart = disposeChart(chartState.detailChart);
        if (chartLightweight && typeof chartLightweight.dispose === 'function') {
            chartState.lwcMain = chartLightweight.dispose(chartState.lwcMain);
            chartState.lwcDetail = chartLightweight.dispose(chartState.lwcDetail);
        } else {
            chartState.lwcMain = null;
            chartState.lwcDetail = null;
        }
    }

    function clearOutput(message) {
        disposeCharts();
        chartState.tdCurveDates = [];
        chartState.tdCurveFrames = [];
        chartState.tdCurveFrameIndex = null;
        if (chartUi.setCanvasPlaceholder) chartUi.setCanvasPlaceholder(message);
        if (chartUi.renderSummary) chartUi.renderSummary(null, fields(), payloadMeta(), chartState.stale);
        if (chartUi.renderSeriesRail) chartUi.renderSeriesRail(null, chartState);
        if (chartUi.renderSpotlight) chartUi.renderSpotlight(null, fields());
        if (chartSummary && chartSummary.clear) chartSummary.clear(message);
    }

    function syncTdCurveFrameIndex() {
        if (chartState.tdCurveFrames && chartState.tdCurveFrames.length > 0) {
            chartState.tdCurveFrameIndex = chartState.tdCurveFrames.length - 1;
        } else {
            chartState.tdCurveFrameIndex = null;
        }
    }

    function rowsDateRange(rows) {
        var minDate = '';
        var maxDate = '';
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
            var date = String(row && row.collection_date || '').slice(0, 10);
            if (!date) return;
            if (!minDate || date < minDate) minDate = date;
            if (!maxDate || date > maxDate) maxDate = date;
        });
        return { minDate: minDate, maxDate: maxDate };
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
        if (currentFields.view === 'lenders' || currentFields.view === 'ladder') {
            parts.push(model.meta.visibleLenders.toLocaleString() + '/' + model.meta.totalLenders.toLocaleString() + ' lenders');
            return parts.join(' | ');
        }
        if (currentFields.view === 'slope' && model.slope && model.slope.lines) {
            parts.push(model.slope.lines.length + ' slopes');
            parts.push(model.slope.dateLeftLabel + ' \u2192 ' + model.slope.dateRightLabel);
            return parts.join(' | ');
        }
        if (currentFields.view === 'economicReport' || currentFields.view === 'homeLoanReport' || currentFields.view === 'termDepositReport') {
            parts.push(model.meta.visibleLenders.toLocaleString() + ' banks');
            return parts.join(' | ');
        }
        parts.push(model.meta.visibleSeries.toLocaleString() + '/' + model.meta.totalSeries.toLocaleString() + ' series');
        return parts.join(' | ');
    }

    function chartErrorMessage() {
        return 'Chart unavailable right now. It will retry when you change filters or options.';
    }

    function ensureEchartsCharts() {
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
        if (chartLightweight && typeof chartLightweight.resizeState === 'function') {
            chartLightweight.resizeState(chartState.lwcMain);
            chartLightweight.resizeState(chartState.lwcDetail);
        }
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

    function ensureStructureFiltersUi() {
        if (section !== 'home-loans' || !els.chartStructureFilters || !els.chartStructureFiltersWrap) {
            if (els.chartStructureFiltersWrap) els.chartStructureFiltersWrap.style.display = section === 'home-loans' ? '' : 'none';
            return;
        }
        els.chartStructureFiltersWrap.style.display = '';
        if (structureFiltersBound) return;
        structureFiltersBound = true;
        var container = els.chartStructureFilters;
        HL_RATE_STRUCTURES.forEach(function (item) {
            var label = document.createElement('label');
            label.className = 'chart-structure-checkbox';
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('data-rate-structure', item.value);
            input.checked = chartState.includedRateStructures && chartState.includedRateStructures.indexOf(item.value) >= 0;
            label.appendChild(input);
            label.appendChild(document.createTextNode(' ' + item.label));
            container.appendChild(label);
        });
        container.addEventListener('change', function () {
            var checked = [];
            container.querySelectorAll('input[type="checkbox"]:checked').forEach(function (input) {
                var v = input.getAttribute('data-rate-structure');
                if (v) checked.push(v);
            });
            chartState.includedRateStructures = checked.length ? checked : null;
            refreshFromCache('structure-filter');
        });
    }

    function syncStructureFilterCheckboxes() {
        if (!els.chartStructureFilters) return;
        var included = Array.isArray(chartState.includedRateStructures) ? chartState.includedRateStructures.slice() : [];
        els.chartStructureFilters.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
            var value = String(input.getAttribute('data-rate-structure') || '');
            input.checked = included.indexOf(value) >= 0;
        });
    }

    function reconcileIncludedRateStructuresWithRows() {
        if (section !== 'home-loans' || !Array.isArray(chartState.rows) || !chartState.rows.length) return;
        var available = [];
        chartState.rows.forEach(function (row) {
            var structure = String(row && row.rate_structure || '').trim();
            if (!structure || available.indexOf(structure) >= 0) return;
            available.push(structure);
        });
        if (!available.length) return;
        var included = Array.isArray(chartState.includedRateStructures) ? chartState.includedRateStructures.slice() : [];
        var overlap = included.some(function (structure) { return available.indexOf(structure) >= 0; });
        if (!included.length || !overlap) {
            chartState.includedRateStructures = available.slice();
        }
        syncStructureFilterCheckboxes();
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
            // LWC charts handle their own resizing internally via their own ResizeObserver.
            // Avoid a full destroy+recreate on every container resize — only re-render when
            // the data/view actually changed or a theme/mode change was flagged.
            var currentView = fields && fields().view;
            if (chartState.lwcMain && chartState.lwcMain.kind === currentView && !chartState.lwcNeedsRedraw) {
                resizeCharts();
                return;
            }
            chartState.lwcNeedsRedraw = false;
            renderFromCache();
        }, 150);
    }

    function sendChartErrorToLog(err, context) {
        var apiBase = config && config.apiBase;
        if (!apiBase) return;
        var payload = {
            level: 'error',
            message: (err && err.message) ? String(err.message) : 'Chart render error',
            code: 'chart_render_error',
            location: 'ar-charts.js:renderFromCache',
            timestamp: Date.now(),
            data: context || {},
        };
        if (err && err.stack) payload.data.stack = String(err.stack).slice(0, 2000);
        fetch(apiBase + '/debug-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).catch(function () {});
    }

    function renderFromCache() {
        var currentFields;
        var section = (window.AR && window.AR.section) || '';
        try {
            ensureStructureFiltersUi();
            reconcileIncludedRateStructuresWithRows();
            if (!chartState.rows.length) {
                if (chartUi.clearErrorState) chartUi.clearErrorState();
                clearOutput('WAIT');
                return;
            }

            currentFields = fields();
            var model = chartData.buildChartModel(chartState.rows, currentFields, chartState);
            chartState.tdCurveFrames = Array.isArray(model.tdCurveFrames) ? model.tdCurveFrames : [];
            chartState.tdCurveDates = Array.isArray(model.tdCurveDates) ? model.tdCurveDates : [];
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
            if (currentFields.view === 'slope' && (!model.slope || !model.slope.lines || !model.slope.lines.length)) {
                if (chartUi.clearErrorState) chartUi.clearErrorState();
                clearOutput('No slope data');
                if (chartUi.setStatus) chartUi.setStatus('No slope data');
                return;
            }
            if (currentFields.view === 'ladder' && (!model.lenderRanking || !model.lenderRanking.entries.length)) {
                if (chartUi.clearErrorState) chartUi.clearErrorState();
                clearOutput('No ladder data');
                if (chartUi.setStatus) chartUi.setStatus('No ladder data');
                return;
            }
            if (currentFields.view === 'distribution') {
                var distModel = model.distribution;
                if (!distModel || !distModel.categories || !distModel.categories.length) {
                    if (chartUi.clearErrorState) chartUi.clearErrorState();
                    clearOutput('No distribution data');
                    if (chartUi.setStatus) chartUi.setStatus('No distribution data');
                    return;
                }
            }
            if (currentFields.view === 'economicReport' || currentFields.view === 'homeLoanReport' || currentFields.view === 'termDepositReport') {
                if (!model.visibleSeries || !model.visibleSeries.length) {
                    if (chartUi.clearErrorState) chartUi.clearErrorState();
                    clearOutput('No data');
                    if (chartUi.setStatus) chartUi.setStatus('No data');
                    return;
                }
            }
            var timeViews = currentFields.view === 'timeRibbon' || currentFields.view === 'tdTermTime';
            var slopeOrLadder = currentFields.view === 'slope' || currentFields.view === 'ladder';
            if (!timeViews && !slopeOrLadder && currentFields.view !== 'market' && currentFields.view !== 'distribution' && (!model.visibleSeries.length || !model.surface.cells.length)) {
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

            syncTdCurveFrameIndex();

            var pref = currentFields.chartEngine || 'echarts';
            var eff = typeof chartLightweight.effectiveEngine === 'function'
                ? chartLightweight.effectiveEngine(pref, currentFields.view)
                : 'echarts';
            var useLwc = eff === 'lightweight'
                && chartLightweight.isViewSupported
                && chartLightweight.isViewSupported(currentFields.view)
                && typeof chartLightweight.ensureLoaded === 'function'
                && typeof chartLightweight.renderMainCompare === 'function';

            var gen = ++chartState.renderGen;

            function appendEngineHint(base) {
                var hint = typeof chartLightweight.engineStatusHint === 'function'
                    ? chartLightweight.engineStatusHint(pref, eff, currentFields.view)
                    : '';
                if (!hint) return base;
                return base ? (base + ' · ' + hint) : hint;
            }

            function finishChartPaint(extraSuffix) {
                if (gen !== chartState.renderGen) return;
                if (chartUi.renderSummary) chartUi.renderSummary(model, currentFields, payloadMeta(), chartState.stale);
                if (chartUi.renderSeriesRail) chartUi.renderSeriesRail(model, chartState);
                if (chartUi.renderSpotlight) chartUi.renderSpotlight(model, currentFields);
                if (chartSummary && chartSummary.render) chartSummary.render(model, currentFields);
                var statusLine = chartState.stale ? 'STALE' : statusText(model, currentFields);
                var overlayNote = economicOverlays.overlayStatusNote
                    ? economicOverlays.overlayStatusNote(currentFields.economicOverlayIds, currentFields.view)
                    : '';
                statusLine = appendEngineHint(statusLine);
                if (overlayNote) statusLine = statusLine + ' | ' + overlayNote;
                if (extraSuffix) statusLine = statusLine + ' · ' + extraSuffix;
                if (chartUi.setStatus) chartUi.setStatus(statusLine);
                tabState.chartDrawn = true;
                scheduleResizeCharts();
            }

            function runEchartsRender(extraSuffix) {
                if (gen !== chartState.renderGen) return;
                if (chartLightweight.dispose) {
                    chartState.lwcMain = chartLightweight.dispose(chartState.lwcMain);
                    chartState.lwcDetail = chartLightweight.dispose(chartState.lwcDetail);
                }
                ensureEchartsCharts();
                chartEcharts.renderMainChart(chartState.mainChart, els.chartOutput, currentFields.view, model, currentFields, {
                    onMainClick: handleMainChartClick,
                }, chartState.rbaHistory, chartState);
                chartEcharts.renderDetailChart(chartState.detailChart, els.chartDetailOutput, model, currentFields, chartState);
                finishChartPaint(extraSuffix);
            }

            if (useLwc) {
                chartLightweight.ensureLoaded().then(function () {
                    if (gen !== chartState.renderGen) return;
                    try {
                        chartState.mainChart = disposeChart(chartState.mainChart);
                        chartState.detailChart = disposeChart(chartState.detailChart);
                        chartState.lwcMain = chartLightweight.dispose(chartState.lwcMain);
                        chartState.lwcDetail = chartLightweight.dispose(chartState.lwcDetail);
                        var isEconReport   = currentFields.view === 'economicReport';
                        var isHlReport     = currentFields.view === 'homeLoanReport';
                        var isTdReport     = currentFields.view === 'termDepositReport';
                        var isAnyReport    = isEconReport || isHlReport || isTdReport;
                        if (isEconReport && typeof chartLightweight.renderEconomicReport === 'function') {
                            chartState.lwcMain = chartLightweight.renderEconomicReport(els.chartOutput, model, currentFields, chartState.rbaHistory, chartState.cpiHistory, chartState.economicOverlaySeries);
                        } else if (isHlReport && typeof chartLightweight.renderHomeLoanReport === 'function') {
                            chartState.lwcMain = chartLightweight.renderHomeLoanReport(els.chartOutput, model, currentFields, chartState.rbaHistory, chartState.cpiHistory, chartState.economicOverlaySeries);
                        } else if (isTdReport && typeof chartLightweight.renderTermDepositReport === 'function') {
                            chartState.lwcMain = chartLightweight.renderTermDepositReport(els.chartOutput, model, currentFields, chartState.rbaHistory, chartState.cpiHistory, chartState.economicOverlaySeries);
                        } else {
                            chartState.lwcMain = chartLightweight.renderMainCompare(els.chartOutput, model, currentFields, chartState.economicOverlaySeries);
                        }
                        if (els.chartOutput) {
                            els.chartOutput.setAttribute('data-chart-engine', 'lightweight');
                            els.chartOutput.setAttribute('data-chart-render-view', currentFields.view);
                            els.chartOutput.setAttribute('data-chart-rendered', 'true');
                        }
                        chartState.lwcDetail = isAnyReport ? null : chartLightweight.renderDetail(els.chartDetailOutput, model, currentFields);
                        if (els.chartDetailOutput) {
                            els.chartDetailOutput.setAttribute('data-chart-engine', 'lightweight');
                        }
                        observeChartContainers();
                        finishChartPaint();
                    } catch (lwErr) {
                        clientLog('error', 'Lightweight render failed', { message: String(lwErr && lwErr.message) });
                        runEchartsRender('Lightweight render failed — Classic charts');
                    }
                }).catch(function (loadErr) {
                    clientLog('error', 'Lightweight bundle load failed', { message: String(loadErr && loadErr.message) });
                    runEchartsRender('Lightweight library failed to load — Classic charts');
                });
                return;
            }

            runEchartsRender();
        } catch (err) {
            var view = (currentFields && currentFields.view) || '';
            sendChartErrorToLog(err, { view: view, section: section });
            clearOutput('Error loading chart');
            if (chartUi.setErrorState) chartUi.setErrorState(err && err.message ? String(err.message) : 'Error loading chart');
            if (chartUi.setStatus) chartUi.setStatus('Error loading chart');
        }
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
        var dayRepViews = currentFields.view === 'market' || currentFields.view === 'timeRibbon' || currentFields.view === 'tdTermTime' || currentFields.view === 'slope' || currentFields.view === 'economicReport' || currentFields.view === 'homeLoanReport' || currentFields.view === 'termDepositReport';
        params.representation = dayRepViews ? 'day' : (currentFields.representation || 'change');
        if (currentFields.view === 'economicReport' || currentFields.view === 'homeLoanReport' || currentFields.view === 'termDepositReport') {
            var shared = window.AR.chartMacroLwcShared;
            var reportRange = shared && typeof shared.getReportRange === 'function'
                ? String(shared.getReportRange(section) || '')
                : '';
            if (reportRange) params.chart_window = reportRange;
        }
        return params;
    }

    async function drawChart() {
        if (!els.chartOutput) return;
        if (chartLoadPromise) {
            chartState.pendingReload = true;
            return chartLoadPromise;
        }
        chartState.pendingReload = false;
        disposeCharts();
        resetStatusLine();
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
            chartState.loadedChartWindow = String(buildBaseParams().chart_window || '');
            chartState.stale = false;
            chartState.fallbackReason = payload.fallbackReason || '';
            chartState.tdCurveDates = [];
            chartState.tdCurveFrames = [];
            chartState.tdCurveFrameIndex = null;
            chartState.economicOverlayIds = fields().economicOverlayIds ? fields().economicOverlayIds.slice() : [];
            chartState.economicOverlaySeries = [];
            if (els.chartRepresentation && payload.representation && els.chartRepresentation.value !== payload.representation) {
                els.chartRepresentation.value = payload.representation;
            }
            resetSelection();
            try {
                var _fetched = await Promise.all([
                    chartData.fetchRbaHistory ? chartData.fetchRbaHistory() : Promise.resolve([]),
                    chartData.fetchCpiHistory ? chartData.fetchCpiHistory() : Promise.resolve([]),
                ]);
                chartState.rbaHistory = _fetched[0];
                chartState.cpiHistory = _fetched[1];
            } catch (e) {
                chartState.rbaHistory = [];
                chartState.cpiHistory = [];
            }
            try {
                if (chartState.economicOverlayIds.length && economicOverlays.fetchSeries) {
                    var range = rowsDateRange(chartState.rows);
                    if (range.minDate && range.maxDate) {
                        chartState.economicOverlaySeries = await economicOverlays.fetchSeries(chartState.economicOverlayIds, range.minDate, range.maxDate);
                    }
                }
            } catch (overlayError) {
                chartState.economicOverlaySeries = [];
                clientLog('warn', 'Economic overlays unavailable', {
                    message: String(overlayError && overlayError.message || 'Overlay fetch failed'),
                    ids: chartState.economicOverlayIds,
                });
            }

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
            if (chartState.pendingReload) {
                chartState.pendingReload = false;
                drawChart();
            }
        });

        return chartLoadPromise;
    }

    function refreshFromCache(reason) {
        if (reason === 'representation' || reason === 'economic-overlay') {
            drawChart();
            return;
        }
        var currentFields = fields();
        var nextOverlayIds = currentFields.economicOverlayIds || [];
        if (nextOverlayIds.join(',') !== (chartState.economicOverlayIds || []).join(',')) {
            drawChart();
            return;
        }
        if ((currentFields.view === 'market' || currentFields.view === 'timeRibbon' || currentFields.view === 'tdTermTime' || currentFields.view === 'slope') && chartState.loadedRepresentation !== 'day') {
            drawChart();
            return;
        }
        if ((currentFields.view === 'economicReport' || currentFields.view === 'homeLoanReport' || currentFields.view === 'termDepositReport')
            && String(buildBaseParams().chart_window || '') !== String(chartState.loadedChartWindow || '')) {
            drawChart();
            return;
        }
        if (!chartState.rows.length) {
            if (chartUi.clearErrorState) chartUi.clearErrorState();
            drawChart();
            return;
        }
        if (chartState.stale) {
            drawChart();
            return;
        }
        renderFromCache();
        if (chartUi.setStatus) chartUi.setStatus('LIVE ' + currentFields.view + (reason ? ' | ' + reason : ''));
    }

    function toggleSeries(seriesKey) {
        if (!seriesKey) return;
        if (fields().view === 'market' || fields().view === 'timeRibbon' || fields().view === 'tdTermTime' || fields().view === 'slope' || fields().view === 'ladder') {
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
            onControlChange: function (reason) {
                resetStatusLine();
                refreshFromCache(reason || 'control');
            },
            onSeriesToggle: toggleSeries,
            onViewChange: function () {
                resetStatusLine();
                refreshFromCache('view');
            },
        });
    }
    if (chartUi.setPendingState) chartUi.setPendingState('Loading');
    else if (chartUi.setIdleState) chartUi.setIdleState();

    if (els.drawChart) {
        els.drawChart.addEventListener('click', function () {
            drawChart();
        });
    }

    [document.getElementById('notes'), document.getElementById('scenario')].forEach(function (details) {
        if (details && details.tagName === 'DETAILS') details.addEventListener('toggle', scheduleResponsiveSync);
    });

    window.addEventListener('resize', scheduleResponsiveSync);
    window.addEventListener('orientationchange', scheduleResponsiveSync);
    window.addEventListener('ar:tab-changed', scheduleResponsiveSync);
    window.addEventListener('ar:ui-mode-changed', function () { chartState.lwcNeedsRedraw = true; scheduleResponsiveSync(); });
    window.addEventListener('ar:theme-changed', function () { chartState.lwcNeedsRedraw = true; scheduleResponsiveSync(); });
    window.addEventListener('ar:site-ui-settings', function () {
        chartState.lwcNeedsRedraw = true;
        if (chartState.rows.length && !chartState.stale) {
            refreshFromCache('site-ui');
            return;
        }
        scheduleResponsiveSync();
    });
    window.addEventListener('beforeunload', disconnectResizeObserver);

    window.AR.charts = {
        drawChart: drawChart,
        markStale: markStale,
        refreshFromCache: refreshFromCache,
    };
})();
