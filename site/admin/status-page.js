(function () {
    'use strict';
    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var statusEl = document.getElementById('status-line');
    var overallEl = document.getElementById('overall-grid');
    var e2eEl = document.getElementById('e2e-grid');
    var e2eDatasetsEl = document.getElementById('e2e-datasets-wrap');
    var componentsEl = document.getElementById('components-wrap');
    var integrityEl = document.getElementById('integrity-wrap');
    var issuesEl = document.getElementById('issues-wrap');
    var probePayloadsEl = document.getElementById('probe-payloads-wrap');
    var payloadViewerStatusEl = document.getElementById('payload-viewer-status');
    var payloadViewerEl = document.getElementById('payload-viewer-wrap');
    var historyEl = document.getElementById('history-wrap');
    var cdrAuditStatusEl = document.getElementById('cdr-audit-status');
    var cdrAuditOverviewEl = document.getElementById('cdr-audit-overview');
    var cdrAuditWrapEl = document.getElementById('cdr-audit-wrap');

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function boolPill(ok) {
        return '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'OK' : 'Attention') + '</span>';
    }

    function cardCell(label, value) {
        return '<div><div class="status-line">' + esc(label) + '</div><div>' + value + '</div></div>';
    }

    function datasetLabel(value) {
        var map = {
            home_loans: 'Home loans',
            savings: 'Savings',
            term_deposits: 'Term deposits'
        };
        return map[value] || String(value || '');
    }

    function eventAction(fetchEventId, mode, label) {
        return '<button type="button" class="link-btn js-payload-link" data-fetch-event-id="' + esc(fetchEventId)
            + '" data-mode="' + esc(mode) + '">' + esc(label) + '</button>';
    }

    function eventActions(fetchEventIds) {
        if (!Array.isArray(fetchEventIds) || fetchEventIds.length === 0) return '—';
        return fetchEventIds.map(function (id) {
            return '<span>' + eventAction(id, 'json', String(id)) + ' / ' + eventAction(id, 'raw', 'raw') + '</span>';
        }).join('<br>');
    }

    function maybeJson(value) {
        if (typeof value !== 'string') return null;
        try {
            return JSON.parse(value);
        } catch (_err) {
            return null;
        }
    }

    function renderOverall(latest) {
        if (!latest) {
            overallEl.innerHTML = '<div>No health runs recorded yet.</div>';
            return;
        }
        overallEl.innerHTML = [
            cardCell('Latest run', '<span class="mono">' + esc(latest.run_id) + '</span>'),
            cardCell('Checked at', esc(latest.checked_at)),
            cardCell('Trigger', esc(latest.trigger_source)),
            cardCell('Overall status', boolPill(!!latest.overall_ok)),
            cardCell('Duration', esc(String(latest.duration_ms || 0)) + ' ms'),
            cardCell('Failures', esc(String((latest.failures || []).length || 0)))
        ].join('');
    }

    function renderE2E(latest) {
        var e2e = latest && latest.e2e ? latest.e2e : null;
        if (!e2e) {
            e2eEl.innerHTML = '<div>No E2E result available.</div>';
            e2eDatasetsEl.innerHTML = '<div>No per-dataset E2E result available.</div>';
            return;
        }
        var criteria = e2e.criteria || {};
        var datasets = Array.isArray(e2e.datasets) ? e2e.datasets : [];
        var failedDatasets = datasets.filter(function (row) { return !row.ok; }).length;
        e2eEl.innerHTML = [
            cardCell('Aligned', boolPill(!!e2e.aligned)),
            cardCell('Reason code', '<span class="mono">' + esc(e2e.reasonCode || 'n/a') + '</span>'),
            cardCell('Source mode', '<span class="mono">' + esc(e2e.sourceMode || 'n/a') + '</span>'),
            cardCell('Scheduler criterion', boolPill(!!criteria.scheduler)),
            cardCell('Runs progress criterion', boolPill(!!criteria.runsProgress)),
            cardCell('API latest-data criterion', boolPill(!!criteria.apiServesLatest)),
            cardCell('Dataset failures', esc(String(failedDatasets))),
            cardCell('Target collection date', '<span class="mono">' + esc(e2e.targetCollectionDate || 'n/a') + '</span>'),
            cardCell('Detail', esc(e2e.reasonDetail || 'None'))
        ].join('');

        if (!datasets.length) {
            e2eDatasetsEl.innerHTML = '<div>No dataset probes recorded.</div>';
            return;
        }
        e2eDatasetsEl.innerHTML = '<table><thead><tr><th>Dataset</th><th>Status</th><th>Failure</th><th>Detail</th><th>Payloads</th></tr></thead><tbody>'
            + datasets.map(function (row) {
                return '<tr>'
                    + '<td>' + esc(datasetLabel(row.dataset)) + '</td>'
                    + '<td>' + boolPill(!!row.ok) + '</td>'
                    + '<td class="mono">' + esc(row.failureCode || '') + '</td>'
                    + '<td>' + esc(row.detail || '') + '</td>'
                    + '<td class="mono">' + eventActions(row.fetchEventIds) + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderComponents(latest) {
        var rows = latest && Array.isArray(latest.components) ? latest.components : [];
        if (!rows.length) {
            componentsEl.innerHTML = '<div>No component results available.</div>';
            return;
        }
        componentsEl.innerHTML = '<table><thead><tr><th>Component</th><th>Status</th><th>HTTP</th><th>Duration</th><th>Detail</th><th>Payload</th></tr></thead><tbody>'
            + rows.map(function (r) {
                return '<tr>'
                    + '<td class="mono">' + esc(r.key) + '</td>'
                    + '<td>' + boolPill(!!r.ok) + '</td>'
                    + '<td>' + esc(r.status) + '</td>'
                    + '<td>' + esc(r.duration_ms) + ' ms</td>'
                    + '<td>' + esc(r.detail || '') + '</td>'
                    + '<td class="mono">' + (r.fetch_event_id ? eventActions([r.fetch_event_id]) : '—') + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderIntegrity(latest) {
        var integrity = latest && latest.integrity ? latest.integrity : null;
        var checks = integrity && Array.isArray(integrity.checks) ? integrity.checks : [];
        if (!checks.length) {
            integrityEl.innerHTML = '<div>No integrity checks available.</div>';
            return;
        }
        integrityEl.innerHTML = '<table><thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead><tbody>'
            + checks.map(function (c) {
                return '<tr>'
                    + '<td class="mono">' + esc(c.name) + '</td>'
                    + '<td>' + boolPill(!!c.passed) + '</td>'
                    + '<td><span class="mono">' + esc(JSON.stringify(c.detail || {})) + '</span></td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderIssues(latest) {
        var issues = latest && Array.isArray(latest.actionable) ? latest.actionable : [];
        if (!issues.length) {
            issuesEl.innerHTML = '<div>No actionable issues detected from recent warn/error logs.</div>';
            return;
        }
        issuesEl.innerHTML = '<table><thead><tr><th>Code</th><th>Title</th><th>Count</th><th>Action</th><th>Latest</th></tr></thead><tbody>'
            + issues.map(function (i) {
                return '<tr>'
                    + '<td class="mono">' + esc(i.code) + '</td>'
                    + '<td>' + esc(i.title) + '</td>'
                    + '<td>' + esc(i.count) + '</td>'
                    + '<td>' + esc(i.action) + '</td>'
                    + '<td class="mono">' + esc(i.latest_ts || '') + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderProbePayloads(events) {
        if (!Array.isArray(events) || events.length === 0) {
            probePayloadsEl.innerHTML = '<div>No recent probe payloads captured.</div>';
            return;
        }
        probePayloadsEl.innerHTML = '<table><thead><tr><th>Fetched</th><th>Source</th><th>Dataset</th><th>Status</th><th>Payload</th></tr></thead><tbody>'
            + events.map(function (event) {
                return '<tr>'
                    + '<td class="mono">' + esc(event.fetchedAt || '') + '</td>'
                    + '<td><span class="mono">' + esc(event.sourceType || '') + '</span><br>' + esc(event.sourceUrl || '') + '</td>'
                    + '<td>' + esc(datasetLabel(event.dataset)) + '</td>'
                    + '<td>' + esc(event.httpStatus == null ? 'n/a' : event.httpStatus) + '</td>'
                    + '<td class="mono">' + eventActions([event.id]) + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderHistory(history) {
        if (!Array.isArray(history) || history.length === 0) {
            historyEl.innerHTML = '<div>No history yet.</div>';
            return;
        }
        historyEl.innerHTML = '<table><thead><tr><th>Time</th><th>Trigger</th><th>Overall</th><th>E2E</th><th>Reason</th><th>Source mode</th><th>Duration</th></tr></thead><tbody>'
            + history.map(function (h) {
                return '<tr>'
                    + '<td class="mono">' + esc(h.checked_at) + '</td>'
                    + '<td>' + esc(h.trigger_source) + '</td>'
                    + '<td>' + boolPill(!!h.overall_ok) + '</td>'
                    + '<td>' + boolPill(!!(h.e2e && h.e2e.aligned)) + '</td>'
                    + '<td class="mono">' + esc(h.e2e && h.e2e.reasonCode ? h.e2e.reasonCode : '') + '</td>'
                    + '<td class="mono">' + esc(h.e2e && h.e2e.sourceMode ? h.e2e.sourceMode : '') + '</td>'
                    + '<td>' + esc(h.duration_ms) + ' ms</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderCdrAudit(report) {
        if (!report) {
            cdrAuditStatusEl.textContent = 'No audit report available.';
            cdrAuditOverviewEl.innerHTML = '';
            cdrAuditWrapEl.innerHTML = '<div>Run the CDR audit to inspect pipeline gaps.</div>';
            return;
        }

        cdrAuditStatusEl.textContent = report.ok
            ? 'CDR audit status: OK'
            : ('CDR audit detected ' + String(report.totals && report.totals.failed || 0) + ' issue(s).');

        cdrAuditOverviewEl.innerHTML = '<div class="grid">'
            + cardCell('Run ID', '<span class="mono">' + esc(report.run_id || '') + '</span>')
            + cardCell('Generated', esc(report.generated_at || ''))
            + cardCell('Checks', esc(String(report.totals && report.totals.checks || 0)))
            + cardCell('Failed', esc(String(report.totals && report.totals.failed || 0)))
            + cardCell('Errors', esc(String(report.totals && report.totals.errors || 0)))
            + cardCell('Warnings', esc(String(report.totals && report.totals.warns || 0)))
            + '</div>';

        var stageOrder = ['retrieved', 'processed', 'stored', 'archived', 'tracked'];
        var stages = report.stages || {};
        cdrAuditWrapEl.innerHTML = stageOrder.map(function (stage) {
            var checks = Array.isArray(stages[stage]) ? stages[stage] : [];
            if (checks.length === 0) {
                return '<h3>' + esc(stage) + '</h3><div>No checks returned for this stage.</div>';
            }
            var table = '<table><thead><tr><th>Check</th><th>Status</th><th>Severity</th><th>Summary</th><th>Technical</th></tr></thead><tbody>'
                + checks.map(function (check) {
                    var technicalPayload = {
                        metrics: check.metrics || {},
                        sample_rows: check.sample_rows || [],
                        debug: check.debug || {},
                        traceback: check.traceback || null
                    };
                    return '<tr>'
                        + '<td class="mono">' + esc(check.id || '') + '</td>'
                        + '<td>' + boolPill(!!check.passed) + '</td>'
                        + '<td class="mono">' + esc(check.severity || '') + '</td>'
                        + '<td>' + esc(check.summary || '') + '</td>'
                        + '<td><details><summary>View payload</summary><pre class="mono">' + esc(JSON.stringify(technicalPayload, null, 2)) + '</pre></details></td>'
                        + '</tr>';
                }).join('')
                + '</tbody></table>';
            return '<h3>' + esc(stage) + '</h3>' + table;
        }).join('');
    }

    async function loadPayload(fetchEventId, mode) {
        payloadViewerStatusEl.textContent = 'Loading payload ' + String(fetchEventId) + '...';
        payloadViewerEl.textContent = '';
        try {
            var rawMode = mode === 'raw';
            var path = '/diagnostics/fetch-events/' + encodeURIComponent(fetchEventId) + '/payload' + (rawMode ? '?raw=1' : '');
            var res = await portal.fetchAdmin(path, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            if (rawMode) {
                var rawText = await res.text();
                payloadViewerStatusEl.textContent = 'Viewing raw payload for fetch_event_id=' + String(fetchEventId);
                payloadViewerEl.textContent = rawText;
                return;
            }

            var data = await res.json();
            var parsedBody = maybeJson(data && data.payload ? data.payload.body : null);
            var rendered = {
                event: data.event || null,
                payload: parsedBody != null ? parsedBody : (data.payload ? data.payload.body : null)
            };
            payloadViewerStatusEl.textContent = 'Viewing JSON payload for fetch_event_id=' + String(fetchEventId);
            payloadViewerEl.textContent = JSON.stringify(rendered, null, 2);
        } catch (err) {
            payloadViewerStatusEl.textContent = 'Failed to load payload ' + String(fetchEventId) + '.';
            payloadViewerEl.textContent = err && err.message ? err.message : String(err);
        }
    }

    async function loadStatus() {
        statusEl.textContent = 'Loading status...';
        try {
            var res = await portal.fetchAdmin('/health?limit=48');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderOverall(data.latest);
            renderE2E(data.latest);
            renderComponents(data.latest);
            renderIntegrity(data.latest);
            renderIssues(data.latest);
            renderHistory(data.history || []);
            var line = data.latest
                ? ('Last checked: ' + (data.latest.checked_at || 'n/a'))
                : 'No health check runs yet.';
            if (data.nextCronExpression) line += ' | Next: ' + data.nextCronExpression;
            statusEl.textContent = line;
        } catch (err) {
            statusEl.textContent = 'Failed to load status.';
            overallEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
        }
    }

    async function runNow() {
        statusEl.textContent = 'Running manual health check...';
        var btn = document.getElementById('run-check-btn');
        btn.disabled = true;
        try {
            var res = await portal.fetchAdmin('/health/run', { method: 'POST' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            await refreshAll();
            statusEl.textContent = 'Manual health check completed.';
        } catch (_err) {
            statusEl.textContent = 'Manual health check failed.';
        } finally {
            btn.disabled = false;
        }
    }

    async function loadProbePayloads() {
        probePayloadsEl.innerHTML = '<div>Loading probe payloads...</div>';
        try {
            var res = await portal.fetchAdmin('/diagnostics/fetch-events?probe_only=1&limit=40', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderProbePayloads(data.events || []);
        } catch (err) {
            probePayloadsEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
        }
    }

    async function loadCdrAudit() {
        cdrAuditStatusEl.textContent = 'Loading CDR audit...';
        try {
            var res = await portal.fetchAdmin('/cdr-audit', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderCdrAudit(data.report || null);
        } catch (err) {
            cdrAuditStatusEl.textContent = 'Failed to load CDR audit.';
            cdrAuditOverviewEl.innerHTML = '';
            cdrAuditWrapEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
        }
    }

    async function runCdrAuditNow() {
        cdrAuditStatusEl.textContent = 'Running CDR audit...';
        var btn = document.getElementById('run-cdr-audit-btn');
        btn.disabled = true;
        try {
            var res = await portal.fetchAdmin('/cdr-audit/run', { method: 'POST' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderCdrAudit(data.report || null);
        } catch (_err) {
            cdrAuditStatusEl.textContent = 'CDR audit run failed.';
        } finally {
            btn.disabled = false;
        }
    }

    async function refreshAll() {
        await Promise.all([loadStatus(), loadCdrAudit(), loadProbePayloads()]);
    }

    document.getElementById('refresh-btn').addEventListener('click', refreshAll);
    document.getElementById('run-check-btn').addEventListener('click', runNow);
    document.getElementById('run-cdr-audit-btn').addEventListener('click', runCdrAuditNow);
    document.getElementById('copy-diagnose-btn').addEventListener('click', function () {
        var cmd = 'npm run diagnose:api';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cmd).then(function () {
                var btn = document.getElementById('copy-diagnose-btn');
                var orig = btn.textContent;
                btn.textContent = 'Copied';
                setTimeout(function () { btn.textContent = orig; }, 2000);
            });
        }
    });
    document.addEventListener('click', function (event) {
        var target = event.target;
        var button = target && target.closest ? target.closest('.js-payload-link') : null;
        if (!button) return;
        event.preventDefault();
        loadPayload(button.getAttribute('data-fetch-event-id'), button.getAttribute('data-mode'));
    });

    refreshAll();
})();
