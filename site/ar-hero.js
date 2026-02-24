(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var utils = window.AR.utils;
    var section = window.AR.section || 'home-loans';
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var pct = utils && utils.pct ? utils.pct : function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var esc = utils && utils.esc ? utils.esc : window._arEsc;

    async function loadHeroStats() {
        try {
            var ratesRes = await fetch(apiBase + '/rates?' + new URLSearchParams({ page: '1', size: '1', sort: 'collection_date', dir: 'desc' }));
            var ratesData = await ratesRes.json();
            if (ratesData && ratesData.total != null) {
                if (els.statRecords) {
                    var total = Number(ratesData.total || 0);
                    var meta = ratesData.meta || {};
                    var mix = meta.source_mix || {};
                    var scheduled = Number(mix.scheduled || 0);
                    var manual = Number(mix.manual || 0);
                    var mode = meta.source_mode || 'all';
                    var mixText = ' (mode: ' + esc(mode) + ', scheduled ' + scheduled.toLocaleString() + ', manual ' + manual.toLocaleString() + ')';
                    els.statRecords.innerHTML = 'Records: <strong>' + total.toLocaleString() + '</strong><span class="hint">' + mixText + '</span>';
                }
                if (ratesData.data && ratesData.data.length > 0) {
                    var latest = ratesData.data[0];
                    if (els.statUpdated && latest.collection_date) {
                        els.statUpdated.innerHTML = 'Last updated: <strong>' + esc(latest.collection_date) + '</strong>';
                    }
                    if (section === 'home-loans' && els.statCashRate && latest.rba_cash_rate != null) {
                        els.statCashRate.innerHTML = 'RBA Cash Rate: <strong>' + pct(latest.rba_cash_rate) + '</strong>';
                    }
                }
            }
        } catch (_) { /* non-critical */ }
    }

    window.AR.hero = { loadHeroStats: loadHeroStats };
})();
