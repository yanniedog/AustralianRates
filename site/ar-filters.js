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

    var COLUMN_PREFS_KEY = 'ar_column_prefs_' + section;
    var filterFields = sc.filterFields || [];
    var filterApiMap = sc.filterApiMap || {};
    var consumerFilterIds = getConsumerFilterIds();

    function getConsumerFilterIds() {
        if (section === 'savings') {
            return ['filter-bank', 'filter-account-type', 'filter-rate-type', 'filter-min-rate', 'filter-max-rate'];
        }
        if (section === 'term-deposits') {
            return ['filter-bank', 'filter-term-months', 'filter-deposit-tier', 'filter-min-rate', 'filter-max-rate'];
        }
        return [
            'filter-bank',
            'filter-security',
            'filter-repayment',
            'filter-structure',
            'filter-min-rate',
            'filter-max-rate',
            'filter-min-comparison-rate',
            'filter-max-comparison-rate',
        ];
    }

    function readColumnPrefs() {
        try {
            var raw = window.localStorage.getItem(COLUMN_PREFS_KEY);
            if (!raw) return { visible: {}, showRemoved: false };
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return { visible: {}, showRemoved: false };
            return {
                visible: parsed.visible && typeof parsed.visible === 'object' ? parsed.visible : {},
                showRemoved: !!parsed.showRemoved,
            };
        } catch (_err) {
            return { visible: {}, showRemoved: false };
        }
    }

    function writeColumnPrefs(next) {
        try {
            window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(next || { visible: {}, showRemoved: false }));
        } catch (_err) {
            // Ignore storage errors.
        }
    }

    function parseBooleanParam(value) {
        var normalized = String(value || '').trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes';
    }

    function getFilterEl(fieldId) {
        return filterElMap[fieldId] || document.getElementById(fieldId) || null;
    }

    function isMultiField(field) {
        return !!(field && field.multiple);
    }

    function selectedValues(el) {
        if (!el) return [];
        if (!el.multiple) {
            var single = String(el.value || '').trim();
            return single ? [single] : [];
        }
        var out = [];
        for (var i = 0; i < el.options.length; i++) {
            var option = el.options[i];
            var value = String(option.value || '').trim();
            if (option.selected && value) out.push(value);
        }
        return out;
    }

    function setSelectedValues(el, values) {
        if (!el) return;
        var wanted = {};
        for (var i = 0; i < values.length; i++) {
            var key = String(values[i] || '').trim();
            if (!key) continue;
            wanted[key] = true;
        }
        if (!el.multiple) {
            var first = values.length ? String(values[0]) : '';
            el.value = first;
            return;
        }
        for (var j = 0; j < el.options.length; j++) {
            var option = el.options[j];
            option.selected = !!wanted[String(option.value || '').trim()];
        }
    }

    function resetFieldValue(el, field) {
        if (!el) return;
        if (isMultiField(field) && el.multiple) {
            for (var i = 0; i < el.options.length; i++) {
                el.options[i].selected = false;
            }
            return;
        }
        el.value = '';
    }

    function fillSelect(el, values, fieldName, opts) {
        if (!el) return;
        var options = Array.isArray(values) ? values : [];
        var multiple = !!(opts && opts.multiple);
        var currentValues = selectedValues(el);

        if (multiple) {
            el.innerHTML = options.map(function (v) {
                var label = formatFilterValue(fieldName, v);
                return '<option value="' + esc(v) + '">' + esc(label || v) + '</option>';
            }).join('');
            setSelectedValues(el, currentValues);
            return;
        }

        var current = String(el.value || '');
        el.innerHTML = '<option value="">All</option>' + options.map(function (v) {
            var label = formatFilterValue(fieldName, v);
            return '<option value="' + esc(v) + '">' + esc(label || v) + '</option>';
        }).join('');
        if (current && options.indexOf(current) >= 0) el.value = current;
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
            resetFieldValue(getFilterEl(field.id), field);
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
            if (!el) continue;

            if (isMultiField(field)) {
                var values = selectedValues(el);
                if (values.length > 0) p[field.param] = values.join(',');
                continue;
            }

            var value = String(el.value || '').trim();
            if (value) p[field.param] = value;
        }

        if (els.filterStartDate && els.filterStartDate.value) p.start_date = els.filterStartDate.value;
        if (els.filterEndDate && els.filterEndDate.value) p.end_date = els.filterEndDate.value;
        if (isAnalystMode()) {
            if (els.filterMode && els.filterMode.value) p.mode = els.filterMode.value;
            if (els.filterIncludeManual && els.filterIncludeManual.checked) p.include_manual = 'true';
        }

        if (readColumnPrefs().showRemoved) {
            p.include_removed = 'true';
        }
        return p;
    }

    function syncUrlState() {
        var q = new URLSearchParams();
        q.set('tab', tabState.activeTab || 'explorer');

        var fp = buildFilterParams();
        // Use field.url || field.param so URL keys match what restoreUrlState reads (restoreUrlState uses p.get(field.url || field.param)).
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            if (!isFieldVisibleInMode(field.id)) continue;
            var value = fp[field.param];
            if (value == null || String(value).trim() === '') continue;
            q.set(field.url || field.param, String(value).trim());
        }
        if (fp.start_date) q.set('start_date', fp.start_date);
        if (fp.end_date) q.set('end_date', fp.end_date);
        if (fp.mode) q.set('mode', fp.mode);
        if (fp.include_manual) q.set('include_manual', fp.include_manual);
        if (fp.include_removed) q.set('include_removed', fp.include_removed);

        if (els.refreshInterval && els.refreshInterval.value !== '60') q.set('refresh_interval', els.refreshInterval.value);
        if (apiOverride) q.set('apiBase', apiOverride);
        if (isAnalystMode()) q.set('view', 'analyst');

        window.history.replaceState(null, '', window.location.pathname + '?' + q.toString());
    }

    function restoreUrlState() {
        var p = new URLSearchParams(window.location.search);
        var restored = {};
        if (p.get('tab')) {
            tabState.activeTab = p.get('tab');
            restored.tab = p.get('tab');
        }

        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            var value = p.get(field.url || field.param);
            if (!value && field.legacyUrl) value = p.get(field.legacyUrl);
            if (!value) continue;

            var el = getFilterEl(field.id);
            if (!el) continue;
            if (isMultiField(field)) {
                setSelectedValues(el, String(value).split(','));
            } else {
                el.value = value;
            }
            restored[field.url || field.param] = value;
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
        if (p.get('view') && state && state.setUiMode) {
            state.setUiMode(p.get('view'));
            restored.view = p.get('view');
        }

        if (p.has('include_removed')) {
            var nextPrefs = readColumnPrefs();
            nextPrefs.showRemoved = parseBooleanParam(p.get('include_removed'));
            writeColumnPrefs(nextPrefs);
            restored.include_removed = String(nextPrefs.showRemoved);
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
                if (!Object.prototype.hasOwnProperty.call(filterApiMap, filterId)) continue;
                var field = null;
                for (var i = 0; i < filterFields.length; i++) {
                    if (filterFields[i].id === filterId) {
                        field = filterFields[i];
                        break;
                    }
                }
                if (!field) continue;
                var apiKey = filterApiMap[filterId];
                var el = getFilterEl(filterId);
                if (!el || !Array.isArray(f[apiKey])) continue;
                fillSelect(el, f[apiKey], field.param, { multiple: isMultiField(field) });
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
        readColumnPrefs: readColumnPrefs,
        writeColumnPrefs: writeColumnPrefs,
    };
})();

