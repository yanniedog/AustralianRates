(function () {
    'use strict';

    window.AR = window.AR || {};

    var dom = window.AR.dom || {};
    var filterUi = window.AR.filterUi || {};
    var filters = window.AR.filters || {};
    var utils = window.AR.utils || {};
    var filterElMap = dom.filterElMap || {};
    var sectionConfig = window.AR.sectionConfig || {};
    var filterFields = Array.isArray(sectionConfig.filterFields) ? sectionConfig.filterFields : [];
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var formatFilterValue = utils.formatFilterValue || function (_field, value) { return String(value == null ? '' : value); };
    var selectBound = Object.create(null);
    var gridBound = Object.create(null);

    function findField(fieldId) {
        for (var i = 0; i < filterFields.length; i++) {
            if (filterFields[i].id === fieldId) return filterFields[i];
        }
        return null;
    }

    function getSelectEl(fieldId) {
        return filterElMap[fieldId] || document.getElementById(fieldId) || null;
    }

    function getPadGrid(fieldId) {
        return document.getElementById(fieldId + '-pads');
    }

    function selectedValues(selectEl) {
        if (!selectEl) return [];
        if (!selectEl.multiple) {
            var single = String(selectEl.value || '').trim();
            return single ? [single] : [];
        }
        var values = [];
        for (var i = 0; i < selectEl.options.length; i++) {
            var option = selectEl.options[i];
            var value = String(option.value || '').trim();
            if (option.selected && value) values.push(value);
        }
        return values;
    }

    function optionEntries(selectEl) {
        var entries = [];
        if (!selectEl) return entries;
        for (var i = 0; i < selectEl.options.length; i++) {
            var option = selectEl.options[i];
            var value = String(option.value || '').trim();
            if (!value) continue;
            entries.push({
                value: value,
                label: option.textContent || option.innerText || value,
            });
        }
        return entries;
    }

    function buttonMarkup(fieldId, field, entry, selected) {
        var value = String(entry.value || '').trim();
        var display = formatFilterValue(field && field.param, value) || entry.label || value;
        return '' +
            '<button class="filter-pad-btn' + (selected ? ' is-selected' : '') + '"' +
                ' type="button"' +
                ' data-filter-pad-field="' + esc(fieldId) + '"' +
                ' data-filter-pad-value="' + esc(value) + '"' +
                ' aria-pressed="' + (selected ? 'true' : 'false') + '"' +
                ' aria-label="' + esc(display) + '"' +
                ' title="' + esc(display) + '"' +
            '>' +
                '<span class="filter-pad-btn-value">' + esc(display) + '</span>' +
            '</button>';
    }

    function renderPadGrid(fieldId) {
        var selectEl = getSelectEl(fieldId);
        var grid = getPadGrid(fieldId);
        if (!selectEl || !grid) return;

        var field = findField(fieldId);
        var entries = optionEntries(selectEl);
        if (!entries.length) {
            grid.innerHTML = '<span class="filter-pad-empty">Waiting for options</span>';
            return;
        }

        var selected = Object.create(null);
        selectedValues(selectEl).forEach(function (value) {
            selected[String(value)] = true;
        });

        grid.innerHTML = entries.map(function (entry) {
            return buttonMarkup(fieldId, field, entry, !!selected[String(entry.value)]);
        }).join('');
    }

    function bindSelect(fieldId) {
        var selectEl = getSelectEl(fieldId);
        if (!selectEl || selectBound[fieldId]) return;
        selectBound[fieldId] = true;
        selectEl.addEventListener('change', function () {
            renderPadGrid(fieldId);
        });
    }

    function bindGrid(fieldId) {
        var grid = getPadGrid(fieldId);
        if (!grid || gridBound[fieldId]) return;
        gridBound[fieldId] = true;
        grid.addEventListener('click', function (event) {
            var button = event.target && event.target.closest
                ? event.target.closest('[data-filter-pad-field][data-filter-pad-value]')
                : null;
            if (!button) return;
            event.preventDefault();
            togglePad(
                String(button.getAttribute('data-filter-pad-field') || ''),
                String(button.getAttribute('data-filter-pad-value') || '')
            );
        });
    }

    function refreshPadGrids() {
        var padGrids = document.querySelectorAll('[data-filter-pads-for]');
        for (var i = 0; i < padGrids.length; i++) {
            var fieldId = String(padGrids[i].getAttribute('data-filter-pads-for') || '').trim();
            if (!fieldId) continue;
            bindSelect(fieldId);
            bindGrid(fieldId);
            renderPadGrid(fieldId);
        }
    }

    function togglePad(fieldId, rawValue) {
        var selectEl = getSelectEl(fieldId);
        var target = String(rawValue || '').trim();
        if (!selectEl || !target) return;

        if (selectEl.multiple) {
            for (var i = 0; i < selectEl.options.length; i++) {
                var option = selectEl.options[i];
                if (String(option.value || '').trim() !== target) continue;
                option.selected = !option.selected;
                break;
            }
        } else {
            selectEl.value = String(selectEl.value || '').trim() === target ? '' : target;
        }

        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        renderPadGrid(fieldId);
    }

    var originalInit = typeof filterUi.init === 'function' ? filterUi.init : null;
    filterUi.init = function () {
        if (originalInit) originalInit();
        refreshPadGrids();
    };

    var originalRefreshState = typeof filters.refreshFilterUiState === 'function'
        ? filters.refreshFilterUiState
        : null;
    if (originalRefreshState) {
        filters.refreshFilterUiState = function () {
            var result = originalRefreshState.apply(this, arguments);
            refreshPadGrids();
            return result;
        };
    }

    filterUi.refreshPadGrids = refreshPadGrids;
    window.AR.filterUi = filterUi;
    refreshPadGrids();
})();
