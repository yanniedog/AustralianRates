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

    /** Full page reload with cache-bust param so browser fetches fresh HTML/JS and API requests bypass Worker cache. */
    function fullPageRefreshWithCacheBust() {
        try {
            var u = new URL(window.location.href);
            u.searchParams.set('_', String(Date.now()));
            window.location.href = u.toString();
        } catch (_) {
            var sep = window.location.search ? '&' : '?';
            window.location.href = window.location.pathname + window.location.search + sep + '_=' + Date.now();
        }
    }

    /** Remove _= from URL after load so the bar stays clean; state.cacheBust is already set from it. */
    function cleanRefreshParamFromUrl() {
        try {
            var u = new URL(window.location.href);
            if (!u.searchParams.has('_')) return;
            u.searchParams.delete('_');
            var replacement = u.pathname + (u.search || '') + u.hash;
            if (window.history && window.history.replaceState) {
                window.history.replaceState(window.history.state || {}, '', replacement);
            }
        } catch (_) {}
    }

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

    if (document.readyState === 'complete') {
        cleanRefreshParamFromUrl();
    } else {
        window.addEventListener('load', function () { cleanRefreshParamFromUrl(); });
    }

    var refreshPageBtn = document.getElementById('refresh-page-btn');
    if (refreshPageBtn) {
        refreshPageBtn.addEventListener('click', function () { fullPageRefreshWithCacheBust(); });
    }

    window.AR.refresh = {
        updateLastRefreshed: updateLastRefreshed,
        doAutoRefresh: doAutoRefresh,
        setupAutoRefresh: setupAutoRefresh,
        fullPageRefreshWithCacheBust: fullPageRefreshWithCacheBust,
    };
})();
