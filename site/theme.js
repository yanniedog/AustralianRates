/**
 * Dark-only theme bootstrap.
 * Keeps ARTheme API surface for backward compatibility.
 */
(function () {
    'use strict';

    function applyDarkTheme() {
        var root = document.documentElement;
        root.setAttribute('data-theme', 'dark');
    }

    applyDarkTheme();

    window.ARTheme = {
        getTheme: function () {
            return 'dark';
        },
        setTheme: function () {
            applyDarkTheme();
            return 'dark';
        },
        toggle: function () {
            applyDarkTheme();
            return 'dark';
        }
    };
})();
