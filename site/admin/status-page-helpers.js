(function () {
    'use strict';
    window.AR = window.AR || {};

    window.AR.AdminStatusPageHelpers = {
        create: function (deps) {
            var payloadViewerStatusEl = deps && deps.payloadViewerStatusEl ? deps.payloadViewerStatusEl : null;
            var payloadViewerEl = deps && deps.payloadViewerEl ? deps.payloadViewerEl : null;
            var copiedPayloadFingerprints = deps && deps.copiedPayloadFingerprints ? deps.copiedPayloadFingerprints : new Set();

            function esc(v) {
                return String(v == null ? '' : v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            }

            function clipboardIconHtml() {
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            }

            function payloadFingerprintFromText(text) {
                if (!text) return '';
                return String(text.length) + ':' + String(text.slice(0, 240));
            }

            function payloadFingerprintFromButton(btn) {
                if (!btn || !btn.closest) return '';
                var details = btn.closest('details');
                var pre = details && details.querySelector('pre.mono');
                var text = pre ? pre.textContent : '';
                return payloadFingerprintFromText(text);
            }

            function payloadViewerFingerprint() {
                if (!payloadViewerEl) return '';
                return payloadFingerprintFromText(payloadViewerEl.textContent || '');
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
                var fp = payloadViewerFingerprint();
                setCopiedIconState(btn, !!(fp && copiedPayloadFingerprints.has(fp)));
            }

            function copyPayloadViewerToClipboard() {
                var btn = document.getElementById('payload-viewer-copy-btn');
                if (!btn || btn.disabled || !payloadViewerEl || !navigator.clipboard || !navigator.clipboard.writeText) return;
                var text = payloadViewerEl.textContent || '';
                if (!text.trim()) return;
                var origTitle = btn.getAttribute('title') || '';
                var origLabel = btn.getAttribute('aria-label') || '';
                navigator.clipboard.writeText(text).then(function () {
                    var fp = payloadViewerFingerprint();
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

            function boolPill(ok) {
                return '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'OK' : 'Attention') + '</span>';
            }

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
                if (!Array.isArray(fetchEventIds) || fetchEventIds.length === 0) return '\u2014';
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

            function severityFromStoredAuditLatest(latest) {
                if (!latest) return 'yellow';
                var st = String(latest.status || '').toLowerCase();
                if (st === 'red' || latest.overall_ok === false) return 'red';
                if (st === 'amber') return 'yellow';
                return 'green';
            }

            function trafficClassStored(status) {
                if (status === 'green') return 'green';
                if (status === 'amber') return 'amber';
                if (status === 'red') return 'red';
                return 'none';
            }

            function trafficLabelStored(status) {
                if (status === 'green') return 'All checks passed';
                if (status === 'amber') return 'Minor issues (informational only)';
                if (status === 'red') return 'Issues require attention';
                return 'No audit run yet';
            }

            void payloadViewerStatusEl;

            return {
                esc: esc,
                clipboardIconHtml: clipboardIconHtml,
                payloadFingerprintFromText: payloadFingerprintFromText,
                payloadFingerprintFromButton: payloadFingerprintFromButton,
                payloadViewerFingerprint: payloadViewerFingerprint,
                setCopiedIconState: setCopiedIconState,
                syncCopiedPayloadButtons: syncCopiedPayloadButtons,
                copyPayloadFromDetailsButton: copyPayloadFromDetailsButton,
                isPayloadViewerCopyable: isPayloadViewerCopyable,
                updatePayloadViewerCopyButtonState: updatePayloadViewerCopyButtonState,
                copyPayloadViewerToClipboard: copyPayloadViewerToClipboard,
                boolPill: boolPill,
                statusPillHtml: statusPillHtml,
                rowSeverityCoverageGap: rowSeverityCoverageGap,
                rowSeverityLenderUniverse: rowSeverityLenderUniverse,
                rowSeverityReplayQueue: rowSeverityReplayQueue,
                rowSeverityHistory: rowSeverityHistory,
                severityToRowFilterAttr: severityToRowFilterAttr,
                boolToRowFilterAttr: boolToRowFilterAttr,
                cdrCheckRowFilterAttr: cdrCheckRowFilterAttr,
                severityFromComponents: severityFromComponents,
                severityFromIntegrityChecks: severityFromIntegrityChecks,
                severityFromHistoryList: severityFromHistoryList,
                coverageGapRemediationScope: coverageGapRemediationScope,
                replayRowDiagnosticObject: replayRowDiagnosticObject,
                diagnosticCell: diagnosticCell,
                severityFromOverall: severityFromOverall,
                severityFromE2E: severityFromE2E,
                severityFromIssueCount: severityFromIssueCount,
                severityFromCdrReport: severityFromCdrReport,
                severityFromGapCount: severityFromGapCount,
                severityFromLenderUniverse: severityFromLenderUniverse,
                severityFromReplayQueue: severityFromReplayQueue,
                severityFromProbePayloads: severityFromProbePayloads,
                severityFromEconomic: severityFromEconomic,
                applyCardSeverity: applyCardSeverity,
                setStatusLineSeverity: setStatusLineSeverity,
                cardCell: cardCell,
                datasetLabel: datasetLabel,
                eventAction: eventAction,
                eventActions: eventActions,
                maybeJson: maybeJson,
                severityFromStoredAuditLatest: severityFromStoredAuditLatest,
                trafficClassStored: trafficClassStored,
                trafficLabelStored: trafficLabelStored,
            };
        }
    };
})();
