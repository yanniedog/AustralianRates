(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config;
    var params = config && config.params ? config.params : new URLSearchParams(window.location.search);

    var state = {
        activeTab: params.get('tab') || 'explorer',
        pivotLoaded: false,
        chartDrawn: false,
        refreshTimerId: null,
        lastRefreshedAt: null,
    };

    window.AR.state = { state: state };
})();
