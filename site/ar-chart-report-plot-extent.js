(function () {
    'use strict';
    window.AR = window.AR || {};
    var U = window.AR.chartReportPlotUtils || {};
    var positiveRibbonRateOrNull = U.positiveRibbonRateOrNull;
    var finiteRateOrNull = U.finiteRateOrNull;

    function latestRibbonPointForSeries(series, viewStart, ctxMax) {
        var latest = null;
        (series && series.points || []).forEach(function (point) {
            var date = String(point.date || '').slice(0, 10);
            if (!date) return;
            if (viewStart && date < viewStart) return;
            if (ctxMax && date > ctxMax) return;
            var lo = positiveRibbonRateOrNull(point.min_rate);
            var hi = positiveRibbonRateOrNull(point.max_rate);
            var mean = positiveRibbonRateOrNull(point.mean_rate);
            var score = mean != null ? mean : (lo != null && hi != null ? (lo + hi) / 2 : (lo != null ? lo : hi));
            if (score == null) return;
            if (!latest || date > latest.date) {
                latest = {
                    date: date,
                    lo: lo,
                    hi: hi,
                    mean: mean,
                    score: score,
                };
            }
        });
        return latest;
    }

    /** Min/max % for band ribbons only (ignores macro overlays). */
    function computeBandsRateExtentFromPayload(plotPayload, dates) {
        var lo = Infinity;
        var hi = -Infinity;
        (plotPayload && plotPayload.series ? plotPayload.series : []).forEach(function (bank) {
            (bank.points || []).forEach(function (p) {
                var a = positiveRibbonRateOrNull(p.min_rate);
                var b = positiveRibbonRateOrNull(p.max_rate);
                var m = positiveRibbonRateOrNull(p.mean_rate);
                if (a != null) {
                    lo = Math.min(lo, a);
                    hi = Math.max(hi, a);
                }
                if (b != null) {
                    lo = Math.min(lo, b);
                    hi = Math.max(hi, b);
                }
                if (m != null) {
                    lo = Math.min(lo, m);
                    hi = Math.max(hi, m);
                }
            });
        });
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
            lo = 0;
            hi = 8;
        }
        if (hi <= lo) hi = lo + 0.5;
        var span = hi - lo;
        var pad = Math.max(span * 0.06, 0.08);
        return { min: lo - pad, max: hi + pad };
    }

    function extentFromDailyRows(dates, rows, valueKey) {
        var lo = Infinity;
        var hi = -Infinity;
        var vk = valueKey || 'value';
        (dates || []).forEach(function (d) {
            var row = (rows || []).find(function (e) {
                return e && String(e.date).slice(0, 10) === d;
            });
            if (!row) return;
            var v = finiteRateOrNull(row[vk]);
            if (v == null) return;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        });
        if (!Number.isFinite(lo)) return null;
        return { min: lo, max: hi };
    }

    function mergeRateExtents(a, b) {
        if (!a) return b;
        if (!b) return a;
        return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
    }

    function padExtent(ext) {
        if (!ext) return null;
        var span = ext.max - ext.min;
        var pad = Math.max(span * 0.06, 0.08);
        return { min: ext.min - pad, max: ext.max + pad };
    }

    function computeRibbonLodIndices(dateCount, maxCols) {
        if (!Number.isFinite(dateCount) || dateCount <= 1) return null;
        var cap = Math.max(32, Math.floor(maxCols) + 2);
        if (dateCount <= cap) return null;
        var out = [];
        var step = dateCount / cap;
        for (var i = 0; i < dateCount; i += Math.max(1, Math.floor(step))) {
            out.push(Math.min(dateCount - 1, Math.floor(i)));
        }
        if (out[out.length - 1] !== dateCount - 1) out.push(dateCount - 1);
        return out;
    }

    /** Rate changes happen in steps; avoid smoothed interpolation that invents intermediate values. */
    var RIBBON_STEP_MODE = 'end';

    /** Above this count, product polylines use a batched canvas overlay (LOD) instead of one ECharts series each. */
    var RIBBON_ECHARTS_PRODUCT_CAP = 200;

    window.AR.chartReportPlotExtent = {
        latestRibbonPointForSeries: latestRibbonPointForSeries,
        computeBandsRateExtentFromPayload: computeBandsRateExtentFromPayload,
        extentFromDailyRows: extentFromDailyRows,
        mergeRateExtents: mergeRateExtents,
        padExtent: padExtent,
        computeRibbonLodIndices: computeRibbonLodIndices,
        RIBBON_STEP_MODE: RIBBON_STEP_MODE,
        RIBBON_ECHARTS_PRODUCT_CAP: RIBBON_ECHARTS_PRODUCT_CAP,
    };
})();
