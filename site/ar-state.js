(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config;
    var runtimePrefs = window.AR.runtimePrefs = window.AR.runtimePrefs || {};
    var params = config && config.params ? config.params : new URLSearchParams(window.location.search);
    var VALID_TABS = ['explorer', 'pivot', 'history', 'changes'];
    var MOBILE_BREAKPOINT = 760;

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

    function isCompactViewport() {
        return !!(window.matchMedia && window.matchMedia('(max-width: ' + MOBILE_BREAKPOINT + 'px)').matches);
    }

    function initialActiveTab() {
        var requested = hashTab() || params.get('tab');
        if (requested) return normalizeTab(requested);

        var storedRaw = String(runtimePrefs.activeTab || '').trim();
        var stored = storedRaw ? normalizeTab(storedRaw) : '';
        if (isCompactViewport()) {
            if (stored && stored !== 'explorer') return stored;
            return 'history';
        }
        return stored || 'explorer';
    }

    function currentUiMode() {
        if (params.get('view')) return normalizeUiMode(params.get('view'));
        return normalizeUiMode(runtimePrefs.uiMode || 'analyst');
    }

    var state = {
        activeTab: initialActiveTab(),
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
