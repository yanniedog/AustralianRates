(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var utils = window.AR.utils;
    var timeUtils = window.AR.time || {};
    var section = window.AR.section || 'home-loans';
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var esc = utils && utils.esc ? utils.esc : window._arEsc;
    var clientLog = utils && utils.clientLog ? utils.clientLog : function () {};

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

    window.AR.hero = { loadHeroStats: loadHeroStats };
})();
