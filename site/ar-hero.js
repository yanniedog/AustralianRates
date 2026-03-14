(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var utils = window.AR.utils || {};
    var timeUtils = window.AR.time || {};
    var section = window.AR.section || 'home-loans';
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var pct = utils.pct || function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var clientLog = utils.clientLog || function () {};
    var bankBrand = window.AR.bankBrand || {};
    var uiIcons = (window.AR && window.AR.uiIcons) ? window.AR.uiIcons : {};
    var iconText = typeof uiIcons.text === 'function'
        ? uiIcons.text
        : function (_icon, label, className, textClassName) {
            var classes = ['ar-icon-label'];
            if (className) classes.push(className);
            return '' +
                '<span class="' + classes.join(' ') + '">' +
                    '<span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span>' +
                '</span>';
        };
    var QUICK_COMPARE_LIMIT = 20;
    var ladderRows = [];
    var publicIntro = window.AR.publicIntro || null;

    function syncPublicIntro() {
        publicIntro = window.AR.publicIntro || publicIntro;
        return publicIntro;
    }

    function setIntroMetric(id, value, note) {
        var intro = syncPublicIntro();
        if (!intro || typeof intro.setLiveMetric !== 'function') return;
        intro.setLiveMetric(id, value, note);
    }

    function renderStat(el, icon, label, value, help) {
        if (!el) return;
        el.innerHTML = '<span class="metric-code">' + iconText(icon, label) + '</span><strong>' + esc(value) + '</strong>';
        if (help) el.setAttribute('data-help', help);
    }

    function setInlineError(el, message) {
        var text = String(message || '').trim();
        if (!el) return;
        el.textContent = text;
        el.hidden = !text;
    }

    function setStatUnavailable(el) {
        var valueEl;
        if (!el) return;
        valueEl = el.querySelector('strong');
        if (valueEl) valueEl.textContent = 'Unavailable';
    }

    function clearHeroError() {
        setInlineError(els.heroError, '');
    }

    function showHeroError() {
        setInlineError(els.heroError, 'Overview metrics are temporarily unavailable. Refresh to try again.');
        [els.statUpdated, els.statCashRate, els.statRecords].forEach(setStatUnavailable);
        setIntroMetric('updated', 'Unavailable', 'Latest collection could not be loaded.');
        setIntroMetric('rows', 'Unavailable', 'Slice counts are temporarily unavailable.');
    }

    async function loadHeroStats() {
        if (!apiBase) {
            showHeroError();
            return;
        }
        clearHeroError();
        try {
            var query = new URLSearchParams({ page: '1', size: '1', sort: 'collection_date', dir: 'desc' });
            var filterParams = buildFilterParams();
            Object.keys(filterParams || {}).forEach(function (key) {
                query.set(key, filterParams[key]);
            });
            var ratesRes = await fetch(apiBase + '/rates?' + query.toString(), { cache: 'no-store' });
            if (!ratesRes.ok) throw new Error('HTTP ' + ratesRes.status + ' for /rates');
            var ratesData = await ratesRes.json();
            if (!ratesData || ratesData.total == null) return;

            var total = Number(ratesData.total || 0);
            renderStat(els.statRecords, 'rows', 'Rows', total.toLocaleString(), 'Total rows in the active slice.');
            setIntroMetric('rows', total.toLocaleString(), 'Rows in the current filtered slice.');

            if (ratesData.data && ratesData.data.length > 0) {
                var latest = ratesData.data[0];
                if (els.statUpdated && latest.collection_date) {
                    var renderedDate = timeUtils.formatSourceDateWithLocal
                        ? timeUtils.formatSourceDateWithLocal(latest.collection_date, latest.parsed_at)
                        : { text: String(latest.collection_date) };
                    renderStat(els.statUpdated, 'calendar', 'Updated', renderedDate.text, renderedDate.title || 'Last collection date in the active slice.');
                    setIntroMetric('updated', renderedDate.text, 'Latest collection in the current filtered slice.');
                }
                if (section === 'home-loans' && els.statCashRate && latest.rba_cash_rate != null) {
                    renderStat(els.statCashRate, 'stats', 'Cash rate', pct(latest.rba_cash_rate), 'Current RBA cash rate.');
                } else if (els.statCashRate) {
                    renderStat(els.statCashRate, 'continuity', 'Series continuity', 'Healthy', 'Series continuity by canonical product_key.');
                }
            }
        } catch (err) {
            showHeroError();
            clientLog('error', 'Hero stats load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    function sortRows(rows) {
        var bestIsLowest = section === 'home-loans';
        return rows.slice().sort(function (a, b) {
            var aRate = Number(a && a.interest_rate);
            var bRate = Number(b && b.interest_rate);
            if (!Number.isFinite(aRate) && !Number.isFinite(bRate)) return 0;
            if (!Number.isFinite(aRate)) return 1;
            if (!Number.isFinite(bRate)) return -1;
            return bestIsLowest ? aRate - bRate : bRate - aRate;
        });
    }

    function ladderCard(row) {
        var bankName = String(row.bank_name || '').trim() || '-';
        var bank = bankBrand && typeof bankBrand.badge === 'function'
            ? bankBrand.badge(bankName, { compact: true })
            : esc(bankName);
        var product = esc(row.product_name || '-');
        var rate = pct(row.interest_rate);
        var detail = section === 'home-loans'
            ? [row.security_purpose, row.repayment_type, row.rate_structure, row.lvr_tier].filter(Boolean).join(' · ')
            : section === 'savings'
                ? [row.account_type, row.rate_type, row.deposit_tier].filter(Boolean).join(' · ')
                : [row.term_months ? row.term_months + 'm' : '', row.deposit_tier, row.interest_payment].filter(Boolean).join(' · ');

        return '' +
            '<article class="ladder-card" data-bank="' + esc(bankName.toLowerCase()) + '" data-product="' + product.toLowerCase() + '">' +
                '<div class="ladder-card-top">' +
                    '<strong class="ladder-rate">' + esc(rate) + '</strong>' +
                    '<span class="ladder-bank">' + bank + '</span>' +
                '</div>' +
                '<div class="ladder-card-bottom">' +
                    '<span class="ladder-product">' + product + '</span>' +
                    '<span class="ladder-detail">' + esc(detail || '-') + '</span>' +
                '</div>' +
            '</article>';
    }

    function renderQuickCompareCards(rows) {
        if (!els.quickCompareCards) return;
        if (!rows.length) {
            els.quickCompareCards.innerHTML = '<p class="quick-empty">No match</p>';
            return;
        }
        els.quickCompareCards.innerHTML = rows.map(ladderCard).join('');
    }

    function applyLadderSearch() {
        if (!els.quickCompareCards) return;
        var needle = String(els.ladderSearch && els.ladderSearch.value || '').trim().toLowerCase();
        if (!needle) {
            renderQuickCompareCards(ladderRows);
            return;
        }
        renderQuickCompareCards(ladderRows.filter(function (row) {
            var bank = String(row.bank_name || '').toLowerCase();
            var product = String(row.product_name || '').toLowerCase();
            return bank.indexOf(needle) >= 0 || product.indexOf(needle) >= 0;
        }));
    }

    async function loadQuickCompare() {
        if (!els.quickCompareCards || !apiBase) {
            if (els.quickCompareCards && !apiBase) els.quickCompareCards.innerHTML = '<p class="quick-empty">Unavailable</p>';
            setIntroMetric('leader', 'Unavailable', 'Current leader data could not be loaded.');
            return;
        }
        try {
            var params = buildFilterParams();
            params.limit = String(QUICK_COMPARE_LIMIT);
            params.order_by = 'rate_desc';
            var response = await fetch(apiBase + '/latest?' + new URLSearchParams(params).toString(), { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for /latest');
            var data = await response.json();
            ladderRows = sortRows(Array.isArray(data && data.rows) ? data.rows : []);
            applyLadderSearch();
            if (ladderRows.length > 0) {
                var lead = ladderRows[0];
                var leadBank = bankBrand && typeof bankBrand.shortLabel === 'function'
                    ? bankBrand.shortLabel(lead.bank_name)
                    : String(lead.bank_name || '').trim();
                setIntroMetric('leader', pct(lead.interest_rate), (leadBank || 'Current leader') + ' in the active slice.');
            } else {
                setIntroMetric('leader', 'No match', 'Adjust filters to find current leaders.');
            }
        } catch (err) {
            clientLog('error', 'Quick compare load failed', {
                message: err && err.message ? err.message : String(err),
            });
            if (els.quickCompareCards) els.quickCompareCards.innerHTML = '<p class="quick-empty">Unavailable</p>';
            setIntroMetric('leader', 'Unavailable', 'Current leader data could not be loaded.');
        }
    }

    if (els.ladderSearch) {
        els.ladderSearch.addEventListener('input', applyLadderSearch);
    }

    window.AR.hero = {
        loadHeroStats: loadHeroStats,
        loadQuickCompare: loadQuickCompare,
    };
})();
