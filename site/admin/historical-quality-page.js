(function () {
    'use strict';
    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var daysWrap = document.getElementById('historical-quality-days-wrap');
    var statusEl = document.getElementById('historical-quality-status');
    var dateEl = document.getElementById('historical-quality-date');
    var runBtn = document.getElementById('historical-quality-run-btn');
    var refreshBtn = document.getElementById('historical-quality-refresh-btn');
    var selectedMetaEl = document.getElementById('historical-quality-selected-meta');
    var parametersEl = document.getElementById('historical-quality-parameters');
    var topLendersEl = document.getElementById('historical-quality-top-lenders');
    var summaryPreEl = document.getElementById('historical-quality-summary-pre');
    var debugPreEl = document.getElementById('historical-quality-debug-pre');
    var copySummaryBtn = document.getElementById('historical-quality-copy-summary-btn');
    var copyDebugBtn = document.getElementById('historical-quality-copy-debug-btn');
    var copyStatusEl = document.getElementById('historical-quality-copy-status');

    var state = {
        days: [],
        selectedDate: '',
        selectedDetail: null,
    };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function setCopyStatus(text) {
        if (!copyStatusEl) return;
        copyStatusEl.textContent = text || '';
        if (!text) return;
        window.clearTimeout(setCopyStatus.timer);
        setCopyStatus.timer = window.setTimeout(function () {
            copyStatusEl.textContent = '';
        }, 1800);
    }

    function readSummaryCounts(day) {
        var metrics = day && day.summary && day.summary.counts;
        return metrics || {};
    }

    function fmtPct(value) {
        return (Number(value || 0) * 100).toFixed(1) + '%';
    }

    function fmtCount(value) {
        return Number(value || 0).toLocaleString('en-AU');
    }

    function displaySource(value) {
        var source = String(value || '').trim();
        if (source === 'scheduled') return 'sched';
        if (source === 'manual') return 'manual';
        if (source === 'resume') return 'resume';
        if (source === 'script') return 'script';
        return source;
    }

    function displayStatus(value) {
        var status = String(value || '').trim();
        if (status === 'completed') return 'ok';
        if (status === 'running') return 'run';
        if (status === 'failed') return 'fail';
        if (status === 'partial') return 'part';
        if (status === 'pending') return 'pend';
        return status;
    }

    function renderMetricCell(value, type) {
        if (type === 'pct') return '<td class="historical-quality-cell-num">' + esc(fmtPct(value)) + '</td>';
        return '<td class="historical-quality-cell-num">' + esc(fmtCount(value)) + '</td>';
    }

    function copyText(text) {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.reject(new Error('Clipboard unavailable'));
        return navigator.clipboard.writeText(String(text || ''));
    }

    function renderDaysTable() {
        if (!daysWrap) return;
        if (!Array.isArray(state.days) || !state.days.length) {
            daysWrap.innerHTML = '<p>no rows</p>';
            return;
        }
        daysWrap.innerHTML = ''
            + '<table class="historical-quality-table">'
            + '<thead><tr>'
            + '<th>Date</th><th>Src</th><th>St</th><th>Rows</th><th>Ldr</th><th>Prod</th><th>New</th><th>Lost</th><th>Miss</th><th>Ren</th><th>Det</th><th>ID</th><th>Up</th><th>Down</th><th>Struct</th><th>Prov</th><th>Cov</th><th>Trans</th><th>Evid</th><th>Act</th>'
            + '</tr></thead><tbody>'
            + state.days.map(function (day) {
                var counts = readSummaryCounts(day);
                var selected = day.collection_date === state.selectedDate;
                return ''
                    + '<tr data-date="' + esc(day.collection_date) + '"' + (selected ? ' class="is-selected"' : '') + '>'
                    + '<td class="mono historical-quality-cell-date">' + esc(day.collection_date) + '</td>'
                    + '<td>' + esc(displaySource(day.trigger_source)) + '</td>'
                    + '<td>' + esc(displayStatus(day.status)) + '</td>'
                    + renderMetricCell(day.overall.row_count)
                    + renderMetricCell(day.overall.bank_count)
                    + renderMetricCell(day.overall.product_count)
                    + renderMetricCell(counts.new_product_count)
                    + renderMetricCell(counts.lost_product_count)
                    + renderMetricCell(counts.cdr_missing_product_count)
                    + renderMetricCell(counts.renamed_same_id_count)
                    + renderMetricCell(counts.same_id_name_same_rate_other_detail_changed_count)
                    + renderMetricCell(counts.changed_id_same_name_count)
                    + renderMetricCell(counts.increased_rate_product_count)
                    + renderMetricCell(counts.decreased_rate_product_count)
                    + renderMetricCell(day.overall.structural_score_v1, 'pct')
                    + renderMetricCell(day.overall.provenance_score_v1, 'pct')
                    + renderMetricCell(day.overall.coverage_score_v1, 'pct')
                    + renderMetricCell(day.overall.transition_score_v1, 'pct')
                    + renderMetricCell(day.overall.evidence_confidence_score_v1, 'pct')
                    + '<td>'
                    + '<div class="historical-quality-actions-inline historical-quality-actions-inline--tight">'
                    + '<button type="button" class="secondary" data-action="view" data-date="' + esc(day.collection_date) + '">V</button>'
                    + '<button type="button" class="secondary" data-action="copy-text" data-date="' + esc(day.collection_date) + '">T</button>'
                    + '<button type="button" class="secondary" data-action="copy-debug" data-date="' + esc(day.collection_date) + '">J</button>'
                    + '</div>'
                    + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function renderDetail(detail) {
        state.selectedDetail = detail;
        if (!detail) {
            selectedMetaEl.textContent = '';
            parametersEl.innerHTML = '<p>select a day</p>';
            topLendersEl.innerHTML = '';
            summaryPreEl.textContent = 'select a day';
            debugPreEl.textContent = 'select a day';
            return;
        }
        selectedMetaEl.textContent = 'Run ' + String(detail.run.audit_run_id || '') + ' | ' + String(detail.run.trigger_source || '') + ' | ' + String(detail.run.status || '');
        parametersEl.innerHTML = (detail.parameters || []).map(function (item) {
            return ''
                + '<article class="historical-quality-parameter-card">'
                + '<h3>' + esc(item.label) + '</h3>'
                + '<div class="historical-quality-parameter-value">' + esc(item.value) + '</div>'
                + '<div class="historical-quality-actions-inline">'
                + '<button type="button" class="secondary historical-quality-copy-btn" data-action="copy-parameter-text" data-key="' + esc(item.key) + '">Copy text</button>'
                + '<button type="button" class="secondary historical-quality-copy-btn" data-action="copy-parameter-debug" data-key="' + esc(item.key) + '">Copy debug</button>'
                + '</div>'
                + '</article>';
        }).join('');
        var lenders = detail.summary && detail.summary.top_degraded_lenders ? detail.summary.top_degraded_lenders : [];
        topLendersEl.innerHTML = lenders.length
            ? lenders.map(function (lender) {
                return '<li><strong>' + esc(lender.bank_name) + '</strong> <span class="admin-status-line">score ' + esc(Number(lender.degradation_score || 0).toFixed(2)) + ' | reasons: ' + esc((lender.reasons || []).join(', ')) + '</span></li>';
            }).join('')
            : '<li>none</li>';
        summaryPreEl.textContent = String(detail.plain_text || '');
        debugPreEl.textContent = JSON.stringify({
            run: detail.run,
            rows: detail.rows,
            findings: detail.findings,
            parameters: detail.parameters
        }, null, 2);
    }

    function fetchDayDetail(date) {
        setStatus('load ' + date);
        return portal.fetchAdmin('/audits/historical-quality/days/' + encodeURIComponent(date), { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body || !body.ok) throw new Error('Failed to load historical quality day');
                state.selectedDate = date;
                renderDaysTable();
                renderDetail(body);
                setStatus(date + ' ok');
                return body;
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : 'load failed');
                throw error;
            });
    }

    function loadDays() {
        setStatus('loading');
        runBtn.disabled = true;
        refreshBtn.disabled = true;
        return portal.fetchAdmin('/audits/historical-quality/days?limit=180', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body || !body.ok || !Array.isArray(body.days)) throw new Error('Failed to load daily snapshots');
                state.days = body.days;
                renderDaysTable();
                if (!state.selectedDate && state.days[0]) state.selectedDate = state.days[0].collection_date;
                if (state.selectedDate) return fetchDayDetail(state.selectedDate);
                renderDetail(null);
                setStatus('no rows');
                return null;
            })
            .finally(function () {
                runBtn.disabled = false;
                refreshBtn.disabled = false;
            });
    }

    function runSelectedDateAudit() {
        var date = dateEl && dateEl.value ? String(dateEl.value) : '';
        if (!date) {
            setStatus('date required');
            return;
        }
        setStatus('run ' + date);
        runBtn.disabled = true;
        refreshBtn.disabled = true;
        portal.fetchAdmin('/audits/historical-quality/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_date: date, end_date: date })
        })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body || !body.ok || !body.created || !body.created.auditRunId) throw new Error('Failed to start audit run');
                return resumeUntilComplete(String(body.created.auditRunId || '').trim(), 0);
            })
            .then(function () {
                state.selectedDate = date;
                return loadDays();
            })
            .then(function () {
                setStatus(date + ' done');
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : 'run failed');
            })
            .finally(function () {
                runBtn.disabled = false;
                refreshBtn.disabled = false;
            });
    }

    function resumeUntilComplete(auditRunId, attempts) {
        if (attempts > 80) return Promise.reject(new Error('Historical quality run did not settle in time'));
        return portal.fetchAdmin('/audits/historical-quality/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audit_run_id: auditRunId })
        })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                var status = body && body.step ? String(body.step.status || '') : '';
                if (status === 'completed') return body;
                if (status === 'partial') throw new Error('Historical quality run finished partial; inspect admin API detail.');
                return new Promise(function (resolve) {
                    window.setTimeout(function () {
                        resolve(resumeUntilComplete(auditRunId, attempts + 1));
                    }, 350);
                });
            });
    }

    function selectedParameter(key) {
        var items = (state.selectedDetail && state.selectedDetail.parameters) || [];
        for (var i = 0; i < items.length; i += 1) {
            if (items[i].key === key) return items[i];
        }
        return null;
    }

    function handleTableAction(target) {
        var action = target.getAttribute('data-action');
        var date = target.getAttribute('data-date');
        if (!action || !date) return;
        if (action === 'view') {
            fetchDayDetail(date).catch(function () {});
            return;
        }
        if (action === 'copy-text') {
            portal.fetchAdmin('/audits/historical-quality/days/' + encodeURIComponent(date) + '/plain-text', { cache: 'no-store' })
                .then(function (res) { return res.text(); })
                .then(copyText)
                .then(function () { setCopyStatus('Copied summary text.'); })
                .catch(function () { setCopyStatus('Copy failed.'); });
            return;
        }
        if (action === 'copy-debug') {
            portal.fetchAdmin('/audits/historical-quality/days/' + encodeURIComponent(date), { cache: 'no-store' })
                .then(function (res) { return res.json(); })
                .then(function (body) { return copyText(JSON.stringify(body, null, 2)); })
                .then(function () { setCopyStatus('Copied debug JSON.'); })
                .catch(function () { setCopyStatus('Copy failed.'); });
        }
    }

    function handleParameterAction(target) {
        var action = target.getAttribute('data-action');
        var key = target.getAttribute('data-key');
        var item = selectedParameter(key);
        if (!item) return;
        if (action === 'copy-parameter-text') {
            copyText(item.text).then(function () { setCopyStatus('Copied parameter text.'); }).catch(function () { setCopyStatus('Copy failed.'); });
            return;
        }
        if (action === 'copy-parameter-debug') {
            copyText(JSON.stringify(item.debug, null, 2)).then(function () { setCopyStatus('Copied parameter debug.'); }).catch(function () { setCopyStatus('Copy failed.'); });
        }
    }

    if (dateEl) {
        var today = new Date().toISOString().slice(0, 10);
        dateEl.value = today;
    }
    if (refreshBtn) refreshBtn.addEventListener('click', function () { loadDays().catch(function () {}); });
    if (runBtn) runBtn.addEventListener('click', runSelectedDateAudit);
    if (daysWrap) {
        daysWrap.addEventListener('click', function (event) {
            var target = event.target.closest('button[data-action][data-date]');
            if (target) {
                handleTableAction(target);
                return;
            }
            var row = event.target.closest('tr[data-date]');
            if (!row) return;
            fetchDayDetail(String(row.getAttribute('data-date') || '')).catch(function () {});
        });
    }
    if (parametersEl) {
        parametersEl.addEventListener('click', function (event) {
            var target = event.target.closest('button[data-action][data-key]');
            if (!target) return;
            handleParameterAction(target);
        });
    }
    if (copySummaryBtn) {
        copySummaryBtn.addEventListener('click', function () {
            copyText(summaryPreEl.textContent || '').then(function () { setCopyStatus('Copied selected-day summary.'); }).catch(function () { setCopyStatus('Copy failed.'); });
        });
    }
    if (copyDebugBtn) {
        copyDebugBtn.addEventListener('click', function () {
            copyText(debugPreEl.textContent || '').then(function () { setCopyStatus('Copied selected-day debug JSON.'); }).catch(function () { setCopyStatus('Copy failed.'); });
        });
    }

    loadDays().catch(function (error) {
        setStatus(error && error.message ? error.message : 'load failed');
    });
})();
