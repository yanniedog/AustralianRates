(function () {
    'use strict';
    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var statusLine = document.getElementById('status-line');
    var trafficLight = document.getElementById('traffic-light');
    var trafficStatus = document.getElementById('traffic-status');
    var trafficMeta = document.getElementById('traffic-meta');
    var summaryWrap = document.getElementById('summary-wrap');
    var findingsWrap = document.getElementById('findings-wrap');
    var historyWrap = document.getElementById('history-wrap');
    var runAuditBtn = document.getElementById('run-audit-btn');
    var refreshBtn = document.getElementById('refresh-btn');

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setStatus(msg) {
        if (statusLine) statusLine.textContent = msg;
    }

    function trafficClass(status) {
        if (status === 'green') return 'green';
        if (status === 'amber') return 'amber';
        if (status === 'red') return 'red';
        return 'none';
    }

    function trafficLabel(status) {
        if (status === 'green') return 'All checks passed';
        if (status === 'amber') return 'Minor issues (informational only)';
        if (status === 'red') return 'Issues require attention';
        return 'No audit run yet';
    }

    function renderTraffic(latest) {
        if (!trafficLight || !trafficStatus || !trafficMeta) return;
        if (!latest) {
            trafficLight.className = 'integrity-light none';
            trafficLight.setAttribute('aria-label', 'No audit run');
            trafficStatus.textContent = 'No audit run yet';
            trafficMeta.textContent = 'Run an audit manually or wait for the daily run (04:00 UTC).';
            return;
        }
        var status = (latest.status || '').toLowerCase();
        if (status !== 'green' && status !== 'amber' && status !== 'red') status = 'none';
        trafficLight.className = 'integrity-light ' + trafficClass(status);
        trafficLight.setAttribute('aria-label', trafficLabel(status));
        trafficStatus.textContent = trafficLabel(status);
        trafficMeta.textContent = 'Run: ' + esc(latest.run_id || '') + ' | ' + esc(latest.checked_at || '') + ' | ' + esc(latest.trigger_source || '') + ' | ' + (latest.duration_ms != null ? latest.duration_ms + ' ms' : '');
    }

    function renderSummary(summary) {
        if (!summaryWrap) return;
        if (!summary || typeof summary !== 'object') {
            summaryWrap.innerHTML = '';
            return;
        }
        summaryWrap.innerHTML = [
            '<div class="integrity-summary-cell"><div class="label">Total checks</div><div class="value">' + esc(summary.total_checks) + '</div></div>',
            '<div class="integrity-summary-cell"><div class="label">Passed</div><div class="value">' + esc(summary.passed) + '</div></div>',
            '<div class="integrity-summary-cell"><div class="label">Failed</div><div class="value">' + esc(summary.failed) + '</div></div>',
            '<div class="integrity-summary-cell"><div class="label">Dead data issues</div><div class="value">' + esc(summary.dead_data_issues) + '</div></div>',
            '<div class="integrity-summary-cell"><div class="label">Invalid data issues</div><div class="value">' + esc(summary.invalid_data_issues) + '</div></div>',
            '<div class="integrity-summary-cell"><div class="label">Duplicate issues</div><div class="value">' + esc(summary.duplicate_data_issues) + '</div></div>',
            '<div class="integrity-summary-cell"><div class="label">Other issues</div><div class="value">' + esc(summary.other_issues) + '</div></div>'
        ].join('');
    }

    function renderFindings(findings) {
        if (!findingsWrap) return;
        if (!Array.isArray(findings) || findings.length === 0) {
            findingsWrap.innerHTML = '<p>No findings (run an audit first).</p>';
            return;
        }
        var rows = findings.map(function (f) {
            var passClass = f.passed ? 'pass' : 'fail';
            var count = f.count != null ? esc(String(f.count)) : '—';
            return '<tr><td>' + esc(f.check) + '</td><td><span class="' + passClass + '">' + (f.passed ? 'Pass' : 'Fail') + '</span></td><td>' + count + '</td><td>' + esc(f.category) + '</td></tr>';
        });
        findingsWrap.innerHTML = '<table><thead><tr><th>Check</th><th>Result</th><th>Count</th><th>Category</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    }

    function renderHistory(history) {
        if (!historyWrap) return;
        if (!Array.isArray(history) || history.length === 0) {
            historyWrap.innerHTML = '<p>No previous runs.</p>';
            return;
        }
        historyWrap.innerHTML = history.slice(0, 20).map(function (row) {
            var status = (row.status || '').toLowerCase();
            var light = status === 'green' ? 'green' : status === 'amber' ? 'amber' : status === 'red' ? 'red' : 'none';
            return '<li><span class="integrity-light ' + light + '" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px;border-radius:50%;"></span> ' + esc(row.checked_at) + ' | ' + esc(row.trigger_source) + ' | ' + esc(row.status) + ' | ' + (row.duration_ms != null ? row.duration_ms + ' ms' : '') + '</li>';
        }).join('');
    }

    function render(data) {
        var latest = data && data.latest;
        renderTraffic(latest);
        if (latest && latest.summary) renderSummary(latest.summary);
        else renderSummary(null);
        if (latest && latest.findings) renderFindings(latest.findings);
        else renderFindings([]);
        renderHistory(data && data.history ? data.history : []);
    }

    function load() {
        setStatus('Loading...');
        runAuditBtn.disabled = true;
        refreshBtn.disabled = true;
        portal.fetchAdmin('/integrity-audit?limit=30', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (body && body.ok) render(body);
                else setStatus('Failed to load audit data.');
            })
            .catch(function (err) {
                setStatus('Error: ' + (err && err.message ? err.message : 'request failed'));
                render({ latest: null, history: [] });
            })
            .finally(function () {
                runAuditBtn.disabled = false;
                refreshBtn.disabled = false;
                setStatus('');
            });
    }

    function runAudit() {
        setStatus('Running audit...');
        runAuditBtn.disabled = true;
        refreshBtn.disabled = true;
        portal.fetchAdmin('/integrity-audit/run', { method: 'POST' })
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (body && body.ok) {
                    setStatus('Audit complete. Refreshing...');
                    load();
                } else {
                    setStatus('Audit failed: ' + (body && body.message ? body.message : 'unknown'));
                    runAuditBtn.disabled = false;
                    refreshBtn.disabled = false;
                }
            })
            .catch(function (err) {
                setStatus('Error: ' + (err && err.message ? err.message : 'request failed'));
                runAuditBtn.disabled = false;
                refreshBtn.disabled = false;
            });
    }

    if (runAuditBtn) runAuditBtn.addEventListener('click', runAudit);
    if (refreshBtn) refreshBtn.addEventListener('click', load);
    load();
})();
