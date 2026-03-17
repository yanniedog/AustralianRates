(function () {
    'use strict';

    var STORAGE_PREFIX = 'ar-layout-widths:';
    var DESKTOP_QUERY = '(min-width: 1281px)';
    var WIDTHS = {
        left: { key: 'left', min: 240, max: 420, value: 280 },
        right: { key: 'right', min: 260, max: 420, value: 330 },
    };

    var body = document.body;
    var terminal = document.querySelector('.market-terminal');
    if (!body || !terminal || !window.matchMedia) return;

    var leftHandle = document.getElementById('left-rail-resizer');
    var rightHandle = document.getElementById('right-rail-resizer');
    if (!leftHandle) return;

    var desktopQuery = window.matchMedia(DESKTOP_QUERY);
    var section = String(body.getAttribute('data-ar-section') || 'home-loans');
    var storageKey = STORAGE_PREFIX + section;
    var widths = loadWidths();

    applyWidths();
    bindHandle(leftHandle, WIDTHS.left, 1);
    if (rightHandle) bindHandle(rightHandle, WIDTHS.right, -1);
    bindMediaQuery(desktopQuery, syncDesktopState);
    syncDesktopState();

    function bindMediaQuery(query, listener) {
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', listener);
            return;
        }
        if (typeof query.addListener === 'function') query.addListener(listener);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function parseWidth(value, fallback) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function loadWidths() {
        var loaded = {};
        try {
            loaded = JSON.parse(window.localStorage.getItem(storageKey) || '{}') || {};
        } catch (_) {
            loaded = {};
        }
        return {
            left: clamp(parseWidth(loaded.left, WIDTHS.left.value), WIDTHS.left.min, WIDTHS.left.max),
            right: clamp(parseWidth(loaded.right, WIDTHS.right.value), WIDTHS.right.min, WIDTHS.right.max),
        };
    }

    function saveWidths() {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(widths));
        } catch (_) {
            // Ignore storage failures. Layout still works for the session.
        }
    }

    function applyWidths() {
        terminal.style.setProperty('--ar-left-rail-width', widths.left + 'px');
        terminal.style.setProperty('--ar-right-rail-width', widths.right + 'px');
        syncAria(leftHandle, widths.left, WIDTHS.left);
        if (rightHandle) syncAria(rightHandle, widths.right, WIDTHS.right);
    }

    function syncAria(handle, value, config) {
        handle.setAttribute('aria-valuemin', String(config.min));
        handle.setAttribute('aria-valuemax', String(config.max));
        handle.setAttribute('aria-valuenow', String(Math.round(value)));
    }

    function syncDesktopState() {
        if (desktopQuery.matches) {
            applyWidths();
            return;
        }
        body.classList.remove('is-resizing-panels');
        leftHandle.classList.remove('is-active');
        if (rightHandle) rightHandle.classList.remove('is-active');
    }

    function bindHandle(handle, config, direction) {
        handle.addEventListener('pointerdown', function (event) {
            if (!desktopQuery.matches || event.button !== 0) return;
            event.preventDefault();
            startDrag(handle, config, direction, event.clientX, event.pointerId);
        });

        handle.addEventListener('dblclick', function (event) {
            if (!desktopQuery.matches) return;
            event.preventDefault();
            widths[config.key] = config.value;
            applyWidths();
            saveWidths();
        });

        handle.addEventListener('keydown', function (event) {
            if (!desktopQuery.matches) return;
            if (!event || !event.key) return;
            var delta = event.shiftKey ? 24 : 12;
            var next = widths[config.key];
            if (event.key === 'ArrowLeft') next += direction < 0 ? delta : -delta;
            else if (event.key === 'ArrowRight') next += direction < 0 ? -delta : delta;
            else if (event.key === 'Home') next = config.min;
            else if (event.key === 'End') next = config.max;
            else return;
            event.preventDefault();
            widths[config.key] = clamp(next, config.min, config.max);
            applyWidths();
            saveWidths();
        });
    }

    function startDrag(handle, config, direction, startX, pointerId) {
        var startWidth = widths[config.key];

        body.classList.add('is-resizing-panels');
        handle.classList.add('is-active');
        if (typeof handle.setPointerCapture === 'function' && pointerId != null) {
            handle.setPointerCapture(pointerId);
        }

        function finish() {
            body.classList.remove('is-resizing-panels');
            handle.classList.remove('is-active');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onStop);
            window.removeEventListener('pointercancel', onStop);
            saveWidths();
        }

        function onMove(event) {
            if (!desktopQuery.matches) {
                finish();
                return;
            }
            var delta = Number(event.clientX || 0) - startX;
            widths[config.key] = clamp(startWidth + (delta * direction), config.min, config.max);
            applyWidths();
        }

        function onStop() {
            finish();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onStop);
        window.addEventListener('pointercancel', onStop);
    }
})();
