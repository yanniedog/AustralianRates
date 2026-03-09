(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var state = window.AR.state;
    var filterUi = window.AR.filterUi || {};
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
    var appliedFilterSignature = '';
    var latestFilterPayload = null;
    var interactionBound = false;

    function getConsumerFilterIds() {
        return ['filter-bank', 'filter-min-rate', 'filter-max-rate'];
    }

    function normalizeParamsForSignature(params) {
        var input = params && typeof params === 'object' ? params : {};
        var out = {};
        Object.keys(input).sort().forEach(function (key) {
            var value = input[key];
            if (value == null) return;
            var text = String(value).trim();
            if (!text) return;
            out[key] = text;
        });
        return JSON.stringify(out);
    }

    function getCurrentFilterSignature() {
        return normalizeParamsForSignature(buildFilterParams());
    }

    function isFilterDirty() {
        return getCurrentFilterSignature() !== appliedFilterSignature;
    }

    function findFieldByParam(param) {
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            if (field.param === param || field.url === param || field.legacyUrl === param) return field;
        }
        return null;
    }

    function toTitleWords(value) {
        return String(value || '')
            .split('_')
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
    }

    function formatChipLabel(field, key) {
        if (field && field.label) return field.label;
        if (key === 'start_date') return 'From';
        if (key === 'end_date') return 'To';
        if (key === 'mode') return 'Rate Mode';
        if (key === 'include_manual') return 'Manual Runs';
        return toTitleWords(key);
    }

    function renderActiveFilterChips() {
        if (!els.activeFilterChips) return;
        var params = buildFilterParams();
        var chips = [];
        Object.keys(params).forEach(function (key) {
            if (key === 'include_removed') return;
            var value = params[key];
            if (value == null) return;
            var text = String(value).trim();
            if (!text) return;
            var field = findFieldByParam(key);
            var label = formatChipLabel(field, key);
            if (text.indexOf(',') >= 0) {
                var parts = text.split(',').filter(Boolean).map(function (part) {
                    return field ? formatFilterValue(field.param, part) : part;
                });
                text = parts.join(', ');
            } else if (field) {
                text = formatFilterValue(field.param, text);
            }
            chips.push('<span class="filter-chip"><strong>' + esc(label) + ':</strong> ' + esc(text) + '</span>');
        });

        if (!chips.length) {
            els.activeFilterChips.innerHTML = '<span class="filter-chip filter-chip-empty">No active filters</span>';
            return;
        }
        els.activeFilterChips.innerHTML = chips.join('');
    }

    function renderDirtyIndicator() {
        if (!els.filterDirtyIndicator) return;
        var dirty = isFilterDirty();
        els.filterDirtyIndicator.classList.toggle('is-dirty', dirty);
        els.filterDirtyIndicator.textContent = dirty ? 'Unsaved filter changes' : 'Filters applied';
    }

    function refreshFilterUiState() {
        renderActiveFilterChips();
        renderDirtyIndicator();
    }

    function markFiltersApplied() {
        appliedFilterSignature = getCurrentFilterSignature();
        refreshFilterUiState();
    }

    function bindInteractionListeners() {
        if (interactionBound) return;
        interactionBound = true;
        var controls = [];
        for (var i = 0; i < filterFields.length; i++) {
            controls.push(getFilterEl(filterFields[i].id));
        }
        controls.push(els.filterStartDate, els.filterEndDate, els.filterMode, els.filterIncludeManual, els.refreshInterval);
        controls.forEach(function (el) {
            if (!el) return;
            el.addEventListener('change', refreshFilterUiState);
            if (el.tagName === 'INPUT') {
                el.addEventListener('input', refreshFilterUiState);
            }
        });
    }

    function resetFilters() {
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            resetFieldValue(getFilterEl(field.id), field);
        }
        if (els.filterStartDate) els.filterStartDate.value = '';
        if (els.filterEndDate) els.filterEndDate.value = '';
        if (els.filterMode) els.filterMode.value = 'all';
        if (els.filterIncludeManual) els.filterIncludeManual.checked = false;
        if (els.refreshInterval) els.refreshInterval.value = '60';
        if (filterUi && filterUi.resetUi) filterUi.resetUi();
        refreshFilterUiState();
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
            if (el === els.filterBank && filterUi && filterUi.refreshBankOptions) {
                filterUi.refreshBankOptions();
            }
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
        if (els.filterBar && els.filterBar.tagName === 'DETAILS') {
            if (!analyst) els.filterBar.open = false;
        }

        refreshFilterUiState();

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

        var startMeta = filterUi && filterUi.normalizeDateValue
            ? filterUi.normalizeDateValue(els.filterStartDate ? els.filterStartDate.value : '')
            : null;
        var endMeta = filterUi && filterUi.normalizeDateValue
            ? filterUi.normalizeDateValue(els.filterEndDate ? els.filterEndDate.value : '')
            : null;

        if (startMeta && startMeta.ok && !startMeta.empty) p.start_date = startMeta.value;
        else if (!startMeta && els.filterStartDate && els.filterStartDate.value) p.start_date = els.filterStartDate.value;
        if (endMeta && endMeta.ok && !endMeta.empty) p.end_date = endMeta.value;
        else if (!endMeta && els.filterEndDate && els.filterEndDate.value) p.end_date = els.filterEndDate.value;
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

        if (filterUi && filterUi.refreshBankOptions) filterUi.refreshBankOptions();
        if (filterUi && filterUi.validateDateInputs) {
            filterUi.validateDateInputs({ focusInvalid: false });
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
            } else {
                var f = data.filters;
                latestFilterPayload = f;
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
            }
            restoreUrlState();
            if (filterUi && filterUi.init) filterUi.init();
            applyUiMode();
            bindInteractionListeners();
            markFiltersApplied();
        } catch (err) {
            clientLog('error', 'Filter options load failed', {
                message: err && err.message ? err.message : String(err),
            });
            restoreUrlState();
            if (filterUi && filterUi.init) filterUi.init();
            applyUiMode();
            bindInteractionListeners();
            markFiltersApplied();
        }
    }

    window.AR.filters = {
        fillSelect: fillSelect,
        buildFilterParams: buildFilterParams,
        syncUrlState: syncUrlState,
        restoreUrlState: restoreUrlState,
        applyUiMode: applyUiMode,
        loadFilters: loadFilters,
        resetFilters: resetFilters,
        refreshFilterUiState: refreshFilterUiState,
        markFiltersApplied: markFiltersApplied,
        bindInteractionListeners: bindInteractionListeners,
        validateInputs: function () {
            return filterUi && filterUi.validateDateInputs
                ? filterUi.validateDateInputs()
                : true;
        },
        getFiltersPayload: function () { return latestFilterPayload; },
        readColumnPrefs: readColumnPrefs,
        writeColumnPrefs: writeColumnPrefs,
    };
})();
