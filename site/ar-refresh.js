(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var state = window.AR.state;
    var explorer = window.AR.explorer;
    var hero = window.AR.hero;
    var rateChanges = window.AR.rateChanges;
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var reloadExplorer = explorer && explorer.reloadExplorer ? explorer.reloadExplorer : function () {};
    var loadHeroStats = hero && hero.loadHeroStats ? hero.loadHeroStats : function () {};
    var loadRateChanges = rateChanges && rateChanges.loadRateChanges ? rateChanges.loadRateChanges : function () {};

    function updateLastRefreshed() {
        if (!els.lastRefreshed) return;
        if (!tabState.lastRefreshedAt) {
            els.lastRefreshed.textContent = '';
            return;
        }
        var ago = Math.round((Date.now() - tabState.lastRefreshedAt) / 60000);
        els.lastRefreshed.textContent = ago < 1 ? 'Refreshed just now' : 'Refreshed ' + ago + ' min ago';
    }

    function doAutoRefresh() {
        reloadExplorer();
        loadHeroStats();
        loadRateChanges();
        tabState.lastRefreshedAt = Date.now();
        updateLastRefreshed();
    }

    function setupAutoRefresh() {
        if (tabState.refreshTimerId) {
            clearInterval(tabState.refreshTimerId);
            tabState.refreshTimerId = null;
        }
        var minutes = parseInt(els.refreshInterval ? els.refreshInterval.value : '60', 10);
        if (isNaN(minutes) || minutes <= 0) {
            if (els.lastRefreshed) els.lastRefreshed.textContent = 'Auto-refresh off';
            return;
        }
        tabState.lastRefreshedAt = Date.now();
        updateLastRefreshed();
        tabState.refreshTimerId = setInterval(doAutoRefresh, minutes * 60 * 1000);
    }

    setInterval(updateLastRefreshed, 30000);

    window.AR.refresh = {
        updateLastRefreshed: updateLastRefreshed,
        doAutoRefresh: doAutoRefresh,
        setupAutoRefresh: setupAutoRefresh,
    };
})();
