(function () {
    'use strict';
    window.AR = window.AR || {};

    /** When report-plot bands/moves payload has no points, use visible series dates so the chart window matches the main data. */
    function fallbackSeriesDateBoundsFromModel(model) {
        var all = model && (model.allSeries || model.visibleSeries) || [];
        var minDate = '';
        var maxDate = '';
        all.forEach(function (s) {
            (s.points || []).forEach(function (p) {
                var d = String(p && p.date || '').slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
                if (!minDate || d < minDate) minDate = d;
                if (!maxDate || d > maxDate) maxDate = d;
            });
        });
        return { minDate: minDate, maxDate: maxDate };
    }

    function payloadDateRange(plotPayload) {
        var minDate = '';
        var maxDate = '';
        if (!plotPayload) return { minDate: minDate, maxDate: maxDate };
        if (plotPayload.mode === 'moves') {
            (plotPayload.points || []).forEach(function (point) {
                var date = String(point && point.date || '').slice(0, 10);
                if (!date) return;
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
            });
        } else {
            (plotPayload.series || []).forEach(function (series) {
                (series.points || []).forEach(function (point) {
                    var date = String(point && point.date || '').slice(0, 10);
                    if (!date) return;
                    if (!minDate || date < minDate) minDate = date;
                    if (!maxDate || date > maxDate) maxDate = date;
                });
            });
        }
        return { minDate: minDate, maxDate: maxDate };
    }

    /** True when bands payload has at least one series with usable points (avoids stale empty snapshots blocking live fetch). */
    function reportBandsPayloadHasRenderableSeries(payload) {
        if (!payload || payload.mode !== 'bands' || !Array.isArray(payload.series)) return false;
        for (var i = 0; i < payload.series.length; i += 1) {
            var pts = payload.series[i] && payload.series[i].points;
            if (Array.isArray(pts) && pts.length > 0) return true;
        }
        return false;
    }

    /** Moves payload usable for charts (histogram / dual axis). Empty arrays are treated as non-cache-hit. */
    function reportMovesPayloadHasRenderablePoints(payload) {
        if (!payload || payload.mode !== 'moves' || !Array.isArray(payload.points)) return false;
        return payload.points.length > 0;
    }

    function earlierDate(left, right) {
        if (!left) return String(right || '');
        if (!right) return String(left || '');
        return left < right ? left : right;
    }

    function laterDate(left, right) {
        if (!left) return String(right || '');
        if (!right) return String(left || '');
        return left > right ? left : right;
    }

    /** YYYY-MM-DD from snapshot inline filtersResolved (canonical window end matches hero/header). */
    function snapshotFiltersResolvedEndYmd() {
        var data = window.AR && window.AR.snapshot && window.AR.snapshot.data;
        var fr = data && data.filtersResolved;
        var raw = fr && (fr.endDate != null ? fr.endDate : fr.end_date);
        var d = String(raw || '').trim().slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
    }

    /** Third arg unions max date with snapshot window end when bands/report plot is missing or lags overlays. */
    function combinedDateRange(plotPayload, model, snapshotResolvedEndYmd) {
        var plotRange = payloadDateRange(plotPayload);
        var modelRange = fallbackSeriesDateBoundsFromModel(model);
        var maxDate = laterDate(plotRange.maxDate, modelRange.maxDate);
        var snap = snapshotResolvedEndYmd != null && snapshotResolvedEndYmd !== ''
            ? String(snapshotResolvedEndYmd).trim().slice(0, 10)
            : snapshotFiltersResolvedEndYmd();
        if (/^\d{4}-\d{2}-\d{2}$/.test(snap)) {
            maxDate = laterDate(maxDate, snap);
        }
        return {
            minDate: earlierDate(plotRange.minDate, modelRange.minDate),
            maxDate: maxDate,
            plotMaxDate: plotRange.maxDate,
            modelMaxDate: modelRange.maxDate,
        };
    }

    /**
     * Logo tray entries for bands mode: same bank_name strings as plotPayload.series (required for ribbon focus).
     * Returns null if not applicable; caller should fall back to product-derived bank names.
     */
    function bankTrayEntriesFromBandsPayload(plotPayload, bankShortFn) {
        if (!plotPayload || plotPayload.mode !== 'bands' || !plotPayload.series || !plotPayload.series.length) {
            return null;
        }
        var seen = {};
        var list = [];
        plotPayload.series.forEach(function (s) {
            var bn = String(s.bank_name || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (seen[k]) return;
            seen[k] = true;
            var short =
                bankShortFn && typeof bankShortFn === 'function' ? bankShortFn(bn) : String(bn).slice(0, 3);
            list.push({ full: bn, short: short });
        });
        list.sort(function (a, b) {
            return a.short.localeCompare(b.short);
        });
        return list;
    }

    window.AR.chartReportPlotPayloadUtils = {
        fallbackSeriesDateBoundsFromModel: fallbackSeriesDateBoundsFromModel,
        payloadDateRange: payloadDateRange,
        combinedDateRange: combinedDateRange,
        snapshotFiltersResolvedEndYmd: snapshotFiltersResolvedEndYmd,
        bankTrayEntriesFromBandsPayload: bankTrayEntriesFromBandsPayload,
        reportBandsPayloadHasRenderableSeries: reportBandsPayloadHasRenderableSeries,
        reportMovesPayloadHasRenderablePoints: reportMovesPayloadHasRenderablePoints,
    };
})();
