(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom || {};
    var els = dom.els || {};
    var DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    var bound = false;
    var defaultDateStatus = 'Enter dates in YYYY-MM-DD format.';

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
            return { ok: false, empty: false, value: raw, message: 'Enter dates in YYYY-MM-DD format.' };
        }

        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
            return { ok: false, empty: false, value: raw, message: 'Enter dates in YYYY-MM-DD format.' };
        }

        var date = new Date(Date.UTC(year, month - 1, day));
        var sameDay = date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day;
        if (!sameDay) {
            return { ok: false, empty: false, value: raw, message: 'Enter a real calendar date.' };
        }

        return {
            ok: true,
            empty: false,
            value: [year, pad2(month), pad2(day)].join('-'),
            message: '',
        };
    }

    function refreshBankOptions() {
        if (!els.filterBank) return;
        var query = String(els.filterBankSearch && els.filterBankSearch.value || '').trim().toLowerCase();
        for (var i = 0; i < els.filterBank.options.length; i++) {
            var option = els.filterBank.options[i];
            var label = String(option.textContent || option.label || option.value || '').trim().toLowerCase();
            var visible = !query || label.indexOf(query) >= 0 || option.selected;
            option.hidden = !visible;
        }
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

    function clearBankSelection() {
        if (els.filterBank) {
            for (var i = 0; i < els.filterBank.options.length; i++) {
                els.filterBank.options[i].selected = false;
            }
        }
        clearBankSearch();
        notifyFilterUiRefresh();
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
            message = 'From date must be on or before To date.';
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

        if (key === '7' || key === '30') {
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
    }

    function bindDateControls() {
        [els.filterStartDate, els.filterEndDate].forEach(function (input) {
            if (!input) return;
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
    }

    window.AR.filterUi = {
        applyDateShortcut: applyDateShortcut,
        clearBankSearch: clearBankSearch,
        init: init,
        normalizeDateValue: normalizeDateValue,
        refreshBankOptions: refreshBankOptions,
        resetUi: resetUi,
        validateDateInputs: validateDateInputs,
    };
})();
