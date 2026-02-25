/**
 * Theme (light/dark) init and toggle. Run in head so data-theme is set before first paint.
 * Persists choice in localStorage key "ar-theme"; falls back to prefers-color-scheme.
 */
(function () {
    var STORAGE_KEY = 'ar-theme';

    function getSystemTheme() {
        if (typeof window.matchMedia !== 'function') return 'light';
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function getStoredTheme() {
        try {
            var s = localStorage.getItem(STORAGE_KEY);
            return s === 'light' || s === 'dark' ? s : null;
        } catch (e) {
            return null;
        }
    }

    function applyTheme(theme) {
        var root = document.documentElement;
        if (theme === 'dark' || theme === 'light') {
            root.dataset.theme = theme;
        } else {
            root.removeAttribute('data-theme');
        }
    }

    function init() {
        var theme = getStoredTheme();
        if (!theme) theme = getSystemTheme();
        applyTheme(theme);
    }

    init();

    window.ARTheme = {
        getTheme: function () {
            var stored = getStoredTheme();
            if (stored) return stored;
            return getSystemTheme();
        },
        setTheme: function (theme) {
            if (theme !== 'light' && theme !== 'dark') return;
            try {
                localStorage.setItem(STORAGE_KEY, theme);
            } catch (e) {}
            applyTheme(theme);
        },
        toggle: function () {
            var next = this.getTheme() === 'dark' ? 'light' : 'dark';
            this.setTheme(next);
            return next;
        }
    };
})();
