(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var utils = window.AR.utils;
    var timeUtils = window.AR.time || {};
    var els = dom && dom.els ? dom.els : {};
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var isAnalystMode = state && typeof state.isAnalystMode === 'function'
        ? state.isAnalystMode
        : function () { return false; };
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var money = utils && utils.money ? utils.money : function (v) { var n = Number(v); return Number.isFinite(n) ? '$' + n.toFixed(2) : '-'; };
    var formatEnum = utils && utils.formatEnum ? utils.formatEnum : function (_field, value) { return String(value == null ? '' : value); };
    var formatDepositTier = utils && utils.formatDepositTier ? utils.formatDepositTier : function (value) { return String(value == null ? '' : value); };
    var cleanConditionsText = utils && utils.cleanConditionsText ? utils.cleanConditionsText : function (value) { return String(value == null ? '' : value); };
    var truncateText = utils && utils.truncateText ? utils.truncateText : function (value, maxLen) {
        var text = String(value == null ? '' : value);
        var max = Number(maxLen);
        if (!Number.isFinite(max) || max <= 0) max = 140;
        return text.length <= max ? text : text.slice(0, max - 1) + '...';
    };
    var clientLog = utils && utils.clientLog ? utils.clientLog : function () {};
    var esc = window._arEsc;
    var WAYBACK_PREFIX = 'https://web.archive.org/web/*/';

    function pctFormatter(cell) { return pct(cell.getValue()); }

    function safeEsc(value) {
        return typeof esc === 'function' ? esc(value) : String(value || '');
    }

    function safeHref(value) {
        return String(value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function getRowData(cell) {
        var row = cell.getRow ? cell.getRow() : null;
        return row && row.getData ? row.getData() : null;
    }

    function displayValue(row, displayField, rawField, enumField) {
        var display = row && row[displayField] != null ? String(row[displayField]) : '';
        if (display) return display;
        var raw = row && rawField ? row[rawField] : '';
        if (enumField) {
            var mapped = formatEnum(enumField, raw);
            if (mapped) return mapped;
        }
        return String(raw == null ? '' : raw);
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

        return links.join(' &middot; ');
    }

    function productUrlFormatter(cell) {
        var raw = String(cell.getValue() || '').trim();
        if (!raw) return '\u2014';
        if (!/^https?:\/\//i.test(raw)) return '\u2014';

        var label = raw.length > 52 ? raw.slice(0, 49) + '...' : raw;
        return linkHtml(raw, label, raw);
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

    function publishedAtFormatter(cell) {
        return parsedAtFormatter(cell);
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

    function enumDisplayFormatter(displayField, rawField, enumField) {
        return function (cell) {
            var row = getRowData(cell);
            var text = displayValue(row, displayField, rawField, enumField);
            return safeEsc(text || '-');
        };
    }

    function retrievalTypeFormatter(cell) {
        var row = getRowData(cell);
        var text = displayValue(row, 'retrieval_type_display', 'retrieval_type', 'retrieval_type');
        return safeEsc(text || 'Present scrape (same date)');
    }

    function qualityFormatter(cell) {
        var row = getRowData(cell);
        var text = displayValue(row, 'data_quality_display', 'data_quality_flag', 'data_quality_flag');
        return safeEsc(text || '-');
    }

    function depositTierFormatter(cell) {
        var row = getRowData(cell);
        var display = row && row.deposit_tier_display ? String(row.deposit_tier_display) : '';
        if (!display && row) {
            display = formatDepositTier(row.deposit_tier, row.min_balance != null ? row.min_balance : row.min_deposit, row.max_balance != null ? row.max_balance : row.max_deposit);
        }
        return safeEsc(display || String(cell.getValue() || ''));
    }

    function annualFeeFormatter(cell) {
        var v = cell.getValue();
        var n = Number(v);
        if (Number.isFinite(n)) return money(n);
        return 'Not disclosed';
    }

    function monthlyFeeFormatter(cell) {
        var v = cell.getValue();
        var n = Number(v);
        if (Number.isFinite(n)) return money(n);
        return 'Not disclosed';
    }

    function tdDepositBoundFormatter(cell) {
        var v = cell.getValue();
        var n = Number(v);
        if (Number.isFinite(n)) return money(n);

        var row = getRowData(cell) || {};
        var minMissing = row.min_deposit == null || row.min_deposit === '';
        var maxMissing = row.max_deposit == null || row.max_deposit === '';
        var tierDisplay = String(row.deposit_tier_display || row.deposit_tier || '').toLowerCase();
        if (minMissing && maxMissing && (tierDisplay === 'all balances' || tierDisplay === 'all')) {
            return 'Any amount';
        }
        return 'Not disclosed';
    }

    function conditionsFormatter(cell) {
        var row = getRowData(cell) || {};
        var base = row.conditions_display != null ? row.conditions_display : cell.getValue();
        var cleaned = cleanConditionsText(base);
        if (!cleaned) return '-';
        var shortText = truncateText(cleaned, 140);
        var cellEl = cell.getElement ? cell.getElement() : null;
        if (cellEl) cellEl.setAttribute('title', cleaned);
        return safeEsc(shortText);
    }

    var MOBILE_BREAKPOINT = 760;
    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    function getLoanColumns() {
        var narrow = isMobile();
        if (!isAnalystMode()) {
            return [
                { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
                { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
                { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
                { title: 'Comparison', field: 'comparison_rate', formatter: pctFormatter, headerSort: true, minWidth: 80 },
                { title: 'Structure', field: 'rate_structure', headerSort: true, minWidth: 90, formatter: enumDisplayFormatter('rate_structure_display', 'rate_structure', 'rate_structure') },
                { title: 'Purpose', field: 'security_purpose', headerSort: true, minWidth: 90, formatter: enumDisplayFormatter('security_purpose_display', 'security_purpose', 'security_purpose') },
                { title: 'Repayment', field: 'repayment_type', headerSort: true, minWidth: 100, formatter: enumDisplayFormatter('repayment_type_display', 'repayment_type', 'repayment_type') },
                { title: 'LVR', field: 'lvr_tier', headerSort: true, minWidth: 80, formatter: enumDisplayFormatter('lvr_tier_display', 'lvr_tier', 'lvr_tier') },
                { title: 'Product URL', field: 'product_url', headerSort: true, minWidth: 150, formatter: productUrlFormatter },
            ];
        }

        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Comparison', field: 'comparison_rate', formatter: pctFormatter, headerSort: true, minWidth: 80 },
            { title: 'Structure', field: 'rate_structure', headerSort: true, minWidth: 80, formatter: enumDisplayFormatter('rate_structure_display', 'rate_structure', 'rate_structure') },
            { title: 'Purpose', field: 'security_purpose', headerSort: true, minWidth: 80, formatter: enumDisplayFormatter('security_purpose_display', 'security_purpose', 'security_purpose') },
            { title: 'Repayment', field: 'repayment_type', headerSort: true, minWidth: 100, formatter: enumDisplayFormatter('repayment_type_display', 'repayment_type', 'repayment_type') },
            { title: 'LVR', field: 'lvr_tier', headerSort: true, minWidth: 70, formatter: enumDisplayFormatter('lvr_tier_display', 'lvr_tier', 'lvr_tier') },
            { title: 'Feature', field: 'feature_set', headerSort: true, minWidth: 70, formatter: enumDisplayFormatter('feature_set_display', 'feature_set', 'feature_set') },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120 },
            { title: 'Annual Fee', field: 'annual_fee', formatter: annualFeeFormatter, headerSort: true, minWidth: 80 },
            { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 90, formatter: qualityFormatter },
            { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 140, formatter: retrievalTypeFormatter },
            { title: 'Product URL', field: 'product_url', headerSort: true, minWidth: 150, formatter: productUrlFormatter },
            { title: 'Published At', field: 'published_at', headerSort: true, minWidth: 150, formatter: publishedAtFormatter },
            { title: 'Offer Links', field: 'source_url', headerSort: false, minWidth: 120, formatter: offerLinksFormatter },
            { title: 'Cash Rate', field: 'rba_cash_rate', formatter: pctFormatter, headerSort: true, minWidth: 80 },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, formatter: runSourceFormatter },
            { title: 'Retrieved At', field: 'retrieved_at', headerSort: true, minWidth: 150, formatter: parsedAtFormatter },
        ];
    }

    function getSavingsColumns() {
        var narrow = isMobile();
        if (!isAnalystMode()) {
            return [
                { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
                { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
                { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
                { title: 'Account Type', field: 'account_type', headerSort: true, minWidth: 100, formatter: enumDisplayFormatter('account_type_display', 'account_type', 'account_type') },
                { title: 'Rate Type', field: 'rate_type', headerSort: true, minWidth: 90, formatter: enumDisplayFormatter('rate_type_display', 'rate_type', 'rate_type') },
                { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 90, formatter: depositTierFormatter },
                { title: 'Product URL', field: 'product_url', headerSort: true, minWidth: 150, formatter: productUrlFormatter },
            ];
        }

        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Account Type', field: 'account_type', headerSort: true, minWidth: 90, formatter: enumDisplayFormatter('account_type_display', 'account_type', 'account_type') },
            { title: 'Rate Type', field: 'rate_type', headerSort: true, minWidth: 80, formatter: enumDisplayFormatter('rate_type_display', 'rate_type', 'rate_type') },
            { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 80, formatter: depositTierFormatter },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120 },
            { title: 'Conditions', field: 'conditions', headerSort: false, minWidth: 150, formatter: conditionsFormatter },
            { title: 'Monthly Fee', field: 'monthly_fee', formatter: monthlyFeeFormatter, headerSort: true, minWidth: 80 },
            { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 90, formatter: qualityFormatter },
            { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 140, formatter: retrievalTypeFormatter },
            { title: 'Product URL', field: 'product_url', headerSort: true, minWidth: 150, formatter: productUrlFormatter },
            { title: 'Published At', field: 'published_at', headerSort: true, minWidth: 150, formatter: publishedAtFormatter },
            { title: 'Offer Links', field: 'source_url', headerSort: false, minWidth: 120, formatter: offerLinksFormatter },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, formatter: runSourceFormatter },
            { title: 'Retrieved At', field: 'retrieved_at', headerSort: true, minWidth: 150, formatter: parsedAtFormatter },
        ];
    }

    function getTdColumns() {
        var narrow = isMobile();
        if (!isAnalystMode()) {
            return [
                { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
                { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
                { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
                { title: 'Term (months)', field: 'term_months', headerSort: true, minWidth: 90, formatter: enumDisplayFormatter('term_months_display', 'term_months', 'term_months') },
                { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 90, formatter: depositTierFormatter },
                { title: 'Payment', field: 'interest_payment', headerSort: true, minWidth: 100, formatter: enumDisplayFormatter('interest_payment_display', 'interest_payment', 'interest_payment') },
                { title: 'Product URL', field: 'product_url', headerSort: true, minWidth: 150, formatter: productUrlFormatter },
            ];
        }

        return [
            { title: 'Date', field: 'collection_date', headerSort: true, minWidth: 90, width: narrow ? undefined : 110, formatter: collectionDateFormatter },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 90 },
            { title: 'Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 70, width: narrow ? undefined : 90 },
            { title: 'Term (months)', field: 'term_months', headerSort: true, minWidth: 80, formatter: enumDisplayFormatter('term_months_display', 'term_months', 'term_months') },
            { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 80, formatter: depositTierFormatter },
            { title: 'Payment', field: 'interest_payment', headerSort: true, minWidth: 90, formatter: enumDisplayFormatter('interest_payment_display', 'interest_payment', 'interest_payment') },
            { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120 },
            { title: 'Min Deposit', field: 'min_deposit', formatter: tdDepositBoundFormatter, headerSort: true, minWidth: 90 },
            { title: 'Max Deposit', field: 'max_deposit', formatter: tdDepositBoundFormatter, headerSort: true, minWidth: 90 },
            { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 90, formatter: qualityFormatter },
            { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 140, formatter: retrievalTypeFormatter },
            { title: 'Product URL', field: 'product_url', headerSort: true, minWidth: 150, formatter: productUrlFormatter },
            { title: 'Published At', field: 'published_at', headerSort: true, minWidth: 150, formatter: publishedAtFormatter },
            { title: 'Offer Links', field: 'source_url', headerSort: false, minWidth: 120, formatter: offerLinksFormatter },
            { title: 'Source', field: 'run_source', headerSort: true, minWidth: 60, formatter: runSourceFormatter },
            { title: 'Retrieved At', field: 'retrieved_at', headerSort: true, minWidth: 150, formatter: parsedAtFormatter },
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
    var currentSort = { field: 'collection_date', dir: 'desc' };

    function getTableLayout() { return 'fitColumns'; }

    function normalizeSortDir(dir) {
        return String(dir || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
    }

    function parseSortersValue(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'object') {
            if (raw.field) return [raw];
            return [];
        }
        if (typeof raw === 'string') {
            var text = raw.trim();
            if (!text) return [];
            try {
                var parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return parsed;
                if (parsed && typeof parsed === 'object' && parsed.field) return [parsed];
            } catch (_err) {
                return [];
            }
        }
        return [];
    }

    function resolveSorters(params) {
        var sorters = parseSortersValue(params && params.sorters);
        if (!sorters.length) sorters = parseSortersValue(params && params.sort);

        if (!sorters.length && params && typeof params === 'object') {
            var field = params['sorters[0][field]'] || params['sort[0][field]'];
            var dir = params['sorters[0][dir]'] || params['sort[0][dir]'];
            if (field) sorters = [{ field: field, dir: dir || 'asc' }];
        }

        if (!sorters.length && params && typeof params.sort === 'string' && (params.dir === 'asc' || params.dir === 'desc')) {
            sorters = [{ field: params.sort, dir: params.dir }];
        }

        return sorters;
    }

    function applySorters(sorters) {
        if (!Array.isArray(sorters) || sorters.length === 0) return;
        var first = sorters[0] || {};
        var field = first.field;
        if (!field && first.column != null) {
            if (typeof first.column.getField === 'function') field = first.column.getField();
            else if (typeof first.column === 'string') field = first.column;
        }
        if (!field) return;
        currentSort.field = String(field);
        currentSort.dir = normalizeSortDir(first.dir);
    }

    function getCurrentSort() {
        return {
            field: currentSort.field,
            dir: currentSort.dir,
        };
    }

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
                var sorters = resolveSorters(params);
                if (!sorters.length && rateTable && rateTable.getSorters) {
                    sorters = resolveSorters({ sorters: rateTable.getSorters() });
                }
                applySorters(sorters);
                var q = new URLSearchParams();
                var fp = buildFilterParams();
                Object.keys(fp).forEach(function (k) { q.set(k, fp[k]); });
                q.set('page', String(params.page != null ? params.page : 1));
                q.set('size', '50');
                q.set('sort', currentSort.field);
                q.set('dir', currentSort.dir);

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
            dataSorting: function (sorters) {
                applySorters(sorters);
                if (rateTable && rateTable.setData) rateTable.setData();
            },
            dataSendParams: { page: 'page', size: 'size' },
            movableColumns: isAnalystMode() && !isMobile(),
            resizableColumns: isAnalystMode() && !isMobile(),
            layout: getTableLayout(),
            placeholder: 'No rate data found. Try adjusting your filters or date range.',
            columns: getRateTableColumns(),
            initialSort: [{ column: currentSort.field, dir: currentSort.dir }],
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
                rateTable.setColumns(getRateTableColumns());
                rateTable.redraw(true);
            }, 250);
        });
    }

    function applyUiMode() {
        if (!rateTable) return;
        rateTable.setColumns(getRateTableColumns());
        rateTable.redraw(true);
        reloadExplorer();
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
        applyUiMode: applyUiMode,
        getCurrentSort: getCurrentSort,
    };
})();
