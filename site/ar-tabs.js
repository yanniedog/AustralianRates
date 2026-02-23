(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var state = window.AR.state;
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};

    var tabBtns = [els.tabExplorer, els.tabPivot, els.tabCharts];
    var tabPanels = [els.panelExplorer, els.panelPivot, els.panelCharts];

    function activateTab(tabId) {
        tabState.activeTab = tabId;
        tabBtns.forEach(function (btn) {
            if (!btn) return;
            var active = btn.id === 'tab-' + tabId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });
        tabPanels.forEach(function (panel) {
            if (!panel) return;
            var active = panel.id === 'panel-' + tabId;
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });
        if (window.AR.filters && window.AR.filters.syncUrlState) {
            window.AR.filters.syncUrlState();
        }
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
        bindTabListeners: bindTabListeners,
        getActiveTab: function () { return tabState.activeTab; },
    };
})();
