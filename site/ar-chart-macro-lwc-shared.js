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

    /**
     * Value of the step immediately before the segment active at ymd (same semantics as LWC step lines).
     * rows: ascending { date, [valueKey] } (e.g. value or rate).
     */
    function prevStepValue(rows, ymd, valueKey) {
        if (!rows || !rows.length || !ymd) return null;
        var vk = valueKey || 'value';
        var y = String(ymd).slice(0, 10);
        var i = -1;
        for (var k = 0; k < rows.length; k++) {
            if (String(rows[k].date).slice(0, 10) <= y) i = k;
            else break;
        }
        if (i <= 0) return null;
        var prev = Number(rows[i - 1][vk]);
        return Number.isFinite(prev) ? prev : null;
    }

    /**
     * Tiny arrow after "%" for legend: deposit = green up / red down; mortgage = red up / green down.
     */
    function rateLegendArrowHtml(current, previous, semantics, goodColor, badColor) {
        var cur = Number(current);
        var prev = previous == null ? null : Number(previous);
        if (prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return '';
        if (Math.abs(cur - prev) < 1e-6) return '';
        var up = cur > prev;
        var st = 'font-size:7px;line-height:1;margin-left:1px;display:inline-block;vertical-align:0.08em;';
        var g = goodColor || '#059669';
        var b = badColor || '#dc2626';
        if (semantics === 'mortgage') {
            if (up) return '<span style="' + st + 'color:' + b + ';">\u25b2</span>';
            return '<span style="' + st + 'color:' + g + ';">\u25bc</span>';
        }
        if (up) return '<span style="' + st + 'color:' + g + ';">\u25b2</span>';
        return '<span style="' + st + 'color:' + b + ';">\u25bc</span>';
    }

    // ── View mode state for report charts ────────────────────────────────────
    var _viewModeBySection = {};

    function getViewMode(section) {
        return _viewModeBySection[section] || { mode: 'bank', focusBank: '' };
    }

    function setViewMode(section, mode, focusBank) {
        _viewModeBySection[section] = { mode: mode || 'bank', focusBank: focusBank || '' };
    }

    function productColorVariant(baseHex, idx, total) {
        if (total <= 1 || idx === 0) return baseHex;
        var r = parseInt(baseHex.slice(1, 3), 16);
        var g = parseInt(baseHex.slice(3, 5), 16);
        var b = parseInt(baseHex.slice(5, 7), 16);
        var alpha = Math.max(0.35, 1 - idx * 0.22);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
    }

    function shortProductName(name) {
        var s = String(name || '').trim();
        if (s.length <= 20) return s;
        return s.slice(0, 19).trim() + '\u2026';
    }

    function escHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Last finite normalized_value along an economic overlay point list (chronological). */
    function lastFiniteNormalizedOverlay(points) {
        var last = null;
        (Array.isArray(points) ? points : []).forEach(function (p) {
            if (p && Number.isFinite(Number(p.normalized_value))) last = Number(p.normalized_value);
        });
        return last;
    }

    /**
     * HTML row for indexed economic overlay in the report legend (dashed swatch matches LWC overlay series).
     */
    function economicOverlayLegendItemHtml(color, label, value) {
        if (value == null || !Number.isFinite(Number(value))) return '';
        var c = String(color || '#64748b').replace(/[<>"'&]/g, '');
        var lbl = escHtml(String(label || ''));
        var v = Number(value).toFixed(1);
        return '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">' +
            '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + c + ';flex-shrink:0;"></span>' +
            '<span style="opacity:0.75;color:' + c + ';">' + lbl + '</span>' +
            '<span style="font-variant-numeric:tabular-nums;font-weight:600;color:' + c + ';">' + v + '</span></span>';
    }

    window.AR.chartMacroLwcShared = {
        ymdToUtc: ymdToUtc,
        utcToYmd: utcToYmd,
        fillForwardDaily: fillForwardDaily,
        cpiAtDate: cpiAtDate,
        prepareRbaCpiForReport: prepareRbaCpiForReport,
        prevStepValue: prevStepValue,
        rateLegendArrowHtml: rateLegendArrowHtml,
        getViewMode: getViewMode,
        setViewMode: setViewMode,
        productColorVariant: productColorVariant,
        shortProductName: shortProductName,
        escHtml: escHtml,
        lastFiniteNormalizedOverlay: lastFiniteNormalizedOverlay,
        economicOverlayLegendItemHtml: economicOverlayLegendItemHtml,
    };
})();
