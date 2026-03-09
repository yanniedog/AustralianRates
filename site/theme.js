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

/* Microsoft Clarity (session recording, heatmaps) */
(function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r);
    t.async = 1;
    t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
})(window, document, 'clarity', 'script', 'vt4vtenviy');
