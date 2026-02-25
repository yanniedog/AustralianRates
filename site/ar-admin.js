(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var explorer = window.AR.explorer;
    var hero = window.AR.hero;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var reloadExplorer = explorer && explorer.reloadExplorer ? explorer.reloadExplorer : function () {};
    var loadHeroStats = hero && hero.loadHeroStats ? hero.loadHeroStats : function () {};
    var clientLog = utils.clientLog || function () {};

    var triggerInFlight = false;
    var triggerCooldownTimer = null;
    var triggerCooldownUntil = 0;
    var runProgressRunId = '';
    var runProgressTimer = null;
    var runProgressFetchInFlight = false;
    var runProgressLastCompleted = -1;
    var runProgressFailures = 0;
    var RUN_PROGRESS_POLL_MS = 2500;
    var RUN_PROGRESS_MAX_FAILURES = 4;

    function enableManualRunFilter() {
        if (els.filterIncludeManual && !els.filterIncludeManual.checked) {
            els.filterIncludeManual.checked = true;
        }
    }

    function isTriggerCooldownActive() {
        return triggerCooldownUntil > Date.now();
    }

    function isRunProgressActive() {
        return !!runProgressRunId;
    }

    function syncTriggerButtonState() {
        if (!els.triggerRun) return;
        els.triggerRun.disabled = !!(triggerInFlight || isTriggerCooldownActive() || isRunProgressActive());
    }

    function clearTriggerCooldown() {
        if (triggerCooldownTimer) {
            clearInterval(triggerCooldownTimer);
            triggerCooldownTimer = null;
        }
        triggerCooldownUntil = 0;
        syncTriggerButtonState();
    }

    function formatCooldown(seconds) {
        var s = Math.max(0, Math.ceil(Number(seconds) || 0));
        var mins = Math.floor(s / 60);
        var rem = s % 60;
        if (mins <= 0) return rem + 's';
        return mins + 'm ' + (rem < 10 ? '0' + rem : String(rem)) + 's';
    }

    function startTriggerCooldown(seconds, reasonText) {
        var safeSeconds = Math.max(1, Math.ceil(Number(seconds) || 0));
        clearTriggerCooldown();
        triggerCooldownUntil = Date.now() + (safeSeconds * 1000);
        syncTriggerButtonState();

        function renderCountdown() {
            var remaining = Math.max(0, Math.ceil((triggerCooldownUntil - Date.now()) / 1000));
            if (remaining <= 0) {
                clearTriggerCooldown();
                if (els.triggerStatus) els.triggerStatus.textContent = 'You can check rates again now.';
                setTimeout(function () {
                    if (els.triggerStatus && els.triggerStatus.textContent === 'You can check rates again now.') {
                        els.triggerStatus.textContent = '';
                    }
                }, 3000);
                return;
            }
            if (els.triggerStatus) {
                els.triggerStatus.textContent = reasonText + ' Try again in ' + formatCooldown(remaining) + '.';
            }
        }

        renderCountdown();
        triggerCooldownTimer = setInterval(renderCountdown, 1000);
    }

    function parseTriggerResponse(response) {
        return response
            .json()
            .then(function (body) {
                return { status: response.status, body: body };
            })
            .catch(function (error) {
                return {
                    status: response.status,
                    body: null,
                    parseError: String(error && error.message),
                };
            });
    }

    function refreshData() {
        reloadExplorer();
        loadHeroStats();
    }

    function scheduleFallbackRefreshes() {
        setTimeout(refreshData, 15000);
        setTimeout(refreshData, 45000);
        setTimeout(refreshData, 90000);
    }

    function clearRunProgressPolling(keepStatusText) {
        if (runProgressTimer) {
            clearInterval(runProgressTimer);
            runProgressTimer = null;
        }
        runProgressRunId = '';
        runProgressFetchInFlight = false;
        runProgressLastCompleted = -1;
        runProgressFailures = 0;
        syncTriggerButtonState();
        if (!keepStatusText && els.triggerStatus) els.triggerStatus.textContent = '';
    }

    function toInt(value, fallback) {
        var n = Number(value);
        if (!isFinite(n)) return fallback;
        return Math.max(0, Math.floor(n));
    }

    function buildRunStatusText(run) {
        var enqueued = toInt(run && run.enqueued_total, 0);
        var completed = toInt(run && run.completed_total, toInt(run && run.processed_total, 0) + toInt(run && run.failed_total, 0));
        var failed = toInt(run && run.failed_total, 0);
        var pending = toInt(run && run.pending_total, Math.max(0, enqueued - completed));
        var pct = Number(run && run.progress_pct);
        if (!isFinite(pct)) {
            pct = enqueued > 0 ? Math.round((completed / enqueued) * 1000) / 10 : 0;
        }
        var status = String((run && run.status) || 'running');
        if (status === 'running') {
            return 'Checking rates live: ' + completed + '/' + enqueued + ' tasks complete (' + pct + '%). Pending ' + pending + '.';
        }
        if (status === 'ok') {
            return 'Check complete: ' + completed + '/' + enqueued + ' tasks done. Data refreshed.';
        }
        if (status === 'partial') {
            return 'Check finished with partial results: ' + completed + '/' + enqueued + ' tasks done, failures ' + failed + '. Data refreshed.';
        }
        return 'Check finished with errors. Completed ' + completed + '/' + enqueued + ' tasks.';
    }

    function pollRunProgress() {
        if (!runProgressRunId || runProgressFetchInFlight) return;
        runProgressFetchInFlight = true;

        fetch(apiBase + '/run-status/' + encodeURIComponent(runProgressRunId), { method: 'GET' })
            .then(parseTriggerResponse)
            .then(function (res) {
                if (!runProgressRunId) return;
                if (res.status !== 200 || !res.body || !res.body.ok || !res.body.run) {
                    runProgressFailures += 1;
                    if (runProgressFailures >= RUN_PROGRESS_MAX_FAILURES) {
                        clearRunProgressPolling(true);
                        if (els.triggerStatus) {
                            els.triggerStatus.textContent = 'Run is still processing. Live progress unavailable; refreshing data in stages...';
                        }
                        scheduleFallbackRefreshes();
                    }
                    return;
                }

                runProgressFailures = 0;
                var run = res.body.run;
                var completed = toInt(run.completed_total, toInt(run.processed_total, 0) + toInt(run.failed_total, 0));
                if (completed !== runProgressLastCompleted) {
                    runProgressLastCompleted = completed;
                    refreshData();
                }

                if (els.triggerStatus) els.triggerStatus.textContent = buildRunStatusText(run);
                if (String(run.status || 'running') !== 'running') {
                    var doneText = buildRunStatusText(run);
                    refreshData();
                    clearRunProgressPolling(true);
                    if (els.triggerStatus) els.triggerStatus.textContent = doneText;
                    setTimeout(function () {
                        if (els.triggerStatus && els.triggerStatus.textContent === doneText) {
                            els.triggerStatus.textContent = '';
                        }
                    }, 8000);
                }
            })
            .catch(function () {
                runProgressFailures += 1;
            })
            .finally(function () {
                runProgressFetchInFlight = false;
            });
    }

    function startRunProgressPolling(runId, historicalQueued) {
        clearRunProgressPolling(true);
        runProgressRunId = String(runId || '').trim();
        runProgressLastCompleted = -1;
        runProgressFailures = 0;
        syncTriggerButtonState();

        if (!runProgressRunId) {
            if (els.triggerStatus) {
                els.triggerStatus.textContent = 'Run started. Refreshing data in stages...';
            }
            refreshData();
            scheduleFallbackRefreshes();
            return;
        }

        if (els.triggerStatus) {
            var intro = 'Full check started (mortgage, savings, term deposits, historical lookup).';
            if (historicalQueued > 0) intro += ' Historical lookups queued: ' + historicalQueued + '.';
            els.triggerStatus.textContent = intro + ' Getting live progress...';
        }
        pollRunProgress();
        runProgressTimer = setInterval(pollRunProgress, RUN_PROGRESS_POLL_MS);
    }

    function handleRateLimitedResponse(res) {
        var secs = Number(res.body && res.body.retry_after_seconds) || 0;
        var reason = String((res.body && res.body.reason) || 'rate_limited');
        var statusPrefix = reason === 'manual_run_in_progress' ? 'A check is already running.' : 'Rate limited.';
        startTriggerCooldown(secs, statusPrefix);
        clientLog('warn', 'Manual run trigger rate limited', {
            reason: reason,
            retryAfterSeconds: secs,
        });
    }

    function getHistoricalQueuedCount(body) {
        return Number(
            body &&
            body.result &&
            body.result.auto_backfill &&
            body.result.auto_backfill.enqueued,
        ) || 0;
    }

    function getRunId(body) {
        return String(body && body.result && body.result.runId || '');
    }

    function getHistoricalRunId(body) {
        return String(body && body.historical_run_id || '');
    }

    function getHistoricalWorkerCommand(body) {
        return String(body && body.worker_command || '');
    }

    function buildHistoricalTriggerPayload() {
        var enabled = !!(els.historicalPullEnabled && els.historicalPullEnabled.checked);
        if (!enabled) return { enabled: false };
        var startDate = els.historicalStartDate ? String(els.historicalStartDate.value || '').trim() : '';
        var endDate = els.historicalEndDate ? String(els.historicalEndDate.value || '').trim() : '';
        if (!startDate || !endDate) {
            return { enabled: true, error: 'Select both historical start and end dates.' };
        }
        return {
            enabled: true,
            payload: {
                historical: {
                    enabled: true,
                    start_date: startDate,
                    end_date: endDate
                }
            }
        };
    }

    function handleAcceptedResponse(res) {
        clearTriggerCooldown();
        enableManualRunFilter();
        var historicalQueued = getHistoricalQueuedCount(res.body);
        var runId = getRunId(res.body);
        var historicalRunId = getHistoricalRunId(res.body);
        var workerCommand = getHistoricalWorkerCommand(res.body);
        if (els.historicalWorkerHint) {
            if (historicalRunId && workerCommand) {
                els.historicalWorkerHint.textContent = 'Historical pull queued: ' + historicalRunId + '. Run locally: ' + workerCommand;
            } else {
                els.historicalWorkerHint.textContent = '';
            }
        }
        clientLog('info', 'Manual run trigger accepted', {
            runId: runId || null,
            historicalQueued: historicalQueued,
            historicalRunId: historicalRunId || null,
        });
        startRunProgressPolling(runId, historicalQueued);
    }

    function handleRejectedResponse(res) {
        var message = String((res.body && (res.body.message || res.body.reason)) || 'Run could not be started.');
        if (els.triggerStatus) els.triggerStatus.textContent = message;
        clientLog('error', 'Manual run trigger rejected', {
            status: res.status,
            message: message,
            parseError: res.parseError || null,
        });
    }

    function triggerManualRun() {
        if (triggerInFlight) return;
        if (isRunProgressActive()) return;
        if (isTriggerCooldownActive()) return;
        if (!els.triggerRun) return;
        triggerInFlight = true;
        syncTriggerButtonState();
        if (els.triggerStatus) els.triggerStatus.textContent = 'Starting run...';
        if (els.historicalWorkerHint) els.historicalWorkerHint.textContent = '';
        clientLog('info', 'Manual run trigger requested', {
            section: window.AR.section || 'home-loans',
        });

        var historical = buildHistoricalTriggerPayload();
        if (historical.enabled && historical.error) {
            if (els.triggerStatus) els.triggerStatus.textContent = historical.error;
            triggerInFlight = false;
            syncTriggerButtonState();
            return;
        }

        fetch(apiBase + '/trigger-run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(historical.payload || {}),
        })
            .then(parseTriggerResponse)
            .then(function (res) {
                if (res.status === 429) {
                    handleRateLimitedResponse(res);
                } else if (res.body && res.body.ok) {
                    handleAcceptedResponse(res);
                } else {
                    handleRejectedResponse(res);
                }
            })
            .catch(function (err) {
                if (els.triggerStatus) els.triggerStatus.textContent = 'Error: ' + String(err.message || err);
                clientLog('error', 'Manual run trigger failed', {
                    message: err && err.message ? err.message : String(err),
                });
            })
            .finally(function () {
                triggerInFlight = false;
                syncTriggerButtonState();
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
            clientLog('info', 'Admin runs loaded', { ok: !!(data && data.ok) });
        } catch (err) {
            els.runsOutput.textContent = JSON.stringify({ ok: false, error: String(err.message || err) }, null, 2);
            clientLog('error', 'Admin runs load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.admin = { triggerManualRun: triggerManualRun, loadRuns: loadRuns };
})();
