(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var state = window.AR.state;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var clientLog = utils.clientLog || function () {};
    var TAB_MAP = {
        explorer: { button: els.tabExplorer, panel: els.panelExplorer, hash: 'table' },
        pivot: { button: els.tabPivot, panel: els.panelPivot, hash: 'pivot' },
        history: { button: els.tabHistory, panel: els.panelHistory, hash: 'history' },
        changes: { button: els.tabChanges, panel: els.panelChanges, hash: 'changes' },
    };

    function normalizeTabId(tabId) {
        var candidate = String(tabId || 'explorer').toLowerCase();
        return Object.prototype.hasOwnProperty.call(TAB_MAP, candidate) ? candidate : 'explorer';
    }

    function updateHash(tabId) {
        var target = TAB_MAP[tabId] ? TAB_MAP[tabId].hash : 'table';
        if (window.location.hash === '#' + target) return;
        window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + target);
    }

    function activateTab(tabId, options) {
        var opts = options || {};
        var activeTab = normalizeTabId(tabId);
        tabState.activeTab = activeTab;
        if (state && typeof state.setActiveTab === 'function') state.setActiveTab(activeTab);

        Object.keys(TAB_MAP).forEach(function (key) {
            var entry = TAB_MAP[key];
            var active = key === activeTab;
            if (entry.button) {
                entry.button.classList.toggle('active', active);
                entry.button.setAttribute('aria-selected', String(active));
                entry.button.setAttribute('tabindex', active ? '0' : '-1');
            }
            if (entry.panel) {
                entry.panel.hidden = !active;
                entry.panel.classList.toggle('active', active);
            }
        });

        if (!opts.skipHash) updateHash(activeTab);

        window.dispatchEvent(new CustomEvent('ar:tab-changed', {
            detail: { tab: activeTab },
        }));

        clientLog('info', 'Tab activated', { tab: activeTab });

        if (window.AR.filters && window.AR.filters.syncUrlState) {
            window.AR.filters.syncUrlState();
        }
    }

    function applyUiMode() {
        activateTab(tabState.activeTab || 'explorer', { skipHash: true });
    }

    function bindTabListeners() {
        function visibleButtons() {
            return Object.keys(TAB_MAP).map(function (key) { return TAB_MAP[key].button; }).filter(Boolean);
        }

        function moveFocusAndActivate(currentBtn, dir) {
            var buttons = visibleButtons();
            if (!buttons.length) return;
            var index = buttons.indexOf(currentBtn);
            if (index < 0) index = 0;
            if (dir === 'next') index = (index + 1) % buttons.length;
            if (dir === 'prev') index = (index - 1 + buttons.length) % buttons.length;
            if (dir === 'first') index = 0;
            if (dir === 'last') index = buttons.length - 1;
            buttons[index].focus();
            activateTab(buttons[index].id.replace('tab-', ''));
        }

        visibleButtons().forEach(function (button) {
            button.addEventListener('click', function () {
                activateTab(button.id.replace('tab-', ''));
            });
            button.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateTab(button.id.replace('tab-', ''));
                    return;
                }
                if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    moveFocusAndActivate(button, 'next');
                    return;
                }
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    moveFocusAndActivate(button, 'prev');
                    return;
                }
                if (event.key === 'Home') {
                    event.preventDefault();
                    moveFocusAndActivate(button, 'first');
                    return;
                }
                if (event.key === 'End') {
                    event.preventDefault();
                    moveFocusAndActivate(button, 'last');
                }
            });
        });
    }

    window.addEventListener('hashchange', function () {
        var hash = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
        if (hash === 'pivot') activateTab('pivot', { skipHash: true });
        else if (hash === 'history') activateTab('history', { skipHash: true });
        else if (hash === 'changes') activateTab('changes', { skipHash: true });
        else if (hash === 'table') activateTab('explorer', { skipHash: true });
    });

    window.AR.tabs = {
        activateTab: activateTab,
        applyUiMode: applyUiMode,
        bindTabListeners: bindTabListeners,
        getActiveTab: function () { return normalizeTabId(tabState.activeTab); },
    };
})();
