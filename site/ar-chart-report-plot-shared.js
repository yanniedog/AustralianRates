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

    /** Above this count, product polylines use a batched canvas overlay (LOD) instead of one ECharts series each. */
    var RIBBON_ECHARTS_PRODUCT_CAP = 200;

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

    function ribbonBankShortName(bankName) {
        var shared = window.AR && window.AR.chartMacroLwcShared;
        if (shared && typeof shared.bankAcronym === 'function') return shared.bankAcronym(bankName);
        return String(bankName || '').trim();
    }

    function ribbonRangeText(lo, hi) {
        if (lo == null && hi == null) return '';
        if (lo != null && hi != null) {
            return lo !== hi ? lo.toFixed(2) + '\u2013' + hi.toFixed(2) + '%' : lo.toFixed(2) + '%';
        }
        var one = lo != null ? lo : hi;
        return one != null ? one.toFixed(2) + '%' : '';
    }

    function ribbonSpreadBpText(lo, hi) {
        if (lo == null || hi == null || hi < lo) return '';
        return Math.round((hi - lo) * 100) + 'bp spread';
    }

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
            edge_width: 2,
            edge_opacity: 1,
            edge_opacity_others: 0.14,
            fill_opacity_end: 0.22,
            fill_opacity_peak: 0.48,
            focus_fill_opacity_end: 0.34,
            focus_fill_opacity_peak: 0.70,
            selected_fill_opacity_end: 0.44,
            selected_fill_opacity_peak: 0.82,
            fill_opacity_others_scale: 0.22,
            mean_width: 1.6,
            mean_opacity: 1,
            mean_opacity_others: 0.18,
            product_line_opacity_hover: 0.5,
            product_line_opacity_selected: 0.85,
            product_line_width_hover: 1.2,
            product_line_width_selected: 2.5,
            others_grey_mix: 0.62,
            active_z: 48,
            inactive_z: 2,
        };
    }

    /** Vertical gradient so filled ribbon reads as a soft tube in cross-section (bright core, faded edges). */
    function ribbonFlowGradientFill(hex, endAlpha, peakAlpha) {
        var rgb = parseHexRgb(hex);
        var r = rgb.r;
        var g = rgb.g;
        var b = rgb.b;
        var lo = Math.max(0, Math.min(1, Number(endAlpha) || 0));
        var pk = Math.max(0, Math.min(1, Number(peakAlpha) || 0));
        return {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
                { offset: 0,    color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
                { offset: 0.28, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 0.72, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 1,    color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
            ],
        };
    }

    /**
     * ECharts merges nested areaStyle objects across setOption calls.
     * Clear mutually-exclusive fields so ribbons do not retain stale flat or
     * gradient fill state after switching focus repeatedly.
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
        };
        if (!next || typeof next !== 'object') return out;
        Object.keys(next).forEach(function (key) {
            out[key] = next[key];
        });
        return out;
    }

    /** Rate changes happen in steps; avoid smoothed interpolation that invents intermediate values. */
    var RIBBON_STEP_MODE = 'end';

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

    /** One-category-wide vertical strips at RBA cash-rate change dates (in view). */
    function buildRbaChangeMarkAreaPairs(dates, decisions, viewStartYmd, ctxMaxYmd) {
        var vs = String(viewStartYmd || '').slice(0, 10);
        var ve = String(ctxMaxYmd || '').slice(0, 10);
        var out = [];
        (decisions || []).forEach(function (row) {
            var d = String(row.date || '').slice(0, 10);
            if (!d || d < vs || d > ve) return;
            var ix = dates.indexOf(d);
            if (ix < 0) return;
            var d2 = ix + 1 < dates.length ? dates[ix + 1] : d;
            out.push([{ xAxis: d }, { xAxis: d2 }]);
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
            var minData = dates.map(function (date) {
                var point = byDate[date];
                return [date, point == null ? null : positiveRibbonRateOrNull(point.min_rate)];
            });
            var deltaData = dates.map(function (date) {
                var point = byDate[date];
                if (point == null) return [date, null];
                var lo = positiveRibbonRateOrNull(point.min_rate);
                var hi = positiveRibbonRateOrNull(point.max_rate);
                if (lo == null || hi == null || hi < lo) return [date, null];
                return [date, Math.max(0, hi - lo)];
            });
            var meanData = dates.map(function (date) {
                var point = byDate[date];
                return [date, point == null ? null : positiveRibbonRateOrNull(point.mean_rate)];
            });
            var maxData = dates.map(function (date) {
                var point = byDate[date];
                return [date, point == null ? null : positiveRibbonRateOrNull(point.max_rate)];
            });
            var stackKey = 'band_' + series.bank_name;
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
                areaStyle: ribbonFlowGradientFill(color, fillEnd, fillPeak),
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

    function ribbonTierFieldsForSection(sec) {
        var s = String(sec || '');
        if (s === 'home-loans') {
            return ['security_purpose', 'repayment_type', 'rate_structure', 'lvr_tier', 'feature_set', 'product_name', 'product_id'];
        }
        if (s === 'savings') {
            return ['account_type', 'rate_type', 'deposit_tier', 'feature_set', 'product_name', 'product_id'];
        }
        if (s === 'term-deposits') {
            return ['term_months', 'deposit_tier', 'interest_payment', 'rate_structure', 'feature_set', 'product_name', 'product_id'];
        }
        return ['security_purpose', 'repayment_type', 'rate_structure', 'product_name', 'product_id'];
    }

    function formatRibbonTierValue(row, field) {
        if (!row || typeof row !== 'object') return '';
        var cfg = window.AR && window.AR.chartConfig;
        if (cfg && typeof cfg.formatFieldValue === 'function') {
            var out = cfg.formatFieldValue(field, row[field], row);
            if (out != null && String(out).trim() !== '' && String(out) !== '-') return String(out).trim();
        }
        if (row[field] != null && String(row[field]).trim() !== '') return String(row[field]).trim();
        return '';
    }

    function ribbonFieldLabel(field) {
        var cfg = window.AR && window.AR.chartConfig;
        if (cfg && typeof cfg.fieldLabel === 'function') return cfg.fieldLabel(field);
        return String(field || '').replace(/_/g, ' ');
    }

    function buildRibbonTierTree(prods, tierFields, fieldIdx) {
        if (!prods || prods.length === 0) return { kind: 'empty' };
        if (prods.length === 1 || fieldIdx >= (tierFields || []).length) {
            return { kind: 'leaves', products: prods.slice() };
        }
        var field = tierFields[fieldIdx];
        var groups = {};
        prods.forEach(function (p) {
            var raw = formatRibbonTierValue(p.row || {}, field);
            var key = raw || '\u2014';
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        });
        var labels = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b); });
        if (labels.length === 1) {
            return buildRibbonTierTree(groups[labels[0]], tierFields, fieldIdx + 1);
        }
        return {
            kind: 'branch',
            field: field,
            groups: labels.map(function (lab) {
                return { label: lab, child: buildRibbonTierTree(groups[lab], tierFields, fieldIdx + 1) };
            }),
        };
    }

    function ribbonRateAtAnchorForHierarchy(p, anchorYmd, secStr) {
        var v = p.byDate[anchorYmd];
        if (v == null || !Number.isFinite(v) || v <= 0) return null;
        if (secStr === 'savings' && v < 1.0) return null;
        return v;
    }

    /** Min/max rates under a tier node at anchor date (same inclusion rules as hierarchy leaf rows). */
    function minMaxRibbonNodeRates(node, anchorYmd, secStr) {
        if (!node || node.kind === 'empty') return null;
        if (node.kind === 'leaves') {
            var minV = Infinity;
            var maxV = -Infinity;
            node.products.forEach(function (p) {
                var v = ribbonRateAtAnchorForHierarchy(p, anchorYmd, secStr);
                if (v == null) return;
                if (v < minV) minV = v;
                if (v > maxV) maxV = v;
            });
            if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return null;
            return { min: minV, max: maxV };
        }
        var minA = Infinity;
        var maxA = -Infinity;
        (node.groups || []).forEach(function (g) {
            var mm = minMaxRibbonNodeRates(g.child, anchorYmd, secStr);
            if (!mm) return;
            if (mm.min < minA) minA = mm.min;
            if (mm.max > maxA) maxA = mm.max;
        });
        if (!Number.isFinite(minA) || !Number.isFinite(maxA)) return null;
        return { min: minA, max: maxA };
    }

    function formatRibbonTierRateRange(mm) {
        if (!mm || !Number.isFinite(mm.min) || !Number.isFinite(mm.max)) return '';
        var a = mm.min.toFixed(2);
        var b = mm.max.toFixed(2);
        return a === b ? a + '%' : a + '%\u2013' + b + '%';
    }

    function collectRibbonNodeKeys(node) {
        var out = [];
        collectRibbonNodeKeysInto(node, out);
        return out;
    }

    function collectRibbonNodeKeysInto(node, out) {
        if (!node || node.kind === 'empty') return;
        if (node.kind === 'leaves') {
            node.products.forEach(function (p) { out.push(p.key); });
            return;
        }
        (node.groups || []).forEach(function (g) {
            collectRibbonNodeKeysInto(g.child, out);
        });
    }

    function ribbonProductSeriesKey(series, bankName, productName, row) {
        var latestRow = row;
        if ((!latestRow || typeof latestRow !== 'object' || Object.keys(latestRow).length === 0) && series && typeof series === 'object') {
            latestRow = (series.latestRow && typeof series.latestRow === 'object') ? series.latestRow : null;
            if ((!latestRow || Object.keys(latestRow).length === 0) && Array.isArray(series.points) && series.points.length) {
                var lastPoint = series.points[series.points.length - 1];
                if (lastPoint && lastPoint.row && typeof lastPoint.row === 'object') latestRow = lastPoint.row;
            }
        }
        var rawKey = latestRow && (
            latestRow.product_key ||
            latestRow.series_key ||
            latestRow.product_id
        );
        if (rawKey != null && String(rawKey).trim() !== '') return '[P]' + String(rawKey).trim();
        if (series && series.key != null && String(series.key).trim() !== '') return '[P]' + String(series.key).trim();
        return '[P]' + String(bankName || '').trim() + '|' + String(productName || 'Unknown').trim();
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

    /** Flat list + per-bank groups for ribbon canvas overlay and hit-testing. */
    function buildRibbonCanvasProductModel(dates, allSeries, bankColor) {
        var flat = [];
        var byBank = {};
        if (!allSeries || !allSeries.length) return { flat: flat, byBank: byBank, count: 0 };
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

    function createMovesStrip(options) {
        var plotPayload = options && options.plotPayload;
        var range = options && options.range || {};
        var theme = options && options.theme || {};
        var section = options && options.section;
        if (!plotPayload || plotPayload.mode !== 'moves') return null;
        var dates = buildDateRange(range.viewStart, range.ctxMax);
        if (!dates.length) return null;

        var byDate = {};
        (plotPayload.points || []).forEach(function (point) {
            byDate[String(point.date || '').slice(0, 10)] = point;
        });

        var points = dates.map(function (date) {
            var point = byDate[date] || {};
            return {
                date: date,
                up: Math.max(0, Number(point.up_count || 0)),
                down: Math.max(0, Number(point.down_count || 0)),
            };
        });
        var maxCount = 0;
        points.forEach(function (point) {
            maxCount = Math.max(maxCount, point.up, point.down);
        });
        if (!maxCount) return null;

        var upColor = isHomeLoan(section) ? theme.bad : theme.good;
        var downColor = isHomeLoan(section) ? theme.good : theme.bad;
        var wrap = document.createElement('div');
        wrap.className = 'lwc-report-moves-strip';

        var labelRow = document.createElement('div');
        labelRow.className = 'lwc-report-moves-strip-header';
        labelRow.innerHTML =
            '<span>Moves</span>' +
            '<span>' + String(maxCount) + '</span>';
        wrap.appendChild(labelRow);

        var plot = document.createElement('div');
        plot.className = 'lwc-report-moves-strip-plot';
        wrap.appendChild(plot);

        points.forEach(function (point) {
            var column = document.createElement('div');
            column.className = 'lwc-report-moves-strip-col';
            column.title = point.date + '  Up ' + String(point.up) + '  Down ' + String(point.down);

            var upLane = document.createElement('div');
            upLane.className = 'lwc-report-moves-strip-lane is-up';
            var upBar = document.createElement('span');
            upBar.className = 'lwc-report-moves-strip-bar is-up';
            upBar.style.height = (point.up > 0 ? Math.max(6, (point.up / maxCount) * 100) : 0) + '%';
            upBar.style.background = upColor;
            if (point.up > 0) upLane.appendChild(upBar);

            var downLane = document.createElement('div');
            downLane.className = 'lwc-report-moves-strip-lane is-down';
            var downBar = document.createElement('span');
            downBar.className = 'lwc-report-moves-strip-bar is-down';
            downBar.style.height = (point.down > 0 ? Math.max(6, (point.down / maxCount) * 100) : 0) + '%';
            downBar.style.background = downColor;
            if (point.down > 0) downLane.appendChild(downBar);

            column.appendChild(upLane);
            column.appendChild(downLane);
            plot.appendChild(column);
        });

        return wrap;
    }

    /**
     * Data for LWC HistogramSeries on a report chart moves pane (above the time scale, inside the chart mount).
     * Requires window.AR.chartMacroLwcShared.ymdToUtc.
     */
    function prepareLwcMovesHistogram(section, plotPayload, viewStart, ctxMax, theme) {
        var M = window.AR.chartMacroLwcShared;
        if (!plotPayload || plotPayload.mode !== 'moves' || !M || typeof M.ymdToUtc !== 'function') return null;
        var dates = buildDateRange(viewStart, ctxMax);
        if (!dates.length) return null;
        var byDate = {};
        (plotPayload.points || []).forEach(function (point) {
            byDate[String(point.date || '').slice(0, 10)] = point;
        });
        var upColor = isHomeLoan(section) ? theme.bad : theme.good;
        var downColor = isHomeLoan(section) ? theme.good : theme.bad;
        var maxCount = 0;
        var upData = [];
        var downData = [];
        dates.forEach(function (date) {
            var point = byDate[date] || {};
            var up = Math.max(0, Number(point.up_count || 0));
            var down = Math.max(0, Number(point.down_count || 0));
            maxCount = Math.max(maxCount, up, down);
            var tm = M.ymdToUtc(date);
            upData.push({ time: tm, value: up, color: upColor });
            downData.push({ time: tm, value: down > 0 ? -down : 0, color: downColor });
        });
        if (!maxCount) return null;
        return { upData: upData, downData: downData, upColor: upColor, downColor: downColor, maxCount: maxCount };
    }

    var REPORT_MOVES_PANE_HEIGHT = 84;
    var REPORT_MOVES_SCALE_ID = 'ar-report-moves';

    /** Second LWC pane: histogram above shared time scale. No-op if data or HistogramSeries missing. */
    function attachLwcMovesPane(chart, L, movesPaneData) {
        if (!chart || !L || !L.HistogramSeries || !movesPaneData) return;
        chart.addPane(false);
        try {
            chart.panes()[1].setHeight(REPORT_MOVES_PANE_HEIGHT);
        } catch (_ph) {}
        var Hist = L.HistogramSeries;
        var upApi = chart.addSeries(Hist, {
            priceScaleId: REPORT_MOVES_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false,
            color: movesPaneData.upColor,
        }, 1);
        var downApi = chart.addSeries(Hist, {
            priceScaleId: REPORT_MOVES_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false,
            color: movesPaneData.downColor,
        }, 1);
        try {
            chart.priceScale(REPORT_MOVES_SCALE_ID, 1).applyOptions({
                borderColor: 'rgba(148, 163, 184, 0.22)',
                scaleMargins: { top: 0.08, bottom: 0.05 },
            });
        } catch (_ps) {}
        upApi.setData(movesPaneData.upData);
        downApi.setData(movesPaneData.downData);
    }

    function render(options) {
        var echarts = window.echarts;
        var M = window.AR.chartMacroLwcShared;
        var overlayModule = window.AR.chartEconomicOverlays || {};
        if (!echarts || !M) throw new Error('report plot dependencies not loaded');
        var escHtml = typeof M.escHtml === 'function'
            ? M.escHtml
            : function (value) {
                return String(value == null ? '' : value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            };

        var container = options.container;
        var theme = options.theme;
        var plotPayload = options.plotPayload;
        var range = options.range;
        var section = options.section;
        var bankList = options.bankList || [];
        var ribbonSummaryData = plotPayload && plotPayload.mode === 'bands'
            ? buildRibbonBankSummaryData(plotPayload, options.allSeries || [], range.viewStart, range.ctxMax)
            : { summaries: {}, spotlightBank: '', spotlightDate: '' };
        bankList = bankList.map(function (bank) {
            var summary = ribbonSummaryData.summaries[String(bank && bank.full || '').trim()] || null;
            return {
                full: bank && bank.full ? bank.full : '',
                short: bank && bank.short ? bank.short : '',
                metric: summary ? summary.metric : '',
                meta: summary ? summary.meta : '',
            };
        });
        var clientLog = chartClientLog();
        var lastRibbonScrubLogAt = 0;
        var lastRibbonVisualSig = '';
        var lastSiteUiRibbonLogAt = 0;
        var ribbonChromeHandlers = {
            onChipClick: function () {},
            onChipPointerEnter: function () {},
            onChipPointerLeave: function () {},
        };
        var ribbonTrayRoot = null;
        var ribbonHoverLabelEl = null;

        container.innerHTML = '';
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';
        container.appendChild(wrapper);
        var ribbonHierarchyHost = (container && container.closest && container.closest('.chart-figure')) || wrapper;

        var viewBarOpts = {
            section: section,
            vm: options.vm,
            bankList: bankList,
            onReRender: options.onReRender,
        };
        if (options.vm && options.vm.mode === 'bands') {
            viewBarOpts.onRibbonBankChipClick = function (full) {
                ribbonChromeHandlers.onChipClick(full);
            };
            viewBarOpts.onRibbonBankChipPointerEnter = function (full) {
                ribbonChromeHandlers.onChipPointerEnter(full);
            };
            viewBarOpts.onRibbonBankChipPointerLeave = function (full) {
                ribbonChromeHandlers.onChipPointerLeave(full);
            };
        }
        var viewBar = M.createReportViewModeBar(viewBarOpts);
        wrapper.appendChild(viewBar);
        if (options.vm && options.vm.mode === 'bands') {
            ribbonTrayRoot = viewBar.querySelector('.lwc-focus-bank-tray');
            var trayWrapEl = viewBar.querySelector('.lwc-focus-bank-tray-wrap');
            if (trayWrapEl) {
                ribbonHoverLabelEl = document.createElement('span');
                ribbonHoverLabelEl.className = 'lwc-ribbon-hover-bank-label';
                ribbonHoverLabelEl.setAttribute('aria-live', 'polite');
                trayWrapEl.appendChild(ribbonHoverLabelEl);
            }
        }
        wrapper.appendChild(M.createReportRangeBar({
            section: section,
            range: range.reportRange,
            minDate: range.dataMin,
            maxDate: range.ctxMax,
            onChange: options.onRangeChange,
        }));

        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--report-plot';
        mount.style.cssText = 'width:100%;flex:1;min-height:380px;position:relative;';
        wrapper.appendChild(mount);
        var ribbonHierarchyPanel = createRibbonHierarchyPanel(theme, escHtml);
        ribbonHierarchyHost.appendChild(ribbonHierarchyPanel.el);

        if (options.noteText) {
            var note = document.createElement('div');
            note.textContent = options.noteText;
            note.style.cssText = 'position:absolute;bottom:44px;left:8px;font-size:9px;opacity:0.5;color:inherit;pointer-events:none;font-family:"Space Grotesk",system-ui,sans-serif;white-space:nowrap;z-index:3;';
            mount.appendChild(note);
        }

        var chart = echarts.init(mount, null, { renderer: 'canvas' });
        /** Ribbons + overlays use left % axis (index 0); grid also has yAxis 1 (e.g. moves count). */
        var ribbonAxisFinder = { gridIndex: 0, xAxisIndex: 0, yAxisIndex: 0 };
        var dates = buildDateRange(range.viewStart, range.ctxMax);
        var chartWidth = mount.clientWidth || container.clientWidth || window.innerWidth || 0;
        var showRibbonEdgeLabels = chartWidth >= 1080;
        var reportGridRight = showRibbonEdgeLabels ? 144 : (chartWidth >= 760 ? 28 : 18);
        var prep = M.prepareRbaCpiForReport(options.rbaHistory, options.cpiData, range.viewStart, range.ctxMax);
        var rbaDaily = M.fillForwardDaily(prep.rbaData.points, 'date', 'rate', range.chartStart, range.ctxMax);
        var cpiDaily = M.fillForwardDaily(prep.cpiPoints, 'date', 'value', range.chartStart, range.ctxMax);
        var overlayDefs = overlayModule.prepareWindowSeries
            ? overlayModule.prepareWindowSeries(options.economicOverlaySeries || [], range.viewStart, range.ctxMax)
            : [];

        var bandsReportEarly = plotPayload && plotPayload.mode === 'bands';
        var showRbaMacroLine = bandsReportEarly ? !!(container._ribbonMacroRba) : false;
        var showCpiMacroLine = bandsReportEarly ? !!(container._ribbonMacroCpi) : false;
        var bandsOnlyYExtent = bandsReportEarly ? computeBandsRateExtentFromPayload(plotPayload, dates) : null;
        var rbaLineShown = !bandsReportEarly || showRbaMacroLine;
        var cpiLineShown = !bandsReportEarly || showCpiMacroLine;

        var rbaDecisionsWindow = (prep.rbaData.decisions || []).filter(function (row) {
            var d = String(row.date || '').slice(0, 10);
            return d && d >= String(range.viewStart || '').slice(0, 10) && d <= String(range.ctxMax || '').slice(0, 10);
        });
        var rbaChangeMarkPairs = bandsReportEarly
            ? buildRbaChangeMarkAreaPairs(dates, rbaDecisionsWindow, range.viewStart, range.ctxMax)
            : [];

        var series = [
            {
                name: 'RBA',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                step: 'end',
                lineStyle: { color: theme.rba, width: 2, type: 'dashed', opacity: rbaLineShown ? 1 : 0 },
                data: dates.map(function (date) {
                    var point = rbaDaily.find(function (entry) { return entry.date === date; });
                    return [date, point ? finiteRateOrNull(point.value) : null];
                }),
                silent: !rbaLineShown,
            },
            {
                name: 'CPI',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                step: 'end',
                lineStyle: { color: theme.cpi, width: 2, type: 'dashed', opacity: cpiLineShown ? 1 : 0 },
                data: dates.map(function (date) {
                    var point = cpiDaily.find(function (entry) { return entry.date === date; });
                    return [date, point ? finiteRateOrNull(point.value) : null];
                }),
                silent: !cpiLineShown,
            },
        ];
        if (bandsReportEarly && rbaChangeMarkPairs.length) {
            series.push({
                name: 'RBA change',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                silent: true,
                lineStyle: { width: 0, opacity: 0 },
                data: dates.map(function (d) {
                    return [d, bandsOnlyYExtent ? bandsOnlyYExtent.min : 0];
                }),
                markArea: {
                    silent: true,
                    itemStyle: { color: 'rgba(234, 179, 8, 0.14)' },
                    data: rbaChangeMarkPairs,
                },
            });
        }
        if (plotPayload && plotPayload.mode === 'moves') {
            series.push({
                name: 'Baseline',
                type: 'line',
                yAxisIndex: 1,
                symbol: 'none',
                silent: true,
                lineStyle: { color: theme.axis, width: 1, opacity: 0.65 },
                data: dates.map(function (date) { return [date, 0]; }),
            });
        }
        (overlayDefs || []).forEach(function (overlay) {
            series.push({
                name: overlay.label,
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                lineStyle: { color: overlay.color, width: 1.5, type: 'dashed', opacity: 0.8 },
                data: (overlay.points || []).map(function (point) {
                    return [point.date, Number.isFinite(Number(point.normalized_value)) ? Number(point.normalized_value) : null];
                }),
            });
        });

        if (plotPayload && plotPayload.mode === 'moves') series = series.concat(buildMovesSeries(section, dates, plotPayload, theme));

        var productOverlay = [];
        var isBandsMode = plotPayload && plotPayload.mode === 'bands';
        var ribbonCanvasModel = { flat: [], byBank: {}, count: 0 };
        var useRibbonCanvas = false;
        var ribbonCanvas = null;
        var ribbonCanvasCtx = null;
        var ribbonLodIndices = null;
        var ribbonRaf = null;
        var zrRibbonSubs = [];
        var siteUiRibbonListener = null;

        if (isBandsMode) {
            series = series.concat(buildBandSeries({
                dates: dates,
                plotPayload: plotPayload,
                bankColor: options.bankColor,
                ribbonStyle: getRibbonStyleResolved(),
            }));
            ribbonCanvasModel = buildRibbonCanvasProductModel(dates, options.allSeries || [], options.bankColor);
            useRibbonCanvas = ribbonCanvasModel.count > RIBBON_ECHARTS_PRODUCT_CAP;
            if (!useRibbonCanvas) {
                productOverlay = buildProductOverlay(dates, options.allSeries || [], options.bankColor);
                series = series.concat(productOverlay);
            }
        }

        var bandByDateByBank = {};
        var knownBanks = {};
        if (isBandsMode && plotPayload.series) {
            plotPayload.series.forEach(function (bank) {
                knownBanks[bank.bank_name] = true;
                var byDate = {};
                (bank.points || []).forEach(function (p) {
                    var d = String(p.date || '').slice(0, 10);
                    if (!d) return;
                    var lo = positiveRibbonRateOrNull(p.min_rate);
                    var hi = positiveRibbonRateOrNull(p.max_rate);
                    if (lo == null || hi == null || hi < lo) return;
                    byDate[d] = p;
                });
                bandByDateByBank[bank.bank_name] = byDate;
            });
        }

        var hoveredBank = '';
        var ribbonAutoSpotlightBank = ribbonSummaryData.spotlightBank || '';
        var ribbonProductBank = '';
        var ribbonTrayHoverBank = '';
        var lastPointerDate = ribbonSummaryData.spotlightDate || '';
        var ribbonListHoverKeys = null;
        var ribbonHoverScopeMap = {};
        var ribbonHoverScopeSeq = 0;
        var ribbonExpandedPaths = {};
        var ribbonTreeAnchorYmd = '';
        var ribbonListHoverPath = '';

        function deepestExpandedRibbonPath() {
            var best = '';
            var bestDepth = -1;
            Object.keys(ribbonExpandedPaths).forEach(function (p) {
                if (!ribbonExpandedPaths[p]) return;
                var depth = p ? p.split('>').length : 0;
                if (depth > bestDepth) {
                    bestDepth = depth;
                    best = p;
                }
            });
            return best;
        }

        var ribbonTreeHadBranches = false;

        function ribbonPathAllowsProductLines(rowPath) {
            var rp = String(rowPath || '');
            var deep = deepestExpandedRibbonPath();
            if (!deep) {
                if (!ribbonTreeHadBranches) return true;
                return false;
            }
            return rp === deep || rp.indexOf(deep + '>') === 0;
        }

        function clearRibbonHoverScopes() {
            ribbonHoverScopeMap = {};
            ribbonHoverScopeSeq = 0;
        }

        function registerRibbonHoverScope(keys) {
            var id = String(++ribbonHoverScopeSeq);
            ribbonHoverScopeMap[id] = keys.slice();
            return id;
        }

        function normRibbonBankName(n) {
            return String(n || '')
                .trim()
                .replace(/[\u00A0\u2000-\u200B\uFEFF]/g, ' ')
                .replace(/\s+/g, ' ')
                .toLowerCase();
        }

        /** Normalized key only if name matches a bands series; else '' (all ribbons stay active — avoids all-grey when focus string is orphan). */
        function resolveBandsFocusKey(nameRaw) {
            var raw = String(nameRaw || '').trim();
            if (!raw || !plotPayload || !plotPayload.series || !plotPayload.series.length) return '';
            var want = normRibbonBankName(raw);
            for (var i = 0; i < plotPayload.series.length; i++) {
                if (normRibbonBankName(plotPayload.series[i].bank_name) === want) return want;
            }
            return '';
        }

        /** Map UI/chip string to plotPayload bank_name spelling when possible (canvas byBank + series ids). */
        function canonicalBandsBankFromUi(nameRaw) {
            var raw = String(nameRaw || '').trim();
            if (!raw || !plotPayload || !plotPayload.series) return raw;
            var want = normRibbonBankName(raw);
            for (var i = 0; i < plotPayload.series.length; i++) {
                var bn = String(plotPayload.series[i].bank_name || '').trim();
                if (normRibbonBankName(bn) === want) return bn;
            }
            return raw;
        }

        function ribbonSummaryForBank(bankName) {
            return ribbonSummaryData && ribbonSummaryData.summaries
                ? ribbonSummaryData.summaries[String(bankName || '').trim()] || null
                : null;
        }

        function ribbonHoverSummaryText(bankName) {
            var bank = String(bankName || '').trim();
            if (!bank) return '';
            var summary = ribbonSummaryForBank(bank);
            if (!summary) return bank;
            return [
                bank,
                summary.metric || '',
                summary.mean != null ? '\u03bc ' + summary.mean.toFixed(2) + '%' : '',
                ribbonSpreadBpText(summary.lo, summary.hi),
            ].filter(Boolean).join(' \u00b7 ');
        }

        function ribbonPanelBank() {
            return String(ribbonTrayHoverBank || ribbonProductBank || '').trim();
        }

        /** Bank whose corridor is foregrounded: explicit panel focus, then chart hover, then the best current lender. */
        function ribbonChartHighlightBank() {
            return String(ribbonPanelBank() || hoveredBank || ribbonAutoSpotlightBank || '').trim();
        }

        function ribbonLineFilterKeys() {
            var list = ribbonListHoverKeys;
            if (!list || !list.length) return [];
            if (!ribbonPathAllowsProductLines(String(ribbonListHoverPath || ''))) return [];
            return list.slice();
        }

        function productLineVisible(prodKey) {
            var fk = ribbonLineFilterKeys();
            for (var i = 0; i < fk.length; i++) {
                if (fk[i] === prodKey) return true;
            }
            return false;
        }

        function resolveDateFromAxisValue(xRaw) {
            if (xRaw == null) return '';
            if (typeof xRaw === 'number' && Number.isFinite(xRaw)) {
                var i = Math.round(xRaw);
                if (i >= 0 && i < dates.length) return dates[i];
            }
            var s = String(xRaw).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(s) && dates.indexOf(s) >= 0) return s;
            return '';
        }

        /** Bank under pointer: full min–max band at date (narrowest band wins if overlapping). */
        function pickBankFromRibbonBand(dateStr, yVal) {
            if (!dateStr || !Number.isFinite(yVal)) return '';
            var candidates = [];
            Object.keys(knownBanks).forEach(function (bn) {
                var p = bandByDateByBank[bn] && bandByDateByBank[bn][dateStr];
                if (!p) return;
                var lo = positiveRibbonRateOrNull(p.min_rate);
                var hi = positiveRibbonRateOrNull(p.max_rate);
                if (lo == null || hi == null || hi < lo) return;
                if (yVal >= lo && yVal <= hi) {
                    var w = hi - lo;
                    candidates.push({ bn: bn, w: Number.isFinite(w) ? w : 0 });
                }
            });
            candidates.sort(function (a, b) { return a.w - b.w; });
            return candidates.length ? candidates[0].bn : '';
        }

        function syncRibbonTrayUi() {
            if (!ribbonTrayRoot) return;
            var dimRef = ribbonChartHighlightBank();
            var dimWant = resolveBandsFocusKey(dimRef);
            var dimKey = dimWant || '';
            var hlRaw = String(ribbonTrayHoverBank || (ribbonProductBank ? '' : hoveredBank) || '').trim();
            var hlKey = hlRaw ? normRibbonBankName(canonicalBandsBankFromUi(hlRaw)) : '';
            var selKey =
                ribbonProductBank && resolveBandsFocusKey(ribbonProductBank)
                    ? normRibbonBankName(canonicalBandsBankFromUi(String(ribbonProductBank || '').trim()))
                    : '';
            var chips = ribbonTrayRoot.querySelectorAll('.lwc-focus-bank-chip');
            for (var i = 0; i < chips.length; i++) {
                var ch = chips[i];
                var fk = normRibbonBankName(
                    canonicalBandsBankFromUi(String(ch.getAttribute('data-ar-bank-full') || ch.title || '').trim())
                );
                var isHover = !!hlKey && fk === hlKey;
                var isSelected = !!selKey && fk === selKey;
                ch.classList.toggle('is-ribbon-hover', isHover);
                ch.classList.toggle('is-ribbon-selected', isSelected);
                ch.classList.toggle('is-ribbon-dim', !!dimKey && fk !== dimKey);
                ch.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            }
            if (ribbonHoverLabelEl) {
                var _hb = ribbonChartHighlightBank();
                var _txt = ribbonHoverSummaryText(_hb);
                var _autoOnly = !ribbonProductBank && !ribbonTrayHoverBank && !hoveredBank;
                if (_autoOnly && _hb && normRibbonBankName(_hb) === normRibbonBankName(ribbonAutoSpotlightBank)) {
                    _txt = _txt ? 'Spotlight \u00b7 ' + _txt : '';
                } else if (!_txt && ribbonAutoSpotlightBank) {
                    _txt = 'Spotlight \u00b7 ' + ribbonHoverSummaryText(ribbonAutoSpotlightBank);
                }
                ribbonHoverLabelEl.textContent = _txt;
                ribbonHoverLabelEl.style.display = _txt ? 'inline' : 'none';
            }
        }

        function syncInfoboxRowHighlight() {
            syncRibbonScopedRowHighlight(options.infoBox && options.infoBox.el);
            syncRibbonScopedRowHighlight(ribbonHierarchyPanel && ribbonHierarchyPanel.el);
        }

        function syncRibbonScopedRowHighlight(root) {
            if (!root) return;
            var k = ribbonListHoverKeys && ribbonListHoverKeys.length === 1 ? ribbonListHoverKeys[0] : '';
            var rows = root.querySelectorAll('.ar-report-infobox-row[data-ribbon-prod-key]');
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                row.classList.toggle('is-ribbon-chart-sync', !!k && row.getAttribute('data-ribbon-prod-key') === k);
            }
            var scopes = root.querySelectorAll('[data-ribbon-scope]');
            for (var j = 0; j < scopes.length; j++) {
                var el = scopes[j];
                if (el.classList.contains('ar-report-infobox-row') && el.hasAttribute('data-ribbon-prod-key')) continue;
                var sid = el.getAttribute('data-ribbon-scope');
                var ks = ribbonHoverScopeMap[sid];
                var hit = false;
                if (k && ks && ks.length) {
                    for (var x = 0; x < ks.length; x++) {
                        if (ks[x] === k) {
                            hit = true;
                            break;
                        }
                    }
                }
                el.classList.toggle('is-ribbon-chart-sync', hit);
            }
        }

        function setRibbonAnchorDate(dateStr) {
            var ymd = String(dateStr || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
            if (dates.indexOf(ymd) < 0) return false;
            lastPointerDate = ymd;
            return true;
        }

        function syncRibbonPinnedPanelState() {
            applyRibbonBankHighlightState(ribbonChartHighlightBank());
            updateProductVisibility();
            refreshRibbonUnderChartPanel();
            scheduleRibbonRedraw();
            syncRibbonTrayUi();
        }

        function resolveHoverBank(seriesName) {
            if (!seriesName) return '';
            if (seriesName.endsWith(' ribbon')) return seriesName.slice(0, -7);
            if (seriesName.endsWith(' mean')) return seriesName.slice(0, -5);
            if (seriesName.endsWith(' max')) return seriesName.slice(0, -4);
            if (knownBanks[seriesName]) return seriesName;
            return '';
        }

        function updateProductVisibility() {
            if (useRibbonCanvas) {
                scheduleRibbonRedraw();
                if (isBandsMode) {
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                }
                return;
            }
            if (!productOverlay.length) return;
            var rs = getRibbonStyleResolved();
            var oh = Math.max(0, Math.min(1, Number(rs.product_line_opacity_hover)));
            var wh = Math.max(0, Number(rs.product_line_width_hover) || 1.2);
            var updates = [];
            productOverlay.forEach(function (s) {
                var rest = s.name.slice(3);
                var pipe = rest.indexOf('|');
                var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                var pb = ribbonPanelBank();
                var showBank = pb && normRibbonBankName(bn) === normRibbonBankName(pb);
                var match = productLineVisible(s.name);
                var show = showBank && match;
                var base = s._ribbonBaseHex || '#64748b';
                updates.push({
                    id: s.id,
                    lineStyle: {
                        color: hexToRgba(base, oh),
                        width: wh,
                        opacity: show ? 1 : 0,
                        cap: 'round',
                        join: 'round',
                    },
                    silent: true,
                });
            });
            chart.setOption({ series: updates }, { lazyUpdate: false, silent: true });
            if (isBandsMode) {
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
            }
        }

        function syncRibbonCanvasSize() {
            if (!ribbonCanvas) return;
            var w = mount.clientWidth || 0;
            var h = mount.clientHeight || 0;
            var dpr = window.devicePixelRatio || 1;
            ribbonCanvas.style.width = w + 'px';
            ribbonCanvas.style.height = h + 'px';
            ribbonCanvas.width = Math.max(1, Math.floor(w * dpr));
            ribbonCanvas.height = Math.max(1, Math.floor(h * dpr));
            if (ribbonCanvasCtx) ribbonCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function recomputeRibbonLod() {
            if (!useRibbonCanvas || !dates.length) {
                ribbonLodIndices = null;
                return;
            }
            var w = mount.clientWidth || 800;
            var approxCols = Math.max(100, Math.floor(w * 0.85));
            ribbonLodIndices = computeRibbonLodIndices(dates.length, approxCols);
        }

        function redrawRibbonCanvas() {
            if (!useRibbonCanvas || !ribbonCanvasCtx) return;
            syncRibbonCanvasSize();
            var ctx = ribbonCanvasCtx;
            ctx.clearRect(0, 0, ribbonCanvas.width, ribbonCanvas.height);
            var pb = ribbonPanelBank();
            if (!pb) return;
            var prods = ribbonCanvasModel.byBank[pb];
            if (!prods || !prods.length) return;
            var idxs = ribbonLodIndices;
            prods.forEach(function (prod) {
                if (!productLineVisible(prod.key)) return;
                ctx.beginPath();
                var first = true;
                function plotAt(di) {
                    var d = dates[di];
                    var v = prod.byDate[d];
                    if (v == null) return;
                    var pix = chart.convertToPixel(ribbonAxisFinder, [d, v]);
                    if (!pix || pix.length < 2 || !Number.isFinite(pix[0]) || !Number.isFinite(pix[1])) return;
                    if (first) {
                        ctx.moveTo(pix[0], pix[1]);
                        first = false;
                    } else {
                        ctx.lineTo(pix[0], pix[1]);
                    }
                }
                if (idxs && idxs.length) {
                    for (var ii = 0; ii < idxs.length; ii++) plotAt(idxs[ii]);
                } else {
                    for (var di = 0; di < dates.length; di++) plotAt(di);
                }
                if (first) return;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                var rsC = getRibbonStyleResolved();
                var oh = Math.max(0, Math.min(1, Number(rsC.product_line_opacity_hover)));
                var wh = Math.max(0, Number(rsC.product_line_width_hover) || 1.2);
                ctx.strokeStyle = hexToRgba(prod.baseHex, oh);
                ctx.lineWidth = wh;
                ctx.stroke();
            });
        }

        function scheduleRibbonRedraw() {
            if (!useRibbonCanvas) return;
            if (ribbonRaf != null) return;
            ribbonRaf = window.requestAnimationFrame(function () {
                ribbonRaf = null;
                redrawRibbonCanvas();
            });
        }

        function hideRibbonInfoBox() {
            var ib = options.infoBox;
            if (ib && typeof ib.hide === 'function') ib.hide();
        }

        function hideRibbonHierarchyPanel() {
            ribbonListHoverKeys = null;
            ribbonListHoverPath = '';
            ribbonExpandedPaths = {};
            ribbonTreeBank = '';
            ribbonTreeAnchorYmd = '';
            ribbonTreeHadBranches = false;
            if (ribbonHierarchyPanel && typeof ribbonHierarchyPanel.hide === 'function') ribbonHierarchyPanel.hide();
            syncInfoboxRowHighlight();
        }

        function applyRibbonBankHighlightState(hoveredBankName) {
            if (!isBandsMode || !plotPayload || !plotPayload.series || !plotPayload.series.length) return;
            var rs = getRibbonStyleResolved();
            var focusKey = resolveBandsFocusKey(hoveredBankName);
            var explicitFocus = !!(ribbonProductBank || ribbonTrayHoverBank || hoveredBank);
            var autoSpotlight = !explicitFocus && !!focusKey && normRibbonBankName(ribbonAutoSpotlightBank) === focusKey;
            var visualSig =
                String(focusKey || '') +
                '|' +
                normRibbonBankName(ribbonProductBank) +
                '|' +
                normRibbonBankName(ribbonTrayHoverBank) +
                '|' +
                normRibbonBankName(hoveredBank) +
                '|' +
                normRibbonBankName(ribbonAutoSpotlightBank);
            if (visualSig !== lastRibbonVisualSig) {
                lastRibbonVisualSig = visualSig;
                clientLog('info', 'Chart ribbon foreground/colour', {
                    section: String(section || ''),
                    focusBank: focusKey || null,
                    pinnedBank: ribbonProductBank ? chartLogClip(ribbonProductBank, 48) : null,
                    trayHoverBank: ribbonTrayHoverBank ? chartLogClip(ribbonTrayHoverBank, 48) : null,
                    productLines: useRibbonCanvas ? 'canvas' : 'echarts',
                });
            }
            var updates = [];
            plotPayload.series.forEach(function (bank, index) {
                var active = !focusKey || normRibbonBankName(bank.bank_name) === focusKey;
                var selected = active && focusKey && ribbonProductBank && normRibbonBankName(bank.bank_name) === resolveBandsFocusKey(ribbonProductBank);
                var pointerFocus = active && hoveredBank && normRibbonBankName(bank.bank_name) === resolveBandsFocusKey(hoveredBank);
                var c0 = options.bankColor(bank.bank_name, index);
                var inactiveGreyMix = focusKey ? Math.max(Number(rs.others_grey_mix) || 0, 0.84) : rs.others_grey_mix;
                var strokeC = active
                    ? (autoSpotlight ? mixHexWithGrey(c0, 0.06) : c0)
                    : mixHexWithGrey(c0, inactiveGreyMix);
                var zRoot = active ? Number(rs.active_z) : Number(rs.inactive_z);
                var zb = zRoot + index * 0.08;
                var zlv = focusKey ? (active ? 2 : 0) : 0;
                var ewBase = Math.max(0, Number(rs.edge_width) || 0);
                var ew = active
                    ? (selected ? ewBase + 0.6 : (pointerFocus || !autoSpotlight ? ewBase : Math.max(1, ewBase * 0.72)))
                    : Math.max(0.75, ewBase * 0.62);
                var eo = active
                    ? (selected ? 1 : (pointerFocus || ribbonTrayHoverBank ? 0.9 : (autoSpotlight ? 0.34 : Math.max(0.72, Number(rs.edge_opacity) || 0))))
                    : (focusKey ? 0.06 : Math.max(0.1, Math.min(0.22, Number(rs.edge_opacity_others) || 0)));
                var edgeLine = { color: strokeC, width: ew > 0 ? ew : 0.01, opacity: ew > 0 ? eo : 0, cap: 'round', join: 'round' };
                function alpha(key, fallback) {
                    var n = Number(rs[key]);
                    if (!Number.isFinite(n)) return fallback;
                    return Math.max(0, Math.min(1, n));
                }
                var fe = alpha('fill_opacity_end', 0.22);
                var fp = alpha('fill_opacity_peak', 0.48);
                var ffe = alpha('focus_fill_opacity_end', fe);
                var ffp = alpha('focus_fill_opacity_peak', fp);
                var sfe = alpha('selected_fill_opacity_end', ffe);
                var sfp = alpha('selected_fill_opacity_peak', ffp);
                var sc = focusKey ? 0.015 : Math.max(0, Math.min(1, Number(rs.fill_opacity_others_scale)));
                var fillEnd = active
                    ? (selected ? sfe : (pointerFocus || ribbonTrayHoverBank ? ffe * 0.92 : (autoSpotlight ? Math.min(0.14, ffe * 0.28) : Math.min(0.28, ffe * 0.5))))
                    : fe * sc;
                var fillPeak = active
                    ? (selected ? sfp : (pointerFocus || ribbonTrayHoverBank ? ffp : (autoSpotlight ? Math.min(0.22, ffp * 0.3) : Math.min(0.38, ffp * 0.54))))
                    : fp * sc;
                var mwBase = Math.max(0, Number(rs.mean_width) || 0);
                var mw = active
                    ? (selected ? mwBase + 1.4 : (pointerFocus || !autoSpotlight ? mwBase + 0.55 : mwBase + 0.15))
                    : Math.max(1.15, mwBase * 0.95);
                var mo = active
                    ? (selected ? 1 : (pointerFocus || ribbonTrayHoverBank ? 0.96 : (autoSpotlight ? 0.88 : Math.max(0.8, Number(rs.mean_opacity) || 0))))
                    : (focusKey ? 0.24 : Math.max(0.3, Math.min(0.42, Number(rs.mean_opacity_others) || 0.3)));
                var fillAreaStyle;
                if (active) {
                    if (focusKey && fillEnd <= 0 && fillPeak <= 0) {
                        var focusFill = hexToRgba(strokeC, 0.24);
                        fillAreaStyle = ribbonAreaStyleMerged({
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 1,
                            y2: 0,
                            colorStops: [
                                { offset: 0, color: focusFill },
                                { offset: 1, color: focusFill },
                            ],
                        });
                    } else {
                        fillAreaStyle = ribbonAreaStyleMerged(ribbonFlowGradientFill(strokeC, fillEnd, fillPeak));
                    }
                } else {
                    fillAreaStyle = ribbonAreaStyleMerged({
                        color: hexToRgba(strokeC, Math.min(0.08, Math.max(0, (fillEnd + fillPeak) * 0.65))),
                    });
                }
                var summary = ribbonSummaryForBank(bank.bank_name);
                var endLabelText = summary
                    ? [summary.short || ribbonBankShortName(bank.bank_name), summary.metric || ''].filter(Boolean).join(' ')
                    : ribbonBankShortName(bank.bank_name);
                updates.push({ id: 'ribbon_min_' + index, z: zb, zlevel: zlv, lineStyle: edgeLine, areaStyle: { opacity: 0 } });
                updates.push({
                    id: 'ribbon_fill_' + index,
                    z: zb + 0.01,
                    zlevel: zlv,
                    lineStyle: { color: strokeC, width: 0.01, opacity: 0, cap: 'round', join: 'round' },
                    areaStyle: fillAreaStyle,
                });
                updates.push({ id: 'ribbon_max_' + index, z: zb + 0.02, zlevel: zlv, lineStyle: edgeLine });
                updates.push({
                    id: 'ribbon_mean_' + index,
                    z: zb + 0.03,
                    zlevel: zlv,
                    lineStyle: {
                        color: strokeC,
                        width: mw > 0 ? mw : 0.01,
                        opacity: mw > 0 ? mo : 0,
                        type: 'solid',
                        cap: 'round',
                        join: 'round',
                    },
                    endLabel: showRibbonEdgeLabels && active && summary
                        ? {
                            show: true,
                            formatter: function () { return endLabelText; },
                            color: theme.ttText || '#e2e8f0',
                            fontFamily: '"Space Grotesk",system-ui,sans-serif',
                            fontSize: 11,
                            fontWeight: 700,
                            backgroundColor: hexToRgba(strokeC, 0.18),
                            borderColor: hexToRgba(strokeC, 0.42),
                            borderWidth: 1,
                            borderRadius: 999,
                            padding: [4, 8],
                            distance: 12,
                        }
                        : { show: false },
                });
            });
            try {
                chart.setOption({ series: updates }, { lazyUpdate: false, silent: true });
            } catch (_e) {}
        }

        var ribbonTreeBank = '';

        function renderRibbonTreeDom(container, node, path, depth, anchorYmd, secStr) {
            if (!node || node.kind === 'empty') return;
            if (node.kind === 'leaves') {
                var leaves = node.products.slice().sort(function (a, b) {
                    var va = a.byDate[anchorYmd];
                    var vb = b.byDate[anchorYmd];
                    return (Number.isFinite(vb) ? vb : 0) - (Number.isFinite(va) ? va : 0);
                });
                leaves.forEach(function (p) {
                    var v = ribbonRateAtAnchorForHierarchy(p, anchorYmd, secStr);
                    if (v == null) return;
                    var scopeId = registerRibbonHoverScope([p.key]);
                    var row = document.createElement('div');
                    row.className = 'ar-report-infobox-trow ar-report-infobox-trow--leaf ar-report-infobox-row';
                    row.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:2px 0;border-top:1px solid rgba(148,163,184,0.18);font-size:11px;line-height:1.25;min-width:0;cursor:default;padding-left:' + (6 + depth * 12) + 'px;';
                    row.setAttribute('data-ribbon-scope', scopeId);
                    row.setAttribute('data-ribbon-tree-path', String(path || ''));
                    row.setAttribute('data-ribbon-prod-key', p.key);
                    var sw = document.createElement('span');
                    sw.style.cssText = 'width:6px;height:6px;border-radius:1px;flex-shrink:0;margin-top:2px;background:' + String(p.baseHex || '#666').replace(/[<>"']/g, '') + ';';
                    var mid = document.createElement('span');
                    mid.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    var bn = document.createElement('span');
                    bn.style.fontWeight = '600';
                    bn.textContent = p.bankName || 'Unknown';
                    var dot = document.createElement('span');
                    dot.style.opacity = '0.4';
                    dot.textContent = ' \u00b7 ';
                    var pn = document.createElement('span');
                    pn.textContent = p.productName || '';
                    mid.appendChild(bn);
                    mid.appendChild(dot);
                    mid.appendChild(pn);
                    var rateEl = document.createElement('span');
                    rateEl.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:600;flex-shrink:0;';
                    rateEl.textContent = v.toFixed(2) + '%';
                    row.appendChild(sw);
                    row.appendChild(mid);
                    row.appendChild(rateEl);
                    container.appendChild(row);
                });
                return;
            }
            (node.groups || []).forEach(function (g, idx) {
                var subPath = path ? path + '>' + idx : String(idx);
                var expanded = !!ribbonExpandedPaths[subPath];
                var keys = collectRibbonNodeKeys(g.child);
                if (!keys.length) return;
                var scopeId = registerRibbonHoverScope(keys);
                var mm = minMaxRibbonNodeRates(g.child, anchorYmd, secStr);
                var branchLabel = ribbonFieldLabel(node.field) + ': ' + g.label;
                var brow = document.createElement('div');
                brow.className = 'ar-report-infobox-trow ar-report-infobox-trow--branch';
                brow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid rgba(148,163,184,0.2);font-size:11px;line-height:1.25;min-width:0;cursor:pointer;padding-left:' + (4 + depth * 12) + 'px;';
                brow.setAttribute('data-ribbon-scope', scopeId);
                brow.setAttribute('data-ribbon-tree-path', subPath);
                brow.setAttribute('role', 'button');
                brow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                brow.setAttribute('aria-label', (expanded ? 'Collapse tier, ' : 'Expand tier, ') + branchLabel);
                brow.setAttribute('title', expanded ? 'Collapse tier' : 'Expand tier');
                brow.tabIndex = 0;
                var twist = document.createElement('span');
                twist.className = 'ar-report-infobox-twist';
                twist.setAttribute('aria-hidden', 'true');
                twist.style.cssText = 'flex-shrink:0;user-select:none;';
                twist.textContent = expanded ? '\u25bc' : '\u25b6';
                var lab = document.createElement('span');
                lab.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;';
                lab.textContent = branchLabel;
                var rateSpan = document.createElement('span');
                rateSpan.style.cssText = 'font-variant-numeric:tabular-nums;opacity:0.9;flex-shrink:0;';
                rateSpan.textContent = formatRibbonTierRateRange(mm);
                brow.appendChild(twist);
                brow.appendChild(lab);
                brow.appendChild(rateSpan);
                function toggleBranch() {
                    var nextOpen = !expanded;
                    ribbonExpandedPaths[subPath] = nextOpen;
                    clientLog('info', nextOpen ? 'Chart product hierarchy expand' : 'Chart product hierarchy collapse', {
                        section: String(section || ''),
                        path: chartLogClip(subPath, 40),
                        label: chartLogClip(branchLabel, 72),
                    });
                    refreshRibbonUnderChartPanel();
                }
                brow.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    toggleBranch();
                });
                brow.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        toggleBranch();
                    }
                });
                container.appendChild(brow);
                if (expanded) {
                    var nest = document.createElement('div');
                    nest.className = 'ar-report-infobox-tnest';
                    renderRibbonTreeDom(nest, g.child, subPath, depth + 1, anchorYmd, secStr);
                    container.appendChild(nest);
                }
            });
        }

        function refreshRibbonUnderChartPanel() {
            if (!ribbonHierarchyPanel || typeof ribbonHierarchyPanel.show !== 'function') return;
            var pbPanel = ribbonPanelBank();
            if (!pbPanel) {
                hideRibbonHierarchyPanel();
                return;
            }
            var anchor = lastPointerDate || (dates.length ? dates[dates.length - 1] : '');
            if (!anchor) {
                hideRibbonHierarchyPanel();
                return;
            }
            if (ribbonTreeBank !== pbPanel) {
                ribbonExpandedPaths = {};
                ribbonTreeHadBranches = false;
                ribbonTreeBank = pbPanel;
            }
            ribbonTreeAnchorYmd = anchor;
            var plist = ribbonCanvasModel.byBank[pbPanel] || [];
            var prodsAtAnchor = [];
            var sec = String(section || '');
            plist.forEach(function (prod) {
                var v = prod.byDate[anchor];
                if (v == null || !Number.isFinite(v) || v <= 0) return;
                if (sec === 'savings' && v < 1.0) return;
                prodsAtAnchor.push(prod);
            });
            prodsAtAnchor.sort(function (a, b) {
                var va = a.byDate[anchor];
                var vb = b.byDate[anchor];
                return (Number.isFinite(vb) ? vb : 0) - (Number.isFinite(va) ? va : 0);
            });
            if (!prodsAtAnchor.length) {
                hideRibbonHierarchyPanel();
                return;
            }
            clearRibbonHoverScopes();
            var tierFields = ribbonTierFieldsForSection(sec);
            var tree = buildRibbonTierTree(prodsAtAnchor, tierFields, 0);
            if (!tree || tree.kind === 'empty') {
                hideRibbonHierarchyPanel();
                return;
            }
            ribbonTreeHadBranches = tree.kind !== 'leaves';
            var n = prodsAtAnchor.length;
            var ibBandPt = bandByDateByBank[pbPanel] && bandByDateByBank[pbPanel][anchor];
            var ibRateStr = '';
            if (ibBandPt) {
                var ibLo = positiveRibbonRateOrNull(ibBandPt.min_rate);
                var ibHi = positiveRibbonRateOrNull(ibBandPt.max_rate);
                if (ibLo != null && ibHi != null) {
                    ibRateStr = ibLo !== ibHi
                        ? ibLo.toFixed(2) + '\u2013' + ibHi.toFixed(2) + '%'
                        : ibLo.toFixed(2) + '%';
                }
            }
            ribbonHierarchyPanel.show({
                heading: fmtReportDateYmd(anchor) + (ibRateStr ? '  \u00b7  ' + ibRateStr : ''),
                meta: pbPanel + ' \u00b7 ' + n + ' product' + (n !== 1 ? 's' : ''),
                compact: true,
                renderBody: function (wrap) {
                    renderRibbonTreeDom(wrap, tree, '', 0, anchor, sec);
                },
            });
            syncInfoboxRowHighlight();
        }

        var tooltipConfig = isBandsMode
            ? {
                show: true,
                trigger: 'axis',
                axisPointer: {
                    type: 'line',
                    lineStyle: {
                        color: theme.crosshairLine || 'rgba(99,179,237,0.40)',
                        width: 1,
                        type: 'dashed',
                    },
                },
                formatter: function () { return null; },
              }
            : { trigger: 'axis', axisPointer: { type: 'line' } };

        if (options.infoBox && options.infoBox.el) {
            wrapper.appendChild(options.infoBox.el);
        }

        chart.setOption({
            animation: false,
            grid: { top: 18, right: reportGridRight, bottom: 56, left: 48, containLabel: true },
            tooltip: tooltipConfig,
            legend: { show: false },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { lineStyle: { color: theme.axis } },
                axisLabel: { color: theme.muted, hideOverlap: true },
                splitLine: { show: false },
            },
            yAxis: [
                (function () {
                    var y0 = {
                        type: 'value',
                        name: '%',
                        position: 'left',
                        axisLine: { lineStyle: { color: theme.axis } },
                        axisLabel: { color: theme.muted },
                        splitLine: { lineStyle: { color: theme.grid } },
                    };
                    if (bandsOnlyYExtent) {
                        y0.min = bandsOnlyYExtent.min;
                        y0.max = bandsOnlyYExtent.max;
                        y0.scale = false;
                    }
                    return y0;
                })(),
                {
                    type: 'value',
                    show: !!(plotPayload && plotPayload.mode === 'moves'),
                    name: plotPayload && plotPayload.mode === 'moves' ? 'Count' : '',
                    position: 'right',
                    min: function (value) { return Math.min(value.min, 0); },
                    max: function (value) { return Math.max(value.max, 0); },
                    axisLine: { lineStyle: { color: theme.axis } },
                    axisLabel: { color: theme.muted },
                    splitLine: { show: false },
                },
            ],
            series: series,
        });

        if (isBandsMode) {
            var macroRow = document.createElement('div');
            macroRow.className = 'lwc-report-macro-bar';
            function mkMacroBtn(label) {
                var b = document.createElement('button');
                b.type = 'button';
                b.textContent = label;
                b.className = 'lwc-report-macro-toggle';
                b.setAttribute('aria-pressed', 'false');
                return b;
            }
            function syncMacroBtnStyle(btn, on) {
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.classList.toggle('is-active', !!on);
            }
            var rbaMacroBtn = mkMacroBtn('RBA');
            var cpiMacroBtn = mkMacroBtn('CPI');
            function applyRibbonMacroDisplay() {
                var merged = bandsOnlyYExtent;
                if (showRbaMacroLine) {
                    merged = mergeRateExtents(merged, extentFromDailyRows(dates, rbaDaily, 'value'));
                }
                if (showCpiMacroLine) {
                    merged = mergeRateExtents(merged, extentFromDailyRows(dates, cpiDaily, 'value'));
                }
                if (showRbaMacroLine || showCpiMacroLine) merged = merged ? padExtent(merged) : bandsOnlyYExtent;
                else merged = bandsOnlyYExtent;
                if (!merged) merged = bandsOnlyYExtent;
                chart.setOption(
                    {
                        animation: true,
                        animationDuration: 220,
                        animationEasing: 'cubicOut',
                        yAxis: [{ min: merged.min, max: merged.max, scale: false }],
                        series: [
                            { name: 'RBA', lineStyle: { opacity: showRbaMacroLine ? 1 : 0 }, silent: !showRbaMacroLine },
                            { name: 'CPI', lineStyle: { opacity: showCpiMacroLine ? 1 : 0 }, silent: !showCpiMacroLine },
                        ],
                    },
                    { lazyUpdate: false, silent: true }
                );
                if (useRibbonCanvas) scheduleRibbonRedraw();
            }
            rbaMacroBtn.addEventListener('click', function () {
                showRbaMacroLine = !showRbaMacroLine;
                container._ribbonMacroRba = showRbaMacroLine;
                syncMacroBtnStyle(rbaMacroBtn, showRbaMacroLine);
                applyRibbonMacroDisplay();
            });
            cpiMacroBtn.addEventListener('click', function () {
                showCpiMacroLine = !showCpiMacroLine;
                container._ribbonMacroCpi = showCpiMacroLine;
                syncMacroBtnStyle(cpiMacroBtn, showCpiMacroLine);
                applyRibbonMacroDisplay();
            });
            syncMacroBtnStyle(rbaMacroBtn, showRbaMacroLine);
            syncMacroBtnStyle(cpiMacroBtn, showCpiMacroLine);
            if (showRbaMacroLine || showCpiMacroLine) applyRibbonMacroDisplay();
            var macroLab = document.createElement('span');
            macroLab.className = 'lwc-report-macro-label';
            macroLab.textContent = 'Macro';
            macroRow.appendChild(macroLab);
            macroRow.appendChild(rbaMacroBtn);
            macroRow.appendChild(cpiMacroBtn);
            wrapper.insertBefore(macroRow, mount);
        }

        if (!isBandsMode) {
            var reportAxisPtrLogAt = 0;
            chart.on('updateAxisPointer', function (ev) {
                var tPtr = Date.now();
                if (tPtr - reportAxisPtrLogAt < 320) return;
                reportAxisPtrLogAt = tPtr;
                var ax0 = ev && ev.axesInfo && ev.axesInfo[0];
                if (!ax0) return;
                var vRaw = ax0.value;
                var vOut = vRaw;
                if (Array.isArray(vRaw)) vOut = vRaw.slice(0, 4);
                else if (vRaw != null && typeof vRaw === 'object') vOut = '[axis value]';
                clientLog('info', 'Chart report axis pointer', {
                    section: String(section || ''),
                    mode: plotPayload && plotPayload.mode,
                    axisDim: ax0.axisDim,
                    axisIndex: ax0.axisIndex,
                    value: vOut,
                });
            });
        }

        if (isBandsMode) {
            applyRibbonBankHighlightState(ribbonChartHighlightBank());
        }

        if (isBandsMode && useRibbonCanvas) {
            ribbonCanvas = document.createElement('canvas');
            ribbonCanvas.className = 'lwc-ribbon-products-canvas';
            ribbonCanvas.setAttribute('aria-hidden', 'true');
            ribbonCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;';
            mount.appendChild(ribbonCanvas);
            ribbonCanvasCtx = ribbonCanvas.getContext('2d');
        }

        if (isBandsMode) {
            var zr = chart.getZr();
            function ribbonZrXY(ev) {
                var ox = typeof ev.offsetX === 'number' ? ev.offsetX : (ev.zrX != null ? ev.zrX : 0);
                var oy = typeof ev.offsetY === 'number' ? ev.offsetY : (ev.zrY != null ? ev.zrY : 0);
                return [ox, oy];
            }
            function onRibbonZrMouseMove(ev) {
                var xy = ribbonZrXY(ev);
                var data = chart.convertFromPixel(ribbonAxisFinder, xy);
                if (!data || data.length < 2) return;
                var prevPointerDate = lastPointerDate;
                var prevBandBank = hoveredBank;
                var dateStr = resolveDateFromAxisValue(data[0]);
                if (dateStr) lastPointerDate = dateStr;
                var yVal = data[1];
                var next = pickBankFromRibbonBand(dateStr, yVal);
                var bankChanged = next !== hoveredBank;
                if (bankChanged) {
                    hoveredBank = next;
                    updateProductVisibility();
                }
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                var pbMove = ribbonPanelBank();
                if (bankChanged) {
                    clientLog('info', 'Chart ribbon band hover', {
                        section: String(section || ''),
                        bandBank: next ? chartLogClip(next, 48) : null,
                        date: dateStr || null,
                        focusPanel: pbMove ? chartLogClip(pbMove, 48) : null,
                    });
                }
                var dateChanged = !!dateStr && dateStr !== prevPointerDate;
                if (dateChanged && !bankChanged && prevBandBank === next && (next || pbMove)) {
                    var tScr = Date.now();
                    if (tScr - lastRibbonScrubLogAt >= 450) {
                        lastRibbonScrubLogAt = tScr;
                        clientLog('info', 'Chart ribbon date scrub', {
                            section: String(section || ''),
                            date: dateStr,
                            bandBank: next ? chartLogClip(next, 48) : null,
                        });
                    }
                }
                syncRibbonTrayUi();
                refreshRibbonUnderChartPanel();
            }
            function onRibbonZrGlobalOut() {
                clientLog('info', 'Chart ribbon pointer leave chart', { section: String(section || '') });
                hoveredBank = '';
                syncRibbonTrayUi();
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                scheduleRibbonRedraw();
                syncInfoboxRowHighlight();
                refreshRibbonUnderChartPanel();
            }
            function onRibbonZrClick(ev) {
                var xy = ribbonZrXY(ev);
                var data = chart.convertFromPixel(ribbonAxisFinder, xy);
                if (!data || data.length < 2) return;
                var dateStr = resolveDateFromAxisValue(data[0]);
                var yVal = data[1];
                var tapBank = pickBankFromRibbonBand(dateStr, yVal);
                var pinnedBank = canonicalBandsBankFromUi(String(ribbonProductBank || '').trim());
                var anchorChanged = setRibbonAnchorDate(dateStr);

                if (tapBank) {
                    ribbonTrayHoverBank = '';
                    ribbonProductBank = tapBank;
                    hoveredBank = tapBank;
                    syncRibbonPinnedPanelState();
                    clientLog('info',
                        pinnedBank && normRibbonBankName(pinnedBank) === normRibbonBankName(tapBank)
                            ? 'Chart ribbon anchor update (pinned bank)'
                            : 'Chart ribbon bank pin (chart click)',
                        {
                        section: String(section || ''),
                        bank: chartLogClip(tapBank, 48),
                        date: anchorChanged ? lastPointerDate : null,
                    });
                    return;
                }

                if (pinnedBank && anchorChanged) {
                    ribbonTrayHoverBank = '';
                    hoveredBank = pinnedBank;
                    syncRibbonPinnedPanelState();
                    clientLog('info', 'Chart ribbon anchor update', {
                        section: String(section || ''),
                        bank: chartLogClip(pinnedBank, 48),
                        date: lastPointerDate || null,
                    });
                    return;
                }

                ribbonTrayHoverBank = '';
                hoveredBank = '';
                syncRibbonPinnedPanelState();
                clientLog('info', 'Chart ribbon hover clear', { section: String(section || '') });
            }

            function ribbonAnchorYmdOrLast() {
                var cur = String(lastPointerDate || '').slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(cur) && dates.indexOf(cur) >= 0) return cur;
                return dates.length ? dates[dates.length - 1] : '';
            }

            ribbonChromeHandlers.onChipClick = function (fullName) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (!bn) return;
                if (
                    ribbonProductBank &&
                    normRibbonBankName(bn) === normRibbonBankName(ribbonProductBank)
                ) {
                    ribbonTrayHoverBank = '';
                    ribbonProductBank = '';
                    hoveredBank = '';
                    hideRibbonInfoBox();
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    refreshRibbonUnderChartPanel();
                    scheduleRibbonRedraw();
                    syncRibbonTrayUi();
                    clientLog('info', 'Chart lender tray chip deselect', {
                        section: String(section || ''),
                        bank: chartLogClip(bn, 48),
                    });
                    return;
                }
                ribbonTrayHoverBank = '';
                ribbonProductBank = bn;
                hoveredBank = bn;
                setRibbonAnchorDate(ribbonAnchorYmdOrLast());
                syncRibbonPinnedPanelState();
                window.requestAnimationFrame(function () {
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    if (useRibbonCanvas) scheduleRibbonRedraw();
                });
                clientLog('info', 'Chart lender tray chip click', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                    anchorDate: lastPointerDate || null,
                });
            };

            ribbonChromeHandlers.onChipPointerEnter = function (fullName) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (!bn) return;
                hoveredBank = '';
                ribbonTrayHoverBank = bn;
                if (!lastPointerDate && dates.length) lastPointerDate = dates[dates.length - 1];
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                window.requestAnimationFrame(function () {
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    if (useRibbonCanvas) scheduleRibbonRedraw();
                });
                clientLog('info', 'Chart lender tray logo hover', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                });
            };
            ribbonChromeHandlers.onChipPointerLeave = function (fullName) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (normRibbonBankName(ribbonTrayHoverBank) !== normRibbonBankName(bn)) return;
                ribbonTrayHoverBank = '';
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                clientLog('info', 'Chart lender tray logo hover end', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                });
            };

            (function attachRibbonHierarchyHover() {
                var panelEl = ribbonHierarchyPanel && ribbonHierarchyPanel.el;
                if (!panelEl) return;
                if (panelEl._arRibbonListOver) {
                    try { panelEl.removeEventListener('mouseover', panelEl._arRibbonListOver); } catch (_e) {}
                    try { panelEl.removeEventListener('mouseout', panelEl._arRibbonListOut); } catch (_e2) {}
                }
                panelEl._arRibbonListOver = function (ev) {
                    var row = ev.target.closest('[data-ribbon-scope]');
                    if (!row || !panelEl.contains(row)) return;
                    var sid = row.getAttribute('data-ribbon-scope');
                    var keys = sid ? ribbonHoverScopeMap[sid] : null;
                    if (!keys || !keys.length) return;
                    ribbonListHoverKeys = keys.slice();
                    ribbonListHoverPath = String(row.getAttribute('data-ribbon-tree-path') || '');
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    syncInfoboxRowHighlight();
                    var rowIsLeaf = row.classList && row.classList.contains('ar-report-infobox-trow--leaf');
                    var preview = keys.length === 1 ? chartLogProductParts(keys[0]) : null;
                    clientLog('info', rowIsLeaf ? 'Chart hierarchy product row hover' : 'Chart hierarchy tier row hover', {
                        section: String(section || ''),
                        keys: keys.length,
                        bank: preview ? preview.bank : null,
                        product: preview ? preview.product : null,
                    });
                };
                panelEl._arRibbonListOut = function (ev) {
                    var toEl = ev.relatedTarget;
                    if (toEl && panelEl.contains(toEl)) return;
                    if (!ribbonListHoverKeys) return;
                    var n = ribbonListHoverKeys.length;
                    ribbonListHoverKeys = null;
                    ribbonListHoverPath = '';
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    syncInfoboxRowHighlight();
                    clientLog('info', 'Chart hierarchy row hover clear', { section: String(section || ''), keys: n });
                };
                panelEl.addEventListener('mouseover', panelEl._arRibbonListOver);
                panelEl.addEventListener('mouseout', panelEl._arRibbonListOut);
            })();

            zr.on('mousemove', onRibbonZrMouseMove);
            zr.on('globalout', onRibbonZrGlobalOut);
            zr.on('click', onRibbonZrClick);
            zrRibbonSubs.push({ type: 'mousemove', fn: onRibbonZrMouseMove });
            zrRibbonSubs.push({ type: 'globalout', fn: onRibbonZrGlobalOut });
            zrRibbonSubs.push({ type: 'click', fn: onRibbonZrClick });

            chart.on('finished', function () {
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                if (useRibbonCanvas) {
                    recomputeRibbonLod();
                    scheduleRibbonRedraw();
                }
            });

            siteUiRibbonListener = function () {
                var tu = Date.now();
                if (tu - lastSiteUiRibbonLogAt >= 800) {
                    lastSiteUiRibbonLogAt = tu;
                    clientLog('info', 'Chart ribbon style refresh (site UI)', { section: String(section || '') });
                }
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
            };
            window.addEventListener('ar:site-ui-settings', siteUiRibbonListener);
            syncRibbonTrayUi();
        }

        return {
            mount: mount,
            chart: {
                resize: function (width, height) {
                    chart.resize({ width: width, height: height });
                    chartWidth = width || mount.clientWidth || container.clientWidth || window.innerWidth || chart.getWidth() || 0;
                    showRibbonEdgeLabels = chartWidth >= 1080;
                    reportGridRight = showRibbonEdgeLabels ? 144 : (chartWidth >= 760 ? 28 : 18);
                    chart.setOption({ grid: { right: reportGridRight } }, { lazyUpdate: false, silent: true });
                    if (isBandsMode) applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    if (useRibbonCanvas) {
                        recomputeRibbonLod();
                        scheduleRibbonRedraw();
                    }
                },
            },
            kind: options.reportViewKind || 'report-plot',
            dispose: function () {
                if (ribbonRaf != null) {
                    try { window.cancelAnimationFrame(ribbonRaf); } catch (_) {}
                    ribbonRaf = null;
                }
                if (zrRibbonSubs.length) {
                    try {
                        var zr2 = chart.getZr();
                        zrRibbonSubs.forEach(function (sub) {
                            try { zr2.off(sub.type, sub.fn); } catch (_) {}
                        });
                    } catch (_) {}
                }
                zrRibbonSubs = [];
                if (siteUiRibbonListener) {
                    try { window.removeEventListener('ar:site-ui-settings', siteUiRibbonListener); } catch (_) {}
                    siteUiRibbonListener = null;
                }
                if (options.infoBox && options.infoBox.el) {
                    var ibx = options.infoBox.el;
                    ibx._arOnClose = null;
                }
                if (ribbonHierarchyPanel && ribbonHierarchyPanel.el) {
                    var panelEl = ribbonHierarchyPanel.el;
                    if (panelEl._arRibbonListOver) {
                        try { panelEl.removeEventListener('mouseover', panelEl._arRibbonListOver); } catch (_e3) {}
                        panelEl._arRibbonListOver = null;
                    }
                    if (panelEl._arRibbonListOut) {
                        try { panelEl.removeEventListener('mouseout', panelEl._arRibbonListOut); } catch (_e4) {}
                        panelEl._arRibbonListOut = null;
                    }
                }
                try { chart.dispose(); } catch (_) {}
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
            },
        };
    }

    function createRibbonHierarchyPanel(theme, escHtml) {
        var el = document.createElement('div');
        el.className = 'ar-report-infobox ar-report-infobox--compact ar-report-infobox--ribbon-tree ar-report-underchart-tree';
        el.style.cssText = 'display:none;padding:8px 10px 10px;font:11px/1.5 "Space Grotesk",system-ui,sans-serif;color:' + theme.ttText + ';background:' + theme.ttBg + ';border:1px solid ' + theme.ttBorder + ';border-radius:6px;margin-top:8px;flex-shrink:0;max-height:min(42vh,320px);overflow:auto;';
        var body = document.createElement('div');
        el.appendChild(body);
        return {
            el: el,
            show: function (input) {
                if (!input || typeof input.renderBody !== 'function') {
                    el.style.display = 'none';
                    body.innerHTML = '';
                    return;
                }
                var heading = input.heading
                    ? '<div style="font-weight:700;margin-bottom:4px;font-size:12px;line-height:1.2;">' + escHtml(input.heading) + '</div>'
                    : '';
                var meta = input.meta
                    ? '<div style="font-size:10px;color:' + theme.muted + ';margin-bottom:8px;line-height:1.3;">' + escHtml(input.meta) + '</div>'
                    : '';
                body.innerHTML = heading + meta;
                var treeRoot = document.createElement('div');
                treeRoot.className = 'ar-report-infobox-ribbon-tree';
                body.appendChild(treeRoot);
                try {
                    input.renderBody(treeRoot);
                } catch (_e) {}
                el.style.display = 'block';
            },
            hide: function () {
                body.innerHTML = '';
                el.style.display = 'none';
            },
        };
    }

    var chartReportPlotPayloadUtils = window.AR.chartReportPlotPayloadUtils || {};

    window.AR.chartReportPlot = {
        createMovesStrip: createMovesStrip,
        prepareLwcMovesHistogram: prepareLwcMovesHistogram,
        attachLwcMovesPane: attachLwcMovesPane,
        payloadDateRange: chartReportPlotPayloadUtils.payloadDateRange,
        fallbackSeriesDateBoundsFromModel: chartReportPlotPayloadUtils.fallbackSeriesDateBoundsFromModel,
        bankTrayEntriesFromBandsPayload: chartReportPlotPayloadUtils.bankTrayEntriesFromBandsPayload,
        render: render,
    };
})();
