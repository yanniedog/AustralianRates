(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var state = window.AR.state;
    var sc = window.AR.sectionConfig || {};
    var els = dom && dom.els ? dom.els : {};
    var filterElMap = dom && dom.filterElMap ? dom.filterElMap : {};
    var tabState = state && state.state ? state.state : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var apiOverride = config && config.apiOverride ? config.apiOverride : null;
    var isAdmin = config && config.isAdmin ? config.isAdmin : false;
    var esc = (window.AR.utils && window.AR.utils.esc) ? window.AR.utils.esc : window._arEsc;

    var filterFields = sc.filterFields || [];
    var filterApiMap = sc.filterApiMap || {};

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

    function getFilterEl(fieldId) {
        return filterElMap[fieldId] || document.getElementById(fieldId) || null;
    }

    function buildFilterParams() {
        var p = {};
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            var el = getFilterEl(field.id);
            if (el && el.value) p[field.param] = el.value;
        }
        if (els.filterStartDate && els.filterStartDate.value) p.start_date = els.filterStartDate.value;
        if (els.filterEndDate && els.filterEndDate.value) p.end_date = els.filterEndDate.value;
        if (els.filterIncludeManual && els.filterIncludeManual.checked) p.include_manual = 'true';
        return p;
    }

    function syncUrlState() {
        var q = new URLSearchParams();
        q.set('tab', tabState.activeTab);
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            var el = getFilterEl(field.id);
            if (el && el.value) q.set(field.url, el.value);
        }
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
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            var val = p.get(field.url);
            if (val) {
                var el = getFilterEl(field.id);
                if (el) el.value = val;
            }
        }
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
            for (var filterId in filterApiMap) {
                if (Object.prototype.hasOwnProperty.call(filterApiMap, filterId)) {
                    var el = getFilterEl(filterId);
                    var apiKey = filterApiMap[filterId];
                    if (el && f[apiKey]) fillSelect(el, f[apiKey]);
                }
            }
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
