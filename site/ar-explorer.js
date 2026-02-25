(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var utils = window.AR.utils;
    var timeUtils = window.AR.time || {};
    var els = dom && dom.els ? dom.els : {};
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var money = utils && utils.money ? utils.money : function (v) { var n = Number(v); return Number.isFinite(n) ? '$' + n.toFixed(2) : '-'; };
    var clientLog = utils && utils.clientLog ? utils.clientLog : function () {};
    var esc = window._arEsc;
    var WAYBACK_PREFIX = 'https://web.archive.org/web/*/';

    function pctFormatter(cell) { return pct(cell.getValue()); }
    function moneyFormatter(cell) { return money(cell.getValue()); }

    function safeEsc(value) {
        return typeof esc === 'function' ? esc(value) : String(value || '');
    }

    function safeHref(value) {
        return String(value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function isWaybackUrl(url) {
        return /(^|\.)web\.archive\.org\/web\//i.test(String(url || ''));
    }

    function extractWaybackOriginalUrl(url) {
        var raw = String(url || '');
        var m = raw.match(/\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/i);
        return m && m[1] ? m[1] : '';
    }

    function linkHtml(href, label, title) {
        return '<a href="' + safeHref(href) + '" target="_blank" rel="noopener noreferrer" title="' + safeEsc(title) + '">' + safeEsc(label) + '</a>';
    }

    function offerLinksFormatter(cell) {
        var raw = String(cell.getValue() || '').trim();
        if (!raw) return '\u2014';

        var currentUrl = isWaybackUrl(raw) ? extractWaybackOriginalUrl(raw) : raw;
        var waybackUrl = isWaybackUrl(raw) ? raw : (WAYBACK_PREFIX + raw);
        var links = [];

        if (/^https?:\/\//i.test(currentUrl)) {
            links.push(linkHtml(currentUrl, 'Current', currentUrl));
        }
        if (/^https?:\/\//i.test(waybackUrl)) {
            links.push(linkHtml(waybackUrl, 'Wayback', waybackUrl));
        }

        if (links.length === 0) {
            return '\u2014';
        }

        cell.getElement().innerHTML = links.join(' &middot; ');
        return '';
    }

    function runSourceFormatter(cell) {
        var v = String(cell.getValue() || '');
        return v === 'manual' ? 'Manual' : 'Auto';
    }

    function parsedAtFormatter(cell) {
        var v = cell.getValue();
        if (!v) return '-';
        var rendered = timeUtils.formatCheckedAt ? timeUtils.formatCheckedAt(v) : { text: String(v), title: String(v) };
        var cellEl = cell.getElement ? cell.getElement() : null;
        if (cellEl && rendered && rendered.title) {
            cellEl.setAttribute('title', rendered.title);
        }
        return rendered && rendered.text ? rendered.text : String(v);
    }

    function collectionDateFormatter(cell) {
        var value = cell.getValue();
        var rowData = cell.getRow && cell.getRow() ? cell.getRow().getData() : null;
        var parsedAt = rowData && rowData.parsed_at ? rowData.parsed_at : '';
        var rendered = timeUtils.formatSourceDateWithLocal
            ? timeUtils.formatSourceDateWithLocal(value, parsedAt)
            : { text: String(value || ''), title: String(value || '') };
        var cellEl = cell.getElement ? cell.getElement() : null;
        if (cellEl && rendered && rendered.title) {
            cellEl.setAttribute('title', rendered.title);
        }
        return rendered && rendered.text ? rendered.text : String(value || '');
    }

    function retrievalTypeFormatter(cell) {
        var v = String(cell.getValue() || '');
        if (v === 'historical_scrape') return 'Historical scrape';
        return 'Present scrape (same date)';
    }

    var MOBILE_BREAKPOINT = 760;
    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    function getLoanColumns() {
        var narrow = isMobile();
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
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
            { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 140, visible: !narrow, formatter: retrievalTypeFormatter },
            { title: 'Offer Links', field: 'source_url', headerSort: false, minWidth: 120, visible: !narrow, formatter: offerLinksFormatter },
            { title: 'Cash Rate', field: 'rba_cash_rate', formatter: pctFormatter, headerSort: true, minWidth: 80, visible: !narrow },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, visible: !narrow, formatter: runSourceFormatter },
            { title: 'Checked At', field: 'parsed_at', headerSort: true, minWidth: 120, visible: !narrow, formatter: parsedAtFormatter },
        ];
    }

    function getSavingsColumns() {
        var narrow = isMobile();
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Account Type', field: 'account_type', headerSort: true, minWidth: 90 },
            { title: 'Rate Type', field: 'rate_type', headerSort: true, minWidth: 80 },
            { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 80 },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120, visible: !narrow },
            { title: 'Conditions', field: 'conditions', headerSort: false, minWidth: 150, visible: !narrow },
            { title: 'Monthly Fee', field: 'monthly_fee', formatter: moneyFormatter, headerSort: true, minWidth: 80, visible: !narrow },
            { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 140, visible: !narrow, formatter: retrievalTypeFormatter },
            { title: 'Offer Links', field: 'source_url', headerSort: false, minWidth: 120, visible: !narrow, formatter: offerLinksFormatter },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, visible: !narrow, formatter: runSourceFormatter },
            { title: 'Checked At', field: 'parsed_at', headerSort: true, minWidth: 120, visible: !narrow, formatter: parsedAtFormatter },
        ];
    }

    function getTdColumns() {
        var narrow = isMobile();
        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Term (months)', field: 'term_months', headerSort: true, minWidth: 80 },
            { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 80 },
            { title: 'Payment', field: 'interest_payment', headerSort: true, minWidth: 90 },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120, visible: !narrow },
            { title: 'Min Deposit', field: 'min_deposit', formatter: moneyFormatter, headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Max Deposit', field: 'max_deposit', formatter: moneyFormatter, headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 90, visible: !narrow },
            { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 140, visible: !narrow, formatter: retrievalTypeFormatter },
            { title: 'Offer Links', field: 'source_url', headerSort: false, minWidth: 120, visible: !narrow, formatter: offerLinksFormatter },
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
        clientLog('info', 'Explorer table init start', {
            section: window.AR.section || 'home-loans',
        });

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
                var fp = buildFilterParams();
                Object.keys(fp).forEach(function (k) { q.set(k, fp[k]); });
                q.set('page', String(params.page != null ? params.page : 1));
                q.set('size', '50');
                var sortField = 'collection_date';
                var sortDir = 'desc';
                if (params.sorters && params.sorters.length > 0) {
                    sortField = params.sorters[0].field;
                    sortDir = params.sorters[0].dir;
                }
                q.set('sort', sortField);
                q.set('dir', sortDir);
                return url + '?' + q.toString();
            },
            ajaxResponse: function (_url, _params, response) {
                clientLog('info', 'Explorer data loaded', {
                    rows: response && response.data ? response.data.length : 0,
                    total: response && response.total != null ? Number(response.total) : 0,
                });
                return { last_page: response.last_page || 1, data: response.data || [] };
            },
            ajaxError: function (xhr, textStatus, errorThrown) {
                clientLog('error', 'Explorer data load failed', {
                    status: xhr && xhr.status ? xhr.status : null,
                    textStatus: textStatus || null,
                    message: errorThrown ? String(errorThrown) : null,
                });
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
            movableColumns: !isMobile(),
            resizableColumns: !isMobile(),
            layout: getTableLayout(),
            placeholder: 'No rate data found. Try adjusting your filters or date range.',
            columns: getRateTableColumns(),
            initialSort: [{ column: 'collection_date', dir: 'desc' }],
        });
        clientLog('info', 'Explorer table init complete');

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
        if (rateTable) {
            clientLog('info', 'Explorer reload requested');
            rateTable.setData();
        }
    }

    window.AR.explorer = {
        initRateTable: initRateTable,
        reloadExplorer: reloadExplorer,
    };
})();
