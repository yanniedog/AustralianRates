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

    clientLog('info', 'App init start', {
        section: window.AR.section || 'home-loans',
        activeTab: tabState.activeTab || 'explorer',
    });

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

    function applyFilters() {
        if (filters && filters.validateInputs && !filters.validateInputs()) {
            clientLog('warn', 'Apply filters blocked by invalid input', {
                section: window.AR.section || 'home-loans',
            });
            return;
        }

        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (filters && filters.markFiltersApplied) filters.markFiltersApplied();
        if (explorer && explorer.reloadExplorer) explorer.reloadExplorer();
        if (hero && hero.loadHeroStats) hero.loadHeroStats();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (tabState.pivotLoaded && els.pivotStatus) els.pivotStatus.textContent = 'STALE';
        if (charts && charts.markStale) charts.markStale('STALE');
        if (rateChanges && rateChanges.loadRateChanges) rateChanges.loadRateChanges();
        if (executiveSummary && executiveSummary.loadExecutiveSummary && els.executiveSummarySections) {
            executiveSummary.loadExecutiveSummary();
        }
        drawChartIfReady(true);
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
            applyFilters();
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
            if (pivot && pivot.loadPivotData) pivot.loadPivotData();
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
    window.addEventListener('ar:tab-changed', function (event) {
        var tab = event && event.detail && event.detail.tab;
        if (tab === 'history' && charts && charts.markStale && tabState.chartDrawn) {
            charts.markStale('LIVE');
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
