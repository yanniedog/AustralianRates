(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var utils = window.AR.utils;
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var money = utils && utils.money ? utils.money : function (v) { var n = Number(v); return Number.isFinite(n) ? '$' + n.toFixed(2) : '-'; };
    var esc = window._arEsc;

    function pctFormatter(cell) {
        return pct(cell.getValue());
    }

    function moneyFormatter(cell) {
        return money(cell.getValue());
    }

    function sourceUrlFormatter(cell) {
        var url = cell.getValue();
        if (!url) return '—';
        var u = String(url);
        var label = u.length > 40 ? u.slice(0, 37) + '…' : u;
        var href = u.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        cell.getElement().innerHTML = '<a href="' + href + '" target="_blank" rel="noopener noreferrer" title="' + esc(u) + '">' + esc(label) + '</a>';
        return '';
    }

    function runSourceFormatter(cell) {
        var v = String(cell.getValue() || '');
        return v === 'manual' ? 'Manual' : 'Auto';
    }

    function parsedAtFormatter(cell) {
        var v = cell.getValue();
        if (!v) return '-';
        try { return new Date(v).toLocaleString(); } catch (_) { return String(v); }
    }

    function qualityFormatter(cell) {
        var v = String(cell.getValue() || '');
        if (v === 'ok') return 'CDR Live';
        if (v.indexOf('parsed_from_wayback') === 0) return 'Historical';
        return v;
    }

    function getRateTableColumns() {
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, width: 110, tooltip: 'Date the rate was collected / discovered.' },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 120, tooltip: 'Lender or bank name.' },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, width: 90, tooltip: 'Advertised interest rate (%).' },
            { title: 'Comparison', field: 'comparison_rate', formatter: pctFormatter, headerSort: true, width: 110, tooltip: 'Comparison rate (%), includes fees.' },
            { title: 'Structure', field: 'rate_structure', headerSort: true, width: 100, tooltip: 'Variable or fixed term (e.g. 1–5 years).' },
            { title: 'Purpose', field: 'security_purpose', headerSort: true, width: 130, tooltip: 'Owner-occupied or investment.' },
            { title: 'Repayment', field: 'repayment_type', headerSort: true, width: 150, tooltip: 'Principal and interest or interest only.' },
            { title: 'LVR', field: 'lvr_tier', headerSort: true, width: 110, tooltip: 'Loan-to-value ratio tier.' },
            { title: 'Feature', field: 'feature_set', headerSort: true, width: 90, tooltip: 'Basic (no offset/redraw) or Premium (with offset/redraw).' },
            { title: 'Offset', field: 'feature_set', headerSort: true, width: 70, tooltip: 'Whether the account has an offset arrangement (Yes/No).',
                formatter: function (cell) { return (cell.getValue() === 'premium') ? 'Yes' : 'No'; }
            },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 140, tooltip: 'Product or rate name.' },
            { title: 'Annual Fee', field: 'annual_fee', formatter: moneyFormatter, headerSort: true, width: 100, tooltip: 'Annual fee ($).' },
            { title: 'Source URL', field: 'source_url', headerSort: true, width: 120, tooltip: 'URL the rate was scraped or sourced from.', formatter: sourceUrlFormatter },
            { title: 'Cash Rate', field: 'rba_cash_rate', formatter: pctFormatter, headerSort: true, width: 100, tooltip: 'RBA cash rate on that date.' },
            { title: 'Source', field: 'run_source', headerSort: true, width: 90, tooltip: 'Auto (scheduled) or Manual run.', formatter: runSourceFormatter },
            { title: 'Checked At', field: 'parsed_at', headerSort: true, width: 160, tooltip: 'When the rate was parsed.', formatter: parsedAtFormatter },
            { title: 'Quality', field: 'data_quality_flag', headerSort: false, width: 120, visible: false, tooltip: 'Data quality flag (e.g. CDR Live, Historical).', formatter: qualityFormatter },
        ];
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
                return { last_page: response.last_page || 1, data: response.data || [] };
            },
            pagination: true,
            paginationMode: 'remote',
            paginationSize: 50,
            paginationCounter: function (pageSize, currentRow, currentPage, totalRows, totalPages) {
                return 'Page ' + currentPage + ' of ' + totalPages + ' (' + totalRows.toLocaleString() + ' records)';
            },
            sortMode: 'remote',
            ajaxSorting: true,
            dataSendParams: { page: 'page', size: 'size', sort: 'sort', sorters: 'sorters' },
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
                var fetchUrl = url + '?' + q.toString();
                // #region agent log
                console.log('[AR-DEBUG-eb90c6] ajaxRequestFunc fetching:', fetchUrl);
                // #endregion
                return fetch(fetchUrl, { cache: 'no-store' })
                    .then(function (r) {
                        // #region agent log
                        console.log('[AR-DEBUG-eb90c6] fetch response status:', r.status, 'cf-cache-status:', r.headers.get('cf-cache-status'));
                        // #endregion
                        return r.json();
                    })
                    .then(function (data) {
                        // #region agent log
                        var firstDate = (data.data && data.data.length > 0) ? data.data[0].collection_date : 'no-data';
                        console.log('[AR-DEBUG-eb90c6] fetched data: total=' + data.total + ', rows=' + (data.data ? data.data.length : 0) + ', first_date=' + firstDate);
                        // #endregion
                        return { last_page: data.last_page || 1, data: data.data || [] };
                    });
            },
            movableColumns: true,
            resizableColumns: true,
            layout: 'fitDataFill',
            placeholder: 'No rate data found. Try adjusting your filters or date range.',
            columns: getRateTableColumns(),
            initialSort: [{ column: 'collection_date', dir: 'desc' }],
        });
    }

    function reloadExplorer() {
        if (!rateTable) return;
        var fp = buildFilterParams();
        fp.page = '1';
        fp.size = '50';
        fp.sort = 'collection_date';
        fp.dir = 'desc';
        var q = Object.keys(fp).filter(function (k) { var v = fp[k]; return v !== undefined && v !== null && v !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(fp[k])); }).join('&');
        rateTable.setData(apiBase + '/rates?' + q);
    }

    window.AR.explorer = {
        initRateTable: initRateTable,
        reloadExplorer: reloadExplorer,
    };
})();
