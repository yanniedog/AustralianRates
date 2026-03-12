(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var clientLog = utils.clientLog || function () {};
    var esc = window._arEsc || function (value) { return String(value == null ? '' : value); };
    var apiBase = config && config.apiBase ? config.apiBase : '';

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

    function ymd(value) {
        var raw = String(value == null ? '' : value).trim();
        var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return match ? (match[1] + '/' + match[2] + '/' + match[3]) : (raw || '-');
    }

    function changeWindow(row) {
        var current = ymd(row.collection_date || row.changed_at);
        var previous = ymd(row.previous_collection_date || row.previous_changed_at);
        if (current === '-') return '-';
        if (previous !== '-' && previous !== current) return previous + ' -> ' + current;
        return 'Through ' + current;
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
            return (
                '<li class="rate-change-item">' +
                    '<div class="rate-change-main">' +
                        '<span class="rate-change-date">' + esc(changeWindow(row)) + '</span>' +
                        '<span class="rate-change-bank">' + esc(row.bank_name || '-') + '</span>' +
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
            var res = await fetch(apiBase + '/changes?limit=200&offset=0', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
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
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.rateChanges = {
        loadRateChanges: loadRateChanges,
    };
})();
