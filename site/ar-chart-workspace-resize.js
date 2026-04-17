(function () {
    'use strict';

    var body = document.body;
    var workspace = document.querySelector('.chart-workspace');
    var handle = document.getElementById('chart-workspace-resizer');
    if (!body || !workspace || !handle || !window.matchMedia) return;

    var SECTION = String(body.getAttribute('data-ar-section') || 'home-loans');
    var STORAGE_KEY = 'ar-chart-workspace-size:' + SECTION;
    var DESKTOP_QUERY = '(min-width: 981px)';
    var desktopQuery = window.matchMedia(DESKTOP_QUERY);
    var sizes = loadSizes();

    applySizes();
    bindMediaQuery(desktopQuery, syncMode);
    bindHandle();
    bindWindowResize();
    syncMode();

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

    function parseNumber(value, fallback) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function workspaceHeight() {
        var rect = workspace.getBoundingClientRect();
        return Math.max(0, Math.round(rect.height || 0));
    }

    function workspaceWidth() {
        var rect = workspace.getBoundingClientRect();
        return Math.max(0, Math.round(rect.width || 0));
    }

    function sideWidthConfig() {
        var total = workspaceWidth() || Math.max(720, Math.round((window.innerWidth || 1280) * 0.72));
        var min = 240;
        var max = Math.max(min + 120, total - 240);
        var value = clamp(Math.round(total * 0.5), min, max);
        return { min: min, max: max, value: value };
    }

    function topHeightConfig() {
        var total = workspaceHeight() || Math.max(420, Math.round((window.innerHeight || 844) * 0.58));
        var min = Math.max(160, Math.round(total * 0.3));
        var max = Math.max(min + 72, total - 160);
        var value = clamp(Math.round(total * 0.5), min, max);
        return { min: min, max: max, value: value };
    }

    function loadSizes() {
        var loaded = {};
        try {
            loaded = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
        } catch (_) {
            loaded = {};
        }
        var widthCfg = sideWidthConfig();
        var topCfg = topHeightConfig();
        return {
            sideWidth: clamp(parseNumber(loaded.sideWidth, widthCfg.value), widthCfg.min, widthCfg.max),
            topHeight: clamp(parseNumber(loaded.topHeight, topCfg.value), topCfg.min, topCfg.max),
        };
    }

    function saveSizes() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
        } catch (_) {
            // Ignore storage failures.
        }
    }

    function applySizes() {
        var widthCfg = sideWidthConfig();
        var topCfg = topHeightConfig();
        sizes.sideWidth = clamp(sizes.sideWidth, widthCfg.min, widthCfg.max);
        sizes.topHeight = clamp(sizes.topHeight, topCfg.min, topCfg.max);
        workspace.style.setProperty('--ar-chart-side-panel-width', sizes.sideWidth + 'px');
        workspace.style.setProperty('--ar-chart-mobile-top-height', sizes.topHeight + 'px');
        syncAria();
    }

    function syncAria() {
        var isDesktop = desktopQuery.matches;
        var cfg = isDesktop ? sideWidthConfig() : topHeightConfig();
        var value = isDesktop ? sizes.sideWidth : sizes.topHeight;
        handle.setAttribute('aria-orientation', isDesktop ? 'vertical' : 'horizontal');
        handle.setAttribute('aria-valuemin', String(cfg.min));
        handle.setAttribute('aria-valuemax', String(cfg.max));
        handle.setAttribute('aria-valuenow', String(Math.round(value)));
        handle.setAttribute(
            'aria-label',
            isDesktop
                ? 'Resize chart and hierarchy columns'
                : 'Resize hierarchy and chart rows'
        );
        handle.dataset.resizeMode = isDesktop ? 'desktop' : 'mobile';
    }

    function syncMode() {
        body.classList.toggle('is-chart-workspace-desktop', desktopQuery.matches);
        body.classList.toggle('is-chart-workspace-mobile', !desktopQuery.matches);
        applySizes();
    }

    function bindWindowResize() {
        window.addEventListener('resize', function () {
            applySizes();
        });
    }

    function bindHandle() {
        handle.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) return;
            event.preventDefault();
            startDrag(event);
        });

        handle.addEventListener('dblclick', function (event) {
            event.preventDefault();
            var widthCfg = sideWidthConfig();
            var topCfg = topHeightConfig();
            sizes.sideWidth = widthCfg.value;
            sizes.topHeight = topCfg.value;
            applySizes();
            saveSizes();
        });

        handle.addEventListener('keydown', function (event) {
            if (!event || !event.key) return;
            var isDesktop = desktopQuery.matches;
            var cfg = isDesktop ? sideWidthConfig() : topHeightConfig();
            var delta = event.shiftKey ? 32 : 16;
            var next = isDesktop ? sizes.sideWidth : sizes.topHeight;
            if (isDesktop) {
                if (event.key === 'ArrowLeft') next += delta;
                else if (event.key === 'ArrowRight') next -= delta;
                else if (event.key === 'Home') next = cfg.min;
                else if (event.key === 'End') next = cfg.max;
                else return;
                sizes.sideWidth = clamp(next, cfg.min, cfg.max);
            } else {
                if (event.key === 'ArrowUp') next -= delta;
                else if (event.key === 'ArrowDown') next += delta;
                else if (event.key === 'Home') next = cfg.min;
                else if (event.key === 'End') next = cfg.max;
                else return;
                sizes.topHeight = clamp(next, cfg.min, cfg.max);
            }
            event.preventDefault();
            applySizes();
            saveSizes();
        });
    }

    function startDrag(event) {
        var isDesktop = desktopQuery.matches;
        var cfg = isDesktop ? sideWidthConfig() : topHeightConfig();
        var startValue = isDesktop ? sizes.sideWidth : sizes.topHeight;
        var startCoord = isDesktop ? Number(event.clientX || 0) : Number(event.clientY || 0);
        var pointerId = event.pointerId;

        body.classList.add('is-resizing-chart-workspace');
        handle.classList.add('is-active');
        if (typeof handle.setPointerCapture === 'function' && pointerId != null) {
            handle.setPointerCapture(pointerId);
        }

        function finish() {
            body.classList.remove('is-resizing-chart-workspace');
            handle.classList.remove('is-active');
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onStop);
            handle.removeEventListener('pointercancel', onStop);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onStop);
            window.removeEventListener('pointercancel', onStop);
            saveSizes();
        }

        function onMove(moveEvent) {
            var coord = isDesktop ? Number(moveEvent.clientX || 0) : Number(moveEvent.clientY || 0);
            var delta = coord - startCoord;
            if (isDesktop) {
                sizes.sideWidth = clamp(startValue - delta, cfg.min, cfg.max);
            } else {
                sizes.topHeight = clamp(startValue + delta, cfg.min, cfg.max);
            }
            applySizes();
        }

        function onStop() {
            finish();
        }

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onStop);
        handle.addEventListener('pointercancel', onStop);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onStop);
        window.addEventListener('pointercancel', onStop);
    }
})();
