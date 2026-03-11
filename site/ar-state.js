(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config;
    var runtimePrefs = window.AR.runtimePrefs = window.AR.runtimePrefs || {};
    var params = config && config.params ? config.params : new URLSearchParams(window.location.search);
    var VALID_TABS = ['explorer', 'pivot', 'history', 'changes'];

    function normalizeUiMode(value) {
        return String(value || '').toLowerCase() === 'consumer' ? 'consumer' : 'analyst';
    }

    function normalizeTab(value) {
        var candidate = String(value || '').toLowerCase();
        return VALID_TABS.indexOf(candidate) >= 0 ? candidate : 'explorer';
    }

    function hashTab() {
        var hash = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
        if (hash === 'table') return 'explorer';
        if (hash === 'pivot') return 'pivot';
        if (hash === 'history') return 'history';
        if (hash === 'changes') return 'changes';
        return '';
    }

    function currentUiMode() {
        if (params.get('view')) return normalizeUiMode(params.get('view'));
        return normalizeUiMode(runtimePrefs.uiMode || 'analyst');
    }

    var state = {
        activeTab: normalizeTab(hashTab() || params.get('tab') || runtimePrefs.activeTab || 'explorer'),
        pivotLoaded: false,
        chartDrawn: false,
        refreshTimerId: null,
        lastRefreshedAt: null,
        uiMode: currentUiMode(),
    };

    runtimePrefs.uiMode = state.uiMode;
    runtimePrefs.activeTab = state.activeTab;

    function setUiMode(mode) {
        var normalized = normalizeUiMode(mode);
        if (state.uiMode === normalized) return;
        state.uiMode = normalized;
        runtimePrefs.uiMode = normalized;
        window.dispatchEvent(new CustomEvent('ar:ui-mode-changed', {
            detail: { mode: normalized },
        }));
    }

    function setActiveTab(tab) {
        var normalized = normalizeTab(tab);
        state.activeTab = normalized;
        runtimePrefs.activeTab = normalized;
    }

    function getUiMode() {
        return normalizeUiMode(state.uiMode);
    }

    function isAnalystMode() {
        return getUiMode() === 'analyst';
    }

    window.AR.state = {
        state: state,
        setActiveTab: setActiveTab,
        setUiMode: setUiMode,
        getUiMode: getUiMode,
        isAnalystMode: isAnalystMode,
    };
})();
