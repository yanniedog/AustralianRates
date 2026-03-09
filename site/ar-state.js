(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config;
    var runtimePrefs = window.AR.runtimePrefs = window.AR.runtimePrefs || {};
    var params = config && config.params ? config.params : new URLSearchParams(window.location.search);

    function normalizeUiMode(value) {
        return String(value || '').toLowerCase() === 'analyst' ? 'analyst' : 'consumer';
    }

    function currentUiMode() {
        if (params.get('view')) return normalizeUiMode(params.get('view'));
        var requestedTab = String(params.get('tab') || '').toLowerCase();
        if (requestedTab === 'pivot' || requestedTab === 'charts') return 'analyst';
        return normalizeUiMode(runtimePrefs.uiMode);
    }

    var state = {
        activeTab: params.get('tab') || 'explorer',
        pivotLoaded: false,
        chartDrawn: false,
        refreshTimerId: null,
        lastRefreshedAt: null,
        uiMode: currentUiMode(),
    };
    runtimePrefs.uiMode = state.uiMode;

    function setUiMode(mode) {
        var normalized = normalizeUiMode(mode);
        if (state.uiMode === normalized) return;
        state.uiMode = normalized;
        runtimePrefs.uiMode = normalized;
        window.dispatchEvent(new CustomEvent('ar:ui-mode-changed', {
            detail: { mode: normalized },
        }));
    }

    function getUiMode() {
        return normalizeUiMode(state.uiMode);
    }

    function isAnalystMode() {
        return getUiMode() === 'analyst';
    }

    window.AR.state = {
        state: state,
        setUiMode: setUiMode,
        getUiMode: getUiMode,
        isAnalystMode: isAnalystMode,
    };
})();
