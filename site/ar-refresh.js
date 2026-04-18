(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var state = window.AR.state;
    var hero = window.AR.hero;
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var loadHeroStats = hero && hero.loadHeroStats ? hero.loadHeroStats : function () {};
    var loadQuickCompare = hero && hero.loadQuickCompare ? hero.loadQuickCompare : function () {};

    /** Full page reload with cache-bust param so browser fetches fresh HTML/JS and API requests bypass Worker cache. */
    function fullPageRefreshWithCacheBust() {
        try {
            var u = new URL(window.location.href);
            u.searchParams.set('_', String(Date.now()));
            var bustUrl = u.toString();
            if (window.fetch) {
                // cache:'reload' bypasses the browser disk cache unconditionally (even
                // stale entries with old max-age headers), fetching fresh from the network.
                // We wait for it to complete before navigating so the browser cache is
                // updated and the navigation uses the fresh response.
                fetch(bustUrl, { cache: 'reload' })
                    .catch(function () {})
                    .finally(function () { window.location.replace(bustUrl); });
            } else {
                window.location.href = bustUrl;
            }
        } catch (_) {
            var sep = window.location.search ? '&' : '?';
            window.location.href = window.location.pathname + window.location.search + sep + '_=' + Date.now();
        }
    }

    /**
     * Clear Cache Storage (cached images/files) and service worker registrations,
     * then do a cache-busted reload. Does NOT clear cookies or localStorage.
     * Equivalent to Chrome "Delete browsing data" with only "Cached images and files"
     * and "Hosted app data" checked.
     */
    function clearCacheAndRefresh() {
        var p = Promise.resolve();
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            p = p.then(function () {
                return navigator.serviceWorker.getRegistrations().then(function (regs) {
                    return Promise.all(regs.map(function (r) { return r.unregister(); }));
                });
            }).catch(function () {});
        }
        if (typeof caches !== 'undefined' && caches.keys) {
            p = p.then(function () {
                return caches.keys().then(function (keys) {
                    return Promise.all(keys.map(function (key) { return caches.delete(key); }));
                });
            }).catch(function () {});
        }
        p.then(function () { fullPageRefreshWithCacheBust(); }).catch(function () { fullPageRefreshWithCacheBust(); });
    }

    /** Remove _= from URL after load so the bar stays clean; state.cacheBust is already set from it. */
    function cleanRefreshParamFromUrl() {
        try {
            var u = new URL(window.location.href);
            if (!u.searchParams.has('_')) return;
            u.searchParams.delete('_');
            var replacement = u.pathname + (u.search || '') + u.hash;
            // Also evict the canonical URL's stale browser cache entry so the next
            // direct visit (without _=) also gets a fresh fetch, not a disk-cached copy.
            if (window.fetch) {
                fetch(u.toString(), { cache: 'reload' }).catch(function () {});
            }
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
        loadHeroStats();
        loadQuickCompare();
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
        refreshPageBtn.addEventListener('click', function () { clearCacheAndRefresh(); });
    }

    window.AR.refresh = {
        updateLastRefreshed: updateLastRefreshed,
        doAutoRefresh: doAutoRefresh,
        setupAutoRefresh: setupAutoRefresh,
        fullPageRefreshWithCacheBust: fullPageRefreshWithCacheBust,
        clearCacheAndRefresh: clearCacheAndRefresh,
    };
})();
