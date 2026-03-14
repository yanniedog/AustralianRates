(function () {
    'use strict';

    var dom = window.AR.dom;
    var state = window.AR.state;
    var tabs = window.AR.tabs;
    var filters = window.AR.filters;
    var explorer = window.AR.explorer;
    var pivot = window.AR.pivot;
    var charts = window.AR.charts;
    var refresh = window.AR.refresh;
    var exportModule = window.AR.export;
    var rateChanges = window.AR.rateChanges;
    var executiveSummary = window.AR.executiveSummary;
    var hero = window.AR.hero;
    var utils = window.AR.utils || {};
    var clientLog = utils.clientLog || function () {};

    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var appInitialized = false;
    var initialChartRequested = false;
    var liveApplyTimerId = 0;
    var liveApplyDelayMs = 280;
    var liveApplyInProgress = false;

    clientLog('info', 'App init start', {
        section: window.AR.section || 'home-loans',
        activeTab: tabState.activeTab || 'explorer',
    });

    function setFilterLiveStatus(text, tone) {
        if (!els.filterLiveStatus) return;
        els.filterLiveStatus.textContent = String(text || 'Live sync on');
        els.filterLiveStatus.classList.remove('is-live', 'is-pending', 'is-error');
        if (tone) els.filterLiveStatus.classList.add(String(tone));
    }

    function clearLiveApplyTimer() {
        if (!liveApplyTimerId) return;
        window.clearTimeout(liveApplyTimerId);
        liveApplyTimerId = 0;
    }

    function applyUiMode(mode, options) {
        var opts = options || {};
        var uiMode = String(mode || (state && state.getUiMode ? state.getUiMode() : 'analyst'));
        document.body.classList.toggle('ui-mode-consumer', uiMode !== 'analyst');
        document.body.classList.toggle('ui-mode-analyst', uiMode === 'analyst');

        if (tabs && tabs.applyUiMode) tabs.applyUiMode();
        if (filters && filters.applyUiMode) filters.applyUiMode();
        if (explorer && explorer.applyUiMode) explorer.applyUiMode();

        if (!opts.skipRefresh) {
            if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
            if (filters && filters.syncUrlState) filters.syncUrlState();
            if (filters && filters.markFiltersApplied) filters.markFiltersApplied();
        }
    }

    function drawChartIfReady(force) {
        if (!charts || !charts.drawChart || !els.chartOutput) return;
        if (initialChartRequested && !force) return;
        initialChartRequested = true;
        window.setTimeout(function () {
            charts.drawChart();
        }, 120);
    }

    function scheduleLiveApply(reason) {
        if (!appInitialized) return;
        clearLiveApplyTimer();
        setFilterLiveStatus('Sync queued', 'is-pending');
        liveApplyTimerId = window.setTimeout(function () {
            liveApplyTimerId = 0;
            applyFilters({
                source: 'live',
                reason: reason || 'filters-state',
                passiveValidation: true,
            });
        }, liveApplyDelayMs);
    }

    function applyFilters(options) {
        var opts = options || {};
        clearLiveApplyTimer();
        if (filters && filters.validateInputs && !filters.validateInputs(opts.passiveValidation ? { focusInvalid: false } : undefined)) {
            setFilterLiveStatus('Fix date range', 'is-error');
            clientLog('warn', 'Apply filters blocked by invalid input', {
                section: window.AR.section || 'home-loans',
            });
            return;
        }

        liveApplyInProgress = true;
        setFilterLiveStatus(opts.source === 'live' ? 'Syncing...' : 'Refreshing...', 'is-pending');
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (filters && filters.markFiltersApplied) filters.markFiltersApplied();
        if (explorer && explorer.reloadExplorer) explorer.reloadExplorer();
        if (hero && hero.loadHeroStats) hero.loadHeroStats();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (pivot && pivot.invalidatePivot) {
            pivot.invalidatePivot({
                message: tabState.activeTab === 'pivot' ? 'Refreshing default pivot grid...' : 'Default pivot grid queued for refresh.',
            });
        } else if (tabState.pivotLoaded && els.pivotStatus) {
            els.pivotStatus.textContent = 'STALE';
        }
        if (charts && charts.markStale) charts.markStale('STALE');
        if (rateChanges && rateChanges.loadRateChanges) rateChanges.loadRateChanges();
        if (executiveSummary && executiveSummary.loadExecutiveSummary && els.executiveSummarySections) {
            executiveSummary.loadExecutiveSummary();
        }
        drawChartIfReady(true);
        if (pivot && pivot.preloadPivotData) {
            pivot.preloadPivotData({
                delay: tabState.activeTab === 'pivot' ? 0 : 900,
                force: true,
                immediate: tabState.activeTab === 'pivot',
                reason: 'filters-applied',
                statusMessage: tabState.activeTab === 'pivot' ? 'Refreshing default pivot grid...' : 'Preparing default pivot grid...',
                statusPrefix: tabState.activeTab === 'pivot' ? 'Refreshing default pivot grid... ' : 'Preparing default pivot grid... ',
            });
        }
        window.setTimeout(function () {
            liveApplyInProgress = false;
            setFilterLiveStatus('Live sync on', 'is-live');
        }, opts.source === 'live' ? 220 : 360);
    }

    function applyFiltersShortcut(event) {
        if (!event || event.defaultPrevented) return;
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.shiftKey || event.altKey || event.key !== 'Enter') return;
        if (event.target && String(event.target.tagName || '').toUpperCase() === 'TEXTAREA') return;
        event.preventDefault();
        applyFilters();
    }

    function collapsePanelsByDefault() {
        if (els.filterBar && els.filterBar.tagName === 'DETAILS') els.filterBar.open = false;
        var notes = document.getElementById('notes');
        if (notes && notes.tagName === 'DETAILS') notes.open = false;
    }

    function finishAppInit(source) {
        if (appInitialized) return;
        appInitialized = true;

        applyUiMode(state && state.getUiMode ? state.getUiMode() : 'analyst', { skipRefresh: true });
        if (tabs && tabs.activateTab) tabs.activateTab(tabState.activeTab || 'explorer', { skipHash: false });
        if (explorer && explorer.initRateTable) explorer.initRateTable();
        if (hero && hero.loadHeroStats) hero.loadHeroStats();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (rateChanges && rateChanges.loadRateChanges) rateChanges.loadRateChanges();
        if (executiveSummary && executiveSummary.loadExecutiveSummary && els.executiveSummarySections) {
            executiveSummary.loadExecutiveSummary();
        }
        if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
        drawChartIfReady(false);
        if (pivot && pivot.preloadPivotData) {
            pivot.preloadPivotData({
                delay: tabState.activeTab === 'pivot' ? 0 : 1200,
                immediate: tabState.activeTab === 'pivot',
                reason: 'app-init',
            });
        }
        setFilterLiveStatus('Live sync on', 'is-live');

        clientLog('info', 'App init complete', {
            activeTab: tabState.activeTab || 'explorer',
            source: source || 'unknown',
        });
    }

    if (els.applyFilters) els.applyFilters.addEventListener('click', applyFilters);
    if (els.resetFilters) {
        els.resetFilters.addEventListener('click', function (event) {
            if (event) event.preventDefault();
            if (filters && filters.resetFilters) filters.resetFilters();
        });
    }
    if (els.downloadFormat) {
        els.downloadFormat.addEventListener('change', function () {
            var format = String(els.downloadFormat.value || '').trim();
            if (!format) return;
            if (exportModule && exportModule.downloadSelectedFormat) exportModule.downloadSelectedFormat(format);
            else if (exportModule && exportModule.downloadCsv) exportModule.downloadCsv();
        });
    }
    if (els.downloadCsv) {
        els.downloadCsv.addEventListener('click', function () {
            if (exportModule && exportModule.downloadSelectedFormat) exportModule.downloadSelectedFormat('csv');
            else if (exportModule && exportModule.downloadCsv) exportModule.downloadCsv();
        });
    }
    if (els.loadPivot) {
        els.loadPivot.addEventListener('click', function () {
            if (filters && filters.validateInputs && !filters.validateInputs()) return;
            if (pivot && pivot.ensurePivotLoaded) {
                pivot.ensurePivotLoaded({
                    reason: 'manual-refresh',
                    statusMessage: 'Loading default pivot grid...',
                    statusPrefix: 'Loading default pivot grid... ',
                });
            } else if (pivot && pivot.loadPivotData) {
                pivot.loadPivotData({
                    reason: 'manual-refresh',
                    statusMessage: 'Loading default pivot grid...',
                    statusPrefix: 'Loading default pivot grid... ',
                });
            }
        });
    }
    if (els.pivotRepresentation) {
        els.pivotRepresentation.addEventListener('change', function () {
            if (pivot && pivot.invalidatePivot) {
                pivot.invalidatePivot({
                    message: tabState.activeTab === 'pivot' ? 'Refreshing default pivot grid...' : 'Default pivot grid queued for refresh.',
                });
            }
            if (tabState.activeTab === 'pivot' && pivot && pivot.loadPivotData) {
                pivot.loadPivotData({
                    force: true,
                    reason: 'representation-change',
                    statusMessage: 'Refreshing default pivot grid...',
                    statusPrefix: 'Refreshing default pivot grid... ',
                });
            }
        });
    }
    if (els.drawChart) {
        els.drawChart.addEventListener('click', function () {
            if (filters && filters.validateInputs && !filters.validateInputs()) return;
            if (charts && charts.drawChart) charts.drawChart();
        });
    }
    if (els.filterIncludeManual) {
        els.filterIncludeManual.addEventListener('change', function () {
            if (filters && filters.refreshFilterUiState) filters.refreshFilterUiState();
        });
    }
    if (els.filterMode) {
        els.filterMode.addEventListener('change', function () {
            if (filters && filters.refreshFilterUiState) filters.refreshFilterUiState();
        });
    }
    if (els.refreshInterval) {
        els.refreshInterval.addEventListener('change', function () {
            if (filters && filters.syncUrlState) filters.syncUrlState();
            if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
            if (filters && filters.refreshFilterUiState) filters.refreshFilterUiState();
        });
    }

    window.addEventListener('ar:ui-mode-changed', function (event) {
        applyUiMode(event && event.detail ? event.detail.mode : null);
    });
    window.addEventListener('ar:filters-state', function (event) {
        var detail = event && event.detail ? event.detail : {};
        if (!appInitialized) return;
        if (!detail.dirty) {
            if (liveApplyInProgress) return;
            if (!liveApplyTimerId) setFilterLiveStatus('Live sync on', 'is-live');
            return;
        }
        scheduleLiveApply('filters-state');
    });
    window.addEventListener('ar:tab-changed', function (event) {
        var tab = event && event.detail && event.detail.tab;
        if (tab === 'history' && charts && charts.markStale && tabState.chartDrawn) {
            charts.markStale('LIVE');
        }
        if (tab === 'pivot' && pivot && pivot.ensurePivotLoaded) {
            pivot.ensurePivotLoaded({ reason: 'pivot-tab-activated' });
        }
    });
    window.addEventListener('ar:theme-changed', function () {
        if (tabState.chartDrawn && charts && charts.drawChart) {
            charts.drawChart();
        }
    });
    document.addEventListener('keydown', applyFiltersShortcut);

    if (tabs && tabs.bindTabListeners) tabs.bindTabListeners();
    collapsePanelsByDefault();
    applyUiMode(state && state.getUiMode ? state.getUiMode() : 'analyst', { skipRefresh: true });

    if (filters && filters.loadFilters) {
        filters.loadFilters().then(function () {
            finishAppInit('filters-loaded');
        }).catch(function (err) {
            clientLog('error', 'App init failed while loading filters', {
                message: err && err.message ? err.message : String(err),
            });
            finishAppInit('filters-load-failed');
        });
    } else {
        finishAppInit('no-filter-module');
    }
})();
