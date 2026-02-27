(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var clientLog = typeof utils.clientLog === 'function' ? utils.clientLog : function () {};
    var esc = window._arEsc || function (v) { return String(v == null ? '' : v); };
    var apiBase = config && config.apiBase ? config.apiBase : '';

    function getStatusEl() {
        return (els && els.rateChangeStatus) || document.getElementById('rate-change-status');
    }

    function getListEl() {
        return (els && els.rateChangeList) || document.getElementById('rate-change-list');
    }

    function ymd(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return '-';
        var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[1] + '/' + m[2] + '/' + m[3];
        return raw;
    }

    function pct(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(3) + '%';
    }

    function detailText(row) {
        var section = window.AR.section || 'home-loans';
        if (section === 'savings') {
            return [
                String(row.account_type || '').trim(),
                String(row.rate_type || '').trim(),
                String(row.deposit_tier || '').trim()
            ].filter(Boolean).join(' | ');
        }
        if (section === 'term-deposits') {
            return [
                String(row.term_months || '').trim() ? String(row.term_months).trim() + 'm' : '',
                String(row.deposit_tier || '').trim(),
                String(row.interest_payment || '').trim()
            ].filter(Boolean).join(' | ');
        }
        return [
            String(row.security_purpose || '').trim(),
            String(row.repayment_type || '').trim(),
            String(row.lvr_tier || '').trim(),
            String(row.rate_structure || '').trim()
        ].filter(Boolean).join(' | ');
    }

    function renderRows(rows) {
        var listEl = getListEl();
        if (!listEl) return;
        if (!Array.isArray(rows) || rows.length === 0) {
            listEl.innerHTML = '<li class="rate-change-item-empty">No rate changes logged yet.</li>';
            return;
        }

        var html = rows.map(function (row) {
            var bank = esc(row.bank_name || '');
            var product = esc(row.product_name || '');
            var fromRate = pct(row.previous_rate);
            var toRate = pct(row.new_rate);
            var date = ymd(row.collection_date || row.changed_at);
            var detail = esc(detailText(row));
            var delta = Number(row.delta_bps);
            var dirClass = Number.isFinite(delta) ? (delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat')) : 'flat';
            var deltaText = Number.isFinite(delta) ? ((delta > 0 ? '+' : '') + delta.toFixed(1) + ' bps') : '';
            return (
                '<li class="rate-change-item">' +
                    '<div class="rate-change-main">' +
                        '<span class="rate-change-date">' + esc(date) + '</span>' +
                        '<span class="rate-change-bank">' + bank + '</span>' +
                        '<span class="rate-change-product">' + product + '</span>' +
                    '</div>' +
                    '<div class="rate-change-sub">' +
                        '<span class="rate-change-rates">' + esc(fromRate) + ' -> ' + esc(toRate) + '</span>' +
                        (deltaText ? '<span class="rate-change-delta ' + dirClass + '">' + esc(deltaText) + '</span>' : '') +
                        (detail ? '<span class="rate-change-detail">' + detail + '</span>' : '') +
                    '</div>' +
                '</li>'
            );
        }).join('');
        listEl.innerHTML = html;
    }

    async function loadRateChanges() {
        var listEl = getListEl();
        var statusEl = getStatusEl();
        if (!listEl || !statusEl || !apiBase) {
            clientLog('error', 'RATE_CHANGE_LOG_ABNORMALITY: Missing DOM container or API base', {
                hasList: !!listEl,
                hasStatus: !!statusEl,
                hasApiBase: !!apiBase
            });
            return;
        }
        if (statusEl) statusEl.textContent = 'Loading latest rate changes...';
        try {
            var res = await fetch(apiBase + '/changes?limit=200&offset=0', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            var rows = Array.isArray(data && data.rows) ? data.rows : [];
            renderRows(rows);
            if (statusEl) {
                var total = Number(data && data.total) || rows.length;
                statusEl.textContent = 'Showing latest ' + rows.length + ' changes (' + total + ' total tracked).';
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = 'Rate change log unavailable right now.';
            renderRows([]);
            clientLog('error', 'Rate change log load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.rateChanges = {
        loadRateChanges: loadRateChanges,
    };
})();
