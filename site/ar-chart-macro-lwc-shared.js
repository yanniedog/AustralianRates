/**
 * Shared RBA + CPI preparation for Economic / Home Loan / Term Deposit LWC report charts.
 * Single implementation so macro overlays match home loans everywhere.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    function ymdToUtc(ymd) {
        var p = ymd.split('-');
        return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 1000;
    }

    function utcToYmd(ts) {
        return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    }

    function fillForwardDaily(points, dateKey, valKey, startYmd, endYmd) {
        var result = [];
        var cur = new Date(startYmd + 'T00:00:00Z');
        var end = new Date(endYmd + 'T00:00:00Z');
        var last = null;
        var idx = 0;
        while (cur <= end) {
            var d = cur.toISOString().slice(0, 10);
            while (idx < points.length && points[idx][dateKey] <= d) {
                last = points[idx][valKey];
                idx++;
            }
            if (last !== null) result.push({ date: d, value: last });
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return result;
    }

    function buildRbaSeries(rbaHistory) {
        if (!Array.isArray(rbaHistory) || !rbaHistory.length) return { points: [], decisions: [] };
        var all = rbaHistory.map(function (row) {
            return {
                date: String(row.effective_date || row.date || '').slice(0, 10),
                rate: Number(row.cash_rate != null ? row.cash_rate : row.value),
            };
        }).filter(function (row) {
            return row.date && Number.isFinite(row.rate);
        }).sort(function (left, right) {
            return left.date.localeCompare(right.date);
        });

        var deduped = [];
        all.forEach(function (row) {
            if (!deduped.length || row.rate !== deduped[deduped.length - 1].rate) deduped.push(row);
        });

        return { points: deduped.slice(), decisions: deduped.slice() };
    }

    function buildCpiSeries(cpiData) {
        return (Array.isArray(cpiData) ? cpiData : []).map(function (row) {
            return {
                date: String(row.quarter_date || row.date || '').slice(0, 10),
                value: Number(row.annual_change != null ? row.annual_change : row.value),
            };
        }).filter(function (row) {
            return row.date && Number.isFinite(row.value);
        }).sort(function (left, right) {
            return left.date.localeCompare(right.date);
        });
    }

    function cpiAtDate(points, dateStr) {
        var value = null;
        for (var i = 0; i < points.length; i++) {
            if (String(points[i].date) <= dateStr) value = points[i].value;
        }
        return value;
    }

    /**
     * Match home-loan report: anchor RBA at first CPI quarter, clip to ctxMax, extend both to ctxMax.
     */
    function prepareRbaCpiForReport(rbaHistory, cpiData, ctxMax) {
        var rbaData = buildRbaSeries(rbaHistory || []);
        var cpiPoints = buildCpiSeries(cpiData || []);

        var rbaStart = cpiPoints.length ? cpiPoints[0].date : ctxMin;

        var carry = null;
        var inWindow = [];
        rbaData.points.forEach(function (point) {
            if (point.date < rbaStart) carry = point;
            else if (point.date <= ctxMax) inWindow.push(point);
        });
        var next = [];
        var carryRate = carry ? carry.rate : (inWindow.length ? inWindow[0].rate : null);
        if (carryRate != null) next.push({ date: rbaStart, rate: carryRate });
        next = next.concat(inWindow);
        if (next.length) {
            var last = next[next.length - 1];
            if (last.date < ctxMax) next.push({ date: ctxMax, rate: last.rate });
        }
        rbaData.points = next;

        if (cpiPoints.length) {
            var cpiLast = cpiPoints[cpiPoints.length - 1];
            if (cpiLast.date < ctxMax) {
                cpiPoints.push({ date: ctxMax, value: cpiLast.value });
            }
        }

        return { rbaData: rbaData, cpiPoints: cpiPoints, rbaStart: rbaStart };
    }

    window.AR.chartMacroLwcShared = {
        ymdToUtc: ymdToUtc,
        utcToYmd: utcToYmd,
        fillForwardDaily: fillForwardDaily,
        cpiAtDate: cpiAtDate,
        prepareRbaCpiForReport: prepareRbaCpiForReport,
    };
})();
