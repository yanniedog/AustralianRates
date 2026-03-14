(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom || {};
    var els = dom.els || {};
    var bankBrand = window.AR.bankBrand || {};
    var DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    var bound = false;
    var bankOptionButtons = Object.create(null);
    var bankPickerEmptyEl = null;
    var defaultDateStatus = 'Choose a date or type YYYY-MM-DD';
    var esc = window._arEsc || function (value) { return String(value == null ? '' : value); };

    function pad2(value) {
        var num = Number(value);
        if (!Number.isFinite(num)) return '00';
        return (num < 10 ? '0' : '') + String(Math.floor(num));
    }

    function formatDate(date) {
        return [
            date.getFullYear(),
            pad2(date.getMonth() + 1),
            pad2(date.getDate()),
        ].join('-');
    }

    function setDateStatus(message) {
        if (!els.filterDateStatus) return;
        els.filterDateStatus.textContent = String(message || defaultDateStatus);
        els.filterDateStatus.classList.toggle('is-error', String(message || defaultDateStatus) !== defaultDateStatus);
    }

    function setDateInvalid(el, invalid) {
        if (!el) return;
        el.classList.toggle('is-invalid', !!invalid);
        el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    }

    function normalizeDateValue(value) {
        var raw = String(value || '').trim();
        if (!raw) {
            return { ok: true, empty: true, value: '', message: '' };
        }

        var match = raw.match(DATE_RE);
        if (!match) {
            return { ok: false, empty: false, value: raw, message: 'YYYY-MM-DD' };
        }

        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
            return { ok: false, empty: false, value: raw, message: 'YYYY-MM-DD' };
        }

        var date = new Date(Date.UTC(year, month - 1, day));
        var sameDay = date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day;
        if (!sameDay) {
            return { ok: false, empty: false, value: raw, message: 'Invalid date' };
        }

        return {
            ok: true,
            empty: false,
            value: [year, pad2(month), pad2(day)].join('-'),
            message: '',
        };
    }

    function selectedBankCount() {
        if (!els.filterBank) return 0;
        var count = 0;
        for (var i = 0; i < els.filterBank.options.length; i++) {
            if (els.filterBank.options[i].selected) count++;
        }
        return count;
    }

    function updateBankCount() {
        if (!els.filterBankCount || !els.filterBank) return;
        var total = els.filterBank.options.length;
        var selected = selectedBankCount();
        els.filterBankCount.textContent = selected ? (selected + '/' + total) : 'All';
        els.filterBankCount.title = selected ? (selected + ' banks selected') : 'All banks';
    }

    function bankMatchesQuery(value, query) {
        if (bankBrand && typeof bankBrand.matchesQuery === 'function') {
            return bankBrand.matchesQuery(value, query);
        }
        return String(value || '').toLowerCase().indexOf(String(query || '').toLowerCase()) >= 0;
    }

    function bankBadgeMarkup(value) {
        if (bankBrand && typeof bankBrand.badge === 'function') {
            return bankBrand.badge(value, { showName: true, className: 'bank-option-badge' });
        }
        return '<span class="bank-option-text">' + esc(value || '-') + '</span>';
    }

    function showNativeDatePicker(input) {
        if (!input || input.type !== 'date' || typeof input.showPicker !== 'function') return;
        try {
            input.showPicker();
        } catch (_err) {
            // Some browsers require a narrower user gesture contract. The native input still works.
        }
    }

    function bankSelectEntries() {
        var entries = [];
        if (!els.filterBank) return entries;
        for (var i = 0; i < els.filterBank.options.length; i++) {
            var option = els.filterBank.options[i];
            var value = String(option.value || '').trim();
            if (!value) continue;
            entries.push({
                option: option,
                value: value,
            });
        }
        return entries;
    }

    function createBankOptionButton(value) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'bank-option-card';
        button.dataset.bankValue = value;
        button.setAttribute('aria-label', value);
        button.setAttribute('title', value);
        button.innerHTML = bankBadgeMarkup(value);
        return button;
    }

    function ensureBankOptionElements(entries) {
        if (!els.filterBankOptions) return;
        var seen = Object.create(null);

        entries.forEach(function (entry) {
            seen[entry.value] = true;
            if (!bankOptionButtons[entry.value]) {
                bankOptionButtons[entry.value] = createBankOptionButton(entry.value);
            }
            entry.button = bankOptionButtons[entry.value];
            els.filterBankOptions.appendChild(entry.button);
        });

        Object.keys(bankOptionButtons).forEach(function (value) {
            if (seen[value]) return;
            var stale = bankOptionButtons[value];
            if (stale && stale.parentNode === els.filterBankOptions) {
                els.filterBankOptions.removeChild(stale);
            }
            delete bankOptionButtons[value];
        });

        if (!bankPickerEmptyEl) {
            bankPickerEmptyEl = document.createElement('p');
            bankPickerEmptyEl.className = 'bank-picker-empty';
            bankPickerEmptyEl.textContent = 'No bank match';
        }
        els.filterBankOptions.appendChild(bankPickerEmptyEl);
    }

    function renderBankOptions() {
        if (!els.filterBankOptions || !els.filterBank) {
            updateBankCount();
            return;
        }

        var query = String(els.filterBankSearch && els.filterBankSearch.value || '').trim();
        var entries = bankSelectEntries();
        var visibleCount = 0;
        ensureBankOptionElements(entries);

        entries.forEach(function (entry) {
            var option = entry.option;
            var selected = !!option.selected;
            var visible = !query || bankMatchesQuery(entry.value, query) || selected;
            option.hidden = !visible;
            if (entry.button) {
                entry.button.hidden = !visible;
                entry.button.tabIndex = visible ? 0 : -1;
                entry.button.classList.toggle('is-selected', selected);
                entry.button.setAttribute('aria-pressed', selected ? 'true' : 'false');
                entry.button.setAttribute('title', entry.value);
            }
            if (visible) visibleCount++;
        });

        if (bankPickerEmptyEl) bankPickerEmptyEl.hidden = visibleCount > 0;
        updateBankCount();
    }

    function refreshBankOptions() {
        renderBankOptions();
    }

    function clearBankSearch() {
        if (els.filterBankSearch) els.filterBankSearch.value = '';
        refreshBankOptions();
    }

    function notifyFilterUiRefresh() {
        var filters = window.AR.filters;
        if (filters && typeof filters.refreshFilterUiState === 'function') {
            filters.refreshFilterUiState();
        }
    }

    function dispatchBankChange() {
        if (!els.filterBank) return;
        els.filterBank.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clearBankSelection() {
        if (els.filterBank) {
            for (var i = 0; i < els.filterBank.options.length; i++) {
                els.filterBank.options[i].selected = false;
            }
        }
        clearBankSearch();
        dispatchBankChange();
        notifyFilterUiRefresh();
    }

    function toggleBankSelection(value) {
        if (!els.filterBank) return;
        var target = String(value || '').trim();
        if (!target) return;
        for (var i = 0; i < els.filterBank.options.length; i++) {
            var option = els.filterBank.options[i];
            if (String(option.value || '').trim() !== target) continue;
            option.selected = !option.selected;
            break;
        }
        refreshBankOptions();
        dispatchBankChange();
    }

    function validateDateInputs(options) {
        var opts = options || {};
        var startMeta = normalizeDateValue(els.filterStartDate ? els.filterStartDate.value : '');
        var endMeta = normalizeDateValue(els.filterEndDate ? els.filterEndDate.value : '');
        var message = defaultDateStatus;
        var invalidStart = false;
        var invalidEnd = false;
        var invalidEl = null;

        if (startMeta.ok && !startMeta.empty && els.filterStartDate) {
            els.filterStartDate.value = startMeta.value;
        }
        if (endMeta.ok && !endMeta.empty && els.filterEndDate) {
            els.filterEndDate.value = endMeta.value;
        }

        if (!startMeta.ok) {
            invalidStart = true;
            invalidEl = els.filterStartDate;
            message = startMeta.message;
        } else if (!endMeta.ok) {
            invalidEnd = true;
            invalidEl = els.filterEndDate;
            message = endMeta.message;
        } else if (!startMeta.empty && !endMeta.empty && startMeta.value > endMeta.value) {
            invalidStart = true;
            invalidEnd = true;
            invalidEl = els.filterStartDate;
            message = 'FROM <= TO';
        }

        setDateInvalid(els.filterStartDate, invalidStart);
        setDateInvalid(els.filterEndDate, invalidEnd);
        setDateStatus(message);

        if ((invalidStart || invalidEnd) && opts.focusInvalid !== false && invalidEl && typeof invalidEl.focus === 'function') {
            invalidEl.focus();
        }

        return !(invalidStart || invalidEnd);
    }

    function setDaysRange(days) {
        var end = new Date();
        end.setHours(12, 0, 0, 0);
        var start = new Date(end.getTime());
        start.setDate(start.getDate() - (Number(days) - 1));

        if (els.filterStartDate) els.filterStartDate.value = formatDate(start);
        if (els.filterEndDate) els.filterEndDate.value = formatDate(end);
        validateDateInputs({ focusInvalid: false });
        notifyFilterUiRefresh();
    }

    function applyDateShortcut(key) {
        if (key === 'all') {
            if (els.filterStartDate) els.filterStartDate.value = '';
            if (els.filterEndDate) els.filterEndDate.value = '';
            validateDateInputs({ focusInvalid: false });
            notifyFilterUiRefresh();
            return;
        }

        if (key === '7' || key === '30' || key === '90') {
            setDaysRange(Number(key));
        }
    }

    function bindBankSearch() {
        if (els.filterBankSearch) {
            els.filterBankSearch.addEventListener('input', refreshBankOptions);
            els.filterBankSearch.addEventListener('search', refreshBankOptions);
        }
        if (els.filterBankClear) {
            els.filterBankClear.addEventListener('click', function (event) {
                if (event) event.preventDefault();
                clearBankSelection();
            });
        }
        if (els.filterBank) {
            els.filterBank.addEventListener('change', refreshBankOptions);
        }
        if (els.filterBankOptions) {
            els.filterBankOptions.addEventListener('click', function (event) {
                var button = event.target && event.target.closest
                    ? event.target.closest('[data-bank-value]')
                    : null;
                if (!button) return;
                toggleBankSelection(button.getAttribute('data-bank-value'));
            });
        }
    }

    function bindDateControls() {
        [els.filterStartDate, els.filterEndDate].forEach(function (input) {
            if (!input) return;
            input.addEventListener('click', function () {
                showNativeDatePicker(input);
            });
            input.addEventListener('keydown', function (event) {
                if (!event) return;
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    showNativeDatePicker(input);
                }
            });
            input.addEventListener('blur', function () {
                validateDateInputs({ focusInvalid: false });
            });
            input.addEventListener('change', function () {
                validateDateInputs({ focusInvalid: false });
                notifyFilterUiRefresh();
            });
            input.addEventListener('input', function () {
                setDateInvalid(input, false);
                setDateStatus(defaultDateStatus);
            });
        });

        var shortcutButtons = document.querySelectorAll('[data-date-range]');
        for (var i = 0; i < shortcutButtons.length; i++) {
            shortcutButtons[i].addEventListener('click', function (event) {
                if (event) event.preventDefault();
                var key = String(event.currentTarget.getAttribute('data-date-range') || '').trim().toLowerCase();
                applyDateShortcut(key);
            });
        }
    }

    function init() {
        if (!defaultDateStatus && els.filterDateStatus) {
            defaultDateStatus = String(els.filterDateStatus.textContent || '').trim() || defaultDateStatus;
        }
        if (bound) {
            refreshBankOptions();
            validateDateInputs({ focusInvalid: false });
            return;
        }
        bound = true;
        bindBankSearch();
        bindDateControls();
        refreshBankOptions();
        validateDateInputs({ focusInvalid: false });
    }

    function resetUi() {
        clearBankSearch();
        setDateInvalid(els.filterStartDate, false);
        setDateInvalid(els.filterEndDate, false);
        setDateStatus(defaultDateStatus);
        updateBankCount();
    }

    window.AR.filterUi = {
        applyDateShortcut: applyDateShortcut,
        clearBankSearch: clearBankSearch,
        init: init,
        normalizeDateValue: normalizeDateValue,
        refreshBankOptions: refreshBankOptions,
        renderBankOptions: renderBankOptions,
        resetUi: resetUi,
        validateDateInputs: validateDateInputs,
    };
})();
