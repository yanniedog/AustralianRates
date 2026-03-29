(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || '';
    if (section !== 'savings' && section !== 'term-deposits') return;

    var INDEX_MAX = 1000;
    var DOLLARS_STEP = 10000;

    function indexToDollars(idx) {
        var i = Math.min(INDEX_MAX, Math.max(0, Math.round(Number(idx))));
        return i * DOLLARS_STEP;
    }

    function dollarsToIndex(d) {
        var n = Number(d);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(INDEX_MAX, Math.max(0, Math.round(n / DOLLARS_STEP)));
    }

    function formatBand(lo, hi) {
        var u = window.AR && window.AR.utils;
        if (u && typeof u.formatBalanceBand === 'function') return u.formatBalanceBand(lo, hi);
        return String(lo) + ' – ' + String(hi);
    }

    function getEls() {
        return {
            minR: document.getElementById('filter-balance-range-min'),
            maxR: document.getElementById('filter-balance-range-max'),
            hMin: document.getElementById('filter-balance-min'),
            hMax: document.getElementById('filter-balance-max'),
            readout: document.getElementById('filter-deposit-balance-readout'),
            tierSelect: document.getElementById('filter-deposit-tier'),
            fill: document.getElementById('filter-deposit-balance-fill'),
        };
    }

    function updateTrackFill(minIdx, maxIdx) {
        var e = getEls();
        if (!e.fill) return;
        var a = Math.min(minIdx, maxIdx);
        var b = Math.max(minIdx, maxIdx);
        var pLo = (a / INDEX_MAX) * 100;
        var pHi = (b / INDEX_MAX) * 100;
        var w = Math.max(0, pHi - pLo);
        e.fill.style.left = pLo + '%';
        e.fill.style.width = w + '%';
    }

    function applyUiFromIndexes(minIdx, maxIdx) {
        var e = getEls();
        if (!e.minR || !e.maxR || !e.hMin || !e.hMax) return;
        var a = Math.min(minIdx, maxIdx);
        var b = Math.max(minIdx, maxIdx);
        e.minR.value = String(a);
        e.maxR.value = String(b);
        if (a === 0 && b === INDEX_MAX) {
            e.hMin.value = '';
            e.hMax.value = '';
            if (e.readout) e.readout.textContent = 'All balances';
        } else {
            var lo = indexToDollars(a);
            var hi = indexToDollars(b);
            e.hMin.value = String(lo);
            e.hMax.value = String(hi);
            if (e.readout) e.readout.textContent = formatBand(lo, hi);
            if (e.tierSelect) e.tierSelect.value = '';
        }
        e.minR.setAttribute('aria-valuenow', String(indexToDollars(a)));
        e.maxR.setAttribute('aria-valuenow', String(indexToDollars(b)));
        updateTrackFill(a, b);
    }

    function onRangeInput() {
        var e = getEls();
        if (!e.minR || !e.maxR) return;
        var lo = Number(e.minR.value);
        var hi = Number(e.maxR.value);
        if (lo > hi) {
            if (document.activeElement === e.minR) e.maxR.value = String(lo);
            else e.minR.value = String(hi);
            lo = Number(e.minR.value);
            hi = Number(e.maxR.value);
        }
        applyUiFromIndexes(lo, hi);
        var refresh = window.AR.filters && window.AR.filters.refreshFilterUiState;
        if (typeof refresh === 'function') refresh();
    }

    function reset() {
        applyUiFromIndexes(0, INDEX_MAX);
    }

    function syncFromHidden() {
        var e = getEls();
        if (!e.hMin || !e.hMax || !e.minR || !e.maxR) return;
        var sm = String(e.hMin.value || '').trim();
        var sx = String(e.hMax.value || '').trim();
        if (sm === '' && sx === '') {
            applyUiFromIndexes(0, INDEX_MAX);
            if (e.readout) e.readout.textContent = 'All balances';
            return;
        }
        var lo = dollarsToIndex(sm !== '' ? Number(sm) : 0);
        var hi = dollarsToIndex(sx !== '' ? Number(sx) : INDEX_MAX * DOLLARS_STEP);
        applyUiFromIndexes(lo, hi);
    }

    function onTierSelectChange() {
        var e = getEls();
        if (!e.tierSelect) return;
        if (String(e.tierSelect.value || '').trim()) {
            e.hMin.value = '';
            e.hMax.value = '';
            applyUiFromIndexes(0, INDEX_MAX);
            if (e.readout) e.readout.textContent = 'All balances';
            var refresh = window.AR.filters && window.AR.filters.refreshFilterUiState;
            if (typeof refresh === 'function') refresh();
        }
    }

    function bindOnce() {
        var e = getEls();
        if (!e.minR || !e.maxR || e.minR.dataset.arDepositRangeBound) return;
        e.minR.dataset.arDepositRangeBound = '1';
        e.maxR.dataset.arDepositRangeBound = '1';
        e.minR.addEventListener('input', onRangeInput);
        e.maxR.addEventListener('input', onRangeInput);
        e.minR.addEventListener('change', onRangeInput);
        e.maxR.addEventListener('change', onRangeInput);
        if (e.tierSelect) e.tierSelect.addEventListener('change', onTierSelectChange);
    }

    function init() {
        bindOnce();
        var e = getEls();
        if (e.tierSelect && String(e.tierSelect.value || '').trim()) {
            e.hMin.value = '';
            e.hMax.value = '';
            applyUiFromIndexes(0, INDEX_MAX);
            if (e.readout) e.readout.textContent = 'All balances';
            return;
        }
        syncFromHidden();
    }

    window.AR.depositBalanceRange = {
        init: init,
        reset: reset,
        syncFromHidden: syncFromHidden,
    };

    var filterUi = window.AR.filterUi || {};
    var origInit = typeof filterUi.init === 'function' ? filterUi.init : null;
    filterUi.init = function () {
        if (origInit) origInit.apply(this, arguments);
        init();
    };
    window.AR.filterUi = filterUi;
})();
