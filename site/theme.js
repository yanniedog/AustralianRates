/**
 * Light-only theme bootstrap.
 * Keeps ARTheme API surface for backward compatibility.
 */
(function () {
    'use strict';

    function applyLightTheme() {
        var root = document.documentElement;
        root.setAttribute('data-theme', 'light');
    }

    applyLightTheme();

    window.ARTheme = {
        getTheme: function () {
            return 'light';
        },
        setTheme: function () {
            applyLightTheme();
            return 'light';
        },
        toggle: function () {
            applyLightTheme();
            return 'light';
        }
    };
})();
