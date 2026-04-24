(function () {
    'use strict';

    var STORAGE_KEY = 'ar-theme';
    var root = document.documentElement;
    var boundToggleAttr = 'data-ar-theme-bound';
    var themeTransitionTimer = null;

    function getDefaultThemeMode() {
        return 'system';
    }

    function normalizeMode(value) {
        var v = String(value || '').toLowerCase();
        if (v === 'light' || v === 'dark' || v === 'system') return v;
        return getDefaultThemeMode();
    }

    function normalizeTheme(value) {
        return String(value || '').toLowerCase() === 'light' ? 'light' : 'dark';
    }

    function systemTheme() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
        } catch (_err) {}
        return 'dark';
    }

    function resolveMode(mode) {
        var normalized = normalizeMode(mode);
        return normalized === 'system' ? systemTheme() : normalized;
    }

    function readStoredTheme() {
        try {
            var stored = window.localStorage.getItem(STORAGE_KEY);
            return stored ? normalizeMode(stored) : getDefaultThemeMode();
        } catch (_err) {
            return getDefaultThemeMode();
        }
    }

    function themeMeta(mode, resolved) {
        var currentMode = normalizeMode(mode);
        var current = normalizeTheme(resolved || resolveMode(currentMode));
        var nextMode = currentMode === 'system' ? 'light' : (currentMode === 'light' ? 'dark' : 'system');
        return {
            current: current,
            mode: currentMode,
            next: nextMode,
            icon: currentMode === 'system' ? '\u25d0' : (current === 'dark' ? '\u2600' : '\u263e'),
            label: currentMode === 'system'
                ? 'Theme follows system. Switch to light mode'
                : (currentMode === 'light' ? 'Light mode. Switch to dark mode' : 'Dark mode. Switch to system theme'),
        };
    }

    function syncToggleButton(button, mode, resolved) {
        if (!button) return;
        var meta = themeMeta(mode, resolved);
        var visibleLabel = button.getAttribute('data-theme-label') || 'Theme';
        if (button.classList.contains('site-action-btn')) {
            button.innerHTML = '<span class="site-action-glyph" aria-hidden="true">' + meta.icon + '</span><span class="site-action-text">' + visibleLabel + '</span>';
        } else {
            button.textContent = meta.icon;
        }
        button.setAttribute('aria-label', meta.label);
        button.setAttribute('title', meta.label);
        button.setAttribute('data-theme-current', meta.current);
        button.setAttribute('data-theme-next', meta.next);
        button.setAttribute('data-theme-mode', meta.mode);
    }

    function syncAllToggles(mode, resolved) {
        var buttons = document.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < buttons.length; i++) {
            syncToggleButton(buttons[i], mode, resolved);
        }
    }

    function clampThemeTransitions() {
        if (themeTransitionTimer != null) {
            window.clearTimeout(themeTransitionTimer);
        }
        root.setAttribute('data-theme-switching', 'true');
        themeTransitionTimer = window.setTimeout(function () {
            root.removeAttribute('data-theme-switching');
            themeTransitionTimer = null;
        }, 220);
    }

    function applyTheme(mode, options) {
        var nextMode = normalizeMode(mode);
        var next = resolveMode(nextMode);
        var opts = options || {};
        if (!opts.skipTransitionClamp && typeof window.setTimeout === 'function') {
            clampThemeTransitions();
        }
        root.setAttribute('data-theme', next);
        root.setAttribute('data-theme-mode', nextMode);
        root.style.colorScheme = next;

        if (!opts.skipPersist) {
            try {
                window.localStorage.setItem(STORAGE_KEY, nextMode);
            } catch (_err) {}
        }

        syncAllToggles(nextMode, next);

        if (!opts.silent) {
            window.dispatchEvent(new CustomEvent('ar:theme-changed', {
                detail: { theme: next, mode: nextMode },
            }));
        }

        return next;
    }

    function getTheme() {
        return normalizeTheme(root.getAttribute('data-theme') || readStoredTheme());
    }

    function getMode() {
        return normalizeMode(root.getAttribute('data-theme-mode') || readStoredTheme());
    }

    function setTheme(theme) {
        return applyTheme(theme);
    }

    function toggleTheme() {
        var mode = getMode();
        return applyTheme(mode === 'system' ? 'light' : (mode === 'light' ? 'dark' : 'system'));
    }

    function bindToggle(button) {
        if (!button || button.getAttribute(boundToggleAttr) === 'true') return button;
        button.setAttribute(boundToggleAttr, 'true');
        syncToggleButton(button, getMode(), getTheme());
        button.addEventListener('click', function () {
            toggleTheme();
        });
        return button;
    }

    function initToggles(scope) {
        var rootEl = scope && scope.querySelectorAll ? scope : document;
        var buttons = rootEl.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < buttons.length; i++) {
            bindToggle(buttons[i]);
        }
    }

    applyTheme(readStoredTheme(), { skipPersist: true, silent: true, skipTransitionClamp: true });

    try {
        if (window.matchMedia) {
            var media = window.matchMedia('(prefers-color-scheme: light)');
            var onSystemThemeChange = function () {
                if (getMode() === 'system') applyTheme('system', { skipPersist: true });
            };
            if (media.addEventListener) media.addEventListener('change', onSystemThemeChange);
            else if (media.addListener) media.addListener(onSystemThemeChange);
        }
    } catch (_err) {}

    window.ARTheme = {
        bindToggle: bindToggle,
        getMode: getMode,
        getTheme: getTheme,
        initToggles: initToggles,
        setTheme: setTheme,
        toggle: toggleTheme,
    };
})();
