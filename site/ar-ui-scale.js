(function () {
    'use strict';
    window.AR = window.AR || {};

    var STORAGE_KEY = 'ar-public-ui-scale';
    var DEFAULT_PERCENT = 100;
    var MIN_PERCENT = 85;
    var MAX_PERCENT = 130;
    var STEP_PERCENT = 5;
    var resizeTimer = null;
    var currentPercent = DEFAULT_PERCENT;

    function byId(id) {
        return document.getElementById(id);
    }

    function getEls() {
        var dom = window.AR.dom;
        var els = dom && dom.els ? dom.els : {};
        return {
            down: els.uiScaleDown || byId('ui-scale-down'),
            range: els.uiScaleRange || byId('ui-scale-range'),
            up: els.uiScaleUp || byId('ui-scale-up'),
            reset: els.uiScaleReset || byId('ui-scale-reset'),
            value: els.uiScaleValue || byId('ui-scale-value'),
        };
    }

    function normalizePercent(value) {
        if (value == null || value === '') return DEFAULT_PERCENT;
        var parsed = Number(value);
        if (!Number.isFinite(parsed)) return DEFAULT_PERCENT;
        parsed = Math.round(parsed / STEP_PERCENT) * STEP_PERCENT;
        if (parsed < MIN_PERCENT) return MIN_PERCENT;
        if (parsed > MAX_PERCENT) return MAX_PERCENT;
        return parsed;
    }

    function readStoredPercent() {
        try {
            return normalizePercent(window.localStorage.getItem(STORAGE_KEY));
        } catch (_err) {
            return DEFAULT_PERCENT;
        }
    }

    function writeStoredPercent(percent) {
        try {
            if (percent === DEFAULT_PERCENT) {
                window.localStorage.removeItem(STORAGE_KEY);
                return;
            }
            window.localStorage.setItem(STORAGE_KEY, String(percent));
        } catch (_err) {}
    }

    function updateControls(percent) {
        var els = getEls();
        if (els.range) els.range.value = String(percent);
        if (els.value) els.value.textContent = percent + '%';
        if (els.down) els.down.disabled = percent <= MIN_PERCENT;
        if (els.up) els.up.disabled = percent >= MAX_PERCENT;
        if (els.reset) els.reset.disabled = percent === DEFAULT_PERCENT;
    }

    function scheduleResizeSync() {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            window.dispatchEvent(new Event('resize'));
            if (window.AR.ux && typeof window.AR.ux.refresh === 'function') {
                window.AR.ux.refresh();
            }
        }, 80);
    }

    function applyScale(percent, options) {
        var opts = options || {};
        var nextPercent = normalizePercent(percent);
        currentPercent = nextPercent;
        document.documentElement.style.setProperty('--ar-ui-scale', String(nextPercent / 100));
        updateControls(nextPercent);
        if (!opts.skipStorage) writeStoredPercent(nextPercent);
        if (!opts.skipResizeSync) scheduleResizeSync();
    }

    function shiftScale(delta) {
        applyScale(currentPercent + delta);
    }

    function bindControls() {
        var els = getEls();
        if (!els.range) return;

        els.range.addEventListener('input', function () {
            applyScale(els.range.value);
        });
        if (els.down) {
            els.down.addEventListener('click', function () {
                shiftScale(-STEP_PERCENT);
            });
        }
        if (els.up) {
            els.up.addEventListener('click', function () {
                shiftScale(STEP_PERCENT);
            });
        }
        if (els.reset) {
            els.reset.addEventListener('click', function () {
                applyScale(DEFAULT_PERCENT);
            });
        }
    }

    applyScale(readStoredPercent(), { skipResizeSync: true, skipStorage: true });
    bindControls();

    window.AR.uiScale = {
        applyScale: applyScale,
        getPercent: function () {
            return currentPercent;
        },
    };
})();
