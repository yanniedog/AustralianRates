(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var state = window.AR.state;
    var sc = window.AR.sectionConfig || {};
    var section = window.AR.section || 'home-loans';
    var els = dom && dom.els ? dom.els : {};
    var filterElMap = dom && dom.filterElMap ? dom.filterElMap : {};
    var tabState = state && state.state ? state.state : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var apiOverride = config && config.apiOverride ? config.apiOverride : null;
    var isAnalystMode = state && typeof state.isAnalystMode === 'function'
        ? state.isAnalystMode
        : function () { return false; };
    var utils = window.AR.utils || {};
    var esc = utils.esc || window._arEsc;
    var formatFilterValue = utils.formatFilterValue || function (_field, value) { return String(value == null ? '' : value); };
    var clientLog = utils.clientLog || function () {};

    var filterFields = sc.filterFields || [];
    var filterApiMap = sc.filterApiMap || {};
    var consumerFilterIds = getConsumerFilterIds();

    function getConsumerFilterIds() {
        if (section === 'savings') return ['filter-bank', 'filter-account-type', 'filter-rate-type'];
        if (section === 'term-deposits') return ['filter-bank', 'filter-term-months', 'filter-deposit-tier'];
        return ['filter-bank', 'filter-security', 'filter-repayment', 'filter-structure'];
    }

    function fillSelect(el, values, fieldName) {
        if (!el) return;
        var current = el.value;
        el.innerHTML = '<option value="">All</option>' + values.map(function (v) {
            var label = formatFilterValue(fieldName, v);
            return '<option value="' + esc(v) + '">' + esc(label || v) + '</option>';
        }).join('');
        if (current && values.indexOf(current) >= 0) {
            el.value = current;
        }
    }

    function getFilterEl(fieldId) {
        return filterElMap[fieldId] || document.getElementById(fieldId) || null;
    }

    function setControlVisible(el, visible) {
        if (!el) return;
        var wrap = el.closest('label') || el.closest('.toggle-label') || el.closest('.filter-actions');
        if (!wrap) return;
        wrap.classList.toggle('mode-hidden', !visible);
    }

    function setFieldVisibleById(fieldId, visible) {
        setControlVisible(getFilterEl(fieldId), visible);
    }

    function isFieldVisibleInMode(fieldId) {
        return isAnalystMode() || consumerFilterIds.indexOf(fieldId) >= 0;
    }

    function resetAdvancedFiltersForConsumer() {
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            if (consumerFilterIds.indexOf(field.id) >= 0) continue;
            var el = getFilterEl(field.id);
            if (el) el.value = '';
        }
        if (els.filterIncludeManual) els.filterIncludeManual.checked = false;
        if (els.filterMode) els.filterMode.value = 'all';
        if (els.refreshInterval) els.refreshInterval.value = '60';
    }

    function applyUiMode() {
        var analyst = isAnalystMode();
        if (!analyst) resetAdvancedFiltersForConsumer();

        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            setFieldVisibleById(field.id, isFieldVisibleInMode(field.id));
        }

        if (els.filterMode) setControlVisible(els.filterMode, analyst);
        if (els.filterIncludeManual) setControlVisible(els.filterIncludeManual, analyst);
        if (els.refreshInterval) setControlVisible(els.refreshInterval, analyst);

        clientLog('info', 'Filter mode applied', {
            uiMode: analyst ? 'analyst' : 'consumer',
            section: section,
        });
    }

    function buildFilterParams() {
        var p = {};
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            if (!isFieldVisibleInMode(field.id)) continue;
            var el = getFilterEl(field.id);
            if (el && el.value) p[field.param] = el.value;
        }
        if (els.filterStartDate && els.filterStartDate.value) p.start_date = els.filterStartDate.value;
        if (els.filterEndDate && els.filterEndDate.value) p.end_date = els.filterEndDate.value;
        if (isAnalystMode()) {
            if (els.filterMode && els.filterMode.value) p.mode = els.filterMode.value;
            if (els.filterIncludeManual && els.filterIncludeManual.checked) p.include_manual = 'true';
        }
        return p;
    }

    function syncUrlState() {
        var q = new URLSearchParams();
        q.set('tab', tabState.activeTab);
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            if (!isFieldVisibleInMode(field.id)) continue;
            var el = getFilterEl(field.id);
            if (el && el.value) q.set(field.url, el.value);
        }
        if (els.filterStartDate && els.filterStartDate.value) q.set('start_date', els.filterStartDate.value);
        if (els.filterEndDate && els.filterEndDate.value) q.set('end_date', els.filterEndDate.value);
        if (isAnalystMode() && els.filterMode && els.filterMode.value && els.filterMode.value !== 'all') q.set('mode', els.filterMode.value);
        if (isAnalystMode() && els.filterIncludeManual && els.filterIncludeManual.checked) q.set('include_manual', 'true');
        if (els.refreshInterval && els.refreshInterval.value !== '60') q.set('refresh_interval', els.refreshInterval.value);
        if (apiOverride) q.set('apiBase', apiOverride);
        if (isAnalystMode()) q.set('view', 'analyst');
        window.history.replaceState(null, '', window.location.pathname + '?' + q.toString());
    }

    function restoreUrlState() {
        var p = new URLSearchParams(window.location.search);
        var restored = {};
        if (p.get('tab')) tabState.activeTab = p.get('tab');
        if (p.get('tab')) restored.tab = p.get('tab');
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            var val = p.get(field.url);
            if (val) {
                var el = getFilterEl(field.id);
                if (el) el.value = val;
                restored[field.url] = val;
            }
        }
        if (p.get('start_date') && els.filterStartDate) {
            els.filterStartDate.value = p.get('start_date');
            restored.start_date = p.get('start_date');
        }
        if (p.get('end_date') && els.filterEndDate) {
            els.filterEndDate.value = p.get('end_date');
            restored.end_date = p.get('end_date');
        }
        if (p.get('mode') && els.filterMode) {
            els.filterMode.value = p.get('mode');
            restored.mode = p.get('mode');
        }
        if (p.get('include_manual') === 'true' && els.filterIncludeManual) {
            els.filterIncludeManual.checked = true;
            restored.include_manual = 'true';
        }
        if (p.get('refresh_interval') && els.refreshInterval) {
            els.refreshInterval.value = p.get('refresh_interval');
            restored.refresh_interval = p.get('refresh_interval');
        }
        clientLog('info', 'Filter URL state restored', restored);
    }

    async function loadFilters() {
        clientLog('info', 'Loading filter options', { apiBase: apiBase });
        try {
            var r = await fetch(apiBase + '/filters');
            if (!r.ok) throw new Error('HTTP ' + r.status + ' for /filters');
            var data = await r.json();
            if (!data || !data.filters) {
                clientLog('warn', 'Filter options response missing filters payload');
                return;
            }
            var f = data.filters;
            for (var filterId in filterApiMap) {
                if (Object.prototype.hasOwnProperty.call(filterApiMap, filterId)) {
                    var el = getFilterEl(filterId);
                    var apiKey = filterApiMap[filterId];
                    var fieldName = '';
                    for (var i = 0; i < filterFields.length; i++) {
                        if (filterFields[i].id === filterId) {
                            fieldName = filterFields[i].param;
                            break;
                        }
                    }
                    if (el && f[apiKey]) fillSelect(el, f[apiKey], fieldName);
                }
            }
            clientLog('info', 'Filter options loaded', {
                keys: Object.keys(f),
                bankCount: Array.isArray(f.banks) ? f.banks.length : 0,
            });
            restoreUrlState();
            applyUiMode();
        } catch (err) {
            clientLog('error', 'Filter options load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.filters = {
        fillSelect: fillSelect,
        buildFilterParams: buildFilterParams,
        syncUrlState: syncUrlState,
        restoreUrlState: restoreUrlState,
        applyUiMode: applyUiMode,
        loadFilters: loadFilters,
    };
})();
