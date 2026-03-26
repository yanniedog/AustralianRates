(function () {
    'use strict';
    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var statusEl = document.getElementById('status-line');
    var overallEl = document.getElementById('overall-grid');
    var e2eEl = document.getElementById('e2e-grid');
    var e2eDatasetsEl = document.getElementById('e2e-datasets-wrap');
    var componentsEl = document.getElementById('components-wrap');
    var economicOverviewEl = document.getElementById('economic-overview');
    var economicSeriesEl = document.getElementById('economic-series-wrap');
    var integrityEl = document.getElementById('integrity-wrap');
    var issuesEl = document.getElementById('issues-wrap');
    var probePayloadsEl = document.getElementById('probe-payloads-wrap');
    var payloadViewerStatusEl = document.getElementById('payload-viewer-status');
    var payloadViewerEl = document.getElementById('payload-viewer-wrap');
    var historyEl = document.getElementById('history-wrap');
    var cdrAuditStatusEl = document.getElementById('cdr-audit-status');
    var cdrAuditOverviewEl = document.getElementById('cdr-audit-overview');
    var cdrAuditWrapEl = document.getElementById('cdr-audit-wrap');
    var coverageGapRemediationStatusEl = document.getElementById('coverage-gap-remediation-status');
    var coverageGapOverviewEl = document.getElementById('coverage-gap-overview');
    var coverageGapWrapEl = document.getElementById('coverage-gap-wrap');
    var lenderUniverseOverviewEl = document.getElementById('lender-universe-overview');
    var lenderUniverseWrapEl = document.getElementById('lender-universe-wrap');
    var replayQueueWrapEl = document.getElementById('replay-queue-wrap');
    var mainContentEl = document.getElementById('main-content');
    var showFailuresOnly = true;
    var syncFailuresFilterScheduled = false;

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Inline SVG clipboard icon (14px) for copy buttons beside “View payload”. */
    function clipboardIconHtml() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }

    var copiedPayloadFingerprints = new Set();
    var payloadViewerCopiedInSession = false;

    function payloadFingerprintFromButton(btn) {
        if (!btn || !btn.closest) return '';
        var details = btn.closest('details');
        var pre = details && details.querySelector('pre.mono');
        var text = pre ? pre.textContent : '';
        if (!text) return '';
        return String(text.length) + ':' + String(text.slice(0, 240));
    }

    function setCopiedIconState(btn, copied) {
        if (!btn || !btn.classList) return;
        btn.classList.toggle('is-copied', !!copied);
    }

    function syncCopiedPayloadButtons() {
        var buttons = document.querySelectorAll('.js-copy-cdr-payload');
        buttons.forEach(function (btn) {
            var fp = payloadFingerprintFromButton(btn);
            setCopiedIconState(btn, !!(fp && copiedPayloadFingerprints.has(fp)));
        });
    }

    function copyPayloadFromDetailsButton(btn) {
        if (!btn || !navigator.clipboard || !navigator.clipboard.writeText) return;
        var details = btn.closest('details');
        var pre = details && details.querySelector('pre.mono');
        var text = pre ? pre.textContent : '';
        if (!text) return;
        var origTitle = btn.getAttribute('title') || '';
        var origLabel = btn.getAttribute('aria-label') || '';
        navigator.clipboard.writeText(text).then(function () {
            var fp = payloadFingerprintFromButton(btn);
            if (fp) copiedPayloadFingerprints.add(fp);
            setCopiedIconState(btn, true);
            btn.setAttribute('title', 'Copied');
            btn.setAttribute('aria-label', 'Copied to clipboard');
            setTimeout(function () {
                btn.setAttribute('title', origTitle);
                btn.setAttribute('aria-label', origLabel);
            }, 2000);
        }).catch(function () {});
    }

    function isPayloadViewerCopyable() {
        if (!payloadViewerEl) return false;
        var t = (payloadViewerEl.textContent || '').trim();
        if (!t) return false;
        if (t === 'No payload selected.') return false;
        return true;
    }

    function updatePayloadViewerCopyButtonState() {
        var btn = document.getElementById('payload-viewer-copy-btn');
        if (!btn) return;
        var clip = !!(navigator.clipboard && navigator.clipboard.writeText);
        var ok = clip && isPayloadViewerCopyable();
        btn.disabled = !ok;
        btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
        setCopiedIconState(btn, payloadViewerCopiedInSession);
    }

    function copyPayloadViewerToClipboard() {
        var btn = document.getElementById('payload-viewer-copy-btn');
        if (!btn || btn.disabled || !payloadViewerEl || !navigator.clipboard || !navigator.clipboard.writeText) return;
        var text = payloadViewerEl.textContent || '';
        if (!text.trim()) return;
        var origTitle = btn.getAttribute('title') || '';
        var origLabel = btn.getAttribute('aria-label') || '';
        navigator.clipboard.writeText(text).then(function () {
            payloadViewerCopiedInSession = true;
            setCopiedIconState(btn, true);
            btn.setAttribute('title', 'Copied');
            btn.setAttribute('aria-label', 'Copied to clipboard');
            setTimeout(function () {
                btn.setAttribute('title', origTitle);
                btn.setAttribute('aria-label', origLabel);
            }, 2000);
        }).catch(function () {});
    }

    function boolPill(ok) {
        return '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'OK' : 'Attention') + '</span>';
    }

    /** Three-state row status pill (matches .pill.ok / .pill.warn / .pill.bad in admin CSS). */
    function statusPillHtml(severity) {
        var s = severity || 'green';
        if (s === 'red') return '<span class="pill bad">Critical</span>';
        if (s === 'yellow') return '<span class="pill warn">Attention</span>';
        return '<span class="pill ok">OK</span>';
    }

    function rowSeverityCoverageGap(row) {
        var sev = String(row && row.severity || '').toLowerCase();
        if (sev === 'error') return 'red';
        if (sev === 'warn') return 'yellow';
        return 'green';
    }

    function rowSeverityLenderUniverse(row) {
        var st = String(row && row.status || '').toLowerCase();
        if (st === 'missing_from_register') return 'red';
        if (st === 'endpoint_drift') return 'yellow';
        return 'green';
    }

    function rowSeverityReplayQueue(row) {
        var st = String(row && row.status || '').toLowerCase();
        if (st === 'failed') return 'red';
        if (st === 'queued' || st === 'dispatching') return 'yellow';
        return 'green';
    }

    function rowSeverityHistory(h) {
        if (!h || !h.overall_ok) return 'red';
        if (!(h.e2e && h.e2e.aligned)) return 'yellow';
        return 'green';
    }

    /** Map to data-ar-status on table rows: ok = hide in failures-only view; warn/bad = show. */
    function severityToRowFilterAttr(sev) {
        if (sev === 'red') return 'bad';
        if (sev === 'yellow') return 'warn';
        return 'ok';
    }

    function boolToRowFilterAttr(ok) {
        return ok ? 'ok' : 'bad';
    }

    function cdrCheckRowFilterAttr(check) {
        if (!check || !check.passed) return 'bad';
        var sev = String(check.severity || '').toLowerCase();
        if (sev.indexOf('warn') >= 0 || sev === 'yellow') return 'warn';
        return 'ok';
    }

    function severityFromComponents(rows) {
        var r = Array.isArray(rows) ? rows : [];
        var failed = 0;
        for (var i = 0; i < r.length; i++) {
            if (!r[i].ok) failed++;
        }
        if (failed >= 3) return 'red';
        if (failed >= 1) return 'yellow';
        return 'green';
    }

    function severityFromIntegrityChecks(checks) {
        var c = Array.isArray(checks) ? checks : [];
        for (var i = 0; i < c.length; i++) {
            if (!c[i].passed) return 'red';
        }
        return 'green';
    }

    function severityFromHistoryList(history) {
        if (!Array.isArray(history) || history.length === 0) return 'green';
        var worst = 'green';
        for (var i = 0; i < history.length; i++) {
            var s = rowSeverityHistory(history[i]);
            if (s === 'red') return 'red';
            if (s === 'yellow') worst = 'yellow';
        }
        return worst;
    }

    function updateFailuresToggleButtons() {
        var bFail = document.getElementById('status-view-failures-only');
        var bAll = document.getElementById('status-view-all');
        if (!bFail || !bAll) return;
        bFail.setAttribute('aria-pressed', showFailuresOnly ? 'true' : 'false');
        bAll.setAttribute('aria-pressed', showFailuresOnly ? 'false' : 'true');
        bFail.classList.toggle('is-active', showFailuresOnly);
        bAll.classList.toggle('is-active', !showFailuresOnly);
    }

    function syncFailuresFilter() {
        var main = mainContentEl || document.getElementById('main-content');
        if (!main) return;
        updateFailuresToggleButtons();
        main.classList.toggle('admin-status--failures-only', showFailuresOnly);

        var wrapSelectors = [
            '#e2e-datasets-wrap',
            '#components-wrap',
            '#economic-series-wrap',
            '#integrity-wrap',
            '#coverage-gap-wrap',
            '#lender-universe-wrap',
            '#replay-queue-wrap',
            '#issues-wrap',
            '#probe-payloads-wrap',
            '#history-wrap'
        ];

        if (!showFailuresOnly) {
            wrapSelectors.forEach(function (sel) {
                var wrap = main.querySelector(sel);
                if (!wrap) return;
                wrap.querySelectorAll('.admin-status-filter-empty-note').forEach(function (n) { n.remove(); });
                var table = wrap.querySelector('table');
                if (table) table.hidden = false;
            });
            main.querySelectorAll('section.card[data-ar-suppressed-by-filter="1"]').forEach(function (sec) {
                sec.removeAttribute('data-ar-suppressed-by-filter');
                sec.style.display = '';
            });
            syncCopiedPayloadButtons();
            return;
        }

        main.querySelectorAll('section.card').forEach(function (sec) {
            if (sec.querySelector('#payload-viewer-wrap')) return;
            if (!sec.classList.contains('severity-green')) return;
            sec.style.display = 'none';
            sec.setAttribute('data-ar-suppressed-by-filter', '1');
        });

        wrapSelectors.forEach(function (sel) {
            var wrap = main.querySelector(sel);
            if (!wrap) return;
            wrap.querySelectorAll('.admin-status-filter-empty-note').forEach(function (n) { n.remove(); });
            var table = wrap.querySelector('table');
            if (!table) return;
            var tbody = table.querySelector('tbody');
            if (!tbody) return;
            var rows = tbody.querySelectorAll('tr');
            if (!rows.length) return;
            var hasNonOk = Array.prototype.some.call(rows, function (tr) {
                return tr.getAttribute('data-ar-status') !== 'ok';
            });
            if (!hasNonOk) {
                table.hidden = true;
                var note = document.createElement('p');
                note.className = 'admin-status-filter-empty-note';
                note.textContent = 'No failing rows in this section.';
                wrap.appendChild(note);
            } else {
                table.hidden = false;
            }
        });
        syncCopiedPayloadButtons();
    }

    function scheduleSyncFailuresFilter() {
        if (syncFailuresFilterScheduled) return;
        syncFailuresFilterScheduled = true;
        requestAnimationFrame(function () {
            syncFailuresFilterScheduled = false;
            syncFailuresFilter();
        });
    }

    function coverageGapRemediationScope(row) {
        return [
            String(row && row.collection_date || '').trim(),
            String(row && row.lender_code || '').trim(),
            String(row && row.dataset_kind || '').trim()
        ].join('|');
    }

    function replayRowDiagnosticObject(row) {
        var o = {};
        var k;
        for (k in row) {
            if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
            if (k === 'payload_json') continue;
            o[k] = row[k];
        }
        if (row && typeof row.payload_json === 'string' && row.payload_json) {
            try {
                o.payload_parsed = JSON.parse(row.payload_json);
            } catch (_err) {
                o.payload_json = row.payload_json;
            }
        }
        return o;
    }

    /** Collapsible JSON + clipboard (same pattern as CDR audit technical column). */
    function diagnosticCell(obj) {
        return '<td><details><summary class="payload-summary-with-copy"><span>View diagnostic</span>'
            + '<button type="button" class="admin-payload-copy-btn js-copy-cdr-payload" title="Copy diagnostic to clipboard" aria-label="Copy diagnostic to clipboard">'
            + clipboardIconHtml()
            + '</button></summary><pre class="mono">' + esc(JSON.stringify(obj, null, 2)) + '</pre></details></td>';
    }

    function severityFromOverall(latest) {
        if (!latest) return 'green';
        if (!latest.overall_ok) return 'red';
        var failures = (latest.failures || []).length;
        if (failures >= 3) return 'red';
        if (failures >= 1) return 'yellow';
        return 'green';
    }

    function severityFromE2E(latest) {
        var e2e = latest && latest.e2e ? latest.e2e : null;
        if (!e2e) return 'green';
        if (!e2e.aligned) return 'red';
        var datasets = Array.isArray(e2e.datasets) ? e2e.datasets : [];
        var failed = datasets.filter(function (row) { return !row.ok; }).length;
        if (failed >= 2) return 'red';
        if (failed >= 1) return 'yellow';
        return 'green';
    }

    function severityFromIssueCount(count) {
        var n = Number(count) || 0;
        if (n >= 5) return 'red';
        if (n >= 1) return 'yellow';
        return 'green';
    }

    function severityFromCdrReport(report) {
        if (!report) return 'green';
        if (!report.ok) return 'red';
        var failed = report.totals && (report.totals.failed || 0) || 0;
        var warns = report.totals && (report.totals.warns || 0) || 0;
        if (failed > 0) return 'red';
        if (warns > 0) return 'yellow';
        return 'green';
    }

    function severityFromGapCount(gaps, errors) {
        var g = Number(gaps) || 0;
        var e = Number(errors) || 0;
        if (e > 0 || g >= 10) return 'red';
        if (g >= 1) return 'yellow';
        return 'green';
    }

    function severityFromLenderUniverse(report) {
        if (!report) return 'green';
        if (report.error) return 'red';
        var missing = Number(report.totals && report.totals.missing_from_register) || 0;
        var drift = Number(report.totals && report.totals.endpoint_drift) || 0;
        var total = missing + drift;
        if (total >= 3) return 'red';
        if (total >= 1) return 'yellow';
        return 'green';
    }

    function severityFromReplayQueue(rows) {
        var n = Array.isArray(rows) ? rows.length : 0;
        if (n === 0) return 'green';
        if (n >= 10) return 'red';
        if (n >= 1) return 'yellow';
        return 'green';
    }

    function severityFromProbePayloads(events) {
        if (!Array.isArray(events) || events.length === 0) return 'green';
        var failed = 0;
        for (var i = 0; i < events.length; i++) {
            var s = events[i].httpStatus;
            if (s == null || s < 200 || s >= 300) failed++;
        }
        if (failed >= 5) return 'red';
        if (failed >= 1) return 'yellow';
        return 'green';
    }

    function severityFromEconomic(report) {
        var sev = report && report.summary && report.summary.severity;
        if (sev === 'red' || sev === 'yellow' || sev === 'green') return sev;
        return 'green';
    }

    function applyCardSeverity(cardEl, severity) {
        if (!cardEl || !cardEl.classList) return;
        cardEl.classList.remove('severity-green', 'severity-yellow', 'severity-red');
        if (severity) cardEl.classList.add('severity-' + severity);
    }

    function setStatusLineSeverity(statusLineEl, line, severity) {
        if (!statusLineEl) return;
        statusLineEl.className = 'admin-status-line severity-' + (severity || 'green');
        var dot = statusLineEl.querySelector('.severity-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.setAttribute('aria-hidden', 'true');
            statusLineEl.insertBefore(dot, statusLineEl.firstChild);
        }
        dot.className = 'severity-dot severity-' + (severity || 'green');
        var textNode = Array.prototype.find.call(statusLineEl.childNodes, function (n) { return n.nodeType === 3; });
        if (textNode) textNode.textContent = line;
        else statusLineEl.appendChild(document.createTextNode(line));
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
        var card = overallEl && overallEl.parentElement;
        if (!latest) {
            overallEl.innerHTML = '<div>No health runs recorded yet.</div>';
            applyCardSeverity(card, null);
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
        applyCardSeverity(card, severityFromOverall(latest));
    }

    function renderE2E(latest) {
        var card = e2eEl && e2eEl.parentElement;
        var e2e = latest && latest.e2e ? latest.e2e : null;
        if (!e2e) {
            e2eEl.innerHTML = '<div>No E2E result available.</div>';
            e2eDatasetsEl.innerHTML = '<div>No per-dataset E2E result available.</div>';
            applyCardSeverity(card, null);
            var dsCardNoE2e = e2eDatasetsEl && e2eDatasetsEl.closest ? e2eDatasetsEl.closest('.card') : null;
            applyCardSeverity(dsCardNoE2e, null);
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

        applyCardSeverity(card, severityFromE2E(latest));
        var dsCard = e2eDatasetsEl && e2eDatasetsEl.closest ? e2eDatasetsEl.closest('.card') : null;
        if (!datasets.length) {
            e2eDatasetsEl.innerHTML = '<div>No dataset probes recorded.</div>';
            applyCardSeverity(dsCard, null);
            return;
        }
        applyCardSeverity(dsCard, failedDatasets >= 2 ? 'red' : (failedDatasets >= 1 ? 'yellow' : 'green'));
        e2eDatasetsEl.innerHTML = '<table><thead><tr><th>Dataset</th><th>Status</th><th>Failure</th><th>Detail</th><th>Payloads</th></tr></thead><tbody>'
            + datasets.map(function (row) {
                return '<tr data-ar-status="' + boolToRowFilterAttr(!!row.ok) + '">'
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
        var compCard = componentsEl && componentsEl.closest ? componentsEl.closest('.card') : null;
        if (!rows.length) {
            componentsEl.innerHTML = '<div>No component results available.</div>';
            applyCardSeverity(compCard, null);
            return;
        }
        applyCardSeverity(compCard, severityFromComponents(rows));
        componentsEl.innerHTML = '<table><thead><tr><th>Component</th><th>Status</th><th>HTTP</th><th>Duration</th><th>Detail</th><th>Payload</th></tr></thead><tbody>'
            + rows.map(function (r) {
                return '<tr data-ar-status="' + boolToRowFilterAttr(!!r.ok) + '">'
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

    function renderEconomic(latest) {
        var report = latest && latest.economic ? latest.economic : null;
        var card = economicOverviewEl && economicOverviewEl.closest ? economicOverviewEl.closest('.card') : null;
        if (!report || !report.summary) {
            if (economicOverviewEl) economicOverviewEl.innerHTML = '<div>No Economic Data coverage result available.</div>';
            if (economicSeriesEl) economicSeriesEl.innerHTML = '<div>No Economic Data series status available.</div>';
            applyCardSeverity(card, null);
            return;
        }

        var summary = report.summary || {};
        var probes = Array.isArray(report.probes) ? report.probes : [];
        var failedProbes = probes.filter(function (probe) { return !probe.ok; }).length;
        if (economicOverviewEl) {
            economicOverviewEl.innerHTML = [
                cardCell('Defined series', esc(String(summary.defined_series || 0))),
                cardCell('Status rows', esc(String(summary.status_rows || 0))),
                cardCell('Observed series', esc(String(summary.observed_series || 0))),
                cardCell('OK series', esc(String(summary.ok_series || 0))),
                cardCell('Stale series', esc(String(summary.stale_series || 0))),
                cardCell('Error series', esc(String(summary.error_series || 0))),
                cardCell('Missing series', esc(String(summary.missing_series || 0))),
                cardCell('Invalid rows', esc(String(summary.invalid_rows || 0))),
                cardCell('Orphan rows', esc(String(summary.orphan_rows || 0))),
                cardCell('Probe failures', esc(String(failedProbes))),
                cardCell('Coverage severity', statusPillHtml(severityFromEconomic(report)))
            ].join('');
        }

        var rows = Array.isArray(report.per_series) ? report.per_series : [];
        if (!rows.length) {
            if (economicSeriesEl) economicSeriesEl.innerHTML = '<div>No per-series Economic Data rows returned.</div>';
            applyCardSeverity(card, severityFromEconomic(report));
            return;
        }

        if (economicSeriesEl) {
            economicSeriesEl.innerHTML = '<table><thead><tr><th>Series</th><th>Status</th><th>Stored</th><th>Observed rows</th><th>Last observation</th><th>Last checked</th><th>Issues</th></tr></thead><tbody>'
                + rows.map(function (row) {
                    var sev = row.severity || 'green';
                    var sevNorm = (sev === 'red' || sev === 'yellow') ? sev : 'green';
                    return '<tr class="severity-' + esc(sev) + '" data-ar-status="' + severityToRowFilterAttr(sevNorm) + '">'
                        + '<td><span class="mono">' + esc(row.series_id) + '</span><br>' + esc(row.label || '') + '</td>'
                        + '<td>' + statusPillHtml(row.severity || 'green') + '</td>'
                        + '<td class="mono">' + esc(row.stored_status || row.computed_status || '') + '</td>'
                        + '<td>' + esc(String(row.observation_row_count || 0)) + '</td>'
                        + '<td class="mono">' + esc(row.latest_observation_date || row.last_observation_date || '--') + '</td>'
                        + '<td class="mono">' + esc(row.last_checked_at || '--') + '</td>'
                        + '<td class="mono">' + esc((row.issues || []).join(', ') || '--') + '</td>'
                        + '</tr>';
                }).join('')
                + '</tbody></table>';
        }
        applyCardSeverity(card, severityFromEconomic(report));
    }

    function renderIntegrity(latest) {
        var integrity = latest && latest.integrity ? latest.integrity : null;
        var checks = integrity && Array.isArray(integrity.checks) ? integrity.checks : [];
        var intCard = integrityEl && integrityEl.closest ? integrityEl.closest('.card') : null;
        if (!checks.length) {
            integrityEl.innerHTML = '<div class="integrity-empty">'
                + '<p>No integrity checks from the latest health run.</p>'
                + '<p>Use <strong>Run check now</strong> above to run a health check (includes integrity), or open <a href="integrity.html">Data integrity</a> for the full audit and history.</p>'
                + '</div>';
            applyCardSeverity(intCard, null);
            return;
        }
        applyCardSeverity(intCard, severityFromIntegrityChecks(checks));
        integrityEl.innerHTML = '<table><thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead><tbody>'
            + checks.map(function (c) {
                return '<tr data-ar-status="' + boolToRowFilterAttr(!!c.passed) + '">'
                    + '<td class="mono">' + esc(c.name) + '</td>'
                    + '<td>' + boolPill(!!c.passed) + '</td>'
                    + '<td><span class="mono">' + esc(JSON.stringify(c.detail || {})) + '</span></td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderIssues(latest) {
        var issues = latest && Array.isArray(latest.actionable) ? latest.actionable : [];
        var card = issuesEl && issuesEl.closest ? issuesEl.closest('.card') : null;
        if (!issues.length) {
            issuesEl.innerHTML = '<div>No actionable issues detected from recent warn/error logs.</div>';
            applyCardSeverity(card, 'green');
            return;
        }
        var worstIssueSev = issues.reduce(function (acc, i) {
            var s = severityFromIssueCount(i.count);
            return (s === 'red' || (s === 'yellow' && acc !== 'red')) ? s : acc;
        }, 'green');
        applyCardSeverity(card, worstIssueSev);
        issuesEl.innerHTML = '<table><thead><tr><th>Code</th><th>Title</th><th>Count</th><th>Action</th><th>Latest</th><th>Diagnostic</th></tr></thead><tbody>'
            + issues.map(function (i) {
                var sev = severityFromIssueCount(i.count);
                return '<tr class="severity-' + sev + '" data-ar-status="' + severityToRowFilterAttr(sev) + '">'
                    + '<td class="mono">' + esc(i.code) + '</td>'
                    + '<td>' + esc(i.title) + '</td>'
                    + '<td>' + esc(i.count) + '</td>'
                    + '<td>' + esc(i.action) + '</td>'
                    + '<td class="mono">' + esc(i.latest_ts || '') + '</td>'
                    + diagnosticCell(i)
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderProbePayloads(events) {
        var list = Array.isArray(events) ? events : [];
        var card = probePayloadsEl && probePayloadsEl.closest ? probePayloadsEl.closest('.card') : null;
        applyCardSeverity(card, severityFromProbePayloads(list));
        if (!list.length) {
            probePayloadsEl.innerHTML = '<div>No recent probe payloads captured.</div>';
            return;
        }
        probePayloadsEl.innerHTML = '<table><thead><tr><th>Fetched</th><th>Source</th><th>Dataset</th><th>Status</th><th>Payload</th></tr></thead><tbody>'
            + list.map(function (event) {
                var hs = event.httpStatus;
                var rowF = (hs != null && hs >= 200 && hs < 300) ? 'ok' : 'bad';
                return '<tr data-ar-status="' + rowF + '">'
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
        var histCard = historyEl && historyEl.closest ? historyEl.closest('.card') : null;
        if (!Array.isArray(history) || history.length === 0) {
            historyEl.innerHTML = '<div>No history yet.</div>';
            applyCardSeverity(histCard, 'green');
            return;
        }
        applyCardSeverity(histCard, severityFromHistoryList(history));
        historyEl.innerHTML = '<table><thead><tr><th>Status</th><th>Time</th><th>Trigger</th><th>Overall</th><th>E2E</th><th>Reason</th><th>Source mode</th><th>Duration</th><th>Diagnostic</th></tr></thead><tbody>'
            + history.map(function (h) {
                var hSev = rowSeverityHistory(h);
                return '<tr class="severity-' + hSev + '" data-ar-status="' + severityToRowFilterAttr(hSev) + '">'
                    + '<td>' + statusPillHtml(hSev) + '</td>'
                    + '<td class="mono">' + esc(h.checked_at) + '</td>'
                    + '<td>' + esc(h.trigger_source) + '</td>'
                    + '<td>' + boolPill(!!h.overall_ok) + '</td>'
                    + '<td>' + boolPill(!!(h.e2e && h.e2e.aligned)) + '</td>'
                    + '<td class="mono">' + esc(h.e2e && h.e2e.reasonCode ? h.e2e.reasonCode : '') + '</td>'
                    + '<td class="mono">' + esc(h.e2e && h.e2e.sourceMode ? h.e2e.sourceMode : '') + '</td>'
                    + '<td>' + esc(h.duration_ms) + ' ms</td>'
                    + diagnosticCell(h)
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderCdrAudit(report) {
        var cdrCard = cdrAuditWrapEl && cdrAuditWrapEl.closest ? cdrAuditWrapEl.closest('.card') : null;
        if (!report) {
            cdrAuditStatusEl.textContent = 'No audit report available.';
            cdrAuditStatusEl.className = 'admin-status-line severity-green';
            cdrAuditOverviewEl.innerHTML = '';
            cdrAuditWrapEl.innerHTML = '<div>Run the CDR audit to inspect pipeline gaps.</div>';
            applyCardSeverity(cdrCard, null);
            return;
        }
        applyCardSeverity(cdrCard, severityFromCdrReport(report));
        var sev = severityFromCdrReport(report);
        cdrAuditStatusEl.className = 'admin-status-line severity-' + sev;
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
                return '<div class="cdr-audit-stage-block"><h3>' + esc(stage) + '</h3><div>No checks returned for this stage.</div></div>';
            }
            var table = '<table><thead><tr><th>Check</th><th>Status</th><th>Severity</th><th>Summary</th><th>Technical</th></tr></thead><tbody>'
                + checks.map(function (check) {
                    var technicalPayload = {
                        metrics: check.metrics || {},
                        sample_rows: check.sample_rows || [],
                        debug: check.debug || {},
                        traceback: check.traceback || null
                    };
                    var rowF = cdrCheckRowFilterAttr(check);
                    return '<tr data-ar-status="' + rowF + '">'
                        + '<td class="mono">' + esc(check.id || '') + '</td>'
                        + '<td>' + boolPill(!!check.passed) + '</td>'
                        + '<td class="mono">' + esc(check.severity || '') + '</td>'
                        + '<td>' + esc(check.summary || '') + '</td>'
                        + '<td><details><summary class="payload-summary-with-copy"><span>View payload</span>'
                        + '<button type="button" class="admin-payload-copy-btn js-copy-cdr-payload" title="Copy payload to clipboard" aria-label="Copy payload to clipboard">'
                        + clipboardIconHtml()
                        + '</button></summary><pre class="mono">' + esc(JSON.stringify(technicalPayload, null, 2)) + '</pre></details></td>'
                        + '</tr>';
                }).join('')
                + '</tbody></table>';
            return '<div class="cdr-audit-stage-block"><h3>' + esc(stage) + '</h3>' + table + '</div>';
        }).join('');
    }

    function renderCoverageGapAudit(report) {
        if (coverageGapManager) {
            coverageGapManager.render(report, latestCoverageGapRemediation);
            return;
        }
        if (!report) {
            coverageGapOverviewEl.innerHTML = '';
            coverageGapWrapEl.innerHTML = '<div>No coverage-gap audit report available.</div>';
            return;
        }

        coverageGapOverviewEl.innerHTML = '<div class="grid">'
            + cardCell('Collection date', '<span class="mono">' + esc(report.collection_date || 'n/a') + '</span>')
            + cardCell('Gap rows', esc(String(report.totals && report.totals.gaps || 0)))
            + cardCell('Errors', esc(String(report.totals && report.totals.errors || 0)))
            + cardCell('Warnings', esc(String(report.totals && report.totals.warns || 0)))
            + '</div>';

        var rows = Array.isArray(report.rows) ? report.rows : [];
        if (!rows.length) {
            coverageGapWrapEl.innerHTML = '<div>No eligible lender/day coverage gaps are currently open.</div>';
            return;
        }

        coverageGapWrapEl.innerHTML = '<table><thead><tr><th>Lender</th><th>Dataset</th><th>Status</th><th>Expected</th><th>Processed</th><th>Written</th><th>Reasons</th><th>Updated</th><th>Diagnostic</th></tr></thead><tbody>'
            + rows.map(function (row) {
                var rSev = rowSeverityCoverageGap(row);
                var diag = Object.assign({}, row);
                diag.remediation_scope = coverageGapRemediationScope(row);
                return '<tr class="severity-' + rSev + '" data-ar-status="' + severityToRowFilterAttr(rSev) + '">'
                    + '<td>' + esc(row.lender_code || row.bank_name || '') + '</td>'
                    + '<td>' + esc(datasetLabel(row.dataset_kind)) + '</td>'
                    + '<td>' + statusPillHtml(rSev) + '</td>'
                    + '<td>' + esc(String(row.expected_detail_count || 0)) + '</td>'
                    + '<td>' + esc(String(row.processed_detail_count || 0)) + '</td>'
                    + '<td>' + esc(String(row.written_row_count || 0)) + '</td>'
                    + '<td class="mono">' + esc((row.reasons || []).join(', ')) + '</td>'
                    + '<td class="mono">' + esc(row.updated_at || '') + '</td>'
                    + diagnosticCell(diag)
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    var latestCoverageGapRemediation = null;
    var coverageGapManager = window.AR && window.AR.AdminStatusCoverageGaps && typeof window.AR.AdminStatusCoverageGaps.createManager === 'function'
        ? window.AR.AdminStatusCoverageGaps.createManager({
            portal: portal,
            overviewEl: coverageGapOverviewEl,
            wrapEl: coverageGapWrapEl,
            remediationStatusEl: coverageGapRemediationStatusEl,
            datasetLabel: datasetLabel,
            cardCell: cardCell,
            esc: esc,
            statusPillHtml: statusPillHtml,
            diagnosticCell: diagnosticCell,
            rowSeverityCoverageGap: rowSeverityCoverageGap,
            coverageGapRemediationScope: coverageGapRemediationScope,
            refreshCoverage: loadCoverageGapAudit,
            refreshReplayQueue: loadReplayQueue,
            refreshStatus: loadStatus,
            onRendered: scheduleSyncFailuresFilter
        })
        : null;

    function renderLenderUniverse(report) {
        var card = lenderUniverseOverviewEl && lenderUniverseOverviewEl.closest ? lenderUniverseOverviewEl.closest('.card') : null;
        if (!report) {
            lenderUniverseOverviewEl.innerHTML = '';
            lenderUniverseWrapEl.innerHTML = '<div>No lender-universe audit report available.</div>';
            applyCardSeverity(card, null);
            return;
        }
        applyCardSeverity(card, severityFromLenderUniverse(report));
        lenderUniverseOverviewEl.innerHTML = '<div class="grid">'
            + cardCell('Register source', '<span class="mono">' + esc(report.register_source_url || 'n/a') + '</span>')
            + cardCell('Configured lenders', esc(String(report.totals && report.totals.configured_lenders || 0)))
            + cardCell('Missing', esc(String(report.totals && report.totals.missing_from_register || 0)))
            + cardCell('Endpoint drift', esc(String(report.totals && report.totals.endpoint_drift || 0)))
            + '</div>';

        var rows = Array.isArray(report.rows) ? report.rows : [];
        if (!rows.length) {
            lenderUniverseWrapEl.innerHTML = '<div class="mono">' + esc(report.error || 'No lender rows returned.') + '</div>';
            return;
        }

        lenderUniverseWrapEl.innerHTML = '<table><thead><tr><th>Lender</th><th>Status</th><th>Kind</th><th>Configured endpoint</th><th>Register endpoint</th><th>Diagnostic</th></tr></thead><tbody>'
            + rows.map(function (row) {
                var rSev = rowSeverityLenderUniverse(row);
                return '<tr class="severity-' + rSev + '" data-ar-status="' + severityToRowFilterAttr(rSev) + '">'
                    + '<td>' + esc(row.lender_code || '') + '</td>'
                    + '<td>' + statusPillHtml(rSev) + '</td>'
                    + '<td class="mono">' + esc(row.status || '') + '</td>'
                    + '<td class="mono">' + esc(row.configured_endpoint || '--') + '</td>'
                    + '<td class="mono">' + esc(row.register_endpoint || '--') + '</td>'
                    + diagnosticCell(row)
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderReplayQueue(data) {
        var rows = data && Array.isArray(data.rows) ? data.rows : [];
        var card = replayQueueWrapEl && replayQueueWrapEl.closest ? replayQueueWrapEl.closest('.card') : null;
        applyCardSeverity(card, severityFromReplayQueue(rows));
        if (!rows.length) {
            replayQueueWrapEl.innerHTML = '<div>No replay queue rows currently exist.</div>';
            return;
        }
        replayQueueWrapEl.innerHTML = '<table><thead><tr><th>Health</th><th>Phase</th><th>Kind</th><th>Lender</th><th>Dataset</th><th>Collection date</th><th>Attempts</th><th>Next attempt</th><th>Last error</th><th>Diagnostic</th></tr></thead><tbody>'
            + rows.map(function (row) {
                var rSev = rowSeverityReplayQueue(row);
                return '<tr class="severity-' + rSev + '" data-ar-status="' + severityToRowFilterAttr(rSev) + '">'
                    + '<td>' + statusPillHtml(rSev) + '</td>'
                    + '<td class="mono">' + esc(row.status || '') + '</td>'
                    + '<td class="mono">' + esc(row.message_kind || '') + '</td>'
                    + '<td>' + esc(row.lender_code || '--') + '</td>'
                    + '<td>' + esc(datasetLabel(row.dataset_kind)) + '</td>'
                    + '<td class="mono">' + esc(row.collection_date || '--') + '</td>'
                    + '<td>' + esc(String(row.replay_attempt_count || 0)) + '/' + esc(String(row.max_replay_attempts || 0)) + '</td>'
                    + '<td class="mono">' + esc(row.next_attempt_at || '--') + '</td>'
                    + '<td class="mono">' + esc(row.last_error || '--') + '</td>'
                    + diagnosticCell(replayRowDiagnosticObject(row))
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    async function loadPayload(fetchEventId, mode) {
        payloadViewerStatusEl.textContent = 'Loading payload ' + String(fetchEventId) + '...';
        payloadViewerEl.textContent = '';
        updatePayloadViewerCopyButtonState();
        try {
            var rawMode = mode === 'raw';
            var path = '/diagnostics/fetch-events/' + encodeURIComponent(fetchEventId) + '/payload' + (rawMode ? '?raw=1' : '');
            var res = await portal.fetchAdmin(path, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            if (rawMode) {
                var rawText = await res.text();
                payloadViewerStatusEl.textContent = 'Viewing raw payload for fetch_event_id=' + String(fetchEventId);
                payloadViewerEl.textContent = rawText;
                updatePayloadViewerCopyButtonState();
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
            updatePayloadViewerCopyButtonState();
        } catch (err) {
            payloadViewerStatusEl.textContent = 'Failed to load payload ' + String(fetchEventId) + '.';
            payloadViewerEl.textContent = err && err.message ? err.message : String(err);
            updatePayloadViewerCopyButtonState();
        }
    }

    async function loadStatus() {
        setStatusLineSeverity(statusEl, 'Loading status...', 'yellow');
        try {
            var res = await portal.fetchAdmin('/health?limit=48');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderOverall(data.latest);
            renderE2E(data.latest);
            renderComponents(data.latest);
            renderEconomic(data.latest);
            renderIntegrity(data.latest);
            renderIssues(data.latest);
            renderHistory(data.history || []);
            var line = data.latest
                ? ('Last checked: ' + (data.latest.checked_at || 'n/a'))
                : 'No health check runs yet.';
            if (data.nextCronExpression) line += ' | Next: ' + data.nextCronExpression;
            var overallSev = severityFromOverall(data.latest);
            var e2eSev = severityFromE2E(data.latest);
            var economicSev = severityFromEconomic(data.latest && data.latest.economic ? data.latest.economic : null);
            var issueCount = (data.latest && Array.isArray(data.latest.actionable) ? data.latest.actionable : []).length;
            var issuesSev = issueCount >= 5 ? 'red' : issueCount >= 1 ? 'yellow' : 'green';
            var worst = (overallSev === 'red' || e2eSev === 'red' || economicSev === 'red' || issuesSev === 'red') ? 'red'
                : (overallSev === 'yellow' || e2eSev === 'yellow' || economicSev === 'yellow' || issuesSev === 'yellow') ? 'yellow' : 'green';
            setStatusLineSeverity(statusEl, line, worst);
        } catch (err) {
            setStatusLineSeverity(statusEl, 'Failed to load status.', 'red');
            overallEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
        }
        scheduleSyncFailuresFilter();
    }

    async function runNow() {
        setStatusLineSeverity(statusEl, 'Running manual health check...', 'yellow');
        var btn = document.getElementById('run-check-btn');
        btn.disabled = true;
        try {
            var res = await portal.fetchAdmin('/health/run', { method: 'POST' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            await refreshAll();
        } catch (_err) {
            setStatusLineSeverity(statusEl, 'Manual health check failed.', 'red');
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
            var probeCard = probePayloadsEl && probePayloadsEl.closest ? probePayloadsEl.closest('.card') : null;
            applyCardSeverity(probeCard, 'red');
        }
        scheduleSyncFailuresFilter();
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
            var cdrCardErr = cdrAuditWrapEl && cdrAuditWrapEl.closest ? cdrAuditWrapEl.closest('.card') : null;
            applyCardSeverity(cdrCardErr, 'red');
        }
        scheduleSyncFailuresFilter();
    }

    async function loadCoverageGapAudit(forceRefresh) {
        try {
            var res = await portal.fetchAdmin('/diagnostics/coverage-gaps' + (forceRefresh ? '?refresh=1' : ''), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            latestCoverageGapRemediation = data.last_remediation || null;
            var report = data.report || null;
            if (coverageGapManager) {
                coverageGapManager.render(report, latestCoverageGapRemediation);
            } else {
                renderCoverageGapAudit(report);
            }
            var gaps = report && report.totals ? (report.totals.gaps || 0) : 0;
            var errors = report && report.totals ? (report.totals.errors || 0) : 0;
            var gapSev = severityFromGapCount(gaps, errors);
            if (coverageGapRemediationStatusEl) {
                coverageGapRemediationStatusEl.className = 'admin-status-line severity-' + gapSev;
            }
            var coverageGapCard = coverageGapOverviewEl && coverageGapOverviewEl.closest ? coverageGapOverviewEl.closest('.card') : null;
            applyCardSeverity(coverageGapCard, gapSev);
        } catch (err) {
            latestCoverageGapRemediation = null;
            coverageGapOverviewEl.innerHTML = '';
            coverageGapWrapEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
            if (coverageGapRemediationStatusEl) {
                coverageGapRemediationStatusEl.textContent = 'Failed to load automatic coverage-gap remediation status.';
                coverageGapRemediationStatusEl.className = 'admin-status-line severity-red';
            }
            var coverageGapCard = coverageGapOverviewEl && coverageGapOverviewEl.closest ? coverageGapOverviewEl.closest('.card') : null;
            applyCardSeverity(coverageGapCard, 'red');
        }
        scheduleSyncFailuresFilter();
    }

    async function loadLenderUniverse(forceRefresh) {
        try {
            var res = await portal.fetchAdmin('/diagnostics/lender-universe' + (forceRefresh ? '?refresh=1' : ''), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderLenderUniverse(data.report || null);
        } catch (err) {
            lenderUniverseOverviewEl.innerHTML = '';
            lenderUniverseWrapEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
            var lenderCard = lenderUniverseOverviewEl && lenderUniverseOverviewEl.closest ? lenderUniverseOverviewEl.closest('.card') : null;
            applyCardSeverity(lenderCard, 'red');
        }
        scheduleSyncFailuresFilter();
    }

    async function loadReplayQueue() {
        try {
            var res = await portal.fetchAdmin('/diagnostics/replay-queue?limit=40', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            renderReplayQueue(data);
        } catch (err) {
            replayQueueWrapEl.innerHTML = '<div class="mono">' + esc(err && err.message ? err.message : String(err)) + '</div>';
            var replayCard = replayQueueWrapEl && replayQueueWrapEl.closest ? replayQueueWrapEl.closest('.card') : null;
            applyCardSeverity(replayCard, 'red');
        }
        scheduleSyncFailuresFilter();
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
        scheduleSyncFailuresFilter();
    }

    async function refreshAll(forceRefresh) {
        await Promise.all([
            loadStatus(),
            loadCdrAudit(),
            loadProbePayloads(),
            loadCoverageGapAudit(!!forceRefresh),
            loadLenderUniverse(!!forceRefresh),
            loadReplayQueue()
        ]);
        scheduleSyncFailuresFilter();
    }

    var AUTO_REFRESH_MS = 45000;
    var refreshIntervalId = setInterval(function () { refreshAll(false); }, AUTO_REFRESH_MS);

    (function bindStatusViewToggle() {
        var btnFail = document.getElementById('status-view-failures-only');
        var btnAll = document.getElementById('status-view-all');
        if (btnFail) {
            btnFail.addEventListener('click', function () {
                showFailuresOnly = true;
                scheduleSyncFailuresFilter();
            });
        }
        if (btnAll) {
            btnAll.addEventListener('click', function () {
                showFailuresOnly = false;
                scheduleSyncFailuresFilter();
            });
        }
    })();

    // REQUIRED: cache-busts to guarantee the live deployed version loads. Do not remove.
    document.getElementById('refresh-btn').addEventListener('click', function () {
        function doReload() {
            var u = new URL(window.location.href);
            u.searchParams.set('_', String(Date.now()));
            window.location.replace(u.toString());
        }
        // Flush Cache API entries (service worker caches) without touching sessionStorage
        // (sessionStorage holds the admin auth token — clearing it would log you out).
        var p = (typeof caches !== 'undefined' && caches.keys)
            ? caches.keys().then(function (keys) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            })
            : Promise.resolve();
        p.then(doReload).catch(doReload);
    });
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

    async function downloadDebugBundle() {
        var btn = document.getElementById('download-debug-bundle-btn');
        var orig = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Downloading...';
        }
        try {
            var res = await portal.fetchAdmin('/diagnostics/status-debug-bundle', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'status-debug-bundle-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            setStatusLineSeverity(statusEl, 'Debug bundle download failed: ' + (err && err.message ? err.message : String(err)), 'red');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = orig;
            }
        }
    }

    document.getElementById('download-debug-bundle-btn').addEventListener('click', downloadDebugBundle);

    document.getElementById('copy-debug-bundle-curl-btn').addEventListener('click', function () {
        var base = typeof portal.apiBase === 'function' ? portal.apiBase() : '';
        var fullUrl = base + '/admin/diagnostics/status-debug-bundle';
        var curl = 'curl -sS -H "Authorization: Bearer YOUR_ADMIN_TOKEN" "' + fullUrl + '"';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(curl).then(function () {
                var btn = document.getElementById('copy-debug-bundle-curl-btn');
                var orig = btn.textContent;
                btn.textContent = 'Copied';
                setTimeout(function () { btn.textContent = orig; }, 2000);
            });
        }
    });
    (function initPayloadViewerCopy() {
        var btn = document.getElementById('payload-viewer-copy-btn');
        if (btn) {
            btn.innerHTML = clipboardIconHtml();
            btn.addEventListener('click', copyPayloadViewerToClipboard);
        }
        updatePayloadViewerCopyButtonState();
    })();
    document.addEventListener('click', function (event) {
        var target = event.target;
        if (coverageGapManager && coverageGapManager.handleClick(target)) {
            event.preventDefault();
            return;
        }
        var copyPayloadBtn = target && target.closest ? target.closest('.js-copy-cdr-payload') : null;
        if (copyPayloadBtn) {
            event.preventDefault();
            event.stopPropagation();
            copyPayloadFromDetailsButton(copyPayloadBtn);
            return;
        }
        var button = target && target.closest ? target.closest('.js-payload-link') : null;
        if (!button) return;
        event.preventDefault();
        loadPayload(button.getAttribute('data-fetch-event-id'), button.getAttribute('data-mode'));
    });

    refreshAll(false);

    (function cleanRefreshParamFromUrl() {
        try {
            var u = new URL(window.location.href);
            if (!u.searchParams.has('_')) return;
            u.searchParams.delete('_');
            var replacement = u.pathname + (u.search || '') + u.hash;
            if (window.history && window.history.replaceState) {
                window.history.replaceState(window.history.state || {}, '', replacement);
            }
        } catch (_) {}
    })();

    document.body.addEventListener('ar:admin-page-unload', function () {
        if (refreshIntervalId) clearInterval(refreshIntervalId);
    });
})();
