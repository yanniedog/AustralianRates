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
        { key: 'collection_date', label: 'Date', type: 'text', title: 'Collection date for this daily audit row.' },
        { key: 'status', label: 'St', type: 'text', title: 'Audit run status (e.g. completed, running, failed, partial, pending).' },
        { key: 'trigger_source', label: 'Src', type: 'text', title: 'What started the run: scheduled, manual, resume, or script.' },
        { key: 'intra_day_score_v1', label: 'Q', type: 'pct', title: 'Intra-day quality (v1): blend of structural, provenance, coverage, and anomaly pressure (30% / 30% / 25% / 15%).' },
        { key: 'row_count', label: 'Rows', type: 'num', title: 'Number of rate rows stored for this day and scope.' },
        { key: 'bank_count', label: 'Banks', type: 'num', title: 'Distinct lenders (banks) in the dataset for this day.' },
        { key: 'product_count', label: 'Prod', type: 'num', title: 'Distinct home-loan products for this day.' },
        { key: 'new_product_count', label: 'New', type: 'num', title: 'Products that appear today but were absent on the prior collection day.' },
        { key: 'lost_product_count', label: 'Lost', type: 'num', title: 'Products that were present on the prior day but missing today.' },
        { key: 'cdr_missing_product_count', label: 'CDR miss', type: 'num', title: 'Products without a matching Open Banking (CDR) product mapping.' },
        { key: 'renamed_same_id_count', label: 'Rename', type: 'num', title: 'Same product_id as yesterday but the product name changed.' },
        { key: 'same_id_name_same_rate_other_detail_changed_count', label: 'Detail', type: 'num', title: 'Same id, name, and rate as yesterday, but other detail fields changed.' },
        { key: 'changed_id_same_name_count', label: 'ID', type: 'num', title: 'Same lender and product name as yesterday but product_id changed (identifier churn).' },
        { key: 'increased_rate_product_count', label: 'Up', type: 'num', title: 'Products whose interest rate rose versus the prior day.' },
        { key: 'decreased_rate_product_count', label: 'Down', type: 'num', title: 'Products whose interest rate fell versus the prior day.' },
        { key: 'structural_score_v1', label: 'Struct', type: 'pct', title: 'Structural quality: uniqueness, required fields, valid values, and cross-table consistency (penalises duplicates, gaps, invalid rows).' },
        { key: 'provenance_score_v1', label: 'Prov', type: 'pct', title: 'Provenance mix: exact vs reconstructed vs legacy vs quarantined source classification.' },
        { key: 'coverage_score_v1', label: 'Cov', type: 'pct', title: 'Coverage vs rolling baseline: lender, product, and series counts compared to the reference window.' },
        { key: 'anomaly_pressure_score_v1', label: 'Anom', type: 'pct', title: 'Pressure from audit findings, weighted by how many series they affect.' },
        { key: 'continuity_score_v1', label: 'Cont', type: 'pct', title: 'Continuity of the catalogue: explained vs unexplained appearances and disappearances.' },
        { key: 'count_stability_score_v1', label: 'Count', type: 'pct', title: 'Stability of active series count vs the previous day (relative to baseline context).' },
        { key: 'transition_score_v1', label: 'Trans', type: 'pct', title: 'Day-to-day transition quality: average of continuity, count stability, and rate-flow scores.' },
        { key: 'evidence_confidence_score_v1', label: 'Evid', type: 'pct', title: 'Confidence in supporting evidence: blend of provenance score and run-state / permanent-evidence observability.' }
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
            + columns.map(function (column) {
                var tip = column.title ? ' title="' + esc(column.title) + '"' : '';
                return '<th' + tip + '>' + esc(column.label) + '</th>';
            }).join('')
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
