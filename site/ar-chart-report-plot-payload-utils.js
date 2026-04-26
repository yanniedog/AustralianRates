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

    function combinedDateRange(plotPayload, model) {
        var plotRange = payloadDateRange(plotPayload);
        var modelRange = fallbackSeriesDateBoundsFromModel(model);
        return {
            minDate: earlierDate(plotRange.minDate, modelRange.minDate),
            maxDate: laterDate(plotRange.maxDate, modelRange.maxDate),
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
        bankTrayEntriesFromBandsPayload: bankTrayEntriesFromBandsPayload,
    };
})();
