(function () {
    'use strict';
    window.AR = window.AR || {};

    function pct(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(3) + '%';
    }

    function money(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return '$' + n.toFixed(2);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window._arEsc = esc;
    window.AR.utils = { pct: pct, money: money, esc: esc };
})();
