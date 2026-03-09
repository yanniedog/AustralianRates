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
        window.dispatchEvent(new CustomEvent('ar:tab-changed', {
            detail: { tab: tabState.activeTab },
        }));
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
        function getVisibleTabButtons() {
            return tabBtns.filter(function (btn) {
                if (!btn) return false;
                if (btn.hidden) return false;
                return btn.getAttribute('aria-hidden') !== 'true';
            });
        }

        function moveFocusAndActivate(currentBtn, dir) {
            var visible = getVisibleTabButtons();
            if (!visible.length) return;
            var currentIndex = visible.indexOf(currentBtn);
            if (currentIndex < 0) currentIndex = 0;

            var nextIndex = currentIndex;
            if (dir === 'first') nextIndex = 0;
            else if (dir === 'last') nextIndex = visible.length - 1;
            else if (dir === 'prev') nextIndex = (currentIndex - 1 + visible.length) % visible.length;
            else if (dir === 'next') nextIndex = (currentIndex + 1) % visible.length;

            var nextBtn = visible[nextIndex];
            if (!nextBtn) return;
            nextBtn.focus();
            activateTab(nextBtn.id.replace('tab-', ''));
        }

        tabBtns.forEach(function (btn) {
            if (!btn) return;
            btn.addEventListener('click', function () {
                activateTab(btn.id.replace('tab-', ''));
            });
            btn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateTab(btn.id.replace('tab-', ''));
                    return;
                }
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    moveFocusAndActivate(btn, 'next');
                    return;
                }
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    moveFocusAndActivate(btn, 'prev');
                    return;
                }
                if (e.key === 'Home') {
                    e.preventDefault();
                    moveFocusAndActivate(btn, 'first');
                    return;
                }
                if (e.key === 'End') {
                    e.preventDefault();
                    moveFocusAndActivate(btn, 'last');
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
