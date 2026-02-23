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
        // #region agent log
        fetch('http://127.0.0.1:7387/ingest/142ac719-0ef0-4470-bdb0-605715664be9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'79669b'},body:JSON.stringify({sessionId:'79669b',location:'ar-admin.js:triggerManualRun',message:'Check Rates Now clicked',data:{triggerInFlight:!!triggerInFlight,hasTriggerRun:!!els.triggerRun},timestamp:Date.now(),hypothesisId:'H3'})}).catch(function(){});
        // #endregion
        if (triggerInFlight) return;
        if (!els.triggerRun) return;
        triggerInFlight = true;
        els.triggerRun.disabled = true;
        if (els.triggerStatus) els.triggerStatus.textContent = 'Starting run...';

        fetch(apiBase + '/trigger-run', { method: 'POST' })
            .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }).catch(function (e) { return { status: r.status, body: null, parseError: String(e && e.message) }; }); })
            .then(function (res) {
                // #region agent log
                fetch('http://127.0.0.1:7387/ingest/142ac719-0ef0-4470-bdb0-605715664be9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'79669b'},body:JSON.stringify({sessionId:'79669b',location:'ar-admin.js:triggerRun-response',message:'trigger-run response',data:{status:res.status,bodyOk:!!(res.body&&res.body.ok),bodyReason:res.body&&res.body.reason,parseError:res.parseError},timestamp:Date.now(),hypothesisId:'H1'})}).catch(function(){});
                // #endregion
                if (res.status === 429) {
                    var secs = res.body.retry_after_seconds || 0;
                    var mins = Math.ceil(secs / 60);
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Rate limited -- try again in ~' + mins + ' min.';
                } else if (res.body && res.body.ok) {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run started. Data will refresh shortly.';
                    setTimeout(function () {
                        // #region agent log
                        fetch('http://127.0.0.1:7387/ingest/142ac719-0ef0-4470-bdb0-605715664be9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'79669b'},body:JSON.stringify({sessionId:'79669b',location:'ar-admin.js:setTimeout-callback',message:'15s timeout fired',data:{hasReloadExplorer:typeof reloadExplorer==='function'},timestamp:Date.now(),hypothesisId:'H3'})}).catch(function(){});
                        // #endregion
                        reloadExplorer();
                        loadHeroStats();
                        if (els.triggerStatus) els.triggerStatus.textContent = '';
                    }, 15000);
                } else {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run could not be started.';
                }
            })
            .catch(function (err) {
                // #region agent log
                fetch('http://127.0.0.1:7387/ingest/142ac719-0ef0-4470-bdb0-605715664be9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'79669b'},body:JSON.stringify({sessionId:'79669b',location:'ar-admin.js:triggerRun-catch',message:'trigger-run fetch failed',data:{errMsg:String(err&&err.message)},timestamp:Date.now(),hypothesisId:'H2'})}).catch(function(){});
                // #endregion
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
