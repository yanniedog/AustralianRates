(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var utils = window.AR.utils || {};
    var network = window.AR.network || {};
    var els = dom && dom.els ? dom.els : {};
    var clientLog = utils.clientLog || function () {};
    var esc = window._arEsc || function (value) { return String(value == null ? '' : value); };
    var bankBrand = window.AR.bankBrand || {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var sectionConfig = window.AR.sectionConfig || {};
    var requestTimeoutMs = Number(sectionConfig.requestTimeoutMs);
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) requestTimeoutMs = 10000;
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };
    var ymd = utils.ymdDate || function (value) { return String(value == null ? '' : value).trim() || '-'; };
    var formatChangeWindow = utils.formatChangeWindow || function (previousValue, currentValue) {
        var previous = ymd(previousValue);
        var current = ymd(currentValue);
        if (current === '-') return '-';
        if (previous !== '-' && previous !== current) return previous + ' -> ' + current;
        return 'Through ' + current;
    };

    function getStatusEl() {
        return (els && els.rateChangeStatus) || document.getElementById('rate-change-status');
    }

    function getListEl() {
        return (els && els.rateChangeList) || document.getElementById('rate-change-list');
    }

    function getDetailsEl() {
        return (els && els.rateChangeDetails) || document.getElementById('rate-change-details');
    }

    function getHeadlineEl() {
        return (els && els.rateChangeHeadline) || document.getElementById('rate-change-headline');
    }

    function getWarningEl() {
        return (els && els.rateChangeWarning) || document.getElementById('rate-change-warning');
    }

    function changeWindow(row) {
        return formatChangeWindow(
            row.previous_collection_date || row.previous_changed_at,
            row.collection_date || row.changed_at,
            { missingText: '-', throughPrefix: 'Through ' }
        );
    }

    function pct(value) {
        var n = Number(value);
        return Number.isFinite(n) ? n.toFixed(3) + '%' : '-';
    }

    function detailText(row) {
        var section = window.AR.section || 'home-loans';
        if (section === 'savings') {
            return [row.account_type, row.rate_type, row.deposit_tier].filter(Boolean).join(' | ');
        }
        if (section === 'term-deposits') {
            return [row.term_months ? String(row.term_months) + 'm' : '', row.deposit_tier, row.interest_payment].filter(Boolean).join(' | ');
        }
        return [row.security_purpose, row.repayment_type, row.lvr_tier, row.rate_structure].filter(Boolean).join(' | ');
    }

    function tone(delta) {
        if (!Number.isFinite(delta)) return 'flat';
        if (delta > 0) return 'up';
        if (delta < 0) return 'down';
        return 'flat';
    }

    function renderRows(rows) {
        var listEl = getListEl();
        if (!listEl) return;
        if (!Array.isArray(rows) || rows.length === 0) {
            listEl.innerHTML = '<li class="rate-change-item-empty">No data</li>';
            return;
        }

        listEl.innerHTML = rows.map(function (row) {
            var delta = Number(row.delta_bps);
            var deltaText = Number.isFinite(delta) ? ((delta > 0 ? '+' : '') + delta.toFixed(1) + 'bps') : '';
            var bankName = String(row.bank_name || '').trim() || '-';
            var bankLabel = bankBrand && typeof bankBrand.badge === 'function'
                ? bankBrand.badge(bankName, { compact: true })
                : esc(bankName);
            return (
                '<li class="rate-change-item">' +
                    '<div class="rate-change-main">' +
                        '<span class="rate-change-date">' + esc(changeWindow(row)) + '</span>' +
                        '<span class="rate-change-bank">' + bankLabel + '</span>' +
                        (deltaText ? '<span class="rate-change-delta ' + tone(delta) + '">' + esc(deltaText) + '</span>' : '') +
                    '</div>' +
                    '<div class="rate-change-sub">' +
                        '<span class="rate-change-product">' + esc(row.product_name || '-') + '</span>' +
                        '<span class="rate-change-rates">' + esc(pct(row.previous_rate)) + ' > ' + esc(pct(row.new_rate)) + '</span>' +
                        '<span class="rate-change-detail">' + esc(detailText(row) || '-') + '</span>' +
                    '</div>' +
                '</li>'
            );
        }).join('');
    }

    function integrityText(integrity) {
        if (!integrity || typeof integrity !== 'object') return 'INT ?';
        if (integrity.ok === true) return 'INT OK';
        return 'INT ' + String(integrity.status || 'WARN').toUpperCase();
    }

    function renderHeadline(rows, total, integrity) {
        var headlineEl = getHeadlineEl();
        if (!headlineEl) return;
        var latestDate = rows && rows.length ? ymd(rows[0].collection_date || rows[0].changed_at) : 'n/a';
        headlineEl.textContent = 'Through ' + latestDate + ' | ' + total + ' changes | ' + integrityText(integrity);
    }

    function renderIntegrityWarning(integrity) {
        var warningEl = getWarningEl();
        var detailsEl = getDetailsEl();
        var isStale = !!(integrity && integrity.ok === false);
        if (detailsEl) detailsEl.classList.toggle('is-stale', isStale);
        if (!warningEl) return;
        warningEl.hidden = !isStale;
        warningEl.textContent = isStale ? ('Integrity: ' + String(integrity.summary || 'Warn')) : '';
    }

    async function loadRateChanges() {
        var listEl = getListEl();
        var statusEl = getStatusEl();
        if (!listEl || !statusEl || !apiBase) return;

        statusEl.textContent = 'WAIT';
        try {
            var data = requestJson
                ? (await requestJson(apiBase + '/changes?limit=200&offset=0', {
                    requestLabel: 'Recent changes',
                    timeoutMs: requestTimeoutMs,
                    retryCount: 1,
                    retryDelayMs: 700,
                })).data
                : await fetch(apiBase + '/changes?limit=200&offset=0', { cache: 'no-store' }).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                });
            var rows = Array.isArray(data && data.rows) ? data.rows : [];
            var integrity = data && data.integrity ? data.integrity : null;
            var total = Number(data && data.total) || rows.length;
            renderRows(rows);
            renderHeadline(rows, total, integrity);
            renderIntegrityWarning(integrity);
            statusEl.textContent = rows.length + ' rows';
        } catch (err) {
            statusEl.textContent = 'ERR';
            renderRows([]);
            renderHeadline([], 0, null);
            renderIntegrityWarning(null);
            clientLog('error', 'Rate change log load failed', {
                message: describeError(err, 'Recent changes are temporarily unavailable.'),
            });
        }
    }

    window.AR.rateChanges = {
        loadRateChanges: loadRateChanges,
    };
})();
