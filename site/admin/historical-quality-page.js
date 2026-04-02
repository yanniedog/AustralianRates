(function () {
    'use strict';
    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var criteriaEl = document.getElementById('historical-quality-criteria');
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
        criteriaGroups: [],
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
        var metrics = day && day.metrics && day.metrics.daily_summary && day.metrics.daily_summary.counts;
        return metrics || {};
    }

    function fmtPct(value) {
        return (Number(value || 0) * 100).toFixed(1) + '%';
    }

    function fmtCount(value) {
        return Number(value || 0).toLocaleString('en-AU');
    }

    function statLine(label, value) {
        return '<div class="historical-quality-micro-line"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
    }

    function renderCriteria() {
        if (!criteriaEl) return;
        if (!Array.isArray(state.criteriaGroups) || !state.criteriaGroups.length) {
            criteriaEl.innerHTML = '<p>No criteria metadata loaded.</p>';
            return;
        }
        criteriaEl.innerHTML = state.criteriaGroups.map(function (group) {
            return ''
                + '<article class="historical-quality-criteria-card">'
                + '<h3>' + esc(group.label || '') + '</h3>'
                + '<p>' + esc(group.description || '') + '</p>'
                + '<ul class="historical-quality-criteria-list">'
                + (group.criteria || []).map(function (criterion) {
                    return '<li><strong>' + esc(criterion.label || criterion.code || '') + '.</strong> ' + esc(criterion.description || '') + '</li>';
                }).join('')
                + '</ul>'
                + '</article>';
        }).join('');
    }

    function copyText(text) {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.reject(new Error('Clipboard unavailable'));
        return navigator.clipboard.writeText(String(text || ''));
    }

    function renderDaysTable() {
        if (!daysWrap) return;
        if (!Array.isArray(state.days) || !state.days.length) {
            daysWrap.innerHTML = '<p>No historical quality snapshots found.</p>';
            return;
        }
        daysWrap.innerHTML = ''
            + '<table class="historical-quality-table">'
            + '<thead><tr>'
            + '<th>Date</th><th>Inventory</th><th>Availability</th><th>Identity</th><th>Rates</th><th>Quality</th><th>Actions</th>'
            + '</tr></thead><tbody>'
            + state.days.map(function (day) {
                var counts = readSummaryCounts(day);
                var selected = day.collection_date === state.selectedDate;
                return ''
                    + '<tr data-date="' + esc(day.collection_date) + '"' + (selected ? ' class="is-selected"' : '') + '>'
                    + '<td><div class="historical-quality-day-cell">'
                    +   '<span class="historical-quality-day-title mono">' + esc(day.collection_date) + '</span>'
                    +   '<span>' + esc(day.status || '') + '</span>'
                    +   '<span class="admin-status-line">' + esc(day.trigger_source || '') + '</span>'
                    + '</div></td>'
                    + '<td><div class="historical-quality-micro-grid">'
                    +   statLine('Rows', fmtCount(day.overall.row_count))
                    +   statLine('Lenders', fmtCount(day.overall.bank_count))
                    +   statLine('Products', fmtCount(day.overall.product_count))
                    + '</div></td>'
                    + '<td><div class="historical-quality-micro-grid">'
                    +   statLine('New', fmtCount(counts.new_product_count))
                    +   statLine('Lost', fmtCount(counts.lost_product_count))
                    +   statLine('CDR miss', fmtCount(counts.cdr_missing_product_count))
                    + '</div></td>'
                    + '<td><div class="historical-quality-micro-grid">'
                    +   statLine('Rename', fmtCount(counts.renamed_same_id_count))
                    +   statLine('Detail', fmtCount(counts.same_id_name_same_rate_other_detail_changed_count))
                    +   statLine('ID churn', fmtCount(counts.changed_id_same_name_count))
                    + '</div></td>'
                    + '<td><div class="historical-quality-micro-grid">'
                    +   statLine('Up', fmtCount(counts.increased_rate_product_count))
                    +   statLine('Down', fmtCount(counts.decreased_rate_product_count))
                    + '</div></td>'
                    + '<td><div class="historical-quality-micro-grid">'
                    +   statLine('Struct', fmtPct(day.overall.structural_score_v1))
                    +   statLine('Prov', fmtPct(day.overall.provenance_score_v1))
                    +   statLine('Trans', fmtPct(day.overall.transition_score_v1))
                    +   statLine('Evid', fmtPct(day.overall.evidence_confidence_score_v1))
                    + '</div></td>'
                    + '<td>'
                    + '<div class="historical-quality-actions-stack">'
                    + '<button type="button" class="secondary" data-action="view" data-date="' + esc(day.collection_date) + '">View</button>'
                    + '<button type="button" class="secondary" data-action="copy-text" data-date="' + esc(day.collection_date) + '">Text</button>'
                    + '<button type="button" class="secondary" data-action="copy-debug" data-date="' + esc(day.collection_date) + '">Debug</button>'
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
            parametersEl.innerHTML = '<p>Select a day.</p>';
            topLendersEl.innerHTML = '';
            summaryPreEl.textContent = 'Select a day.';
            debugPreEl.textContent = 'Select a day.';
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
        var overall = (detail.rows || []).filter(function (row) { return row.scope === 'overall'; })[0] || null;
        var lenders = overall && overall.metrics && overall.metrics.daily_summary ? overall.metrics.daily_summary.top_degraded_lenders || [] : [];
        topLendersEl.innerHTML = lenders.length
            ? lenders.map(function (lender) {
                return '<li><strong>' + esc(lender.bank_name) + '</strong> <span class="admin-status-line">score ' + esc(Number(lender.degradation_score || 0).toFixed(2)) + ' | reasons: ' + esc((lender.reasons || []).join(', ')) + '</span></li>';
            }).join('')
            : '<li>No degraded lenders ranked for this day.</li>';
        summaryPreEl.textContent = String(detail.plain_text || '');
        debugPreEl.textContent = JSON.stringify({
            run: detail.run,
            rows: detail.rows,
            findings: detail.findings,
            parameters: detail.parameters
        }, null, 2);
    }

    function fetchDayDetail(date) {
        setStatus('Loading ' + date + '...');
        return portal.fetchAdmin('/audits/historical-quality/days/' + encodeURIComponent(date), { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body || !body.ok) throw new Error('Failed to load historical quality day');
                state.selectedDate = date;
                renderDaysTable();
                renderDetail(body);
                setStatus('Loaded ' + date + '.');
                return body;
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : 'Failed to load selected day.');
                throw error;
            });
    }

    function loadDays() {
        setStatus('Loading daily snapshots...');
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
                setStatus('No daily snapshots found.');
                return null;
            })
            .finally(function () {
                runBtn.disabled = false;
                refreshBtn.disabled = false;
            });
    }

    function loadCriteria() {
        return portal.fetchAdmin('/audits/historical-quality/criteria', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body || !body.ok || !Array.isArray(body.criteria_groups)) throw new Error('Failed to load criteria');
                state.criteriaGroups = body.criteria_groups;
                renderCriteria();
                return body;
            })
            .catch(function () {
                state.criteriaGroups = [];
                renderCriteria();
            });
    }

    function runSelectedDateAudit() {
        var date = dateEl && dateEl.value ? String(dateEl.value) : '';
        if (!date) {
            setStatus('Choose a date to run.');
            return;
        }
        setStatus('Starting audit for ' + date + '...');
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
                setStatus('Completed audit for ' + date + '.');
            })
            .catch(function (error) {
                setStatus(error && error.message ? error.message : 'Audit run failed.');
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

    loadCriteria();
    loadDays().catch(function (error) {
        setStatus(error && error.message ? error.message : 'Failed to load historical quality daily snapshots.');
    });
})();
