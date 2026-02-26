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
    var hero = window.AR.hero;
    var utils = window.AR.utils;
    var clientLog = utils && utils.clientLog ? utils.clientLog : function () {};

    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};

    clientLog('info', 'App init start', {
        section: window.AR.section || 'home-loans',
        activeTab: tabState.activeTab || 'explorer',
    });

    function setModeButtonState(mode) {
        var consumerActive = mode === 'consumer';
        if (els.modeConsumer) {
            els.modeConsumer.classList.toggle('active', consumerActive);
            els.modeConsumer.setAttribute('aria-pressed', String(consumerActive));
        }
        if (els.modeAnalyst) {
            els.modeAnalyst.classList.toggle('active', !consumerActive);
            els.modeAnalyst.setAttribute('aria-pressed', String(!consumerActive));
        }
    }

    function applyUiMode(mode) {
        var uiMode = String(mode || (state && state.getUiMode ? state.getUiMode() : 'consumer'));
        document.body.classList.toggle('ui-mode-consumer', uiMode !== 'analyst');
        document.body.classList.toggle('ui-mode-analyst', uiMode === 'analyst');
        setModeButtonState(uiMode);

        if (tabs && tabs.applyUiMode) tabs.applyUiMode();
        if (filters && filters.applyUiMode) filters.applyUiMode();
        if (explorer && explorer.applyUiMode) explorer.applyUiMode();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();

        clientLog('info', 'UI mode applied', { mode: uiMode });
    }

    function applyFilters() {
        clientLog('info', 'Apply filters requested', {
            activeTab: tabState.activeTab || 'explorer',
            includeManual: !!(els.filterIncludeManual && els.filterIncludeManual.checked),
        });
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (explorer && explorer.reloadExplorer) explorer.reloadExplorer();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (tabState.pivotLoaded && els.pivotStatus) {
            els.pivotStatus.textContent = 'Filters changed -- click "Load Data for Pivot" to refresh.';
        }
        if (tabState.chartDrawn && els.chartStatus) {
            els.chartStatus.textContent = 'Filters changed -- click "Draw Chart" to refresh.';
        }
    }

    if (els.applyFilters) els.applyFilters.addEventListener('click', applyFilters);
    if (els.downloadFormat) els.downloadFormat.addEventListener('change', function () {
        var format = String(els.downloadFormat.value || '').trim();
        if (!format) return;
        if (exportModule && exportModule.downloadSelectedFormat) {
            exportModule.downloadSelectedFormat(format);
        } else if (exportModule && exportModule.downloadCsv) {
            exportModule.downloadCsv();
        }
    });
    if (els.downloadCsv) els.downloadCsv.addEventListener('click', function () {
        if (exportModule && exportModule.downloadSelectedFormat) exportModule.downloadSelectedFormat('csv');
        else if (exportModule && exportModule.downloadCsv) exportModule.downloadCsv();
    });
    if (els.loadPivot) els.loadPivot.addEventListener('click', function () {
        if (pivot && pivot.loadPivotData) pivot.loadPivotData();
    });
    if (els.drawChart) els.drawChart.addEventListener('click', function () {
        if (charts && charts.drawChart) charts.drawChart();
    });
    if (els.filterIncludeManual) els.filterIncludeManual.addEventListener('change', applyFilters);
    if (els.filterMode) els.filterMode.addEventListener('change', applyFilters);
    if (els.refreshInterval) els.refreshInterval.addEventListener('change', function () {
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
    });
    if (els.modeConsumer) els.modeConsumer.addEventListener('click', function () {
        if (state && state.setUiMode) state.setUiMode('consumer');
    });
    if (els.modeAnalyst) els.modeAnalyst.addEventListener('click', function () {
        if (state && state.setUiMode) state.setUiMode('analyst');
    });

    window.addEventListener('ar:ui-mode-changed', function (event) {
        var mode = event && event.detail ? event.detail.mode : null;
        applyUiMode(mode);
    });

    if (tabs && tabs.bindTabListeners) tabs.bindTabListeners();

    if (filters && filters.loadFilters) {
        filters.loadFilters().then(function () {
            applyUiMode(state && state.getUiMode ? state.getUiMode() : 'consumer');
            if (tabs && tabs.activateTab) tabs.activateTab(tabState.activeTab || 'explorer');
            clientLog('info', 'App init complete', { activeTab: tabState.activeTab || 'explorer' });
        }).catch(function (err) {
            clientLog('error', 'App init failed while loading filters', {
                message: err && err.message ? err.message : String(err),
            });
            applyUiMode(state && state.getUiMode ? state.getUiMode() : 'consumer');
            if (tabs && tabs.activateTab) tabs.activateTab(tabState.activeTab || 'explorer');
        });
    } else if (tabs && tabs.activateTab) {
        applyUiMode(state && state.getUiMode ? state.getUiMode() : 'consumer');
        tabs.activateTab(tabState.activeTab || 'explorer');
        clientLog('info', 'App init complete (no filter preload)', { activeTab: tabState.activeTab || 'explorer' });
    }
    if (explorer && explorer.initRateTable) explorer.initRateTable();
    if (hero && hero.loadHeroStats) hero.loadHeroStats();
    if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
})();
