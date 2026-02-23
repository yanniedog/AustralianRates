(function () {
    'use strict';
    window.AR = window.AR || {};

    var els = {
        tabExplorer:   document.getElementById('tab-explorer'),
        tabPivot:      document.getElementById('tab-pivot'),
        tabCharts:     document.getElementById('tab-charts'),
        panelExplorer: document.getElementById('panel-explorer'),
        panelPivot:    document.getElementById('panel-pivot'),
        panelCharts:   document.getElementById('panel-charts'),
        panelAdmin:    document.getElementById('panel-admin'),
        filterBank:      document.getElementById('filter-bank'),
        filterSecurity:  document.getElementById('filter-security'),
        filterRepayment: document.getElementById('filter-repayment'),
        filterStructure: document.getElementById('filter-structure'),
        filterLvr:       document.getElementById('filter-lvr'),
        filterFeature:   document.getElementById('filter-feature'),
        filterStartDate: document.getElementById('filter-start-date'),
        filterEndDate:   document.getElementById('filter-end-date'),
        applyFilters:  document.getElementById('apply-filters'),
        downloadCsv:   document.getElementById('download-csv'),
        loadPivot:     document.getElementById('load-pivot'),
        pivotStatus:   document.getElementById('pivot-status'),
        pivotOutput:   document.getElementById('pivot-output'),
        chartX:        document.getElementById('chart-x'),
        chartY:        document.getElementById('chart-y'),
        chartGroup:    document.getElementById('chart-group'),
        chartType:     document.getElementById('chart-type'),
        drawChart:     document.getElementById('draw-chart'),
        chartOutput:   document.getElementById('chart-output'),
        chartStatus:   document.getElementById('chart-status'),
        statUpdated:   document.getElementById('stat-updated'),
        statCashRate:  document.getElementById('stat-cash-rate'),
        statRecords:   document.getElementById('stat-records'),
        refreshRuns:   document.getElementById('refresh-runs'),
        runsOutput:    document.getElementById('runs-output'),
        adminToken:    document.getElementById('admin-token'),
        triggerRun:    document.getElementById('trigger-run'),
        triggerStatus: document.getElementById('trigger-status'),
        filterIncludeManual: document.getElementById('filter-include-manual'),
        refreshInterval: document.getElementById('refresh-interval'),
        lastRefreshed: document.getElementById('last-refreshed'),
    };

    window.AR.dom = { els: els };
})();
