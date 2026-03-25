(function () {
    'use strict';

    function createManager(input) {
        var portal = input.portal;
        var overviewEl = input.overviewEl;
        var wrapEl = input.wrapEl;
        var remediationStatusEl = input.remediationStatusEl;
        var datasetLabel = input.datasetLabel;
        var cardCell = input.cardCell;
        var esc = input.esc;
        var refreshCoverage = input.refreshCoverage;
        var refreshReplayQueue = input.refreshReplayQueue;
        var refreshStatus = input.refreshStatus;
        var statusPillHtml = input.statusPillHtml;
        var diagnosticCell = input.diagnosticCell;
        var rowSeverityCoverageGap = input.rowSeverityCoverageGap;
        var coverageGapRemediationScope = input.coverageGapRemediationScope;
        var report = null;
        var lastRemediation = null;
        var actionStates = {};

        function scopeKey(row) {
            return [
                String(row && row.collection_date || '').trim(),
                String(row && row.lender_code || '').trim(),
                String(row && row.dataset_kind || '').trim()
            ].join('|');
        }

        function normalizeRow(inputRow) {
            return {
                lender_code: String(inputRow && inputRow.lender_code || '').trim(),
                bank_name: String(inputRow && inputRow.bank_name || '').trim(),
                dataset_kind: String(inputRow && inputRow.dataset_kind || '').trim(),
                collection_date: String(inputRow && inputRow.collection_date || '').trim()
            };
        }

        function stateClass(phase) {
            if (phase === 'success') return 'positive';
            if (phase === 'failed') return 'danger';
            if (phase === 'running') return 'warning';
            return '';
        }

        function stateLabel(phase) {
            if (phase === 'success') return 'Done';
            if (phase === 'failed') return 'Failed';
            if (phase === 'running') return 'Running';
            return 'Idle';
        }

        function renderRemediationStatus() {
            if (!remediationStatusEl) return;
            if (!lastRemediation || !lastRemediation.generated_at || !lastRemediation.totals) {
                remediationStatusEl.textContent = 'No automatic coverage-gap remediation has been recorded yet.';
                return;
            }
            var totals = lastRemediation.totals || {};
            remediationStatusEl.textContent =
                'Last automatic remediation ' + String(lastRemediation.generated_at || 'n/a')
                + ' | scopes ' + String(totals.scopes_considered || 0)
                + ' | replay ' + String(totals.replay || 0)
                + ' | reconcile ' + String(totals.reconcile || 0)
                + ' | scheduled retry ' + String(totals.scheduled_retry_pending || 0)
                + ' | failed ' + String(totals.failed || 0);
        }

        function actionMarkup(row) {
            var key = scopeKey(row);
            var state = actionStates[key] || null;
            var disabled = state && state.phase === 'running';
            var stateHtml = '';
            if (state && state.message) {
                stateHtml =
                    '<span class="coverage-gap-action-state coverage-gap-action-state--' + esc(state.phase || 'idle') + '">'
                    + '<span class="pill ' + esc(stateClass(state.phase || 'idle')) + '">' + esc(stateLabel(state.phase || 'idle')) + '</span>'
                    + esc(state.message)
                    + '</span>';
            }
            return ''
                + '<div class="coverage-gap-actions">'
                + '  <button type="button" class="link-btn js-coverage-gap-action" data-action="replay" data-lender-code="' + esc(row.lender_code) + '" data-bank-name="' + esc(row.bank_name || '') + '" data-dataset-kind="' + esc(row.dataset_kind) + '" data-collection-date="' + esc(row.collection_date) + '"' + (disabled ? ' disabled' : '') + '>Replay</button>'
                + '  <button type="button" class="link-btn js-coverage-gap-action" data-action="reconcile" data-lender-code="' + esc(row.lender_code) + '" data-bank-name="' + esc(row.bank_name || '') + '" data-dataset-kind="' + esc(row.dataset_kind) + '" data-collection-date="' + esc(row.collection_date) + '"' + (disabled ? ' disabled' : '') + '>Reconcile lender/day</button>'
                + stateHtml
                + '</div>';
        }

        function render(nextReport, nextLastRemediation) {
            if (arguments.length > 0) report = nextReport || null;
            if (arguments.length > 1) lastRemediation = nextLastRemediation || null;

            renderRemediationStatus();

            if (!report) {
                overviewEl.innerHTML = '';
                wrapEl.innerHTML = '<div>No coverage-gap audit report available.</div>';
                return;
            }

            overviewEl.innerHTML = '<div class="grid">'
                + cardCell('Collection date', '<span class="mono">' + esc(report.collection_date || 'n/a') + '</span>')
                + cardCell('Gap rows', esc(String(report.totals && report.totals.gaps || 0)))
                + cardCell('Errors', esc(String(report.totals && report.totals.errors || 0)))
                + cardCell('Warnings', esc(String(report.totals && report.totals.warns || 0)))
                + '</div>';

            var rows = Array.isArray(report.rows) ? report.rows : [];
            if (!rows.length) {
                wrapEl.innerHTML = '<div>No eligible lender/day coverage gaps are currently open.</div>';
                return;
            }

            wrapEl.innerHTML = '<table><thead><tr><th>Lender</th><th>Dataset</th><th>Status</th><th>Expected</th><th>Processed</th><th>Written</th><th>Reasons</th><th>Updated</th><th>Diagnostic</th><th>Actions</th></tr></thead><tbody>'
                + rows.map(function (row) {
                    var normalized = normalizeRow(row);
                    var rSev = rowSeverityCoverageGap ? rowSeverityCoverageGap(row) : 'green';
                    var diag = Object.assign({}, row);
                    if (coverageGapRemediationScope) {
                        diag.remediation_scope = coverageGapRemediationScope(row);
                    }
                    return '<tr class="severity-' + rSev + '">'
                        + '<td>' + esc(normalized.lender_code || normalized.bank_name || '') + '</td>'
                        + '<td>' + esc(datasetLabel(normalized.dataset_kind)) + '</td>'
                        + '<td>' + (statusPillHtml ? statusPillHtml(rSev) : esc(row.severity || '')) + '</td>'
                        + '<td>' + esc(String(row.expected_detail_count || 0)) + '</td>'
                        + '<td>' + esc(String(row.processed_detail_count || 0)) + '</td>'
                        + '<td>' + esc(String(row.written_row_count || 0)) + '</td>'
                        + '<td class="mono">' + esc((row.reasons || []).join(', ')) + '</td>'
                        + '<td class="mono">' + esc(row.updated_at || '') + '</td>'
                        + (diagnosticCell ? diagnosticCell(diag) : '<td></td>')
                        + '<td>' + actionMarkup(normalized) + '</td>'
                        + '</tr>';
                }).join('')
                + '</tbody></table>';
        }

        async function requestAction(action, row) {
            var key = scopeKey(row);
            actionStates[key] = {
                phase: 'running',
                message: action === 'replay' ? 'Requesting replay...' : 'Queueing lender/day reconciliation...'
            };
            render();

            try {
                var path = action === 'replay' ? '/runs/replay-dispatch' : '/runs/reconcile-lender-day';
                var payload = action === 'replay'
                    ? {
                        lender_code: row.lender_code,
                        collection_date: row.collection_date,
                        dataset: row.dataset_kind,
                        limit: 25,
                        force_due: true
                    }
                    : {
                        lender_code: row.lender_code,
                        collection_date: row.collection_date,
                        datasets: [row.dataset_kind]
                    };
                var response = await portal.fetchAdmin(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var data = await response.json().catch(function () { return null; });
                if (!response.ok || !data || !data.ok) {
                    throw new Error(data && data.error && data.error.message ? data.error.message : ('Request failed (' + response.status + ')'));
                }

                var message = '';
                if (action === 'replay') {
                    var replayResult = data.result || {};
                    message = Number(replayResult.dispatched || 0) > 0
                        ? ('Replay dispatched: ' + String(replayResult.dispatched || 0) + ' item(s).')
                        : 'Replay completed: no due replay rows for this scope.';
                } else {
                    var reconcileResult = data.result || {};
                    var runId = reconcileResult.runId || reconcileResult.run_id || '';
                    var enqueued = Number(reconcileResult.enqueued || 0);
                    message = reconcileResult.skipped
                        ? ('Reconcile skipped: ' + String(reconcileResult.reason || 'unknown') + '.')
                        : ('Reconcile queued' + (runId ? ' (' + String(runId) + ')' : '') + (Number.isFinite(enqueued) ? ' - ' + String(enqueued) + ' job(s).' : '.'));
                }

                actionStates[key] = {
                    phase: 'success',
                    message: message
                };

                await Promise.all([
                    refreshCoverage(true),
                    refreshReplayQueue(),
                    refreshStatus()
                ]);
            } catch (err) {
                actionStates[key] = {
                    phase: 'failed',
                    message: err && err.message ? err.message : String(err)
                };
                render();
            }
        }

        function handleClick(target) {
            var button = target && target.closest ? target.closest('.js-coverage-gap-action') : null;
            if (!button) return false;
            var row = normalizeRow({
                lender_code: button.getAttribute('data-lender-code'),
                bank_name: button.getAttribute('data-bank-name'),
                dataset_kind: button.getAttribute('data-dataset-kind'),
                collection_date: button.getAttribute('data-collection-date')
            });
            requestAction(String(button.getAttribute('data-action') || '').trim(), row);
            return true;
        }

        return {
            render: render,
            handleClick: handleClick
        };
    }

    window.AR = window.AR || {};
    window.AR.AdminStatusCoverageGaps = {
        createManager: createManager
    };
})();
