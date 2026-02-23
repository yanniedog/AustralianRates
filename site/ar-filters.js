(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var state = window.AR.state;
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var apiOverride = config && config.apiOverride ? config.apiOverride : null;
    var isAdmin = config && config.isAdmin ? config.isAdmin : false;
    var esc = (window.AR.utils && window.AR.utils.esc) ? window.AR.utils.esc : window._arEsc;

    function fillSelect(el, values) {
        if (!el) return;
        var current = el.value;
        el.innerHTML = '<option value="">All</option>' + values.map(function (v) {
            return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
        }).join('');
        if (current && values.indexOf(current) >= 0) {
            el.value = current;
        }
    }

    function buildFilterParams() {
        var p = {};
        if (els.filterBank && els.filterBank.value) p.bank = els.filterBank.value;
        if (els.filterSecurity && els.filterSecurity.value) p.security_purpose = els.filterSecurity.value;
        if (els.filterRepayment && els.filterRepayment.value) p.repayment_type = els.filterRepayment.value;
        if (els.filterStructure && els.filterStructure.value) p.rate_structure = els.filterStructure.value;
        if (els.filterLvr && els.filterLvr.value) p.lvr_tier = els.filterLvr.value;
        if (els.filterFeature && els.filterFeature.value) p.feature_set = els.filterFeature.value;
        if (els.filterStartDate && els.filterStartDate.value) p.start_date = els.filterStartDate.value;
        if (els.filterEndDate && els.filterEndDate.value) p.end_date = els.filterEndDate.value;
        if (els.filterIncludeManual && els.filterIncludeManual.checked) p.include_manual = 'true';
        return p;
    }

    function syncUrlState() {
        var q = new URLSearchParams();
        q.set('tab', tabState.activeTab);
        if (els.filterBank && els.filterBank.value) q.set('bank', els.filterBank.value);
        if (els.filterSecurity && els.filterSecurity.value) q.set('purpose', els.filterSecurity.value);
        if (els.filterRepayment && els.filterRepayment.value) q.set('repayment', els.filterRepayment.value);
        if (els.filterStructure && els.filterStructure.value) q.set('structure', els.filterStructure.value);
        if (els.filterLvr && els.filterLvr.value) q.set('lvr', els.filterLvr.value);
        if (els.filterFeature && els.filterFeature.value) q.set('feature', els.filterFeature.value);
        if (els.filterStartDate && els.filterStartDate.value) q.set('start_date', els.filterStartDate.value);
        if (els.filterEndDate && els.filterEndDate.value) q.set('end_date', els.filterEndDate.value);
        if (els.filterIncludeManual && els.filterIncludeManual.checked) q.set('include_manual', 'true');
        if (els.refreshInterval && els.refreshInterval.value !== '60') q.set('refresh_interval', els.refreshInterval.value);
        if (apiOverride) q.set('apiBase', apiOverride);
        if (isAdmin) q.set('admin', 'true');
        window.history.replaceState(null, '', window.location.pathname + '?' + q.toString());
    }

    function restoreUrlState() {
        var p = new URLSearchParams(window.location.search);
        if (p.get('tab')) tabState.activeTab = p.get('tab');
        if (p.get('bank') && els.filterBank) els.filterBank.value = p.get('bank');
        if (p.get('purpose') && els.filterSecurity) els.filterSecurity.value = p.get('purpose');
        if (p.get('repayment') && els.filterRepayment) els.filterRepayment.value = p.get('repayment');
        if (p.get('structure') && els.filterStructure) els.filterStructure.value = p.get('structure');
        if (p.get('lvr') && els.filterLvr) els.filterLvr.value = p.get('lvr');
        if (p.get('feature') && els.filterFeature) els.filterFeature.value = p.get('feature');
        if (p.get('start_date') && els.filterStartDate) els.filterStartDate.value = p.get('start_date');
        if (p.get('end_date') && els.filterEndDate) els.filterEndDate.value = p.get('end_date');
        if (p.get('include_manual') === 'true' && els.filterIncludeManual) els.filterIncludeManual.checked = true;
        if (p.get('refresh_interval') && els.refreshInterval) els.refreshInterval.value = p.get('refresh_interval');
    }

    async function loadFilters() {
        try {
            var r = await fetch(apiBase + '/filters');
            var data = await r.json();
            if (!data || !data.filters) return;
            var f = data.filters;
            fillSelect(els.filterBank, f.banks || []);
            fillSelect(els.filterSecurity, f.security_purposes || []);
            fillSelect(els.filterRepayment, f.repayment_types || []);
            fillSelect(els.filterStructure, f.rate_structures || []);
            fillSelect(els.filterLvr, f.lvr_tiers || []);
            fillSelect(els.filterFeature, f.feature_sets || []);
            restoreUrlState();
        } catch (_) { /* non-critical */ }
    }

    window.AR.filters = {
        fillSelect: fillSelect,
        buildFilterParams: buildFilterParams,
        syncUrlState: syncUrlState,
        restoreUrlState: restoreUrlState,
        loadFilters: loadFilters,
    };
})();
