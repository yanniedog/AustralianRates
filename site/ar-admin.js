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

    function triggerManualRun() {
        if (triggerInFlight) return;
        if (!els.triggerRun) return;
        triggerInFlight = true;
        els.triggerRun.disabled = true;
        if (els.triggerStatus) els.triggerStatus.textContent = 'Starting run...';

        fetch(apiBase + '/trigger-run', { method: 'POST' })
            .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }).catch(function (e) { return { status: r.status, body: null, parseError: String(e && e.message) }; }); })
            .then(function (res) {
                if (res.status === 429) {
                    var secs = (res.body && res.body.retry_after_seconds) || 0;
                    var mins = Math.ceil(secs / 60);
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Rate limited -- try again in ~' + mins + ' min.';
                } else if (res.body && res.body.ok) {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run started. Data will refresh shortly.';
                    reloadExplorer();
                    loadHeroStats();
                    setTimeout(function () {
                        reloadExplorer();
                        loadHeroStats();
                        if (els.triggerStatus) els.triggerStatus.textContent = '';
                    }, 15000);
                } else {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run could not be started.';
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
