(function () {
    'use strict';
    window.AR = window.AR || {};

    var sc = window.AR.sectionConfig || {};
    var params = new URLSearchParams(window.location.search);
    var apiOverride = params.get('apiBase');
    var path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    var pathApiPath = (path.indexOf('/savings') !== -1) ? '/api/savings-rates' : (path.indexOf('/term-deposits') !== -1) ? '/api/term-deposit-rates' : null;
    var effectiveApiPath = sc.apiPath || pathApiPath || '/api/home-loan-rates';
    var apiBase = (apiOverride ? String(apiOverride).replace(/\/+$/, '') : '') ||
                  (window.location.origin + effectiveApiPath);
    var isAdmin = params.get('admin') === 'true';

    window.AR.config = {
        params: params,
        apiOverride: apiOverride,
        apiBase: apiBase,
        isAdmin: isAdmin,
    };
})();
