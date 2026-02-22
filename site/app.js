(function () {
    function normalizeApiBase(input) {
        if (!input) return '';
        return String(input).replace(/\/+$/, '');
    }

    function currency(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(3) + '%';
    }

    function money(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return '$' + n.toFixed(2);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    var params = new URLSearchParams(window.location.search);
    var apiOverride = params.get('apiBase');
    var apiBase = normalizeApiBase(apiOverride) || (window.location.origin + '/api/home-loan-rates');
    var state = {
        mode: 'daily',
        selectedProductKey: '',
        latestRows: []
    };

    var els = {
        apiBaseText: document.getElementById('api-base-text'),
        refreshAll: document.getElementById('refresh-all'),
        tabDaily: document.getElementById('tab-daily'),
        tabHistorical: document.getElementById('tab-historical'),
        tableTitle: document.getElementById('table-title'),
        filterBank: document.getElementById('filter-bank'),
        filterSecurity: document.getElementById('filter-security'),
        filterRepayment: document.getElementById('filter-repayment'),
        filterStructure: document.getElementById('filter-structure'),
        filterLvr: document.getElementById('filter-lvr'),
        filterFeature: document.getElementById('filter-feature'),
        filterLimit: document.getElementById('filter-limit'),
        applyFilters: document.getElementById('apply-filters'),
        downloadCsv: document.getElementById('download-csv'),
        refreshHealth: document.getElementById('refresh-health'),
        refreshLatest: document.getElementById('refresh-latest'),
        refreshSeries: document.getElementById('refresh-series'),
        refreshRuns: document.getElementById('refresh-runs'),
        healthOutput: document.getElementById('health-output'),
        latestBody: document.getElementById('latest-body'),
        seriesHint: document.getElementById('series-hint'),
        seriesCanvas: document.getElementById('series-canvas'),
        runsOutput: document.getElementById('runs-output'),
        adminToken: document.getElementById('admin-token')
    };

    if (els.apiBaseText) {
        els.apiBaseText.textContent = apiBase;
    }

    async function fetchJson(url, options) {
        var response = await fetch(url, options || {});
        var text = await response.text();
        var data = null;
        try {
            data = JSON.parse(text);
        } catch (err) {
            data = { ok: false, raw: text };
        }
        return { response: response, data: data };
    }

    function fillSelect(el, values) {
        if (!el) return;
        var current = el.value;
        el.innerHTML = '<option value="">All</option>' + values.map(function (value) {
            return '<option value="' + esc(value) + '">' + esc(value) + '</option>';
        }).join('');
        if (current && values.indexOf(current) >= 0) {
            el.value = current;
        }
    }

    async function loadFilters() {
        try {
            var result = await fetchJson(apiBase + '/filters');
            if (!result.response.ok || !result.data || !result.data.filters) return;
            var f = result.data.filters;
            fillSelect(els.filterBank, f.banks || []);
            fillSelect(els.filterSecurity, f.security_purposes || []);
            fillSelect(els.filterRepayment, f.repayment_types || []);
            fillSelect(els.filterStructure, f.rate_structures || []);
            fillSelect(els.filterLvr, f.lvr_tiers || []);
            fillSelect(els.filterFeature, f.feature_sets || []);
        } catch (err) {
            // no-op; table can still load without dynamic filters
        }
    }

    function currentFilterQuery() {
        var q = new URLSearchParams();
        q.set('mode', state.mode);
        q.set('limit', String(Math.max(10, Math.min(1000, Number(els.filterLimit && els.filterLimit.value || 200) || 200))));
        if (els.filterBank && els.filterBank.value) q.set('bank', els.filterBank.value);
        if (els.filterSecurity && els.filterSecurity.value) q.set('security_purpose', els.filterSecurity.value);
        if (els.filterRepayment && els.filterRepayment.value) q.set('repayment_type', els.filterRepayment.value);
        if (els.filterStructure && els.filterStructure.value) q.set('rate_structure', els.filterStructure.value);
        if (els.filterLvr && els.filterLvr.value) q.set('lvr_tier', els.filterLvr.value);
        if (els.filterFeature && els.filterFeature.value) q.set('feature_set', els.filterFeature.value);
        return q;
    }

    function setMode(mode) {
        state.mode = mode === 'historical' ? 'historical' : 'daily';
        if (els.tabDaily) els.tabDaily.classList.toggle('active', state.mode === 'daily');
        if (els.tabHistorical) els.tabHistorical.classList.toggle('active', state.mode === 'historical');
        if (els.tableTitle) {
            els.tableTitle.textContent = state.mode === 'daily' ? 'Daily Rates' : 'Historical Backfill';
        }
    }

    async function loadHealth() {
        if (!els.healthOutput) return;
        els.healthOutput.textContent = 'Loading health...';
        try {
            var result = await fetchJson(apiBase + '/health');
            els.healthOutput.textContent = JSON.stringify(result.data, null, 2);
        } catch (err) {
            els.healthOutput.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
        }
    }

    function renderLatestRows(rows) {
        if (!els.latestBody) return;
        if (!Array.isArray(rows) || rows.length === 0) {
            els.latestBody.innerHTML = '<tr><td colspan="13">No rate rows found for this selection.</td></tr>';
            return;
        }

        state.latestRows = rows;
        els.latestBody.innerHTML = rows.map(function (row) {
            return '<tr>' +
                '<td>' + esc(row.collection_date || '-') + '</td>' +
                '<td>' + currency(row.rba_cash_rate) + '</td>' +
                '<td>' + String(row.bank_name || '-') + '</td>' +
                '<td>' + String(row.product_name || row.product_id || '-') + '</td>' +
                '<td>' + esc(row.security_purpose || '-') + '</td>' +
                '<td>' + esc(row.repayment_type || '-') + '</td>' +
                '<td>' + String(row.lvr_tier || '-') + '</td>' +
                '<td>' + String(row.rate_structure || '-') + '</td>' +
                '<td>' + esc(row.feature_set || '-') + '</td>' +
                '<td>' + currency(row.interest_rate) + '</td>' +
                '<td>' + currency(row.comparison_rate) + '</td>' +
                '<td>' + money(row.annual_fee) + '</td>' +
                '<td>' + esc(row.data_quality_flag || '-') + '</td>' +
                '</tr>';
        }).join('');

        var trs = els.latestBody.querySelectorAll('tr');
        rows.forEach(function (row, idx) {
            if (!row.product_key || !trs[idx]) return;
            trs[idx].setAttribute('data-product-key', String(row.product_key));
            trs[idx].classList.add('clickable-row');
        });
    }

    async function loadLatest() {
        if (!els.latestBody) return;
        els.latestBody.innerHTML = '<tr><td colspan="13">Loading rates...</td></tr>';
        try {
            var query = currentFilterQuery();
            var result = await fetchJson(apiBase + '/latest?' + query.toString());
            if (!result.response.ok) {
                els.latestBody.innerHTML = '<tr><td colspan="13">Failed to load rates (' + result.response.status + ').</td></tr>';
                return;
            }
            renderLatestRows(result.data && result.data.rows || []);
        } catch (err) {
            els.latestBody.innerHTML = '<tr><td colspan="13">Error loading rates: ' + String(err && err.message || err) + '</td></tr>';
        }
    }

    function drawSeries(rows) {
        var canvas = els.seriesCanvas;
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        var width = canvas.width;
        var height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#f6f9fc';
        ctx.fillRect(0, 0, width, height);

        if (!rows || rows.length === 0) {
            ctx.fillStyle = '#4a5a70';
            ctx.font = '14px sans-serif';
            ctx.fillText('No timeseries data for selected product.', 20, 32);
            return;
        }

        var values = rows.map(function (r) { return Number(r.interest_rate); }).filter(Number.isFinite);
        if (values.length === 0) {
            ctx.fillStyle = '#4a5a70';
            ctx.font = '14px sans-serif';
            ctx.fillText('No numeric rate values.', 20, 32);
            return;
        }

        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        if (min === max) max = min + 0.1;

        var left = 56;
        var right = width - 20;
        var top = 16;
        var bottom = height - 34;

        ctx.strokeStyle = '#d5deea';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, bottom);
        ctx.lineTo(right, bottom);
        ctx.stroke();

        ctx.strokeStyle = '#0a4aa3';
        ctx.lineWidth = 2;
        ctx.beginPath();
        rows.forEach(function (row, i) {
            var v = Number(row.interest_rate);
            if (!Number.isFinite(v)) return;
            var x = left + (i * (right - left) / Math.max(1, rows.length - 1));
            var y = bottom - ((v - min) / (max - min)) * (bottom - top);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = '#23354f';
        ctx.font = '12px sans-serif';
        ctx.fillText(max.toFixed(3) + '%', 6, top + 6);
        ctx.fillText(min.toFixed(3) + '%', 6, bottom + 4);
        ctx.fillText(String(rows[0].collection_date || ''), left, height - 12);
        ctx.fillText(String(rows[rows.length - 1].collection_date || ''), right - 90, height - 12);
    }

    async function loadSeries() {
        if (!state.selectedProductKey) {
            drawSeries([]);
            return;
        }
        if (els.seriesHint) {
            els.seriesHint.textContent = 'Loading timeseries for ' + state.selectedProductKey + '...';
        }
        try {
            var q = currentFilterQuery();
            q.set('product_key', state.selectedProductKey);
            q.set('limit', '5000');
            var result = await fetchJson(apiBase + '/timeseries?' + q.toString());
            if (!result.response.ok) {
                if (els.seriesHint) els.seriesHint.textContent = 'Failed to load timeseries (' + result.response.status + ').';
                drawSeries([]);
                return;
            }
            var rows = result.data && result.data.rows || [];
            if (els.seriesHint) {
                els.seriesHint.textContent = rows.length > 0
                    ? ('Series points: ' + rows.length)
                    : 'No points for selected product and filter set.';
            }
            drawSeries(rows);
        } catch (err) {
            if (els.seriesHint) els.seriesHint.textContent = 'Error loading timeseries.';
            drawSeries([]);
        }
    }

    function downloadCsv() {
        var q = currentFilterQuery();
        q.set('dataset', 'latest');
        var url = apiBase + '/export.csv?' + q.toString();
        window.open(url, '_blank', 'noopener');
    }

    async function loadRuns() {
        if (!els.runsOutput) return;
        els.runsOutput.textContent = 'Loading runs...';

        var token = els.adminToken && els.adminToken.value ? String(els.adminToken.value).trim() : '';
        var headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;

        try {
            var result = await fetchJson(apiBase + '/admin/runs?limit=10', { headers: headers });
            if (!result.response.ok) {
                els.runsOutput.textContent = JSON.stringify({
                    ok: false,
                    status: result.response.status,
                    message: token ? 'Admin request failed.' : 'Admin token required for run status.',
                    body: result.data
                }, null, 2);
                return;
            }
            els.runsOutput.textContent = JSON.stringify(result.data, null, 2);
        } catch (err) {
            els.runsOutput.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
        }
    }

    async function refreshAll() {
        await Promise.all([loadFilters(), loadHealth(), loadLatest(), loadRuns()]);
        await loadSeries();
    }

    if (els.refreshAll) els.refreshAll.addEventListener('click', refreshAll);
    if (els.tabDaily) els.tabDaily.addEventListener('click', function () { setMode('daily'); refreshAll(); });
    if (els.tabHistorical) els.tabHistorical.addEventListener('click', function () { setMode('historical'); refreshAll(); });
    if (els.applyFilters) els.applyFilters.addEventListener('click', refreshAll);
    if (els.downloadCsv) els.downloadCsv.addEventListener('click', downloadCsv);
    if (els.refreshHealth) els.refreshHealth.addEventListener('click', loadHealth);
    if (els.refreshLatest) els.refreshLatest.addEventListener('click', loadLatest);
    if (els.refreshSeries) els.refreshSeries.addEventListener('click', loadSeries);
    if (els.refreshRuns) els.refreshRuns.addEventListener('click', loadRuns);
    if (els.latestBody) {
        els.latestBody.addEventListener('click', function (event) {
            var target = event.target;
            if (!target) return;
            var tr = target.closest('tr');
            if (!tr) return;
            var key = tr.getAttribute('data-product-key');
            if (!key) return;
            state.selectedProductKey = key;
            loadSeries();
        });
    }

    setMode('daily');
    refreshAll();
})();