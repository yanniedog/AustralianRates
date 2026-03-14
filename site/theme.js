(function () {
    'use strict';

    var STORAGE_KEY = 'ar-theme';
    var root = document.documentElement;
    var boundToggleAttr = 'data-ar-theme-bound';
    var themeTransitionTimer = null;

    function getDefaultTheme() {
        return 'dark';
    }

    function normalizeTheme(value) {
        return String(value || '').toLowerCase() === 'light' ? 'light' : 'dark';
    }

    function readStoredTheme() {
        try {
            var stored = window.localStorage.getItem(STORAGE_KEY);
            return stored ? normalizeTheme(stored) : getDefaultTheme();
        } catch (_err) {
            return getDefaultTheme();
        }
    }

    function themeMeta(theme) {
        var current = normalizeTheme(theme);
        return {
            current: current,
            next: current === 'dark' ? 'light' : 'dark',
            icon: current === 'dark' ? '\u2600' : '\u263E',
            label: current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        };
    }

    function syncToggleButton(button, theme) {
        if (!button) return;
        var meta = themeMeta(theme);
        button.textContent = meta.icon;
        button.setAttribute('aria-label', meta.label);
        button.setAttribute('title', meta.label);
        button.setAttribute('data-theme-current', meta.current);
        button.setAttribute('data-theme-next', meta.next);
    }

    function syncAllToggles(theme) {
        var buttons = document.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < buttons.length; i++) {
            syncToggleButton(buttons[i], theme);
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

    function applyTheme(theme, options) {
        var next = normalizeTheme(theme);
        var opts = options || {};
        if (!opts.skipTransitionClamp && typeof window.setTimeout === 'function') {
            clampThemeTransitions();
        }
        root.setAttribute('data-theme', next);
        root.style.colorScheme = next;

        if (!opts.skipPersist) {
            try {
                window.localStorage.setItem(STORAGE_KEY, next);
            } catch (_err) {}
        }

        syncAllToggles(next);

        if (!opts.silent) {
            window.dispatchEvent(new CustomEvent('ar:theme-changed', {
                detail: { theme: next },
            }));
        }

        return next;
    }

    function getTheme() {
        return normalizeTheme(root.getAttribute('data-theme') || readStoredTheme());
    }

    function setTheme(theme) {
        return applyTheme(theme);
    }

    function toggleTheme() {
        return applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    function bindToggle(button) {
        if (!button || button.getAttribute(boundToggleAttr) === 'true') return button;
        button.setAttribute(boundToggleAttr, 'true');
        syncToggleButton(button, getTheme());
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

    window.ARTheme = {
        bindToggle: bindToggle,
        getTheme: getTheme,
        initToggles: initToggles,
        setTheme: setTheme,
        toggle: toggleTheme,
    };
})();
