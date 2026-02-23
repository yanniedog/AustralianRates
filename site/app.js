(function () {
    'use strict';

    /* ── Utilities ─────────────────────────────────────── */

    function pct(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(3) + '%';
    }

    function money(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return '$' + n.toFixed(2);
    }

    window._arEsc = function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    /* ── API base ──────────────────────────────────────── */

    var params = new URLSearchParams(window.location.search);
    var apiOverride = params.get('apiBase');
    var apiBase = (apiOverride ? String(apiOverride).replace(/\/+$/, '') : '') ||
                  (window.location.origin + '/api/home-loan-rates');
    var isAdmin = params.get('admin') === 'true';

    /* ── DOM references ────────────────────────────────── */

    var els = {
        tabExplorer:   document.getElementById('tab-explorer'),
        tabPivot:      document.getElementById('tab-pivot'),
        tabCharts:     document.getElementById('tab-charts'),
        panelExplorer: document.getElementById('panel-explorer'),
        panelPivot:    document.getElementById('panel-pivot'),
        panelCharts:   document.getElementById('panel-charts'),
        panelAdmin:    document.getElementById('panel-admin'),
        filterBank:      document.getElementById('filter-bank'),
        filterSecurity:  document.getElementById('filter-security'),
        filterRepayment: document.getElementById('filter-repayment'),
        filterStructure: document.getElementById('filter-structure'),
        filterLvr:       document.getElementById('filter-lvr'),
        filterFeature:   document.getElementById('filter-feature'),
        filterStartDate: document.getElementById('filter-start-date'),
        filterEndDate:   document.getElementById('filter-end-date'),
        applyFilters:  document.getElementById('apply-filters'),
        downloadCsv:   document.getElementById('download-csv'),
        loadPivot:     document.getElementById('load-pivot'),
        pivotStatus:   document.getElementById('pivot-status'),
        pivotOutput:   document.getElementById('pivot-output'),
        chartX:        document.getElementById('chart-x'),
        chartY:        document.getElementById('chart-y'),
        chartGroup:    document.getElementById('chart-group'),
        chartType:     document.getElementById('chart-type'),
        drawChart:     document.getElementById('draw-chart'),
        chartOutput:   document.getElementById('chart-output'),
        chartStatus:   document.getElementById('chart-status'),
        statUpdated:   document.getElementById('stat-updated'),
        statCashRate:  document.getElementById('stat-cash-rate'),
        statRecords:   document.getElementById('stat-records'),
        refreshRuns:   document.getElementById('refresh-runs'),
        runsOutput:    document.getElementById('runs-output'),
        adminToken:    document.getElementById('admin-token'),
        triggerRun:    document.getElementById('trigger-run'),
        triggerStatus: document.getElementById('trigger-status'),
        filterIncludeManual: document.getElementById('filter-include-manual'),
        refreshInterval: document.getElementById('refresh-interval'),
        lastRefreshed: document.getElementById('last-refreshed'),
    };

    /* ── State ─────────────────────────────────────────── */

    var state = {
        activeTab: params.get('tab') || 'explorer',
        pivotLoaded: false,
        chartDrawn: false,
        refreshTimerId: null,
        lastRefreshedAt: null,
    };

    /* ── Show admin panel if ?admin=true ───────────────── */

    if (isAdmin && els.panelAdmin) {
        els.panelAdmin.hidden = false;
    }

    /* ── Tab switching ─────────────────────────────────── */

    var tabBtns = [els.tabExplorer, els.tabPivot, els.tabCharts];
    var tabPanels = [els.panelExplorer, els.panelPivot, els.panelCharts];

    function activateTab(tabId) {
        state.activeTab = tabId;
        tabBtns.forEach(function (btn) {
            if (!btn) return;
            var active = btn.id === 'tab-' + tabId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });
        tabPanels.forEach(function (panel) {
            if (!panel) return;
            var active = panel.id === 'panel-' + tabId;
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });
        syncUrlState();
    }

    tabBtns.forEach(function (btn) {
        if (!btn) return;
        btn.addEventListener('click', function () {
            activateTab(btn.id.replace('tab-', ''));
        });
        btn.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activateTab(btn.id.replace('tab-', ''));
            }
        });
    });

    /* ── Filter helpers ────────────────────────────────── */

    function fillSelect(el, values) {
        if (!el) return;
        var current = el.value;
        el.innerHTML = '<option value="">All</option>' + values.map(function (v) {
            return '<option value="' + window._arEsc(v) + '">' + window._arEsc(v) + '</option>';
        }).join('');
        if (current && values.indexOf(current) >= 0) {
            el.value = current;
        }
    }

    function buildFilterParams() {
        var p = {};
        if (els.filterBank && els.filterBank.value) p.bank = els.filterBank.value;
        if (els.filterSecurity && els.filterSecurity.value) p.security_purpose = els.filterSecurity.value;
        if (els.filterRepayment && els.filterRepayment.value) p.repayment_type = els.filterRepayment.value;
        if (els.filterStructure && els.filterStructure.value) p.rate_structure = els.filterStructure.value;
        if (els.filterLvr && els.filterLvr.value) p.lvr_tier = els.filterLvr.value;
        if (els.filterFeature && els.filterFeature.value) p.feature_set = els.filterFeature.value;
        if (els.filterStartDate && els.filterStartDate.value) p.start_date = els.filterStartDate.value;
        if (els.filterEndDate && els.filterEndDate.value) p.end_date = els.filterEndDate.value;
        if (els.filterIncludeManual && els.filterIncludeManual.checked) p.include_manual = 'true';
        return p;
    }

    function syncUrlState() {
        var q = new URLSearchParams();
        q.set('tab', state.activeTab);
        if (els.filterBank && els.filterBank.value) q.set('bank', els.filterBank.value);
        if (els.filterSecurity && els.filterSecurity.value) q.set('purpose', els.filterSecurity.value);
        if (els.filterRepayment && els.filterRepayment.value) q.set('repayment', els.filterRepayment.value);
        if (els.filterStructure && els.filterStructure.value) q.set('structure', els.filterStructure.value);
        if (els.filterLvr && els.filterLvr.value) q.set('lvr', els.filterLvr.value);
        if (els.filterFeature && els.filterFeature.value) q.set('feature', els.filterFeature.value);
        if (els.filterStartDate && els.filterStartDate.value) q.set('start_date', els.filterStartDate.value);
        if (els.filterEndDate && els.filterEndDate.value) q.set('end_date', els.filterEndDate.value);
        if (els.filterIncludeManual && els.filterIncludeManual.checked) q.set('include_manual', 'true');
        if (els.refreshInterval && els.refreshInterval.value !== '60') q.set('refresh_interval', els.refreshInterval.value);
        if (apiOverride) q.set('apiBase', apiOverride);
        if (isAdmin) q.set('admin', 'true');
        window.history.replaceState(null, '', window.location.pathname + '?' + q.toString());
    }

    function restoreUrlState() {
        var p = new URLSearchParams(window.location.search);
        if (p.get('tab')) state.activeTab = p.get('tab');
        if (p.get('bank') && els.filterBank) els.filterBank.value = p.get('bank');
        if (p.get('purpose') && els.filterSecurity) els.filterSecurity.value = p.get('purpose');
        if (p.get('repayment') && els.filterRepayment) els.filterRepayment.value = p.get('repayment');
        if (p.get('structure') && els.filterStructure) els.filterStructure.value = p.get('structure');
        if (p.get('lvr') && els.filterLvr) els.filterLvr.value = p.get('lvr');
        if (p.get('feature') && els.filterFeature) els.filterFeature.value = p.get('feature');
        if (p.get('start_date') && els.filterStartDate) els.filterStartDate.value = p.get('start_date');
        if (p.get('end_date') && els.filterEndDate) els.filterEndDate.value = p.get('end_date');
        if (p.get('include_manual') === 'true' && els.filterIncludeManual) els.filterIncludeManual.checked = true;
        if (p.get('refresh_interval') && els.refreshInterval) els.refreshInterval.value = p.get('refresh_interval');
    }

    /* ── Load filter options ───────────────────────────── */

    async function loadFilters() {
        try {
            var r = await fetch(apiBase + '/filters');
            var data = await r.json();
            if (!data || !data.filters) return;
            var f = data.filters;
            fillSelect(els.filterBank, f.banks || []);
            fillSelect(els.filterSecurity, f.security_purposes || []);
            fillSelect(els.filterRepayment, f.repayment_types || []);
            fillSelect(els.filterStructure, f.rate_structures || []);
            fillSelect(els.filterLvr, f.lvr_tiers || []);
            fillSelect(els.filterFeature, f.feature_sets || []);
            restoreUrlState();
        } catch (_) { /* non-critical */ }
    }

    /* ── Hero stats ────────────────────────────────────── */

    async function loadHeroStats() {
        try {
            var ratesRes = await fetch(apiBase + '/rates?' + new URLSearchParams({ page: '1', size: '1', sort: 'collection_date', dir: 'desc' }));
            var ratesData = await ratesRes.json();
            if (ratesData && ratesData.total != null) {
                if (els.statRecords) els.statRecords.innerHTML = 'Records: <strong>' + Number(ratesData.total).toLocaleString() + '</strong>';
                if (ratesData.data && ratesData.data.length > 0) {
                    var latest = ratesData.data[0];
                    if (els.statUpdated && latest.collection_date) {
                        els.statUpdated.innerHTML = 'Last updated: <strong>' + window._arEsc(latest.collection_date) + '</strong>';
                    }
                    if (els.statCashRate && latest.rba_cash_rate != null) {
                        els.statCashRate.innerHTML = 'RBA Cash Rate: <strong>' + pct(latest.rba_cash_rate) + '</strong>';
                    }
                }
            }
        } catch (_) { /* non-critical */ }
    }

    /* ── Tabulator Rate Explorer ───────────────────────── */

    function pctFormatter(cell) {
        return pct(cell.getValue());
    }

    function moneyFormatter(cell) {
        return money(cell.getValue());
    }

    var rateTable = null;

    function initRateTable() {
        rateTable = new Tabulator('#rate-table', {
            ajaxURL: apiBase + '/rates',
            ajaxConfig: 'GET',
            ajaxContentType: 'json',
            ajaxParams: function () {
                var fp = buildFilterParams();
                fp.size = '50';
                return fp;
            },
            ajaxURLGenerator: function (url, _config, params) {
                var q = new URLSearchParams();
                Object.keys(params).forEach(function (k) {
                    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
                        q.set(k, String(params[k]));
                    }
                });
                return url + '?' + q.toString();
            },
            ajaxResponse: function (_url, _params, response) {
                return {
                    last_page: response.last_page || 1,
                    data: response.data || [],
                };
            },
            pagination: true,
            paginationMode: 'remote',
            paginationSize: 50,
            paginationCounter: function (pageSize, currentRow, currentPage, totalRows, totalPages) {
                return 'Page ' + currentPage + ' of ' + totalPages + ' (' + totalRows.toLocaleString() + ' records)';
            },
            sortMode: 'remote',
            ajaxSorting: true,
            dataSendParams: {
                page: 'page',
                size: 'size',
                sort: 'sort',
                sorters: 'sorters',
            },
            ajaxRequestFunc: function (url, _config, params) {
                var q = new URLSearchParams();
                var fp = buildFilterParams();
                Object.keys(fp).forEach(function (k) { q.set(k, fp[k]); });

                q.set('page', String(params.page || 1));
                q.set('size', '50');

                if (params.sorters && params.sorters.length > 0) {
                    q.set('sort', params.sorters[0].field);
                    q.set('dir', params.sorters[0].dir);
                }

                return fetch(url + '?' + q.toString())
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        return {
                            last_page: data.last_page || 1,
                            data: data.data || [],
                        };
                    });
            },
            movableColumns: true,
            resizableColumns: true,
            layout: 'fitDataFill',
            placeholder: 'No rate data found. Try adjusting your filters or date range.',
            columns: [
                { title: 'Date', field: 'collection_date', headerSort: true, width: 110 },
                { title: 'Cash Rate', field: 'rba_cash_rate', formatter: pctFormatter, headerSort: true, width: 100 },
                { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 100 },
                { title: 'Product', field: 'product_name', headerSort: true, minWidth: 140 },
                { title: 'Purpose', field: 'security_purpose', headerSort: true, width: 130 },
                { title: 'Repayment', field: 'repayment_type', headerSort: true, width: 150 },
                { title: 'LVR', field: 'lvr_tier', headerSort: true, width: 110 },
                { title: 'Structure', field: 'rate_structure', headerSort: true, width: 100 },
                { title: 'Feature', field: 'feature_set', headerSort: true, width: 90 },
                { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, width: 90,
                    cellClick: function () {} },
                { title: 'Comparison', field: 'comparison_rate', formatter: pctFormatter, headerSort: true, width: 110, visible: false },
                { title: 'Annual Fee', field: 'annual_fee', formatter: moneyFormatter, headerSort: true, width: 100, visible: false },
                { title: 'Checked At', field: 'parsed_at', headerSort: true, width: 160,
                    formatter: function (cell) {
                        var v = cell.getValue();
                        if (!v) return '-';
                        try { return new Date(v).toLocaleString(); } catch (_) { return String(v); }
                    }
                },
                { title: 'Source', field: 'run_source', headerSort: true, width: 90,
                    formatter: function (cell) {
                        var v = String(cell.getValue() || '');
                        if (v === 'manual') return 'Manual';
                        return 'Auto';
                    }
                },
                { title: 'Quality', field: 'data_quality_flag', headerSort: false, width: 120, visible: false,
                    formatter: function (cell) {
                        var v = String(cell.getValue() || '');
                        if (v === 'ok') return 'CDR Live';
                        if (v.indexOf('parsed_from_wayback') === 0) return 'Historical';
                        return v;
                    }
                },
            ],
            initialSort: [{ column: 'collection_date', dir: 'desc' }],
        });
    }

    function reloadExplorer() {
        if (rateTable) {
            rateTable.setData();
        }
    }

    /* ── Pivot Table ───────────────────────────────────── */

    function loadPivotData() {
        if (!els.pivotOutput) return;
        if (els.pivotStatus) els.pivotStatus.textContent = 'Loading data for pivot...';

        var fp = buildFilterParams();
        fp.size = '10000';
        fp.page = '1';

        var q = new URLSearchParams(fp);

        fetch(apiBase + '/rates?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (response) {
                var data = response.data || [];
                if (data.length === 0) {
                    if (els.pivotStatus) els.pivotStatus.textContent = 'No data returned. Try broadening your filters or date range.';
                    return;
                }
                var total = response.total || data.length;
                var warning = total > 10000
                    ? ' (showing first 10,000 of ' + total.toLocaleString() + ' rows)'
                    : '';

                if (els.pivotStatus) {
                    els.pivotStatus.textContent = 'Loaded ' + data.length.toLocaleString() + ' rows' + warning + '. Drag fields to configure the pivot.';
                }

                var renderers = $.extend(
                    $.pivotUtilities.renderers,
                    $.pivotUtilities.plotly_renderers
                );

                $(els.pivotOutput).empty().pivotUI(data, {
                    rows: ['bank_name'],
                    cols: ['rate_structure'],
                    vals: ['interest_rate'],
                    aggregatorName: 'Average',
                    renderers: renderers,
                    rendererName: 'Table',
                    rendererOptions: {
                        plotly: {
                            width: Math.min(1100, window.innerWidth - 80),
                            height: 500,
                        },
                    },
                }, true);
                state.pivotLoaded = true;
            })
            .catch(function (err) {
                if (els.pivotStatus) els.pivotStatus.textContent = 'Error loading pivot data: ' + String(err.message || err);
            });
    }

    /* ── Chart Builder ─────────────────────────────────── */

    function drawChart() {
        if (!els.chartOutput) return;
        if (els.chartStatus) els.chartStatus.textContent = 'Loading chart data...';

        var fp = buildFilterParams();
        fp.size = '10000';
        fp.page = '1';
        fp.sort = els.chartX ? els.chartX.value : 'collection_date';
        fp.dir = 'asc';

        var q = new URLSearchParams(fp);

        fetch(apiBase + '/rates?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (response) {
                var data = response.data || [];
                if (data.length === 0) {
                    if (els.chartStatus) els.chartStatus.textContent = 'No data to chart. Adjust filters or date range.';
                    Plotly.purge(els.chartOutput);
                    return;
                }

                var xField = els.chartX ? els.chartX.value : 'collection_date';
                var yField = els.chartY ? els.chartY.value : 'interest_rate';
                var groupField = els.chartGroup ? els.chartGroup.value : '';
                var chartType = els.chartType ? els.chartType.value : 'scatter';

                var traces = [];

                if (groupField) {
                    var groups = {};
                    data.forEach(function (row) {
                        var key = String(row[groupField] || 'Unknown');
                        if (!groups[key]) groups[key] = { x: [], y: [] };
                        groups[key].x.push(row[xField]);
                        groups[key].y.push(Number(row[yField]));
                    });
                    Object.keys(groups).sort().forEach(function (key) {
                        var trace = {
                            x: groups[key].x,
                            y: groups[key].y,
                            name: key,
                            type: chartType,
                        };
                        if (chartType === 'scatter') {
                            trace.mode = 'lines+markers';
                            trace.marker = { size: 4 };
                        }
                        traces.push(trace);
                    });
                } else {
                    var trace = {
                        x: data.map(function (r) { return r[xField]; }),
                        y: data.map(function (r) { return Number(r[yField]); }),
                        type: chartType,
                        name: yField,
                    };
                    if (chartType === 'scatter') {
                        trace.mode = 'lines+markers';
                        trace.marker = { size: 4 };
                    }
                    traces.push(trace);
                }

                var yLabel = {
                    interest_rate: 'Interest Rate (%)',
                    comparison_rate: 'Comparison Rate (%)',
                    annual_fee: 'Annual Fee ($)',
                    rba_cash_rate: 'RBA Cash Rate (%)',
                }[yField] || yField;

                var xLabel = {
                    collection_date: 'Date',
                    bank_name: 'Bank',
                    rate_structure: 'Structure',
                    lvr_tier: 'LVR',
                    feature_set: 'Feature',
                }[xField] || xField;

                var layout = {
                    title: yLabel + ' by ' + xLabel,
                    xaxis: { title: xLabel },
                    yaxis: { title: yLabel },
                    hovermode: 'closest',
                    legend: { orientation: 'h', y: -0.2 },
                    margin: { t: 50, l: 60, r: 20, b: 80 },
                    height: 500,
                };

                Plotly.newPlot(els.chartOutput, traces, layout, { responsive: true });
                state.chartDrawn = true;

                var total = response.total || data.length;
                var suffix = total > 10000
                    ? ' (charted first 10,000 of ' + total.toLocaleString() + ')'
                    : ' (' + data.length.toLocaleString() + ' data points)';
                if (els.chartStatus) els.chartStatus.textContent = 'Chart rendered' + suffix;
            })
            .catch(function (err) {
                if (els.chartStatus) els.chartStatus.textContent = 'Error: ' + String(err.message || err);
            });
    }

    /* ── Trigger Manual Run ─────────────────────────────── */

    var triggerInFlight = false;

    function triggerManualRun() {
        if (triggerInFlight) return;
        if (!els.triggerRun) return;
        triggerInFlight = true;
        els.triggerRun.disabled = true;
        if (els.triggerStatus) els.triggerStatus.textContent = 'Starting run...';

        fetch(apiBase + '/trigger-run', { method: 'POST' })
            .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
            .then(function (res) {
                if (res.status === 429) {
                    var secs = res.body.retry_after_seconds || 0;
                    var mins = Math.ceil(secs / 60);
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Rate limited -- try again in ~' + mins + ' min.';
                } else if (res.body && res.body.ok) {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run started. Data will refresh shortly.';
                    setTimeout(function () {
                        reloadExplorer();
                        loadHeroStats();
                        if (els.triggerStatus) els.triggerStatus.textContent = '';
                    }, 15000);
                } else {
                    if (els.triggerStatus) els.triggerStatus.textContent = 'Run could not be started.';
                }
            })
            .catch(function (err) {
                if (els.triggerStatus) els.triggerStatus.textContent = 'Error: ' + String(err.message || err);
            })
            .finally(function () {
                triggerInFlight = false;
                setTimeout(function () {
                    if (els.triggerRun) els.triggerRun.disabled = false;
                }, 5000);
            });
    }

    /* ── Auto-Refresh ─────────────────────────────────── */

    function updateLastRefreshed() {
        if (!els.lastRefreshed) return;
        if (!state.lastRefreshedAt) {
            els.lastRefreshed.textContent = '';
            return;
        }
        var ago = Math.round((Date.now() - state.lastRefreshedAt) / 60000);
        if (ago < 1) {
            els.lastRefreshed.textContent = 'Refreshed just now';
        } else {
            els.lastRefreshed.textContent = 'Refreshed ' + ago + ' min ago';
        }
    }

    function doAutoRefresh() {
        reloadExplorer();
        loadHeroStats();
        state.lastRefreshedAt = Date.now();
        updateLastRefreshed();
    }

    function setupAutoRefresh() {
        if (state.refreshTimerId) {
            clearInterval(state.refreshTimerId);
            state.refreshTimerId = null;
        }
        var minutes = parseInt(els.refreshInterval ? els.refreshInterval.value : '60', 10);
        if (isNaN(minutes) || minutes <= 0) {
            if (els.lastRefreshed) els.lastRefreshed.textContent = 'Auto-refresh off';
            return;
        }
        state.lastRefreshedAt = Date.now();
        updateLastRefreshed();
        state.refreshTimerId = setInterval(doAutoRefresh, minutes * 60 * 1000);
    }

    setInterval(updateLastRefreshed, 30000);

    /* ── CSV Export ─────────────────────────────────────── */

    function downloadCsv() {
        var fp = buildFilterParams();
        fp.dataset = 'latest';
        var q = new URLSearchParams(fp);
        window.open(apiBase + '/export.csv?' + q.toString(), '_blank', 'noopener');
    }

    /* ── Admin ─────────────────────────────────────────── */

    async function loadRuns() {
        if (!els.runsOutput) return;
        els.runsOutput.textContent = 'Loading runs...';
        var token = els.adminToken && els.adminToken.value ? String(els.adminToken.value).trim() : '';
        var headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        try {
            var r = await fetch(apiBase + '/admin/runs?limit=10', { headers: headers });
            var data = await r.json();
            els.runsOutput.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            els.runsOutput.textContent = JSON.stringify({ ok: false, error: String(err.message || err) }, null, 2);
        }
    }

    /* ── Apply filters ─────────────────────────────────── */

    function applyFilters() {
        syncUrlState();
        reloadExplorer();
        if (state.pivotLoaded && els.pivotStatus) {
            els.pivotStatus.textContent = 'Filters changed -- click "Load Data for Pivot" to refresh.';
        }
        if (state.chartDrawn && els.chartStatus) {
            els.chartStatus.textContent = 'Filters changed -- click "Draw Chart" to refresh.';
        }
    }

    /* ── Event bindings ────────────────────────────────── */

    if (els.applyFilters) els.applyFilters.addEventListener('click', applyFilters);
    if (els.downloadCsv) els.downloadCsv.addEventListener('click', downloadCsv);
    if (els.loadPivot) els.loadPivot.addEventListener('click', loadPivotData);
    if (els.drawChart) els.drawChart.addEventListener('click', drawChart);
    if (els.refreshRuns) els.refreshRuns.addEventListener('click', loadRuns);
    if (els.triggerRun) els.triggerRun.addEventListener('click', triggerManualRun);
    if (els.filterIncludeManual) els.filterIncludeManual.addEventListener('change', applyFilters);
    if (els.refreshInterval) els.refreshInterval.addEventListener('change', function () {
        syncUrlState();
        setupAutoRefresh();
    });

    /* ── Init ──────────────────────────────────────────── */

    loadFilters().then(function () {
        activateTab(state.activeTab);
    });
    loadHeroStats();
    initRateTable();
    setupAutoRefresh();
})();
