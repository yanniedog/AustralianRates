(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var state = window.AR.state;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var isAnalystMode = state && typeof state.isAnalystMode === 'function'
        ? state.isAnalystMode
        : function () { return false; };
    var clientLog = utils.clientLog || function () {};

    var tabBtns = [els.tabExplorer, els.tabPivot, els.tabCharts];
    var tabPanels = [els.panelExplorer, els.panelPivot, els.panelCharts];

    function getAllowedTabs() {
        return isAnalystMode() ? ['explorer', 'pivot', 'charts'] : ['explorer'];
    }

    function normalizeTabId(tabId) {
        var candidate = String(tabId || 'explorer').toLowerCase();
        var allowed = getAllowedTabs();
        if (allowed.indexOf(candidate) >= 0) return candidate;
        return 'explorer';
    }

    function activateTab(tabId) {
        tabState.activeTab = normalizeTabId(tabId);
        tabBtns.forEach(function (btn) {
            if (!btn) return;
            var active = btn.id === 'tab-' + tabState.activeTab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
            btn.setAttribute('tabindex', active ? '0' : '-1');
        });
        tabPanels.forEach(function (panel) {
            if (!panel) return;
            var active = panel.id === 'panel-' + tabState.activeTab;
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });
        clientLog('info', 'Tab activated', { tab: tabState.activeTab });
        if (window.AR.filters && window.AR.filters.syncUrlState) {
            window.AR.filters.syncUrlState();
        }
    }

    function applyUiMode() {
        var analyst = isAnalystMode();
        if (els.tabPivot) {
            els.tabPivot.hidden = !analyst;
            els.tabPivot.setAttribute('aria-hidden', String(!analyst));
        }
        if (els.tabCharts) {
            els.tabCharts.hidden = !analyst;
            els.tabCharts.setAttribute('aria-hidden', String(!analyst));
        }

        if (!analyst && tabState.activeTab !== 'explorer') {
            activateTab('explorer');
            return;
        }

        activateTab(tabState.activeTab || 'explorer');
    }

    function bindTabListeners() {
        tabBtns.forEach(function (btn) {
            if (!btn) return;
            btn.addEventListener('click', function () {
                activateTab(btn.id.replace('tab-', ''));
            });
            btn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateTab(btn.id.replace('tab-', ''));
                }
            });
        });
    }

    window.AR.tabs = {
        activateTab: activateTab,
        applyUiMode: applyUiMode,
        bindTabListeners: bindTabListeners,
        getActiveTab: function () { return tabState.activeTab; },
    };
})();
