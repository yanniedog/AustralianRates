(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var utils = window.AR.utils;
    var els = dom && dom.els ? dom.els : {};
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var money = utils && utils.money ? utils.money : function (v) { var n = Number(v); return Number.isFinite(n) ? '$' + n.toFixed(2) : '-'; };
    var esc = window._arEsc;

    function pctFormatter(cell) { return pct(cell.getValue()); }
    function moneyFormatter(cell) { return money(cell.getValue()); }

    function sourceUrlFormatter(cell) {
        var url = cell.getValue();
        if (!url) return '\u2014';
        var u = String(url);
        var label = u.length > 40 ? u.slice(0, 37) + '\u2026' : u;
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

    var MOBILE_BREAKPOINT = 760;
    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    function getLoanColumns() {
        var narrow = isMobile();
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110 },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Comparison', field: 'comparison_rate', formatter: pctFormatter, headerSort: true, minWidth: 80, visible: !narrow },
            { title: 'Structure', field: 'rate_structure', headerSort: true, minWidth: 80 },
            { title: 'Purpose', field: 'security_purpose', headerSort: true, minWidth: 80 },
            { title: 'Repayment', field: 'repayment_type', headerSort: true, minWidth: 100, visible: !narrow },
            { title: 'LVR', field: 'lvr_tier', headerSort: true, minWidth: 70 },
            { title: 'Feature', field: 'feature_set', headerSort: true, minWidth: 70, visible: !narrow },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120, visible: !narrow },
            { title: 'Annual Fee', field: 'annual_fee', formatter: moneyFormatter, headerSort: true, minWidth: 80, visible: !narrow },
            { title: 'Source URL', field: 'source_url', headerSort: true, minWidth: 100, visible: !narrow, formatter: sourceUrlFormatter },
            { title: 'Cash Rate', field: 'rba_cash_rate', formatter: pctFormatter, headerSort: true, minWidth: 80, visible: !narrow },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, visible: !narrow, formatter: runSourceFormatter },
            { title: 'Checked At', field: 'parsed_at', headerSort: true, minWidth: 120, visible: !narrow, formatter: parsedAtFormatter },
        ];
    }

    function getSavingsColumns() {
        var narrow = isMobile();
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110 },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Account Type', field: 'account_type', headerSort: true, minWidth: 90 },
            { title: 'Rate Type', field: 'rate_type', headerSort: true, minWidth: 80 },
            { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 80 },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120, visible: !narrow },
            { title: 'Conditions', field: 'conditions', headerSort: false, minWidth: 150, visible: !narrow },
            { title: 'Monthly Fee', field: 'monthly_fee', formatter: moneyFormatter, headerSort: true, minWidth: 80, visible: !narrow },
            { title: 'Source URL', field: 'source_url', headerSort: true, minWidth: 100, visible: false, formatter: sourceUrlFormatter },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, visible: !narrow, formatter: runSourceFormatter },
            { title: 'Checked At', field: 'parsed_at', headerSort: true, minWidth: 120, visible: !narrow, formatter: parsedAtFormatter },
        ];
    }

    function getTdColumns() {
        var narrow = isMobile();
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110 },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Term (months)', field: 'term_months', headerSort: true, minWidth: 80 },
            { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 80 },
            { title: 'Payment', field: 'interest_payment', headerSort: true, minWidth: 90 },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120, visible: !narrow },
            { title: 'Min Deposit', field: 'min_deposit', formatter: moneyFormatter, headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Max Deposit', field: 'max_deposit', formatter: moneyFormatter, headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Source URL', field: 'source_url', headerSort: true, minWidth: 100, visible: false, formatter: sourceUrlFormatter },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, visible: !narrow, formatter: runSourceFormatter },
            { title: 'Checked At', field: 'parsed_at', headerSort: true, minWidth: 120, visible: !narrow, formatter: parsedAtFormatter },
        ];
    }

    function getRateTableColumns() {
        var section = window.AR.section || (window.location.pathname.indexOf('/savings') !== -1 ? 'savings' : window.location.pathname.indexOf('/term-deposits') !== -1 ? 'term-deposits' : 'home-loans');
        if (section === 'savings') return getSavingsColumns();
        if (section === 'term-deposits') return getTdColumns();
        return getLoanColumns();
    }

    var rateTable = null;
    var lastMobileState = null;

    function getTableLayout() { return isMobile() ? 'fitColumns' : 'fitDataFill'; }

    function initRateTable() {
        lastMobileState = isMobile();

        var apiBase = (config && config.apiBase) ? config.apiBase : (window.location.origin + (window.AR.sectionConfig && window.AR.sectionConfig.apiPath ? window.AR.sectionConfig.apiPath : '/api/home-loan-rates'));
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
                var sorters = (params.sorters && params.sorters.length > 0) ? params.sorters : (rateTable && rateTable.getSorters ? rateTable.getSorters() : []);
                if (sorters.length > 0) {
                    q.set('sort', sorters[0].field);
                    q.set('dir', sorters[0].dir);
                } else {
                    q.set('sort', 'collection_date');
                    q.set('dir', 'desc');
                }
                var fetchUrl = url + '?' + q.toString();
                return fetch(fetchUrl, { cache: 'no-store' })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        return { last_page: data.last_page || 1, data: data.data || [] };
                    });
            },
            movableColumns: !isMobile(),
            resizableColumns: !isMobile(),
            layout: getTableLayout(),
            placeholder: 'No rate data found. Try adjusting your filters or date range.',
            columns: getRateTableColumns(),
            initialSort: [{ column: 'collection_date', dir: 'desc' }],
        });

        if (rateTable && rateTable.on) {
            rateTable.on('sortChanged', function () {
                if (rateTable && rateTable.setData) rateTable.setData();
            });
        }

        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                if (!rateTable) return;
                var narrow = isMobile();
                if (narrow === lastMobileState) return;
                lastMobileState = narrow;
            }, 250);
        });
    }

    function reloadExplorer() {
        if (rateTable) rateTable.setData();
    }

    window.AR.explorer = {
        initRateTable: initRateTable,
        reloadExplorer: reloadExplorer,
    };
})();
