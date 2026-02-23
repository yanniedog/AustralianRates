(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };

    function downloadCsv() {
        var fp = buildFilterParams();
        fp.dataset = 'latest';
        var q = new URLSearchParams(fp);
        window.open(apiBase + '/export.csv?' + q.toString(), '_blank', 'noopener');
    }

    window.AR.export = { downloadCsv: downloadCsv };
})();
