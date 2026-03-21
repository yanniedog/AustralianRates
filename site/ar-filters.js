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
    var runtimePrefs = window.AR.runtimePrefs = window.AR.runtimePrefs || {};
    var network = window.AR.network || {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var apiOverride = config && config.apiOverride ? config.apiOverride : null;
    var isAnalystMode = state && typeof state.isAnalystMode === 'function'
        ? state.isAnalystMode
        : function () { return false; };
    var utils = window.AR.utils || {};
    var esc = utils.esc || window._arEsc;
    var formatFilterValue = utils.formatFilterValue || function (_field, value) { return String(value == null ? '' : value); };
    var clientLog = utils.clientLog || function () {};
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };

    var filterFields = sc.filterFields || [];
    var filterApiMap = sc.filterApiMap || {};
    var requestTimeoutMs = Number(sc.requestTimeoutMs);
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) requestTimeoutMs = 10000;
    var consumerFilterIds = getConsumerFilterIds();
    var appliedFilterSignature = '';
    var latestFilterPayload = null;
    var filtersPayloadEventName = 'ar:filters-payload-loaded';
    var interactionBound = false;

    function defaultColumnPrefs() {
        return { visible: {}, showRemoved: false, moveColumnsMode: false, columnOrder: null };
    }

    function normalizeColumnPrefs(input) {
        var prefs = input && typeof input === 'object' ? input : {};
        return {
            visible: prefs.visible && typeof prefs.visible === 'object' ? prefs.visible : {},
            showRemoved: !!prefs.showRemoved,
            moveColumnsMode: !!prefs.moveColumnsMode,
            columnOrder: Array.isArray(prefs.columnOrder) ? prefs.columnOrder.slice() : null,
        };
    }

    function columnPrefsStore() {
        if (!runtimePrefs.columnPrefsBySection || typeof runtimePrefs.columnPrefsBySection !== 'object') {
            runtimePrefs.columnPrefsBySection = {};
        }
        if (!runtimePrefs.columnPrefsBySection[section]) {
            runtimePrefs.columnPrefsBySection[section] = defaultColumnPrefs();
        }
        runtimePrefs.columnPrefsBySection[section] = normalizeColumnPrefs(runtimePrefs.columnPrefsBySection[section]);
        return runtimePrefs.columnPrefsBySection;
    }

    function getConsumerFilterIds() {
        if (section === 'home-loans') {
            return ['filter-bank', 'filter-security', 'filter-repayment', 'filter-structure', 'filter-lvr', 'filter-feature', 'filter-min-rate', 'filter-max-rate', 'filter-start-date', 'filter-end-date'];
        }
        if (section === 'savings') {
            return ['filter-bank', 'filter-account-type', 'filter-rate-type', 'filter-deposit-tier', 'filter-min-rate', 'filter-max-rate', 'filter-start-date', 'filter-end-date'];
        }
        if (section === 'term-deposits') {
            return ['filter-bank', 'filter-term-months', 'filter-deposit-tier', 'filter-interest-payment', 'filter-min-rate', 'filter-max-rate', 'filter-start-date', 'filter-end-date'];
        }
        return ['filter-bank', 'filter-min-rate', 'filter-max-rate', 'filter-start-date', 'filter-end-date'];
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

    function isDisplayDefaultParam(key, value) {
        var text = String(value == null ? '' : value).trim().toLowerCase();
        if (!text) return true;
        if (key === 'include_removed') return true;
        if (key === 'min_rate' && text === '0.01') return true;
        if (key === 'mode' && text === 'all') return true;
        return false;
    }

    function getDisplayParams() {
        var raw = buildFilterParams();
        var params = {};
        Object.keys(raw).forEach(function (key) {
            if (isDisplayDefaultParam(key, raw[key])) return;
            params[key] = String(raw[key]).trim();
        });
        return params;
    }

    function getChipEntries(params) {
        var source = params && typeof params === 'object' ? params : getDisplayParams();
        var entries = [];
        Object.keys(source).forEach(function (key) {
            var text = String(source[key] || '').trim();
            if (!text) return;
            var field = findFieldByParam(key);
            var label = formatChipLabel(field, key);
            var values = key === 'include_manual' ? ['true'] : text.split(',').filter(Boolean);
            values.forEach(function (rawValue) {
                var displayValue = rawValue;
                if (key === 'include_manual') displayValue = 'Included';
                else if (field) displayValue = formatFilterValue(field.param, rawValue);
                entries.push({
                    key: key,
                    label: label,
                    rawValue: rawValue,
                    displayValue: displayValue,
                });
            });
        });
        return entries;
    }

    function getActiveFilterCount() {
        return getChipEntries(getDisplayParams()).length;
    }

    function emitFiltersState() {
        window.dispatchEvent(new CustomEvent('ar:filters-state', {
            detail: getStateSnapshot(),
        }));
    }

    function renderActiveFilterChips() {
        if (!els.activeFilterChips) return;
        var chips = getChipEntries(getDisplayParams()).map(function (entry) {
            return '' +
                '<button class="filter-chip" type="button" data-remove-param="' + esc(entry.key) + '" data-remove-value="' + esc(entry.rawValue) + '">' +
                    '<strong>' + esc(entry.label) + ':</strong> ' + esc(entry.displayValue) +
                    '<span class="filter-chip-remove" aria-hidden="true">&times;</span>' +
                '</button>';
        });

        if (!chips.length) {
            els.activeFilterChips.innerHTML = '<span class="filter-chip filter-chip-empty">0</span>';
            return;
        }
        els.activeFilterChips.innerHTML = chips.join('');
    }

    function renderDirtyIndicator() {
        if (!els.filterDirtyIndicator) return;
        var dirty = isFilterDirty();
        var activeCount = getActiveFilterCount();
        els.filterDirtyIndicator.classList.toggle('is-dirty', dirty);
        els.filterDirtyIndicator.textContent = dirty
            ? 'DIRTY'
            : (activeCount ? String(activeCount) : '0');
    }

    function refreshFilterUiState() {
        renderActiveFilterChips();
        renderDirtyIndicator();
        emitFiltersState();
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
        if (els.activeFilterChips) {
            els.activeFilterChips.addEventListener('click', function (event) {
                var button = event.target && event.target.closest
                    ? event.target.closest('[data-remove-param]')
                    : null;
                if (!button) return;
                clearFilterValue(
                    String(button.getAttribute('data-remove-param') || ''),
                    String(button.getAttribute('data-remove-value') || '')
                );
            });
        }
    }

    function clearFilterValue(param, rawValue) {
        var key = String(param || '').trim();
        var value = String(rawValue || '').trim();
        if (!key) return;

        if (key === 'start_date' && els.filterStartDate) {
            els.filterStartDate.value = '';
        } else if (key === 'end_date' && els.filterEndDate) {
            els.filterEndDate.value = '';
        } else if (key === 'mode' && els.filterMode) {
            els.filterMode.value = 'all';
        } else if (key === 'include_manual' && els.filterIncludeManual) {
            els.filterIncludeManual.checked = false;
        } else {
            var field = findFieldByParam(key);
            var el = field ? getFilterEl(field.id) : null;
            if (!el) return;
            if (isMultiField(field)) {
                setSelectedValues(el, selectedValues(el).filter(function (candidate) {
                    return String(candidate) !== value;
                }));
                if (el === els.filterBank && filterUi && filterUi.refreshBankOptions) {
                    filterUi.refreshBankOptions();
                }
            } else {
                el.value = '';
                if (field && field.param === 'min_rate') applyDefaultMinRateIfEmpty();
            }
        }

        if (filterUi && filterUi.validateDateInputs) {
            filterUi.validateDateInputs({ focusInvalid: false });
        }
        refreshFilterUiState();
    }

    function getStateSnapshot() {
        return {
            params: getDisplayParams(),
            activeCount: getActiveFilterCount(),
            dirty: isFilterDirty(),
        };
    }

    function emitFiltersPayloadLoaded(payload) {
        window.dispatchEvent(new CustomEvent(filtersPayloadEventName, {
            detail: {
                filters: payload || null,
            },
        }));
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
        applyDefaultMinRateIfEmpty();
        if (filterUi && filterUi.resetUi) filterUi.resetUi();
        refreshFilterUiState();
    }

    function readColumnPrefs() {
        return normalizeColumnPrefs(columnPrefsStore()[section]);
    }

    function writeColumnPrefs(next) {
        columnPrefsStore()[section] = normalizeColumnPrefs(next);
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

        var fp = buildFilterParams();
        // Use field.url || field.param so URL keys match what restoreUrlState reads (restoreUrlState uses p.get(field.url || field.param)).
        for (var i = 0; i < filterFields.length; i++) {
            var field = filterFields[i];
            if (!isFieldVisibleInMode(field.id)) continue;
            var value = fp[field.param];
            if (value == null || String(value).trim() === '') continue;
            if (field.param === 'min_rate' && String(value).trim() === '0.01') continue;
            q.set(field.url || field.param, String(value).trim());
        }
        if (fp.start_date) q.set('start_date', fp.start_date);
        if (fp.end_date) q.set('end_date', fp.end_date);
        if (fp.mode && fp.mode !== 'all') q.set('mode', fp.mode);
        if (fp.include_manual) q.set('include_manual', fp.include_manual);
        if (fp.include_removed) q.set('include_removed', fp.include_removed);

        if (els.refreshInterval && els.refreshInterval.value !== '60') q.set('refresh_interval', els.refreshInterval.value);
        if (apiOverride) q.set('apiBase', apiOverride);
        if (!isAnalystMode()) q.set('view', 'consumer');

        var query = q.toString();
        window.history.replaceState(null, '', window.location.pathname + (query ? ('?' + query) : '') + window.location.hash);
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
        var loadResult = { ok: true, error: null };
        try {
            var result = requestJson
                ? await requestJson(apiBase + '/filters', {
                    requestLabel: 'Filter controls',
                    timeoutMs: requestTimeoutMs,
                    retryCount: 0,
                    retryDelayMs: 700,
                })
                : null;
            var data = result ? result.data : null;
            if (!data) {
                var filtersUrl = (window.AR.network && window.AR.network.appendCacheBust) ? window.AR.network.appendCacheBust(apiBase + '/filters') : apiBase + '/filters';
                var r = await fetch(filtersUrl, { cache: 'no-store' });
                if (!r.ok) throw new Error('HTTP ' + r.status + ' for /filters');
                data = await r.json();
            }
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
                emitFiltersPayloadLoaded(f);
            }
            restoreUrlState();
            applyDefaultMinRateIfEmpty();
            applyDefaultHomeLoanScenarioIfEmpty();
            if (filterUi && filterUi.init) filterUi.init();
            applyUiMode();
            bindInteractionListeners();
            markFiltersApplied();
        } catch (err) {
            loadResult = { ok: false, error: err };
            clientLog('error', 'Filter options load failed', {
                message: describeError(err, 'Filter controls could not be loaded.'),
            });
            restoreUrlState();
            applyDefaultMinRateIfEmpty();
            applyDefaultHomeLoanScenarioIfEmpty();
            if (filterUi && filterUi.init) filterUi.init();
            applyUiMode();
            bindInteractionListeners();
            markFiltersApplied();
        }
        return loadResult;
    }

    function applyDefaultMinRateIfEmpty() {
        var field = findFieldByParam('min_rate');
        if (!field) return;
        var el = getFilterEl(field.id);
        if (!el || String(el.value || '').trim() !== '') return;
        el.value = '0.01';
    }

    function selectFirstMatchingOption(el, matchers) {
        if (!el || !el.options) return false;
        for (var i = 0; i < el.options.length; i++) {
            var value = String(el.options[i].value || '').trim();
            if (!value) continue;
            for (var j = 0; j < matchers.length; j++) {
                if (matchers[j](value)) {
                    el.value = value;
                    return true;
                }
            }
        }
        return false;
    }

    function applyDefaultHomeLoanScenarioIfEmpty() {
        if (section !== 'home-loans') return;

        var securityEl = getFilterEl('filter-security');
        var repaymentEl = getFilterEl('filter-repayment');
        var structureEl = getFilterEl('filter-structure');
        var lvrEl = getFilterEl('filter-lvr');

        if (securityEl && !String(securityEl.value || '').trim()) securityEl.value = 'owner_occupied';
        if (repaymentEl && !String(repaymentEl.value || '').trim()) repaymentEl.value = 'principal_and_interest';
        if (structureEl && !String(structureEl.value || '').trim()) structureEl.value = 'variable';
        if (lvrEl && !String(lvrEl.value || '').trim()) {
            selectFirstMatchingOption(lvrEl, [
                function (value) { return value === 'lvr_80-85%'; },
                function (value) { return value.indexOf('80-85') >= 0; },
                function (value) { return value.indexOf('80') >= 0; },
            ]);
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
        validateInputs: function (options) {
            return filterUi && filterUi.validateDateInputs
                ? filterUi.validateDateInputs(options || {})
                : true;
        },
        getStateSnapshot: getStateSnapshot,
        getFiltersPayload: function () { return latestFilterPayload; },
        filtersPayloadEventName: filtersPayloadEventName,
        readColumnPrefs: readColumnPrefs,
        writeColumnPrefs: writeColumnPrefs,
    };
})();
