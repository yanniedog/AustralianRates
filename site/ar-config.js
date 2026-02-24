(function () {
    'use strict';
    window.AR = window.AR || {};

    var sc = window.AR.sectionConfig || {};
    var params = new URLSearchParams(window.location.search);
    var apiOverride = params.get('apiBase');
    var apiBase = (apiOverride ? String(apiOverride).replace(/\/+$/, '') : '') ||
                  (window.location.origin + (sc.apiPath || '/api/home-loan-rates'));
    var isAdmin = params.get('admin') === 'true';

    window.AR.config = {
        params: params,
        apiOverride: apiOverride,
        apiBase: apiBase,
        isAdmin: isAdmin,
    };
})();
