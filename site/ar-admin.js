(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var explorer = window.AR.explorer;
    var hero = window.AR.hero;
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var reloadExplorer = explorer && explorer.reloadExplorer ? explorer.reloadExplorer : function () {};
    var loadHeroStats = hero && hero.loadHeroStats ? hero.loadHeroStats : function () {};

    var triggerInFlight = false;

    function enableManualRunFilter() {
        if (els.filterIncludeManual && !els.filterIncludeManual.checked) {
            els.filterIncludeManual.checked = true;
        }
    }

    function triggerManualRun() {
        if (triggerInFlight) return;
        if (!els.triggerRun) return;
        triggerInFlight = true;
        els.triggerRun.disabled = true;
        if (els.triggerStatus) els.triggerStatus.textContent = 'Starting run...';

        fetch(apiBase + '/trigger-run', { method: 'POST' })
            .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }).catch(function (e) { return { status: r.status, body: null, parseError: String(e && e.message) }; }); })
            .then(function (res) {
                // #region agent log
                console.log('[AR-DEBUG-eb90c6] trigger-run response: status=' + res.status + ', body.ok=' + (res.body && res.body.ok));
                // #endregion
                if (res.status === 429) {
                    var secs = (res.body && res.body.retry_after_seconds) || 0;
                    var mins = Math.ceil(secs / 60);
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Rate limited -- try again in ~' + mins + ' min.';
                } else if (res.body && res.body.ok) {
                    enableManualRunFilter();
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run started. Refreshing data...';
                    reloadExplorer();
                    loadHeroStats();
                    setTimeout(function () {
                        // #region agent log
                        console.log('[AR-DEBUG-eb90c6] 15s delayed reload');
                        // #endregion
                        reloadExplorer();
                        loadHeroStats();
                        if (els.triggerStatus) els.triggerStatus.textContent = 'Refreshing data (banks still reporting)...';
                    }, 15000);
                    setTimeout(function () {
                        // #region agent log
                        console.log('[AR-DEBUG-eb90c6] 45s delayed reload');
                        // #endregion
                        reloadExplorer();
                        loadHeroStats();
                        if (els.triggerStatus) els.triggerStatus.textContent = 'Refreshing data (almost done)...';
                    }, 45000);
                    setTimeout(function () {
                        // #region agent log
                        console.log('[AR-DEBUG-eb90c6] 90s final reload');
                        // #endregion
                        reloadExplorer();
                        loadHeroStats();
                        if (els.triggerStatus) els.triggerStatus.textContent = 'Data refreshed.';
                        setTimeout(function () { if (els.triggerStatus) els.triggerStatus.textContent = ''; }, 5000);
                    }, 90000);
                } else {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run could not be started.';
                    // #region agent log
                    console.log('[AR-DEBUG-eb90c6] Run failed. Body:', JSON.stringify(res.body));
                    // #endregion
                }
            })
            .catch(function (err) {
                if (els.triggerStatus) els.triggerStatus.textContent = 'Error: ' + String(err.message || err);
            })
            .finally(function () {
                triggerInFlight = false;
                setTimeout(function () {
                    if (els.triggerRun) els.triggerRun.disabled = false;
                }, 5000);
            });
    }

    async function loadRuns() {
        if (!els.runsOutput) return;
        els.runsOutput.textContent = 'Loading runs...';
        var token = els.adminToken && els.adminToken.value ? String(els.adminToken.value).trim() : '';
        var headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        try {
            var r = await fetch(apiBase + '/admin/runs?limit=10', { headers: headers });
            var data = await r.json();
            els.runsOutput.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            els.runsOutput.textContent = JSON.stringify({ ok: false, error: String(err.message || err) }, null, 2);
        }
    }

    window.AR.admin = { triggerManualRun: triggerManualRun, loadRuns: loadRuns };
})();
