(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config;
    var params = config && config.params ? config.params : new URLSearchParams(window.location.search);
    var UI_MODE_STORAGE_KEY = 'ar_ui_mode';

    function normalizeUiMode(value) {
        return String(value || '').toLowerCase() === 'analyst' ? 'analyst' : 'consumer';
    }

    function readStoredUiMode() {
        try {
            return normalizeUiMode(window.localStorage.getItem(UI_MODE_STORAGE_KEY));
        } catch (_err) {
            return 'consumer';
        }
    }

    function persistUiMode(mode) {
        try {
            window.localStorage.setItem(UI_MODE_STORAGE_KEY, normalizeUiMode(mode));
        } catch (_err) {
            // Ignore storage failures in private/restricted mode.
        }
    }

    var state = {
        activeTab: params.get('tab') || 'explorer',
        pivotLoaded: false,
        chartDrawn: false,
        refreshTimerId: null,
        lastRefreshedAt: null,
        uiMode: readStoredUiMode(),
    };

    function setUiMode(mode) {
        var normalized = normalizeUiMode(mode);
        if (state.uiMode === normalized) return;
        state.uiMode = normalized;
        persistUiMode(normalized);
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
