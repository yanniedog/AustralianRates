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
    var section = window.AR.section || (window.location.pathname.indexOf('/savings') !== -1 ? 'savings' : window.location.pathname.indexOf('/term-deposits') !== -1 ? 'term-deposits' : 'home-loans');
    var COLUMN_PREFS_KEY = 'ar_column_prefs_' + section;
    var ORDER_FIRST = ['found_at', 'comparison_rate', 'interest_rate', 'bank_name'];
    var ORDER_LAST = ['rate_confirmed_at', 'urls'];
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
        var m = raw.match(/\/web\/[^/]+\/(.+)$/i);
        var candidate = m && m[1] ? String(m[1]).trim() : '';
        if (!candidate) return '';
        if (!/^https?:\/\//i.test(candidate)) {
            try {
                candidate = decodeURIComponent(candidate);
            } catch (_) {}
        }
        return /^https?:\/\//i.test(candidate) ? candidate : '';
    }

    function waybackLookupUrl(url) {
        var raw = String(url || '').trim();
        if (!/^https?:\/\//i.test(raw)) return '';
        return WAYBACK_PREFIX + encodeURIComponent(raw);
    }

    function linkHtml(href, label, title) {
        return '<a href="' + safeHref(href) + '" target="_blank" rel="noopener noreferrer" title="' + safeEsc(title) + '">' + safeEsc(label) + '</a>';
    }

    function urlsFormatter(cell) {
        var row = getRowData(cell) || {};
        var source = String(row.source_url || '').trim();
        var product = String(row.product_url || '').trim();
        var currentUrl = isWaybackUrl(source) ? extractWaybackOriginalUrl(source) : source;
        var waybackUrl = isWaybackUrl(source) ? source : waybackLookupUrl(currentUrl || source);
        var links = [];
        var seen = {};

        function addLink(url, label) {
            if (!/^https?:\/\//i.test(String(url || ''))) return;
            if (seen[url]) return;
            seen[url] = true;
            links.push(linkHtml(url, label, url));
        }

        addLink(product, 'Product');
        addLink(currentUrl, 'Source');
        addLink(waybackUrl, 'Wayback');
        return links.length ? links.join(' &middot; ') : '\u2014';
    }

    function runSourceFormatter(cell) {
        var v = String(cell.getValue() || '');
        return v === 'manual' ? 'Manual' : 'Auto';
    }

    function pad2(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '00';
        return (n < 10 ? '0' : '') + String(Math.floor(n));
    }

    function formatYmdSlash(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return '-';

        var fromRawDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (fromRawDate) return fromRawDate[1] + '/' + fromRawDate[2] + '/' + fromRawDate[3];

        var parsed = timeUtils && typeof timeUtils.parseServerTimestamp === 'function'
            ? timeUtils.parseServerTimestamp(raw)
            : null;
        var date = parsed && parsed.ok ? parsed.date : new Date(raw);
        if (!date || !isFinite(date.getTime())) return raw;

        return date.getUTCFullYear() + '/' + pad2(date.getUTCMonth() + 1) + '/' + pad2(date.getUTCDate());
    }

    function parsedAtFormatter(cell) {
        var v = cell.getValue();
        if (!v) return '-';
        var text = formatYmdSlash(v);
        var rendered = timeUtils.formatCompactDateTime ? timeUtils.formatCompactDateTime(v) : { text: String(v), title: String(v) };
        var cellEl = cell.getElement ? cell.getElement() : null;
        if (cellEl && rendered && rendered.title) {
            cellEl.setAttribute('title', rendered.title);
        }
        return text;
    }

    function publishedAtFormatter(cell) {
        return parsedAtFormatter(cell);
    }

    function collectionDateFormatter(cell) {
        var value = cell.getValue();
        var rowData = cell.getRow && cell.getRow() ? cell.getRow().getData() : null;
        var parsedAt = rowData && rowData.parsed_at ? rowData.parsed_at : '';
        var text = formatYmdSlash(value);
        var rendered = timeUtils.formatSourceDateWithLocal
            ? timeUtils.formatSourceDateWithLocal(value, parsedAt)
            : { text: String(value || ''), title: String(value || '') };
        var cellEl = cell.getElement ? cell.getElement() : null;
        if (cellEl && rendered && rendered.title) {
            cellEl.setAttribute('title', rendered.title);
        }
        return text;
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

    function cdrJsonFormatter(cell) {
        var raw = String(cell.getValue() || '').trim();
        if (!raw) return '-';
        var shortText = truncateText(raw, 180);
        var cellEl = cell.getElement ? cell.getElement() : null;
        if (cellEl) cellEl.setAttribute('title', raw);
        return safeEsc(shortText);
    }

    var MOBILE_BREAKPOINT = 760;
    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    function sharedLeadingColumns() {
        return [
            { title: 'Found at', field: 'found_at', headerSort: true, minWidth: 126, formatter: parsedAtFormatter },
            { title: 'Comparison Rate', field: 'comparison_rate', formatter: pctFormatter, headerSort: true, minWidth: 108 },
            { title: 'Headline Rate', field: 'interest_rate', formatter: pctFormatter, headerSort: true, minWidth: 104 },
            { title: 'Bank', field: 'bank_name', headerSort: true, minWidth: 98 },
        ];
    }

    function sharedTrailingColumns() {
        return [
            { title: 'Rate Confirmed', field: 'rate_confirmed_at', headerSort: true, minWidth: 138, formatter: parsedAtFormatter },
            { title: 'URLs', field: 'urls', headerSort: false, minWidth: 160, formatter: urlsFormatter },
        ];
    }

    function getLoanColumns() {
        var base = sharedLeadingColumns();
        if (isAnalystMode()) {
            base = base.concat([
                { title: 'Snapshot Date', field: 'collection_date', headerSort: true, minWidth: 118, formatter: collectionDateFormatter },
                { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120 },
                { title: 'Product Code', field: 'product_code', headerSort: true, minWidth: 132 },
                { title: 'Structure', field: 'rate_structure', headerSort: true, minWidth: 92, formatter: enumDisplayFormatter('rate_structure_display', 'rate_structure', 'rate_structure') },
                { title: 'Purpose', field: 'security_purpose', headerSort: true, minWidth: 92, formatter: enumDisplayFormatter('security_purpose_display', 'security_purpose', 'security_purpose') },
                { title: 'Repayment', field: 'repayment_type', headerSort: true, minWidth: 104, formatter: enumDisplayFormatter('repayment_type_display', 'repayment_type', 'repayment_type') },
                { title: 'LVR', field: 'lvr_tier', headerSort: true, minWidth: 82, formatter: enumDisplayFormatter('lvr_tier_display', 'lvr_tier', 'lvr_tier') },
                { title: 'Feature', field: 'feature_set', headerSort: true, minWidth: 82, formatter: enumDisplayFormatter('feature_set_display', 'feature_set', 'feature_set') },
                { title: 'Annual Fee', field: 'annual_fee', formatter: annualFeeFormatter, headerSort: true, minWidth: 94 },
                { title: 'Cash Rate', field: 'rba_cash_rate', formatter: pctFormatter, headerSort: true, minWidth: 88 },
                { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 96, formatter: qualityFormatter },
                { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 126, formatter: retrievalTypeFormatter },
                { title: 'Source', field: 'run_source', headerSort: true, minWidth: 74, formatter: runSourceFormatter },
                { title: 'Published At', field: 'published_at', headerSort: true, minWidth: 126, formatter: publishedAtFormatter },
                { title: 'Removed At', field: 'removed_at', headerSort: true, minWidth: 126, formatter: parsedAtFormatter },
                { title: 'CDR Detail JSON', field: 'cdr_product_detail_json', headerSort: false, minWidth: 220, formatter: cdrJsonFormatter },
            ]);
        } else {
            base = base.concat([
                { title: 'Structure', field: 'rate_structure', headerSort: true, minWidth: 92, formatter: enumDisplayFormatter('rate_structure_display', 'rate_structure', 'rate_structure') },
                { title: 'Purpose', field: 'security_purpose', headerSort: true, minWidth: 92, formatter: enumDisplayFormatter('security_purpose_display', 'security_purpose', 'security_purpose') },
                { title: 'Repayment', field: 'repayment_type', headerSort: true, minWidth: 102, formatter: enumDisplayFormatter('repayment_type_display', 'repayment_type', 'repayment_type') },
                { title: 'LVR', field: 'lvr_tier', headerSort: true, minWidth: 82, formatter: enumDisplayFormatter('lvr_tier_display', 'lvr_tier', 'lvr_tier') },
            ]);
        }
        return base.concat(sharedTrailingColumns());
    }

    function getSavingsColumns() {
        var base = sharedLeadingColumns();
        if (isAnalystMode()) {
            base = base.concat([
                { title: 'Snapshot Date', field: 'collection_date', headerSort: true, minWidth: 118, formatter: collectionDateFormatter },
                { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120 },
                { title: 'Product Code', field: 'product_code', headerSort: true, minWidth: 132 },
                { title: 'Account Type', field: 'account_type', headerSort: true, minWidth: 108, formatter: enumDisplayFormatter('account_type_display', 'account_type', 'account_type') },
                { title: 'Rate Type', field: 'rate_type', headerSort: true, minWidth: 96, formatter: enumDisplayFormatter('rate_type_display', 'rate_type', 'rate_type') },
                { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 102, formatter: depositTierFormatter },
                { title: 'Conditions', field: 'conditions', headerSort: false, minWidth: 160, formatter: conditionsFormatter },
                { title: 'Monthly Fee', field: 'monthly_fee', formatter: monthlyFeeFormatter, headerSort: true, minWidth: 94 },
                { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 96, formatter: qualityFormatter },
                { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 126, formatter: retrievalTypeFormatter },
                { title: 'Source', field: 'run_source', headerSort: true, minWidth: 74, formatter: runSourceFormatter },
                { title: 'Published At', field: 'published_at', headerSort: true, minWidth: 126, formatter: publishedAtFormatter },
                { title: 'Removed At', field: 'removed_at', headerSort: true, minWidth: 126, formatter: parsedAtFormatter },
                { title: 'CDR Detail JSON', field: 'cdr_product_detail_json', headerSort: false, minWidth: 220, formatter: cdrJsonFormatter },
            ]);
        } else {
            base = base.concat([
                { title: 'Account Type', field: 'account_type', headerSort: true, minWidth: 104, formatter: enumDisplayFormatter('account_type_display', 'account_type', 'account_type') },
                { title: 'Rate Type', field: 'rate_type', headerSort: true, minWidth: 92, formatter: enumDisplayFormatter('rate_type_display', 'rate_type', 'rate_type') },
                { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 98, formatter: depositTierFormatter },
            ]);
        }
        return base.concat(sharedTrailingColumns());
    }

    function getTdColumns() {
        var base = sharedLeadingColumns();
        if (isAnalystMode()) {
            base = base.concat([
                { title: 'Snapshot Date', field: 'collection_date', headerSort: true, minWidth: 118, formatter: collectionDateFormatter },
                { title: 'Product', field: 'product_name', headerSort: true, minWidth: 120 },
                { title: 'Product Code', field: 'product_code', headerSort: true, minWidth: 132 },
                { title: 'Term (months)', field: 'term_months', headerSort: true, minWidth: 104, formatter: enumDisplayFormatter('term_months_display', 'term_months', 'term_months') },
                { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 102, formatter: depositTierFormatter },
                { title: 'Payment', field: 'interest_payment', headerSort: true, minWidth: 102, formatter: enumDisplayFormatter('interest_payment_display', 'interest_payment', 'interest_payment') },
                { title: 'Min Deposit', field: 'min_deposit', formatter: tdDepositBoundFormatter, headerSort: true, minWidth: 96 },
                { title: 'Max Deposit', field: 'max_deposit', formatter: tdDepositBoundFormatter, headerSort: true, minWidth: 96 },
                { title: 'Quality', field: 'data_quality_flag', headerSort: true, minWidth: 96, formatter: qualityFormatter },
                { title: 'Retrieval', field: 'retrieval_type', headerSort: true, minWidth: 126, formatter: retrievalTypeFormatter },
                { title: 'Source', field: 'run_source', headerSort: true, minWidth: 74, formatter: runSourceFormatter },
                { title: 'Published At', field: 'published_at', headerSort: true, minWidth: 126, formatter: publishedAtFormatter },
                { title: 'Removed At', field: 'removed_at', headerSort: true, minWidth: 126, formatter: parsedAtFormatter },
                { title: 'CDR Detail JSON', field: 'cdr_product_detail_json', headerSort: false, minWidth: 220, formatter: cdrJsonFormatter },
            ]);
        } else {
            base = base.concat([
                { title: 'Term (months)', field: 'term_months', headerSort: true, minWidth: 100, formatter: enumDisplayFormatter('term_months_display', 'term_months', 'term_months') },
                { title: 'Deposit Tier', field: 'deposit_tier', headerSort: true, minWidth: 98, formatter: depositTierFormatter },
                { title: 'Payment', field: 'interest_payment', headerSort: true, minWidth: 98, formatter: enumDisplayFormatter('interest_payment_display', 'interest_payment', 'interest_payment') },
            ]);
        }
        return base.concat(sharedTrailingColumns());
    }

    function readColumnPrefs() {
        try {
            var raw = window.localStorage.getItem(COLUMN_PREFS_KEY);
            if (!raw) return { visible: {}, showRemoved: false, moveColumnsMode: false, columnOrder: null };
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return { visible: {}, showRemoved: false, moveColumnsMode: false, columnOrder: null };
            var order = parsed.columnOrder;
            if (!Array.isArray(order)) order = null;
            return {
                visible: parsed.visible && typeof parsed.visible === 'object' ? parsed.visible : {},
                showRemoved: !!parsed.showRemoved,
                moveColumnsMode: !!parsed.moveColumnsMode,
                columnOrder: order,
            };
        } catch (_err) {
            return { visible: {}, showRemoved: false, moveColumnsMode: false, columnOrder: null };
        }
    }

    function writeColumnPrefs(next) {
        try {
            var def = { visible: {}, showRemoved: false, moveColumnsMode: false, columnOrder: null };
            var o = next && typeof next === 'object' ? next : def;
            window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify({
                visible: o.visible && typeof o.visible === 'object' ? o.visible : {},
                showRemoved: !!o.showRemoved,
                moveColumnsMode: !!o.moveColumnsMode,
                columnOrder: Array.isArray(o.columnOrder) ? o.columnOrder : null,
            }));
        } catch (_err) {}
    }

    function isRowRemoved(row) {
        var v = row && row.is_removed;
        return v === true || v === 1 || v === '1' || String(v || '').toLowerCase() === 'true';
    }

    function hasComparisonValue(value) {
        var n = Number(value);
        return Number.isFinite(n);
    }

    function isComparisonAvailable(rows) {
        if (!Array.isArray(rows) || rows.length === 0) return false;
        for (var i = 0; i < rows.length; i++) {
            if (hasComparisonValue(rows[i] && rows[i].comparison_rate)) return true;
        }
        return false;
    }

    function ensureColumnOrder(columns) {
        var mapped = {};
        var ordered = [];
        columns.forEach(function (column) {
            if (column && column.field) mapped[column.field] = column;
        });
        ORDER_FIRST.forEach(function (field) {
            if (mapped[field]) {
                ordered.push(mapped[field]);
                delete mapped[field];
            }
        });
        columns.forEach(function (column) {
            if (!column || !column.field) return;
            if (ORDER_LAST.indexOf(column.field) >= 0) return;
            if (!mapped[column.field]) return;
            ordered.push(mapped[column.field]);
            delete mapped[column.field];
        });
        ORDER_LAST.forEach(function (field) {
            if (mapped[field]) {
                ordered.push(mapped[field]);
                delete mapped[field];
            }
        });
        return ordered.length ? ordered : columns;
    }

    function applyColumnOrder(columns, orderFields) {
        if (!Array.isArray(orderFields) || orderFields.length === 0) return ensureColumnOrder(columns);
        var byField = {};
        columns.forEach(function (col) {
            if (col && col.field) byField[col.field] = col;
        });
        var ordered = [];
        orderFields.forEach(function (field) {
            if (byField[field]) {
                ordered.push(byField[field]);
                delete byField[field];
            }
        });
        Object.keys(byField).forEach(function (field) { ordered.push(byField[field]); });
        return ordered.length ? ordered : columns;
    }

    function getBaseColumns() {
        if (section === 'savings') return getSavingsColumns();
        if (section === 'term-deposits') return getTdColumns();
        return getLoanColumns();
    }

    function isColumnVisible(field) {
        if (columnPrefs.visible[field] === false) return false;
        if (columnPrefs.visible[field] === true) return true;
        if (singleValueColumns && singleValueColumns.indexOf(field) >= 0) return false;
        return true;
    }

    function getRateTableColumns() {
        var columns = getBaseColumns().slice();
        if (!comparisonAvailable) {
            columns = columns.filter(function (column) { return column.field !== 'comparison_rate'; });
        }
        columns = columns.filter(function (column) {
            return isColumnVisible(column.field);
        });
        columns = applyColumnOrder(columns, columnPrefs.columnOrder);
        return columns.length ? columns : getBaseColumns().slice(0, 1);
    }

    var rateTable = null;
    var lastMobileState = null;
    var currentSort = { field: 'collection_date', dir: 'desc' };
    var columnPrefs = readColumnPrefs();
    var singleValueColumns = [];
    var comparisonAvailable = true;
    var settingsBound = false;
    var tableOverlayObserver = null;

    function getTableLayout() { return 'fitDataStretch'; }

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

    function refreshSupportWidgets() {
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (window.AR.hero && window.AR.hero.loadHeroStats) window.AR.hero.loadHeroStats();
        if (window.AR.hero && window.AR.hero.loadQuickCompare) window.AR.hero.loadQuickCompare();
    }

    function persistColumnOrder() {
        if (!rateTable || !columnPrefs.moveColumnsMode) return;
        var cols = rateTable.getColumns ? rateTable.getColumns() : [];
        var order = [];
        for (var i = 0; i < cols.length; i++) {
            var field = cols[i] && typeof cols[i].getField === 'function' ? cols[i].getField() : null;
            if (field) order.push(field);
        }
        if (order.length > 0) {
            columnPrefs.columnOrder = order;
            writeColumnPrefs(columnPrefs);
        }
    }

    function applyColumnPreferences() {
        if (!rateTable) return;
        rateTable.setColumns(getRateTableColumns());
        rateTable.redraw(true);
        if (columnPrefs.moveColumnsMode) scheduleUpdateMoveColumnHeaders();
    }

    function rowFormatter(row) {
        var data = row && row.getData ? row.getData() : null;
        var element = row && row.getElement ? row.getElement() : null;
        if (!element) return;
        element.classList.toggle('ar-row-removed', isRowRemoved(data));
    }

    var moveColumnHeadersTimer = null;
    function scheduleUpdateMoveColumnHeaders() {
        if (moveColumnHeadersTimer) clearTimeout(moveColumnHeadersTimer);
        moveColumnHeadersTimer = setTimeout(function () {
            moveColumnHeadersTimer = null;
            updateMoveColumnHeaders();
        }, 50);
    }

    function updateMoveColumnHeaders() {
        var container = document.getElementById('rate-table');
        if (!container || !rateTable) return;
        var cols = container.querySelectorAll('.tabulator-header .tabulator-col');
        if (columnPrefs.moveColumnsMode) {
            var columnComponents = rateTable.getColumns ? rateTable.getColumns() : [];
            cols.forEach(function (colEl, idx) {
                var col = columnComponents[idx];
                var field = col && typeof col.getField === 'function' ? col.getField() : null;
                if (!field) return;
                var content = colEl.querySelector('.tabulator-col-content');
                if (!content) return;
                var existing = content.querySelector('.ar-move-col-wrap');
                if (existing) {
                    existing.remove();
                }
                var wrap = document.createElement('div');
                wrap.className = 'ar-move-col-wrap';
                var grip = document.createElement('span');
                grip.className = 'ar-move-col-grip';
                grip.setAttribute('title', 'Drag to reorder column');
                grip.setAttribute('aria-hidden', 'true');
                grip.textContent = '\u2016'; /* double vertical line: drag to reorder */
                var titleEl = content.querySelector('.tabulator-col-title');
                var titleClone = titleEl ? titleEl.cloneNode(true) : document.createElement('span');
                titleClone.classList.add('ar-move-col-title');
                var btnLeft = document.createElement('button');
                btnLeft.type = 'button';
                btnLeft.className = 'ar-move-col-btn ar-move-col-btn-left';
                btnLeft.setAttribute('aria-label', 'Move column left');
                btnLeft.textContent = '<';
                btnLeft.dataset.field = field;
                btnLeft.dataset.dir = 'left';
                var btnRight = document.createElement('button');
                btnRight.type = 'button';
                btnRight.className = 'ar-move-col-btn ar-move-col-btn-right';
                btnRight.setAttribute('aria-label', 'Move column right');
                btnRight.textContent = '>';
                btnRight.dataset.field = field;
                btnRight.dataset.dir = 'right';
                wrap.appendChild(grip);
                wrap.appendChild(titleClone);
                wrap.appendChild(btnLeft);
                wrap.appendChild(btnRight);
                content.appendChild(wrap);
                if (titleEl) titleEl.style.display = 'none';
            });
            attachMoveColumnButtonListeners(container);
            updateMoveColumnButtonsState(container);
        } else {
            cols.forEach(function (colEl) {
                var content = colEl.querySelector('.tabulator-col-content');
                if (!content) return;
                content.querySelectorAll('.ar-move-col-wrap').forEach(function (w) { w.remove(); });
                var titleEl = content.querySelector('.tabulator-col-title');
                if (titleEl) titleEl.style.display = '';
            });
        }
    }

    function attachMoveColumnButtonListeners(container) {
        if (!container) return;
        container.querySelectorAll('.ar-move-col-btn').forEach(function (btn) {
            if (btn._arMoveBound) return;
            btn._arMoveBound = true;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var field = btn.dataset.field;
                var dir = btn.dataset.dir;
                if (!rateTable || !field) return;
                var cols = rateTable.getColumns ? rateTable.getColumns() : [];
                var idx = -1;
                for (var i = 0; i < cols.length; i++) {
                    if (cols[i] && cols[i].getField && cols[i].getField() === field) { idx = i; break; }
                }
                if (idx < 0) return;
                if (dir === 'left' && idx > 0) {
                    rateTable.moveColumn && rateTable.moveColumn(cols[idx], cols[idx - 1], false);
                    persistColumnOrder();
                    scheduleUpdateMoveColumnHeaders();
                } else if (dir === 'right' && idx < cols.length - 1) {
                    rateTable.moveColumn && rateTable.moveColumn(cols[idx], cols[idx + 1], true);
                    persistColumnOrder();
                    scheduleUpdateMoveColumnHeaders();
                }
            });
        });
    }

    function updateMoveColumnButtonsState(container) {
        if (!container) return;
        var cols = container.querySelectorAll('.tabulator-header .tabulator-col');
        cols.forEach(function (colEl, idx) {
            var left = colEl.querySelector('.ar-move-col-btn-left');
            var right = colEl.querySelector('.ar-move-col-btn-right');
            if (left) {
                left.disabled = idx === 0;
            }
            if (right) {
                right.disabled = idx === cols.length - 1;
            }
        });
    }

    function renderSettingsPopover() {
        if (!els.tableSettingsPopover) return;
        var columns = getBaseColumns();
        var seen = {};
        var items = [];

        columns.forEach(function (column) {
            if (!column || !column.field || seen[column.field]) return;
            seen[column.field] = true;
            var disabled = column.field === 'comparison_rate' && !comparisonAvailable;
            var checked = !disabled && isColumnVisible(column.field);
            items.push(
                '<label class=\"table-settings-item\">' +
                    '<input type=\"checkbox\" data-field=\"' + safeEsc(column.field) + '\"' +
                    (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
                    '<span>' + safeEsc(column.title || column.field) + '</span>' +
                '</label>'
            );
        });

        els.tableSettingsPopover.innerHTML = '' +
            '<div class=\"table-settings-section\">' +
                '<label class=\"table-settings-item\">' +
                    '<input type=\"checkbox\" data-setting=\"show-removed\"' + (columnPrefs.showRemoved ? ' checked' : '') + '>' +
                    '<span>Show removed rates</span>' +
                '</label>' +
                '<label class=\"table-settings-item\">' +
                    '<input type=\"checkbox\" data-setting=\"move-columns\"' + (columnPrefs.moveColumnsMode ? ' checked' : '') + '>' +
                    '<span>Move columns</span>' +
                '</label>' +
            '</div>' +
            '<div class=\"table-settings-section\">' +
                '<p class=\"table-settings-title\">Visible columns</p>' +
                (items.length ? items.join('') : '<p class=\"table-settings-empty\">No configurable columns.</p>') +
            '</div>';
    }

    function setSettingsOpen(open) {
        if (!els.tableSettingsBtn || !els.tableSettingsPopover) return;
        var next = !!open;
        els.tableSettingsPopover.hidden = !next;
        els.tableSettingsBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
        if (next) renderSettingsPopover();
    }

    function bindSettingsUi() {
        if (settingsBound) return;
        settingsBound = true;
        if (!els.tableSettingsBtn || !els.tableSettingsPopover) return;

        els.tableSettingsBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            setSettingsOpen(els.tableSettingsPopover.hidden);
        });

        els.tableSettingsPopover.addEventListener('click', function (event) {
            event.stopPropagation();
        });

        els.tableSettingsPopover.addEventListener('change', function (event) {
            var target = event.target;
            if (!target) return;
            var setting = target.getAttribute('data-setting');
            if (setting === 'show-removed') {
                columnPrefs.showRemoved = !!target.checked;
                writeColumnPrefs(columnPrefs);
                refreshSupportWidgets();
                reloadExplorer();
                renderSettingsPopover();
                return;
            }
            if (setting === 'move-columns') {
                columnPrefs.moveColumnsMode = !!target.checked;
                writeColumnPrefs(columnPrefs);
                setSettingsOpen(false);
                initRateTable();
                return;
            }

            var field = target.getAttribute('data-field');
            if (!field) return;
            columnPrefs.visible[field] = !!target.checked;
            writeColumnPrefs(columnPrefs);
            applyColumnPreferences();
            renderSettingsPopover();
        });

        document.addEventListener('click', function (event) {
            if (!els.tableSettingsPopover || els.tableSettingsPopover.hidden) return;
            var target = event.target;
            if (els.tableSettingsBtn.contains(target)) return;
            if (els.tableSettingsPopover.contains(target)) return;
            setSettingsOpen(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (!els.tableSettingsPopover || els.tableSettingsPopover.hidden) return;
            setSettingsOpen(false);
        });
    }

    function initRateTable() {
        if (tableOverlayObserver) {
            try { tableOverlayObserver.disconnect(); } catch (_) {}
            tableOverlayObserver = null;
        }
        if (rateTable) {
            try { rateTable.destroy(); } catch (_) {}
            rateTable = null;
            clientLog('warn', 'Explorer table re-init: previous table destroyed', {});
        }
        lastMobileState = isMobile();
        columnPrefs = readColumnPrefs();
        comparisonAvailable = true;
        singleValueColumns = [];
        bindSettingsUi();
        renderSettingsPopover();
        clientLog('info', 'Explorer table init start', {
            section: window.AR.section || 'home-loans',
        });

        var apiBase = (config && config.apiBase) ? config.apiBase : (window.location.origin + (window.AR.sectionConfig && window.AR.sectionConfig.apiPath ? window.AR.sectionConfig.apiPath : '/api/home-loan-rates'));
        fetch(apiBase + '/filters').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
            if (!data || !data.filters || !Array.isArray(data.filters.single_value_columns)) return;
            singleValueColumns = data.filters.single_value_columns;
            if (rateTable) {
                applyColumnPreferences();
                renderSettingsPopover();
            }
        }).catch(function () {});

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
                try {
                    var rows = response && Array.isArray(response.data) ? response.data : [];
                    var nextComparisonAvailable = isComparisonAvailable(rows);
                    if (nextComparisonAvailable !== comparisonAvailable) {
                        comparisonAvailable = nextComparisonAvailable;
                        setTimeout(function () {
                            applyColumnPreferences();
                            renderSettingsPopover();
                        }, 0);
                    }
                    (function logIfSuspiciousCellValues(dataRows) {
                        var suspicious = /undefined|^\s*nan\s*$|^\s*null\s*$|^\s*error\s*$/i;
                        var samples = [];
                        for (var r = 0; r < Math.min(dataRows.length, 100); r++) {
                            var row = dataRows[r];
                            if (!row || typeof row !== 'object') continue;
                            for (var key in row) {
                                if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
                                var v = row[key];
                                if (v === undefined || v === null) continue;
                                var s = String(v).trim();
                                if (suspicious.test(s) || s === 'undefined' || s === 'NaN') {
                                    samples.push({ rowIndex: r, field: key, value: s.slice(0, 80) });
                                    if (samples.length >= 5) break;
                                }
                            }
                            if (samples.length >= 5) break;
                        }
                        if (samples.length > 0) {
                            clientLog('error', 'EXPLORER_TABLE_ABNORMALITY: Suspicious cell value(s) in table', { sample: samples });
                        }
                    })(rows);
                    clientLog('info', 'Explorer data loaded', {
                        rows: rows.length,
                        total: response && response.total != null ? Number(response.total) : 0,
                    });
                    // Return full object so Tabulator gets pagination metadata and clears the loading overlay.
                    var lastPage = response && response.last_page != null ? Number(response.last_page) : 1;
                    var total = response && response.total != null ? Number(response.total) : rows.length;
                    return { last_page: Math.max(1, lastPage), last_row: total, data: rows };
                } catch (e) {
                    var errMsg = e && e.message ? e.message : String(e);
                    clientLog('error', 'EXPLORER_TABLE_ABNORMALITY: Explorer data response processing failed', { message: errMsg });
                    if (typeof console !== 'undefined' && console.error) console.error('EXPLORER_TABLE_ABNORMALITY: ajaxResponse threw', e);
                    return { last_page: 1, last_row: 0, data: [] };
                }
            },
            ajaxError: function (xhr, textStatus, errorThrown) {
                var errData = { status: xhr && xhr.status ? xhr.status : null, textStatus: textStatus || null, message: errorThrown ? String(errorThrown) : null };
                clientLog('error', 'EXPLORER_TABLE_ABNORMALITY: Explorer data load failed', errData);
                if (typeof console !== 'undefined' && console.error) console.error('EXPLORER_TABLE_ABNORMALITY: Explorer data load failed', errData);
                if (rateTable) {
                    try {
                        hideTableLoader('ajaxError');
                        rateTable.setData([]);
                        var placeholder = rateTable.element.querySelector('.tabulator-placeholder');
                        if (placeholder) {
                            placeholder.style.display = 'block';
                        }
                    } catch (_e) {}
                }
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
            dataReceiveParams: { last_row: 'total' },
            movableColumns: (isAnalystMode() && !isMobile()) || columnPrefs.moveColumnsMode,
            resizableColumns: isAnalystMode() && !isMobile(),
            dataLoader: false,
            layout: getTableLayout(),
            layoutColumnsOnNewData: true,
            placeholder: 'No rate data found. Try adjusting your filters or date range.',
            rowFormatter: rowFormatter,
            columns: getRateTableColumns(),
            initialSort: [{ column: currentSort.field, dir: currentSort.dir }],
        });
        function hideTableLoader(reason) {
            var container = document.getElementById('rate-table');
            if (!container) return;
            var removedCount = 0;
            var samples = [];
            var sawLoadingOverlay = false;
            container.querySelectorAll('.tabulator-loader, .tabulator-loader-msg, [class*="tabulator-loading"], .tabulator-alert').forEach(function (el) {
                var text = (el.textContent || '').trim();
                if (samples.length < 3 && text) samples.push(text.slice(0, 80));
                if (/^\s*loading\s*$/i.test(text) || /\bloading\b/i.test(text)) sawLoadingOverlay = true;
                el.style.display = 'none';
                removedCount += 1;
            });
            container.querySelectorAll('.tabulator-table').forEach(function (tableBody) {
                var loadingEl = tableBody.querySelector ? tableBody.querySelector('[class*="loader"], [class*="loading"]') : null;
                if (loadingEl && (loadingEl.textContent || '').trim().toLowerCase().indexOf('loading') !== -1) {
                    loadingEl.style.display = 'none';
                    removedCount += 1;
                    sawLoadingOverlay = true;
                    if (samples.length < 3) samples.push('Loading');
                }
            });
            var rowCount = container.querySelectorAll('.tabulator-row').length;
            var placeholder = container.querySelector('.tabulator-placeholder');
            if (rowCount === 0 && placeholder) placeholder.style.display = 'block';
            var placeholderText = placeholder ? String(placeholder.textContent || '').trim() : '';
            var isNoDataState = !!placeholderText && placeholderText.indexOf('No rate data found') !== -1;
            if (removedCount > 0 && sawLoadingOverlay && isNoDataState) {
                clientLog('error', 'EXPLORER_TABLE_ABNORMALITY: Stale loading/error overlay detected in table', {
                    reason: reason || 'unknown',
                    removedCount: removedCount,
                    sample: samples,
                });
            }
        }
        function scheduleHideTableLoader() {
            [0, 50, 150, 300].forEach(function (ms) {
                setTimeout(function () { hideTableLoader('deferred'); }, ms);
            });
        }
        var tableContainer = document.getElementById('rate-table');
        if (tableContainer && typeof MutationObserver !== 'undefined') {
            tableOverlayObserver = new MutationObserver(function () { hideTableLoader('mutation'); });
            tableOverlayObserver.observe(tableContainer, { childList: true, subtree: true });
        }
        [0, 100, 300, 700].forEach(function (ms) {
            setTimeout(function () { hideTableLoader('init'); }, ms);
        });
        if (columnPrefs.moveColumnsMode) {
            [100, 300].forEach(function (ms) {
                setTimeout(function () { scheduleUpdateMoveColumnHeaders(); }, ms);
            });
        }
        rateTable.on('columnMoved', function () {
            persistColumnOrder();
            scheduleUpdateMoveColumnHeaders();
        });
        rateTable.on('dataLoaded', function () {
            hideTableLoader('dataLoaded');
            scheduleHideTableLoader();
            var container = document.getElementById('rate-table');
            if (!container) return;
            var titles = [];
            container.querySelectorAll('.tabulator-col-title').forEach(function (el) {
                var t = (el.textContent || '').trim();
                if (t) titles.push(t);
            });
            var bad = titles.filter(function (t) { return t.indexOf('::') !== -1; });
            if (bad.length > 0) {
                clientLog('error', 'EXPLORER_TABLE_ABNORMALITY: Column header(s) contain double colon', { sample: bad.slice(0, 10) });
            }
        });
        rateTable.on('dataProcessed', scheduleHideTableLoader);
        rateTable.on('renderComplete', function () {
            scheduleHideTableLoader();
            if (columnPrefs.moveColumnsMode) scheduleUpdateMoveColumnHeaders();
        });
        rateTable.on('pageLoaded', scheduleHideTableLoader);
        clientLog('info', 'Explorer table init complete');

        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                if (!rateTable) return;
                var narrow = isMobile();
                if (narrow === lastMobileState) return;
                lastMobileState = narrow;
                applyColumnPreferences();
            }, 250);
        });
    }

    function applyUiMode() {
        if (!rateTable) return;
        setSettingsOpen(false);
        applyColumnPreferences();
        renderSettingsPopover();
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

    window.addEventListener('error', function (event) {
        var target = event && event.target;
        var inTable = (target && target.nodeType === 1 && document.getElementById('rate-table') && document.getElementById('rate-table').contains(target)) || (event.filename && (String(event.filename).indexOf('ar-explorer') !== -1 || String(event.filename).indexOf('tabulator') !== -1));
        if (!inTable && event.message) {
            var stack = (event.error && event.error.stack) ? event.error.stack : '';
            inTable = stack.indexOf('ar-explorer') !== -1 || stack.indexOf('tabulator') !== -1 || stack.indexOf('Tabulator') !== -1;
        }
        if (inTable || (event.message && /rate-table|explorer|tabulator/i.test(event.message))) {
            var data = { message: event.message || null, filename: event.filename || null, lineno: event.lineno != null ? event.lineno : null, colno: event.colno != null ? event.colno : null };
            if (event.error && event.error.stack) data.stack = event.error.stack;
            clientLog('error', 'EXPLORER_TABLE_ABNORMALITY: Uncaught error in table context', data);
            if (typeof console !== 'undefined' && console.error) console.error('EXPLORER_TABLE_ABNORMALITY: Uncaught error in table context', event.error || event.message, data);
        }
    });
})();
