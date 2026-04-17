(function () {
    'use strict';
    window.AR = window.AR || {};

    function chartClientLog() {
        var u = window.AR && window.AR.utils;
        return u && typeof u.clientLog === 'function' ? u.clientLog : function () {};
    }

    /** Shorten long strings for session log lines. */
    function chartLogClip(s, maxLen) {
        var t = String(s == null ? '' : s);
        var n = Number(maxLen);
        if (!Number.isFinite(n) || n < 8) n = 72;
        return t.length <= n ? t : t.slice(0, n - 1) + '\u2026';
    }

    /** [P]Bank|Product -> { bank, product } for compact log detail. */
    function chartLogProductParts(selectionKey) {
        var s = String(selectionKey || '');
        if (s.indexOf('[P]') === 0) s = s.slice(3);
        var pipe = s.indexOf('|');
        if (pipe >= 0) {
            return { bank: chartLogClip(s.slice(0, pipe), 40), product: chartLogClip(s.slice(pipe + 1), 56) };
        }
        return { bank: '', product: chartLogClip(s, 56) };
    }

    function isHomeLoan(section) {
        return String(section || '') === 'home-loans';
    }

    function buildDateRange(startYmd, endYmd) {
        var dates = [];
        var current = new Date(String(startYmd || '').slice(0, 10) + 'T12:00:00Z');
        var end = new Date(String(endYmd || '').slice(0, 10) + 'T12:00:00Z');
        if (!Number.isFinite(current.getTime()) || !Number.isFinite(end.getTime()) || current > end) return dates;
        while (current <= end) {
            dates.push(current.toISOString().slice(0, 10));
            current.setUTCDate(current.getUTCDate() + 1);
        }
        return dates;
    }

    function hexToRgba(hex, alpha) {
        var h = String(hex || '').trim();
        if (h.indexOf('rgba(') === 0 || h.indexOf('rgb(') === 0) return h;
        if (h.charAt(0) === '#') h = h.slice(1);
        if (h.length === 3) {
            h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        }
        if (h.length !== 6) return 'rgba(100,116,139,' + String(alpha) + ')';
        var r = parseInt(h.slice(0, 2), 16);
        var g = parseInt(h.slice(2, 4), 16);
        var b = parseInt(h.slice(4, 6), 16);
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return 'rgba(100,116,139,' + String(alpha) + ')';
        return 'rgba(' + r + ',' + g + ',' + b + ',' + String(alpha) + ')';
    }

    function parseHexRgb(hex) {
        var h = String(hex || '').trim();
        if (h.charAt(0) === '#') h = h.slice(1);
        if (h.length === 3) {
            h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        }
        if (h.length !== 6) return { r: 100, g: 116, b: 139 };
        var r = parseInt(h.slice(0, 2), 16);
        var g = parseInt(h.slice(2, 4), 16);
        var b = parseInt(h.slice(4, 6), 16);
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return { r: 100, g: 116, b: 139 };
        return { r: r, g: g, b: b };
    }

    function mixHexWithGrey(hex, t) {
        var u = Math.max(0, Math.min(1, Number(t) || 0));
        var rgb = parseHexRgb(hex);
        var sr = 148;
        var sg = 163;
        var sb = 184;
        var r = Math.round(rgb.r + (sr - rgb.r) * u);
        var g = Math.round(rgb.g + (sg - rgb.g) * u);
        var b = Math.round(rgb.b + (sb - rgb.b) * u);
        function h2(n) {
            var s = Math.max(0, Math.min(255, n)).toString(16);
            return s.length < 2 ? '0' + s : s;
        }
        return '#' + h2(r) + h2(g) + h2(b);
    }

    function fmtReportDateYmd(ymd) {
        var s = String(ymd || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var p = s.split('-');
        var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return m[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
    }

    /** Avoid Number(null)===0 / Number('')===0 in chart data (misleading ribbon dips). */
    function finiteRateOrNull(v) {
        if (v == null || v === '') return null;
        var n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /** Report ribbons: exclude non-positive rates (stale cache / zero rows); matches band SQL excluding interest_rate <= 0. */
    function positiveRibbonRateOrNull(v) {
        var n = finiteRateOrNull(v);
        if (n == null || n <= 0) return null;
        return n;
    }

    window.AR.chartReportPlotUtils = {
        chartClientLog: chartClientLog,
        chartLogClip: chartLogClip,
        chartLogProductParts: chartLogProductParts,
        isHomeLoan: isHomeLoan,
        buildDateRange: buildDateRange,
        hexToRgba: hexToRgba,
        parseHexRgb: parseHexRgb,
        mixHexWithGrey: mixHexWithGrey,
        fmtReportDateYmd: fmtReportDateYmd,
        finiteRateOrNull: finiteRateOrNull,
        positiveRibbonRateOrNull: positiveRibbonRateOrNull,
    };
})();
