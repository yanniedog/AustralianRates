(function () {
    'use strict';

    var dom = window.AR.dom;
    var config = window.AR.config;
    var state = window.AR.state;
    var tabs = window.AR.tabs;
    var filters = window.AR.filters;
    var explorer = window.AR.explorer;
    var pivot = window.AR.pivot;
    var charts = window.AR.charts;
    var admin = window.AR.admin;
    var refresh = window.AR.refresh;
    var exportModule = window.AR.export;
    var hero = window.AR.hero;

    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};

    if (config && config.isAdmin && els.panelAdmin) {
        els.panelAdmin.hidden = false;
    }

    function applyFilters() {
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (explorer && explorer.reloadExplorer) explorer.reloadExplorer();
        if (tabState.pivotLoaded && els.pivotStatus) {
            els.pivotStatus.textContent = 'Filters changed -- click "Load Data for Pivot" to refresh.';
        }
        if (tabState.chartDrawn && els.chartStatus) {
            els.chartStatus.textContent = 'Filters changed -- click "Draw Chart" to refresh.';
        }
    }

    if (els.applyFilters) els.applyFilters.addEventListener('click', applyFilters);
    if (els.downloadCsv) els.downloadCsv.addEventListener('click', function () {
        if (exportModule && exportModule.downloadCsv) exportModule.downloadCsv();
    });
    if (els.loadPivot) els.loadPivot.addEventListener('click', function () {
        if (pivot && pivot.loadPivotData) pivot.loadPivotData();
    });
    if (els.drawChart) els.drawChart.addEventListener('click', function () {
        if (charts && charts.drawChart) charts.drawChart();
    });
    if (els.refreshRuns) els.refreshRuns.addEventListener('click', function () {
        if (admin && admin.loadRuns) admin.loadRuns();
    });
    if (els.triggerRun) els.triggerRun.addEventListener('click', function () {
        if (admin && admin.triggerManualRun) admin.triggerManualRun();
    });
    if (els.filterIncludeManual) els.filterIncludeManual.addEventListener('change', applyFilters);
    if (els.refreshInterval) els.refreshInterval.addEventListener('change', function () {
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
    });

    if (tabs && tabs.bindTabListeners) tabs.bindTabListeners();

    if (filters && filters.loadFilters) {
        filters.loadFilters().then(function () {
            if (tabs && tabs.activateTab) tabs.activateTab(tabState.activeTab);
        });
    } else if (tabs && tabs.activateTab) {
        tabs.activateTab(tabState.activeTab);
    }
    if (hero && hero.loadHeroStats) hero.loadHeroStats();
    if (explorer && explorer.initRateTable) explorer.initRateTable();
    if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
})();
