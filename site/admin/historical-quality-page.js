(function () {
    'use strict';
    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var statusEl = document.getElementById('historical-quality-status');
    var dateEl = document.getElementById('historical-quality-date');
    var runBtn = document.getElementById('historical-quality-run-btn');
    var refreshBtn = document.getElementById('historical-quality-refresh-btn');
    var tableWrap = document.getElementById('historical-quality-table-wrap');
    var countEl = document.getElementById('historical-quality-count');

    var state = { days: [] };

    var columns = [
        { key: 'collection_date', label: 'Date', type: 'text' },
        { key: 'status', label: 'St', type: 'text' },
        { key: 'trigger_source', label: 'Src', type: 'text' },
        { key: 'intra_day_score_v1', label: 'Q', type: 'pct' },
        { key: 'row_count', label: 'Rows', type: 'num' },
        { key: 'bank_count', label: 'Banks', type: 'num' },
        { key: 'product_count', label: 'Prod', type: 'num' },
        { key: 'new_product_count', label: 'New', type: 'num' },
        { key: 'lost_product_count', label: 'Lost', type: 'num' },
        { key: 'cdr_missing_product_count', label: 'CDR miss', type: 'num' },
        { key: 'renamed_same_id_count', label: 'Rename', type: 'num' },
        { key: 'same_id_name_same_rate_other_detail_changed_count', label: 'Detail', type: 'num' },
        { key: 'changed_id_same_name_count', label: 'ID', type: 'num' },
        { key: 'increased_rate_product_count', label: 'Up', type: 'num' },
        { key: 'decreased_rate_product_count', label: 'Down', type: 'num' },
        { key: 'structural_score_v1', label: 'Struct', type: 'pct' },
        { key: 'provenance_score_v1', label: 'Prov', type: 'pct' },
        { key: 'coverage_score_v1', label: 'Cov', type: 'pct' },
        { key: 'anomaly_pressure_score_v1', label: 'Anom', type: 'pct' },
        { key: 'continuity_score_v1', label: 'Cont', type: 'pct' },
        { key: 'count_stability_score_v1', label: 'Count', type: 'pct' },
        { key: 'transition_score_v1', label: 'Trans', type: 'pct' },
        { key: 'evidence_confidence_score_v1', label: 'Evid', type: 'pct' }
    ];

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtPct(value) {
        return (Number(value || 0) * 100).toFixed(1) + '%';
    }

    function fmtNum(value) {
        return Number(value || 0).toLocaleString('en-AU');
    }

    function readCounts(day) {
        return day && day.summary && day.summary.counts ? day.summary.counts : {};
    }

    function cellValue(day, key) {
        var counts = readCounts(day);
        if (Object.prototype.hasOwnProperty.call(counts, key)) return counts[key];
        if (day && day.overall && Object.prototype.hasOwnProperty.call(day.overall, key)) return day.overall[key];
        if (day && Object.prototype.hasOwnProperty.call(day, key)) return day[key];
        return '';
    }

    function displayStatus(value) {
        var text = String(value || '').trim();
        if (text === 'completed') return 'ok';
        if (text === 'running') return 'run';
        if (text === 'failed') return 'fail';
        if (text === 'partial') return 'part';
        if (text === 'pending') return 'pend';
        return text || '-';
    }

    function displaySource(value) {
        var text = String(value || '').trim();
        if (text === 'scheduled') return 'sched';
        if (text === 'manual') return 'manual';
        if (text === 'resume') return 'resume';
        if (text === 'script') return 'script';
        return text || '-';
    }

    function renderCell(day, column) {
        var raw = cellValue(day, column.key);
        if (column.key === 'status') return '<td>' + esc(displayStatus(raw)) + '</td>';
        if (column.key === 'trigger_source') return '<td>' + esc(displaySource(raw)) + '</td>';
        if (column.key === 'collection_date') return '<td class="mono historical-quality-cell-date">' + esc(raw) + '</td>';
        if (column.type === 'pct') return '<td class="historical-quality-cell-num">' + esc(fmtPct(raw)) + '</td>';
        if (column.type === 'num') return '<td class="historical-quality-cell-num">' + esc(fmtNum(raw)) + '</td>';
        return '<td>' + esc(raw) + '</td>';
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = String(text || '');
    }

    function setBusy(busy) {
        if (runBtn) runBtn.disabled = !!busy;
        if (refreshBtn) refreshBtn.disabled = !!busy;
    }

    function renderTable() {
        if (!tableWrap) return;
        if (!Array.isArray(state.days) || !state.days.length) {
            tableWrap.innerHTML = '<p class="admin-hint">No historical-quality rows available.</p>';
            if (countEl) countEl.textContent = '0';
            return;
        }
        if (countEl) countEl.textContent = fmtNum(state.days.length);
        tableWrap.innerHTML = ''
            + '<table class="historical-quality-table">'
            + '<thead><tr>'
            + columns.map(function (column) { return '<th>' + esc(column.label) + '</th>'; }).join('')
            + '</tr></thead><tbody>'
            + state.days.map(function (day) {
                return '<tr>' + columns.map(function (column) { return renderCell(day, column); }).join('') + '</tr>';
            }).join('')
            + '</tbody></table>';
    }

    function loadDays() {
        setBusy(true);
        setStatus('loading');
        return portal.fetchAdmin('/audits/historical-quality/days?limit=5000', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body || !body.ok || !Array.isArray(body.days)) throw new Error('Failed to load historical quality rows');
                state.days = body.days;
                renderTable();
                setStatus(body.days.length ? ('ready · ' + fmtNum(body.days.length) + ' days') : 'no rows');
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : 'load failed');
                throw error;
            })
            .finally(function () {
                setBusy(false);
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
                if (status === 'partial') throw new Error('Historical quality run finished partial');
                return new Promise(function (resolve) {
                    window.setTimeout(function () {
                        resolve(resumeUntilComplete(auditRunId, attempts + 1));
                    }, 350);
                });
            });
    }

    function runSelectedDateAudit() {
        var date = dateEl && dateEl.value ? String(dateEl.value) : '';
        if (!date) {
            setStatus('date required');
            return;
        }
        setBusy(true);
        setStatus('run ' + date);
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
            .then(loadDays)
            .then(function () {
                setStatus(date + ' done');
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : 'run failed');
            })
            .finally(function () {
                setBusy(false);
            });
    }

    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
    if (refreshBtn) refreshBtn.addEventListener('click', function () { loadDays().catch(function () {}); });
    if (runBtn) runBtn.addEventListener('click', runSelectedDateAudit);

    loadDays().catch(function () {});
})();
