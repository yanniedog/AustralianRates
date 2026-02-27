(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var state = window.AR.state;
    var utils = window.AR.utils;
    var timeUtils = window.AR.time || {};
    var section = window.AR.section || 'home-loans';
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var isAnalystMode = state && typeof state.isAnalystMode === 'function'
        ? state.isAnalystMode
        : function () { return false; };
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var esc = utils && utils.esc ? utils.esc : window._arEsc;
    var clientLog = utils && utils.clientLog ? utils.clientLog : function () {};
    var QUICK_COMPARE_LIMIT = 1000;

    async function loadHeroStats() {
        clientLog('info', 'Hero stats load started', { section: section });
        try {
            var baseParams = { page: '1', size: '1', sort: 'collection_date', dir: 'desc' };
            var filterParams = buildFilterParams();
            var query = new URLSearchParams(baseParams);
            Object.keys(filterParams || {}).forEach(function (key) {
                query.set(key, filterParams[key]);
            });
            var ratesRes = await fetch(apiBase + '/rates?' + query.toString());
            if (!ratesRes.ok) throw new Error('HTTP ' + ratesRes.status + ' for /rates');
            var ratesData = await ratesRes.json();
                if (ratesData && ratesData.total != null) {
                var total = Number(ratesData.total || 0);
                if (els.statRecords) {
                    els.statRecords.innerHTML = 'Records: <strong>' + total.toLocaleString() + '</strong>';
                }
                if (ratesData.data && ratesData.data.length > 0) {
                    var latest = ratesData.data[0];
                    if (els.statUpdated && latest.collection_date) {
                        var renderedDate = timeUtils.formatSourceDateWithLocal
                            ? timeUtils.formatSourceDateWithLocal(latest.collection_date, latest.parsed_at)
                            : { text: String(latest.collection_date) };
                        els.statUpdated.innerHTML = 'Last updated: <strong>' + esc(renderedDate.text) + '</strong>';
                        if (renderedDate.title) {
                            els.statUpdated.setAttribute('title', renderedDate.title);
                        }
                    }
                    if (section === 'home-loans' && els.statCashRate && latest.rba_cash_rate != null) {
                        els.statCashRate.innerHTML = 'RBA Cash Rate: <strong>' + pct(latest.rba_cash_rate) + '</strong>';
                    }
                    clientLog('info', 'Hero stats loaded', {
                        total: total,
                        latestDate: latest.collection_date || null,
                    });
                }
            } else {
                clientLog('warn', 'Hero stats response missing total');
            }
        } catch (err) {
            clientLog('error', 'Hero stats load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    function getFiniteNumbers(rows, field) {
        var values = [];
        for (var i = 0; i < rows.length; i++) {
            var val = rows[i] && rows[i][field];
            if (val == null) continue;
            var n = Number(val);
            if (Number.isFinite(n)) values.push(n);
        }
        return values;
    }

    function median(values) {
        if (!values.length) return null;
        var sorted = values.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
        return sorted[mid];
    }

    function renderQuickCompareCards(rows, trackedTotal, limited) {
        if (!els.quickCompareCards) return;

        if (isAnalystMode()) {
            els.quickCompareCards.innerHTML = '';
            return;
        }

        if (!rows.length) {
            els.quickCompareCards.innerHTML = '<p class="quick-empty">No matching products for current filters.</p>';
            return;
        }

        var interestRates = getFiniteNumbers(rows, 'interest_rate');
        var bestIsLowest = section === 'home-loans';
        var bestRate = interestRates.length
            ? (bestIsLowest ? Math.min.apply(null, interestRates) : Math.max.apply(null, interestRates))
            : null;
        var medRate = median(interestRates);

        var topRateLabel = section === 'term-deposits' ? 'Best term deposit rate' : 'Best headline rate';
        var topRateNote = bestIsLowest
            ? 'Lowest current interest rate in filtered results'
            : 'Highest current interest rate in filtered results';
        var cards = [
            {
                label: topRateLabel,
                value: bestRate == null ? '-' : pct(bestRate),
                note: topRateNote,
            },
            {
                label: section === 'home-loans' ? 'Median mortgage rate' : 'Median rate',
                value: medRate == null ? '-' : pct(medRate),
                note: 'Middle rate across visible product set',
            },
            {
                label: 'Tracked products',
                value: Number.isFinite(Number(trackedTotal)) ? Number(trackedTotal).toLocaleString() : String(rows.length),
                note: limited
                    ? 'Current products matching your filters (quick compare limited to top ' + QUICK_COMPARE_LIMIT.toLocaleString() + ')'
                    : 'Current products matching your filters',
            },
        ];

        if (section === 'home-loans') {
            var comparisonRates = getFiniteNumbers(rows, 'comparison_rate');
            var bestComparison = comparisonRates.length ? Math.min.apply(null, comparisonRates) : null;
            cards[1] = {
                label: 'Best comparison rate',
                value: bestComparison == null ? '-' : pct(bestComparison),
                note: 'Lowest comparison rate where disclosed',
            };
        }

        els.quickCompareCards.innerHTML = cards.map(function (card) {
            return '' +
                '<article class="quick-card">' +
                    '<p class="quick-label">' + esc(card.label) + '</p>' +
                    '<p class="quick-value">' + esc(card.value) + '</p>' +
                    '<p class="quick-note">' + esc(card.note) + '</p>' +
                '</article>';
        }).join('');
    }

    async function loadQuickCompare() {
        if (!els.quickCompareCards) return;
        if (isAnalystMode()) {
            renderQuickCompareCards([], 0, false);
            return;
        }

        clientLog('info', 'Quick compare load started', { section: section });
        try {
            var latestParams = buildFilterParams();
            latestParams.limit = String(QUICK_COMPARE_LIMIT);
            latestParams.order_by = 'rate_desc';
            var latestQuery = new URLSearchParams(latestParams);
            var response = await fetch(apiBase + '/latest?' + latestQuery.toString());
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for /latest');

            var data = await response.json();
            var rows = data && Array.isArray(data.rows) ? data.rows : [];
            // total = count of current products matching filters (from /latest); fallback to rows.length if API does not return total
            var trackedTotal = data && data.total != null ? Number(data.total) : rows.length;
            var limited = rows.length >= QUICK_COMPARE_LIMIT;
            renderQuickCompareCards(rows, trackedTotal, limited);
            clientLog('info', 'Quick compare load complete', { count: rows.length, trackedTotal: trackedTotal, limited: limited });
        } catch (err) {
            clientLog('error', 'Quick compare load failed', {
                message: err && err.message ? err.message : String(err),
            });
            els.quickCompareCards.innerHTML = '<p class="quick-empty">Quick compare is unavailable right now.</p>';
        }
    }

    window.AR.hero = {
        loadHeroStats: loadHeroStats,
        loadQuickCompare: loadQuickCompare,
    };
})();
