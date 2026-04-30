(function () {
    'use strict';
    window.AR = window.AR || {};
    var R = window.AR.ribbon || {};
    var ribbonBankShortName = R.ribbonBankShortName;
    var ribbonRangeText = R.ribbonRangeText;
    var ribbonSpreadBpText = R.ribbonSpreadBpText;
    var ribbonProductSeriesKey = R.ribbonProductSeriesKey;

    var U = window.AR.chartReportPlotUtils || {};
    var isHomeLoan = U.isHomeLoan;
    var hexToRgba = U.hexToRgba;
    var parseHexRgb = U.parseHexRgb;
    var positiveRibbonRateOrNull = U.positiveRibbonRateOrNull;

    var E = window.AR.chartReportPlotExtent || {};
    var latestRibbonPointForSeries = E.latestRibbonPointForSeries;
    var RIBBON_STEP_MODE = E.RIBBON_STEP_MODE;

    function buildRibbonBankSummaryData(plotPayload, allSeries, viewStart, ctxMax) {
        var summaries = {};
        var productCountByBank = {};
        var contenders = [];
        var latestDate = '';
        var cfg = window.AR && window.AR.chartConfig;
        var direction = cfg && typeof cfg.rankDirection === 'function'
            ? cfg.rankDirection('interest_rate')
            : 'asc';

        (allSeries || []).forEach(function (series) {
            var bankName = String(series && series.bankName || '').trim();
            if (!bankName) return;
            productCountByBank[bankName] = (productCountByBank[bankName] || 0) + 1;
        });

        (plotPayload && plotPayload.series || []).forEach(function (series) {
            var bankName = String(series && series.bank_name || '').trim();
            if (!bankName) return;
            var latest = latestRibbonPointForSeries(series, viewStart, ctxMax);
            if (!latest) return;
            latestDate = latestDate && latestDate > latest.date ? latestDate : latest.date;
            var products = productCountByBank[bankName] || 0;
            var rangeText = ribbonRangeText(latest.lo, latest.hi);
            summaries[bankName] = {
                date: latest.date,
                lo: latest.lo,
                hi: latest.hi,
                mean: latest.mean,
                score: latest.score,
                rangeText: rangeText,
                metric: rangeText || (latest.mean != null ? latest.mean.toFixed(2) + '%' : ''),
                meta: [
                    latest.mean != null ? '\u03bc ' + latest.mean.toFixed(2) + '%' : '',
                    ribbonSpreadBpText(latest.lo, latest.hi),
                    products ? products + ' products' : '',
                ].filter(Boolean).join(' \u00b7 '),
                short: ribbonBankShortName(bankName),
            };
        });

        Object.keys(summaries).forEach(function (bankName) {
            var summary = summaries[bankName];
            if (!summary || summary.date !== latestDate) return;
            contenders.push({
                bankName: bankName,
                score: summary.score,
            });
        });

        contenders.sort(function (left, right) {
            if (left.score === right.score) return String(left.bankName || '').localeCompare(String(right.bankName || ''));
            return direction === 'desc' ? right.score - left.score : left.score - right.score;
        });

        return {
            summaries: summaries,
            spotlightBank: contenders.length ? contenders[0].bankName : '',
            spotlightDate: latestDate,
        };
    }

    function getRibbonStyleResolved() {
        var ui = window.AR && window.AR.chartSiteUi;
        if (ui && typeof ui.getChartRibbonStyle === 'function') return ui.getChartRibbonStyle();
        return {
            preset: 'glass',
            edge_width: 1.25,
            edge_opacity: 0.75,
            edge_opacity_others: 0.12,
            fill_opacity_end: 0.14,
            fill_opacity_peak: 0.42,
            focus_fill_opacity_end: 0.26,
            focus_fill_opacity_peak: 0.60,
            selected_fill_opacity_end: 0.34,
            selected_fill_opacity_peak: 0.72,
            fill_opacity_others_scale: 0.22,
            mean_width: 1,
            mean_opacity: 0.9,
            mean_opacity_others: 0.16,
            product_line_opacity_hover: 0.5,
            product_line_opacity_selected: 0.85,
            product_line_width_hover: 1.2,
            product_line_width_selected: 2.5,
            others_grey_mix: 0.62,
            active_z: 48,
            inactive_z: 2,
            gap_fill_enabled: true,
            slice_pair_table_enabled: true,
            slice_pair_font_px: 11,
            slice_pair_text_color: '',
            slice_pair_text_alpha: 1,
            slice_pair_table_bg_color: '',
            slice_pair_table_bg_alpha: 0.22,
            slice_pair_grid_color: '',
            slice_pair_grid_alpha: 0.35,
            slice_pair_grid_width_px: 1,
        };
    }

    /**
     * Vertical gradient fill for a ribbon.
     * - preset 'classic': original 4-stop symmetric fade (end → peak → peak → end).
     * - preset 'glass': 6-stop gradient with a bright highlight near the top (light-on-glass)
     *   and a softer, longer fade below so edges read as translucent rather than hard bands.
     */
    function ribbonFlowGradientFill(hex, endAlpha, peakAlpha, preset) {
        var rgb = parseHexRgb(hex);
        var r = rgb.r;
        var g = rgb.g;
        var b = rgb.b;
        var lo = Math.max(0, Math.min(1, Number(endAlpha) || 0));
        var pk = Math.max(0, Math.min(1, Number(peakAlpha) || 0));
        var stops;
        if (preset === 'classic') {
            stops = [
                { offset: 0,    color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
                { offset: 0.28, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 0.72, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 1,    color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
            ];
        } else {
            var hl = Math.min(1, pk + (1 - pk) * 0.28);
            var loTop = Math.max(0, lo * 0.55);
            stops = [
                { offset: 0,    color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(loTop) + ')' },
                { offset: 0.08, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(hl) + ')' },
                { offset: 0.30, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 0.70, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk * 0.85) + ')' },
                { offset: 1,    color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
            ];
        }
        return {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: stops,
        };
    }

    /**
     * ECharts merges nested areaStyle objects across setOption calls.
     * Clear mutually-exclusive fields so ribbons do not retain stale flat or
     * gradient fill state after switching focus repeatedly. `opacity` is
     * cleared too because scoped ribbon series are initialised with
     * `areaStyle: { opacity: 0 }` to stay hidden until a tier is active;
     * without resetting opacity here the ECharts merge keeps the 0 and the
     * ribbon fill never appears.
     */
    function ribbonAreaStyleMerged(next) {
        var out = {
            type: null,
            x: null,
            y: null,
            x2: null,
            y2: null,
            colorStops: null,
            color: null,
            opacity: 1,
            shadowBlur: 0,
            shadowColor: 'rgba(0,0,0,0)',
            shadowOffsetX: 0,
            shadowOffsetY: 0,
        };
        if (!next || typeof next !== 'object') return out;
        Object.keys(next).forEach(function (key) {
            out[key] = next[key];
        });
        return out;
    }

    function buildMovesSeries(section, dates, plotPayload, theme) {
        var byDate = {};
        (plotPayload && plotPayload.points || []).forEach(function (point) {
            byDate[String(point.date || '').slice(0, 10)] = point;
        });
        var upColor = isHomeLoan(section) ? theme.bad : theme.good;
        var downColor = isHomeLoan(section) ? theme.good : theme.bad;
        var upData = [];
        var downData = [];
        dates.forEach(function (date) {
            var point = byDate[date] || {};
            var upCount = Number(point.up_count || 0);
            var flatCount = Number(point.flat_count || 0);
            var downCount = Number(point.down_count || 0);
            upData.push({ value: [date, upCount], raw: { date: date, up: upCount, flat: flatCount, down: downCount } });
            downData.push({ value: [date, -downCount], raw: { date: date, up: upCount, flat: flatCount, down: downCount } });
        });
        return [
            {
                name: 'Up',
                type: 'bar',
                yAxisIndex: 1,
                barMaxWidth: 10,
                itemStyle: { color: upColor },
                data: upData,
            },
            {
                name: 'Down',
                type: 'bar',
                yAxisIndex: 1,
                barMaxWidth: 10,
                itemStyle: { color: downColor },
                data: downData,
            },
        ];
    }

    /** One-category-wide vertical strips at RBA cash-rate change dates (in view). */
    function buildRbaChangeMarkAreaPairs(dates, decisions, viewStartYmd, ctxMaxYmd, allDecisions) {
        var vs = String(viewStartYmd || '').slice(0, 10);
        var ve = String(ctxMaxYmd || '').slice(0, 10);
        var full = Array.isArray(allDecisions) && allDecisions.length ? allDecisions : decisions;
        var dateToFullIndex = {};
        (full || []).forEach(function (r, i) {
            var key = String(r && r.date || '').slice(0, 10);
            if (key) dateToFullIndex[key] = i;
        });
        var out = [];
        (decisions || []).forEach(function (row) {
            var d = String(row.date || '').slice(0, 10);
            if (!d || d < vs || d > ve) return;
            var ix = dates.indexOf(d);
            if (ix < 0) return;
            var d2 = ix + 1 < dates.length ? dates[ix + 1] : d;
            var change = Number(row.change_bp != null
                ? row.change_bp
                : (row.change != null ? row.change * 100 : (row.change_amount != null ? row.change_amount * 100 : NaN)));
            if (!Number.isFinite(change) || change === 0) {
                var fi = dateToFullIndex[d];
                var rate = Number(row.rate);
                if (fi != null && fi > 0 && Number.isFinite(rate)) {
                    var prevR = Number(full[fi - 1].rate);
                    if (Number.isFinite(prevR)) change = Math.round((rate - prevR) * 100);
                }
            }
            var start = { xAxis: d };
            if (Number.isFinite(change) && change !== 0) {
                var bps = Math.abs(Math.round(change));
                var sign = change > 0 ? '+' : '-';
                var headText = sign + bps + ' bps';
                var arrowGlyph = change > 0 ? '\u25b2' : '\u25bc';
                var arrowLines = [];
                for (var ai = 0; ai < 5; ai++) arrowLines.push(arrowGlyph);
                var arrowBlock = arrowLines.join('\n');
                start.name = headText;
                start.label = {
                    show: true,
                    position: 'insideTop',
                    distance: 2,
                    align: 'center',
                    verticalAlign: 'top',
                    formatter: function () {
                        return '{head|' + headText + '}\n{arr|' + arrowBlock + '}';
                    },
                    rich: {
                        head: {
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#fef9c3',
                            lineHeight: 16,
                            align: 'center',
                            textBorderColor: 'rgba(15,23,42,0.75)',
                            textBorderWidth: 2,
                        },
                        arr: {
                            fontSize: 13,
                            fontWeight: 700,
                            color: '#fde047',
                            lineHeight: 12,
                            align: 'center',
                            textBorderColor: 'rgba(15,23,42,0.65)',
                            textBorderWidth: 1,
                        },
                    },
                };
            }
            out.push([start, { xAxis: d2 }]);
        });
        return out;
    }

    function buildBandSeries(opts) {
        var dates = opts.dates;
        var plotPayload = opts.plotPayload;
        var bankColor = opts.bankColor;
        var rs = opts.ribbonStyle || getRibbonStyleResolved();
        var out = [];
        (plotPayload && plotPayload.series || []).forEach(function (series, index) {
            var color = bankColor(series.bank_name, index);
            var byDate = {};
            (series.points || []).forEach(function (point) {
                byDate[String(point.date || '').slice(0, 10)] = point;
            });
            var gapFillEnabled = rs.gap_fill_enabled !== false;
            var GAP_FILL_MAX_MS = 3 * 86400000;
            var lastKnownPoint = null;
            var lastKnownDate = null;
            var filledByDate = {};
            dates.forEach(function (date) {
                var point = byDate[date];
                if (point != null) {
                    filledByDate[date] = point;
                    lastKnownPoint = point;
                    lastKnownDate = date;
                } else if (gapFillEnabled && lastKnownPoint != null) {
                    var gapMs = new Date(date).getTime() - new Date(lastKnownDate).getTime();
                    if (gapMs > 0 && gapMs <= GAP_FILL_MAX_MS) {
                        filledByDate[date] = lastKnownPoint;
                    }
                }
            });
            var minData = dates.map(function (date) {
                var point = filledByDate[date];
                return [date, point == null ? null : positiveRibbonRateOrNull(point.min_rate)];
            });
            var deltaData = dates.map(function (date) {
                var point = filledByDate[date];
                if (point == null) return [date, null];
                var lo = positiveRibbonRateOrNull(point.min_rate);
                var hi = positiveRibbonRateOrNull(point.max_rate);
                if (lo == null || hi == null || hi < lo) return [date, null];
                return [date, Math.max(0, hi - lo)];
            });
            var meanData = dates.map(function (date) {
                var point = filledByDate[date];
                return [date, point == null ? null : positiveRibbonRateOrNull(point.mean_rate)];
            });
            var maxData = dates.map(function (date) {
                var point = filledByDate[date];
                return [date, point == null ? null : positiveRibbonRateOrNull(point.max_rate)];
            });
            var stackKey = 'band_' + series.bank_name;
            var preset = String(rs.preset || 'glass').toLowerCase() === 'classic' ? 'classic' : 'glass';
            var ew = Math.max(0, Number(rs.edge_width) || 0);
            var eo = Math.max(0, Math.min(1, Number(rs.edge_opacity)));
            var flowEdge = {
                color: color,
                width: ew > 0 ? ew : 0.01,
                opacity: ew > 0 ? eo : 0,
                cap: 'round',
                join: 'round',
            };
            var zBase = Math.max(0, Number(rs.inactive_z) || 2) + index * 0.02;
            out.push({
                id: 'ribbon_min_' + index,
                name: series.bank_name,
                type: 'line',
                yAxisIndex: 0,
                stack: stackKey,
                step: RIBBON_STEP_MODE,
                smooth: false,
                symbol: 'none',
                connectNulls: false,
                lineStyle: flowEdge,
                areaStyle: { opacity: 0 },
                data: minData,
                z: zBase,
            });
            var fillEnd = Math.max(0, Math.min(1, Number(rs.fill_opacity_end)));
            var fillPeak = Math.max(0, Math.min(1, Number(rs.fill_opacity_peak)));
            var fillAreaStyle = ribbonFlowGradientFill(color, fillEnd, fillPeak, preset);
            if (preset === 'glass') {
                fillAreaStyle.shadowBlur = 6;
                fillAreaStyle.shadowColor = hexToRgba(color, 0.22);
                fillAreaStyle.shadowOffsetY = 1;
            }
            out.push({
                id: 'ribbon_fill_' + index,
                name: series.bank_name + ' ribbon',
                type: 'line',
                yAxisIndex: 0,
                stack: stackKey,
                step: RIBBON_STEP_MODE,
                smooth: false,
                symbol: 'none',
                connectNulls: false,
                lineStyle: { color: color, width: 0.01, opacity: 0, cap: 'round', join: 'round' },
                areaStyle: fillAreaStyle,
                data: deltaData,
                z: zBase + 0.01,
            });
            out.push({
                id: 'ribbon_max_' + index,
                name: series.bank_name + ' max',
                type: 'line',
                yAxisIndex: 0,
                step: RIBBON_STEP_MODE,
                smooth: false,
                symbol: 'none',
                connectNulls: false,
                lineStyle: flowEdge,
                data: maxData,
                z: zBase + 0.02,
            });
            var mw = Math.max(0, Number(rs.mean_width) || 0);
            var mo = Math.max(0, Math.min(1, Number(rs.mean_opacity)));
            out.push({
                id: 'ribbon_mean_' + index,
                name: series.bank_name + ' mean',
                type: 'line',
                yAxisIndex: 0,
                step: RIBBON_STEP_MODE,
                smooth: false,
                symbol: 'none',
                connectNulls: false,
                lineStyle: {
                    color: color,
                    width: mw > 0 ? mw : 0.01,
                    opacity: mw > 0 ? mo : 0,
                    type: 'solid',
                    cap: 'round',
                    join: 'round',
                },
                data: meanData,
                z: zBase + 0.03,
            });
        });
        return out;
    }

    /** Build hidden product overlay lines for ribbon hover reveal (ECharts path when product count <= cap). */
    function buildProductOverlay(dates, allSeries, bankColor) {
        var out = [];
        if (!allSeries || !allSeries.length) return out;
        var bankIndexMap = {};
        var bankCount = 0;
        allSeries.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var bk = bn.toLowerCase();
            if (bankIndexMap[bk] == null) { bankIndexMap[bk] = bankCount++; }
            var baseHex = bankColor(bn, bankIndexMap[bk]);
            var pn = String(s.productName || 'Unknown');
            var byDate = {};
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '').slice(0, 10);
                var v = Number(p.value);
                if (d && Number.isFinite(v) && v > 0) byDate[d] = v;
            });
            var hasData = false;
            var data = dates.map(function (date) {
                var v = byDate[date];
                if (v != null) { hasData = true; return [date, v]; }
                return [date, null];
            });
            if (!hasData) return;
            var row = (s.latestRow && typeof s.latestRow === 'object') ? s.latestRow : {};
            var prodKey = ribbonProductSeriesKey(s, bn, pn, row);
            out.push({
                id: 'ribbon_prod_' + out.length,
                name: prodKey,
                type: 'line',
                yAxisIndex: 0,
                smooth: false,
                symbol: 'none',
                connectNulls: false,
                lineStyle: { color: hexToRgba(baseHex, 0.5), width: 1.2, opacity: 0, cap: 'round', join: 'round' },
                silent: true,
                data: data,
                z: 5,
                _ribbonBaseHex: baseHex,
            });
        });
        return out;
    }

    /**
     * Carry each product's last quoted rate forward across calendar gaps ≤3 days (aligned with buildBandSeries
     * on band payloads) so aggregated ribbon geometry matches the declared chart window after sparse ingest points.
     */
    function forwardFillRibbonScalarByDate(dates, byDate, sectionStr) {
        var sec = String(sectionStr || '');
        var GAP_FILL_MAX_MS = 3 * 86400000;
        var out = {};
        Object.keys(byDate || {}).forEach(function (k) {
            var raw = byDate[k];
            if (raw != null && Number.isFinite(raw)) out[k] = raw;
        });
        var lastOrganic = null;
        var lastVal = null;
        (dates || []).forEach(function (date) {
            var v = out[date];
            var organicOk =
                v != null &&
                Number.isFinite(v) &&
                v > 0 &&
                (sec !== 'savings' || v >= 1.0);
            if (organicOk) {
                lastOrganic = date;
                lastVal = v;
                return;
            }
            if (lastOrganic != null && lastVal != null && (v == null || !Number.isFinite(v))) {
                var gapMs = new Date(date).getTime() - new Date(lastOrganic).getTime();
                if (gapMs > 0 && gapMs <= GAP_FILL_MAX_MS) out[date] = lastVal;
            }
        });
        return out;
    }

    /** Flat list + per-bank groups for ribbon canvas overlay and hit-testing. */
    /** @param {object} [canvasOpts] e.g. { section: 'home-loans' } for savings rate rules during forward-fill */
    function buildRibbonCanvasProductModel(dates, allSeries, bankColor, canvasOpts) {
        var flat = [];
        var byBank = {};
        if (!allSeries || !allSeries.length) return { flat: flat, byBank: byBank, count: 0 };
        var section = canvasOpts && canvasOpts.section != null ? String(canvasOpts.section) : '';
        var bankIndexMap = {};
        var bankCount = 0;
        allSeries.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var bk = bn.toLowerCase();
            if (bankIndexMap[bk] == null) { bankIndexMap[bk] = bankCount++; }
            var baseHex = bankColor(bn, bankIndexMap[bk]);
            var pn = String(s.productName || 'Unknown');
            var byDate = {};
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '').slice(0, 10);
                var v = Number(p.value);
                if (d && Number.isFinite(v) && v > 0) byDate[d] = v;
            });
            var hasData = false;
            for (var di = 0; di < dates.length; di++) {
                if (byDate[dates[di]] != null) { hasData = true; break; }
            }
            if (!hasData) return;
            byDate = forwardFillRibbonScalarByDate(dates, byDate, section);
            var row = (s.latestRow && typeof s.latestRow === 'object') ? s.latestRow : {};
            if (!row || Object.keys(row).length === 0) {
                var lp = (s.points && s.points.length) ? s.points[s.points.length - 1] : null;
                if (lp && lp.row && typeof lp.row === 'object') row = lp.row;
            }
            var key = ribbonProductSeriesKey(s, bn, pn, row);
            var entry = {
                key: key,
                bankName: bn,
                productName: pn,
                baseHex: baseHex,
                byDate: byDate,
                row: row,
            };
            flat.push(entry);
            if (!byBank[bn]) byBank[bn] = [];
            byBank[bn].push(entry);
        });
        return { flat: flat, byBank: byBank, count: flat.length };
    }

    window.AR.chartReportPlotSeries = {
        buildRibbonBankSummaryData: buildRibbonBankSummaryData,
        getRibbonStyleResolved: getRibbonStyleResolved,
        ribbonFlowGradientFill: ribbonFlowGradientFill,
        ribbonAreaStyleMerged: ribbonAreaStyleMerged,
        buildMovesSeries: buildMovesSeries,
        buildRbaChangeMarkAreaPairs: buildRbaChangeMarkAreaPairs,
        buildBandSeries: buildBandSeries,
        buildProductOverlay: buildProductOverlay,
        buildRibbonCanvasProductModel: buildRibbonCanvasProductModel,
    };
})();
