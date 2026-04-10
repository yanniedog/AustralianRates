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
            mean_width: 1.25,
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

    /** Horizontal light band (along time) so filled ribbons read as soft tubes, not flat slabs. */
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
            x2: 1,
            y2: 0,
            colorStops: [
                { offset: 0, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
                { offset: 0.42, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 0.58, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(pk) + ')' },
                { offset: 1, color: 'rgba(' + r + ',' + g + ',' + b + ',' + String(lo) + ')' },
            ],
        };
    }

    /** Spline-like edges (superficial Sankey-style); keep identical on stacked pair. */
    var RIBBON_SANKEY_SMOOTH = 0.42;

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
                smooth: false,
                symbol: 'none',
                connectNulls: false,
                lineStyle: {
                    color: color,
                    width: mw > 0 ? mw : 0.01,
                    opacity: mw > 0 ? mo : 0,
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
            return ['security_purpose', 'repayment_type', 'rate_structure', 'lvr_tier', 'feature_set'];
        }
        if (s === 'savings') {
            return ['account_type', 'rate_type', 'deposit_tier', 'feature_set'];
        }
        if (s === 'term-deposits') {
            return ['term_months', 'deposit_tier', 'interest_payment', 'rate_structure', 'feature_set'];
        }
        return ['security_purpose', 'repayment_type', 'rate_structure'];
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

    function maxRibbonNodeRate(node, anchorYmd) {
        if (!node || node.kind === 'empty') return null;
        if (node.kind === 'leaves') {
            var m = -Infinity;
            node.products.forEach(function (p) {
                var v = p.byDate[anchorYmd];
                if (v != null && Number.isFinite(v) && v > m) m = v;
            });
            return Number.isFinite(m) ? m : null;
        }
        var m2 = -Infinity;
        (node.groups || []).forEach(function (g) {
            var r = maxRibbonNodeRate(g.child, anchorYmd);
            if (r != null && r > m2) m2 = r;
        });
        return Number.isFinite(m2) ? m2 : null;
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
            out.push({
                id: 'ribbon_prod_' + out.length,
                name: '[P]' + bn + '|' + pn,
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
            var key = '[P]' + bn + '|' + pn;
            var row = (s.latestRow && typeof s.latestRow === 'object') ? s.latestRow : {};
            if (!row || Object.keys(row).length === 0) {
                var lp = (s.points && s.points.length) ? s.points[s.points.length - 1] : null;
                if (lp && lp.row && typeof lp.row === 'object') row = lp.row;
            }
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

        var container = options.container;
        var theme = options.theme;
        var plotPayload = options.plotPayload;
        var range = options.range;
        var section = options.section;
        var bankList = options.bankList || [];
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
        var prep = M.prepareRbaCpiForReport(options.rbaHistory, options.cpiData, range.viewStart, range.ctxMax);
        var rbaDaily = M.fillForwardDaily(prep.rbaData.points, 'date', 'rate', range.chartStart, range.ctxMax);
        var cpiDaily = M.fillForwardDaily(prep.cpiPoints, 'date', 'value', range.chartStart, range.ctxMax);
        var overlayDefs = overlayModule.prepareWindowSeries
            ? overlayModule.prepareWindowSeries(options.economicOverlaySeries || [], range.viewStart, range.ctxMax)
            : [];

        var series = [
            {
                name: 'RBA',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                step: 'end',
                lineStyle: { color: theme.rba, width: 2, type: 'dashed' },
                data: dates.map(function (date) {
                    var point = rbaDaily.find(function (entry) { return entry.date === date; });
                    return [date, point ? finiteRateOrNull(point.value) : null];
                }),
            },
            {
                name: 'CPI',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                step: 'end',
                lineStyle: { color: theme.cpi, width: 2, type: 'dashed' },
                data: dates.map(function (date) {
                    var point = cpiDaily.find(function (entry) { return entry.date === date; });
                    return [date, point ? finiteRateOrNull(point.value) : null];
                }),
            },
        ];
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
        var ribbonProductBank = '';
        var ribbonTrayHoverBank = '';
        var selectedProductName = '';
        var lastPointerDate = '';
        var ribbonChartHoverProductKey = '';
        var ribbonListHoverKeys = null;
        var ribbonHoverScopeMap = {};
        var ribbonHoverScopeSeq = 0;
        var ribbonExpandedPaths = {};
        var ribbonTreeAnchorYmd = '';

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

        function ribbonPanelBank() {
            return String(ribbonTrayHoverBank || ribbonProductBank || '').trim();
        }

        /** Bank whose ribbons stay full-colour: tray hover or pinned chip only; chart mouseover never dims peers. */
        function ribbonChartHighlightBank() {
            return ribbonPanelBank();
        }

        function ribbonLineFilterKeys() {
            if (selectedProductName) return [selectedProductName];
            var list = ribbonListHoverKeys;
            var chart = ribbonChartHoverProductKey;
            if (list && list.length) {
                if (chart) {
                    if (list.indexOf(chart) >= 0) return [chart];
                    return [chart];
                }
                return list.slice();
            }
            if (chart) return [chart];
            return [];
        }

        function productLineVisible(prodKey) {
            var fk = ribbonLineFilterKeys();
            if (fk === null) return true;
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
                var txt = ribbonChartHighlightBank();
                ribbonHoverLabelEl.textContent = txt;
                ribbonHoverLabelEl.style.display = txt ? 'inline' : 'none';
            }
        }

        function syncInfoboxRowHighlight() {
            var ib = options.infoBox;
            if (!ib || !ib.el) return;
            var k = ribbonChartHoverProductKey;
            var rows = ib.el.querySelectorAll('.ar-report-infobox-row[data-ribbon-prod-key]');
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                row.classList.toggle('is-ribbon-chart-sync', !!k && row.getAttribute('data-ribbon-prod-key') === k);
            }
            var scopes = ib.el.querySelectorAll('[data-ribbon-scope]');
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
            var os = Math.max(0, Math.min(1, Number(rs.product_line_opacity_selected)));
            var wh = Math.max(0, Number(rs.product_line_width_hover) || 1.2);
            var ws = Math.max(0, Number(rs.product_line_width_selected) || 2.5);
            var updates = [];
            productOverlay.forEach(function (s) {
                var rest = s.name.slice(3);
                var pipe = rest.indexOf('|');
                var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                var pb = ribbonPanelBank();
                var showBank = pb && normRibbonBankName(bn) === normRibbonBankName(pb);
                var match = productLineVisible(s.name);
                var show = showBank && match;
                var isSelected = s.name === selectedProductName;
                var base = s._ribbonBaseHex || '#64748b';
                updates.push({
                    id: s.id,
                    lineStyle: {
                        color: hexToRgba(base, isSelected ? os : oh),
                        width: isSelected ? ws : wh,
                        opacity: show ? 1 : 0,
                        cap: 'round',
                        join: 'round',
                    },
                    silent: !show,
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
                var isSel = prod.key === selectedProductName;
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
                var os = Math.max(0, Math.min(1, Number(rsC.product_line_opacity_selected)));
                var wh = Math.max(0, Number(rsC.product_line_width_hover) || 1.2);
                var ws = Math.max(0, Number(rsC.product_line_width_selected) || 2.5);
                ctx.strokeStyle = hexToRgba(prod.baseHex, isSel ? os : oh);
                ctx.lineWidth = isSel ? ws : wh;
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

        function ribbonCanvasPickProduct(offsetX, offsetY) {
            var data = chart.convertFromPixel(ribbonAxisFinder, [offsetX, offsetY]);
            if (!data || data.length < 2) return null;
            var dateStr = resolveDateFromAxisValue(data[0]);
            var pbPick = ribbonPanelBank();
            if (!dateStr || !pbPick) return null;
            var prods = ribbonCanvasModel.byBank[pbPick];
            if (!prods) return null;
            var best = null;
            var bestDist = Infinity;
            prods.forEach(function (prod) {
                var v = prod.byDate[dateStr];
                if (v == null) return;
                var pix = chart.convertToPixel(ribbonAxisFinder, [dateStr, v]);
                if (!pix || pix.length < 2) return;
                var dx = pix[0] - offsetX;
                var dy = pix[1] - offsetY;
                var dist = dx * dx + dy * dy;
                if (dist < bestDist && Math.abs(dx) < 28) {
                    bestDist = dist;
                    best = { prod: prod, rate: v, date: dateStr };
                }
            });
            if (best && bestDist < 1600) return best;
            return null;
        }

        function overlayPickProduct(offsetX, offsetY) {
            if (!ribbonPanelBank() || !productOverlay.length) return null;
            var data = chart.convertFromPixel(ribbonAxisFinder, [offsetX, offsetY]);
            if (!data || data.length < 2) return null;
            var dateStr = resolveDateFromAxisValue(data[0]);
            if (!dateStr) return null;
            var best = null;
            var bestDist = Infinity;
            var pbOv = ribbonPanelBank();
            productOverlay.forEach(function (s) {
                var rest = s.name.slice(3);
                var pipe = rest.indexOf('|');
                var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                if (normRibbonBankName(bn) !== normRibbonBankName(pbOv)) return;
                var yAt = null;
                (s.data || []).forEach(function (pt) {
                    if (!pt || pt.length < 2) return;
                    if (String(pt[0]).slice(0, 10) === dateStr && pt[1] != null) {
                        yAt = Number(pt[1]);
                    }
                });
                if (yAt == null || !Number.isFinite(yAt)) return;
                var pix = chart.convertToPixel(ribbonAxisFinder, [dateStr, yAt]);
                if (!pix || pix.length < 2) return;
                var dx = pix[0] - offsetX;
                var dy = pix[1] - offsetY;
                var dist = dx * dx + dy * dy;
                if (dist < bestDist && Math.abs(dx) < 28) {
                    bestDist = dist;
                    var pn = pipe >= 0 ? rest.slice(pipe + 1) : '';
                    best = {
                        prod: {
                            key: s.name,
                            bankName: bn,
                            productName: pn,
                            baseHex: s._ribbonBaseHex || '#64748b',
                        },
                        rate: yAt,
                        date: dateStr,
                    };
                }
            });
            if (best && bestDist < 1600) return best;
            return null;
        }

        function showRibbonInfoBox(pick) {
            var ib = options.infoBox;
            if (!ib || typeof ib.show !== 'function' || !pick) return;
            ib.show({
                heading: fmtReportDateYmd(pick.date),
                meta: M.selectionMetaText ? M.selectionMetaText({
                    selectionYmd: pick.date,
                    rate: pick.rate,
                    entries: [{ bankName: pick.prod.bankName, productName: pick.prod.productName, rate: pick.rate, color: pick.prod.baseHex, selectionKey: pick.prod.key, subtitle: '' }],
                }) : '',
                compact: true,
                items: [{
                    bankName: pick.prod.bankName,
                    productName: pick.prod.productName,
                    rate: pick.rate,
                    color: pick.prod.baseHex,
                    selectionKey: pick.prod.key,
                    subtitle: '',
                }],
            });
        }

        function hideRibbonInfoBox() {
            ribbonListHoverKeys = null;
            var ib = options.infoBox;
            if (ib && typeof ib.hide === 'function') ib.hide();
        }

        function applyRibbonBankHighlightState(hoveredBankName) {
            if (!isBandsMode || !plotPayload || !plotPayload.series || !plotPayload.series.length) return;
            var rs = getRibbonStyleResolved();
            var focusKey = resolveBandsFocusKey(hoveredBankName);
            var visualSig =
                String(focusKey || '') +
                '|' +
                normRibbonBankName(ribbonProductBank) +
                '|' +
                normRibbonBankName(ribbonTrayHoverBank);
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
                var c0 = options.bankColor(bank.bank_name, index);
                var strokeC = active ? c0 : mixHexWithGrey(c0, rs.others_grey_mix);
                var zRoot = active ? Number(rs.active_z) : Number(rs.inactive_z);
                var zb = zRoot + index * 0.08;
                var zlv = focusKey ? (active ? 2 : 0) : 0;
                var ew = Math.max(0, Number(rs.edge_width) || 0);
                var eo = Math.max(0, Math.min(1, Number(active ? rs.edge_opacity : rs.edge_opacity_others)));
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
                var sc = Math.max(0, Math.min(1, Number(rs.fill_opacity_others_scale)));
                var fillEnd = active ? (selected ? sfe : (focusKey ? ffe : fe)) : fe * sc;
                var fillPeak = active ? (selected ? sfp : (focusKey ? ffp : fp)) : fp * sc;
                var mw = Math.max(0, Number(rs.mean_width) || 0);
                var mo = Math.max(0, Math.min(1, Number(active ? rs.mean_opacity : rs.mean_opacity_others)));
                var fillAreaStyle;
                if (active) {
                    if (focusKey && fillEnd <= 0 && fillPeak <= 0) {
                        var focusFill = hexToRgba(strokeC, 0.24);
                        fillAreaStyle = {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 1,
                            y2: 0,
                            colorStops: [
                                { offset: 0, color: focusFill },
                                { offset: 1, color: focusFill },
                            ],
                        };
                    } else {
                        fillAreaStyle = ribbonFlowGradientFill(strokeC, fillEnd, fillPeak);
                    }
                } else {
                    fillAreaStyle = { color: hexToRgba(strokeC, Math.min(1, Math.max(0, (fillEnd + fillPeak) * 0.85))) };
                }
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
                        cap: 'round',
                        join: 'round',
                    },
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
                    var v = p.byDate[anchorYmd];
                    if (v == null || !Number.isFinite(v) || v <= 0) return;
                    if (secStr === 'savings' && v < 1.0) return;
                    var scopeId = registerRibbonHoverScope([p.key]);
                    var row = document.createElement('div');
                    row.className = 'ar-report-infobox-trow ar-report-infobox-trow--leaf ar-report-infobox-row';
                    row.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:2px 0;border-top:1px solid rgba(148,163,184,0.18);font-size:11px;line-height:1.25;min-width:0;cursor:default;padding-left:' + (6 + depth * 12) + 'px;';
                    row.setAttribute('data-ribbon-scope', scopeId);
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
                var mr = maxRibbonNodeRate(g.child, anchorYmd);
                var branchLabel = ribbonFieldLabel(node.field) + ': ' + g.label;
                var brow = document.createElement('div');
                brow.className = 'ar-report-infobox-trow ar-report-infobox-trow--branch';
                brow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid rgba(148,163,184,0.2);font-size:11px;line-height:1.25;min-width:0;cursor:pointer;padding-left:' + (4 + depth * 12) + 'px;';
                brow.setAttribute('data-ribbon-scope', scopeId);
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
                rateSpan.textContent = mr != null && Number.isFinite(mr) ? mr.toFixed(2) + '%' : '';
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
            var ib = options.infoBox;
            if (!ib || typeof ib.show !== 'function') return;
            if (selectedProductName) return;
            var pbPanel = ribbonPanelBank();
            if (!pbPanel) {
                hideRibbonInfoBox();
                return;
            }
            var anchor = lastPointerDate || (dates.length ? dates[dates.length - 1] : '');
            if (!anchor) {
                hideRibbonInfoBox();
                return;
            }
            if (ribbonTreeBank !== pbPanel || ribbonTreeAnchorYmd !== anchor) {
                ribbonExpandedPaths = {};
                ribbonTreeBank = pbPanel;
                ribbonTreeAnchorYmd = anchor;
            }
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
                hideRibbonInfoBox();
                return;
            }
            clearRibbonHoverScopes();
            var tierFields = ribbonTierFieldsForSection(sec);
            var tree = buildRibbonTierTree(prodsAtAnchor, tierFields, 0);
            if (!tree || tree.kind === 'empty') {
                hideRibbonInfoBox();
                return;
            }
            var n = prodsAtAnchor.length;
            ib.show({
                heading: fmtReportDateYmd(anchor),
                meta: pbPanel + ' \u00b7 ' + n + ' product' + (n !== 1 ? 's' : '') + ' \u00b7 focus bank above \u00b7 click tier rows to expand or collapse',
                compact: true,
                renderBody: function (wrap) {
                    renderRibbonTreeDom(wrap, tree, '', 0, anchor, sec);
                },
            });
        }

        function bankColorIndexForName(bn) {
            var want = String(bn || '').trim();
            for (var i = 0; i < bankList.length; i++) {
                var entry = bankList[i];
                var full = typeof entry === 'string' ? entry : (entry && entry.full);
                if (String(full || '').trim() === want) return i;
            }
            return 0;
        }

        var tooltipConfig = isBandsMode
            ? { show: false }
            : { trigger: 'axis', axisPointer: { type: 'line' } };

        if (options.infoBox && options.infoBox.el) {
            wrapper.appendChild(options.infoBox.el);
        }

        chart.setOption({
            animation: false,
            grid: { top: 18, right: 18, bottom: 56, left: 48, containLabel: true },
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
                {
                    type: 'value',
                    name: '%',
                    position: 'left',
                    axisLine: { lineStyle: { color: theme.axis } },
                    axisLabel: { color: theme.muted },
                    splitLine: { lineStyle: { color: theme.grid } },
                },
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
                var prevPh = ribbonChartHoverProductKey;
                var pbMove = ribbonPanelBank();
                if (pbMove && !selectedProductName && next && normRibbonBankName(next) === normRibbonBankName(pbMove)) {
                    var pickH = useRibbonCanvas ? ribbonCanvasPickProduct(xy[0], xy[1]) : overlayPickProduct(xy[0], xy[1]);
                    ribbonChartHoverProductKey = pickH && pickH.prod ? pickH.prod.key : '';
                } else {
                    ribbonChartHoverProductKey = '';
                }
                if (ribbonChartHoverProductKey !== prevPh) {
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    syncInfoboxRowHighlight();
                }
                if (bankChanged) {
                    clientLog('info', 'Chart ribbon band hover', {
                        section: String(section || ''),
                        bandBank: next ? chartLogClip(next, 48) : null,
                        date: dateStr || null,
                        focusPanel: pbMove ? chartLogClip(pbMove, 48) : null,
                    });
                }
                if (ribbonChartHoverProductKey !== prevPh) {
                    if (ribbonChartHoverProductKey) {
                        var pp = chartLogProductParts(ribbonChartHoverProductKey);
                        clientLog('info', 'Chart ribbon product line hover', {
                            section: String(section || ''),
                            bank: pp.bank || null,
                            product: pp.product || null,
                            date: dateStr || null,
                            overlay: useRibbonCanvas ? 'canvas' : 'echarts',
                        });
                    } else if (prevPh) {
                        clientLog('info', 'Chart ribbon product line hover clear', { section: String(section || '') });
                    }
                }
                var dateChanged = !!dateStr && dateStr !== prevPointerDate;
                if (
                    dateChanged &&
                    !bankChanged &&
                    ribbonChartHoverProductKey === prevPh &&
                    prevBandBank === next &&
                    (next || pbMove)
                ) {
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
                if (!ribbonTrayHoverBank) lastPointerDate = '';
                ribbonChartHoverProductKey = '';
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

                if (useRibbonCanvas && ribbonPanelBank() && tapBank && normRibbonBankName(tapBank) === normRibbonBankName(ribbonPanelBank())) {
                    var pick = ribbonCanvasPickProduct(xy[0], xy[1]);
                    if (pick) {
                        ribbonChartHoverProductKey = '';
                        if (selectedProductName === pick.prod.key) {
                            selectedProductName = '';
                            hideRibbonInfoBox();
                            refreshRibbonUnderChartPanel();
                            clientLog('info', 'Chart ribbon product line deselect', {
                                section: String(section || ''),
                                overlay: 'canvas',
                            });
                        } else {
                            ribbonTrayHoverBank = '';
                            ribbonProductBank = tapBank;
                            selectedProductName = pick.prod.key;
                            showRibbonInfoBox(pick);
                            var psel = chartLogProductParts(pick.prod.key);
                            clientLog('info', 'Chart ribbon product line select', {
                                section: String(section || ''),
                                bank: psel.bank,
                                product: psel.product,
                                date: dateStr || null,
                                rate: Number.isFinite(pick.rate) ? Math.round(pick.rate * 100) / 100 : null,
                                overlay: 'canvas',
                            });
                        }
                        applyRibbonBankHighlightState(ribbonChartHighlightBank());
                        updateProductVisibility();
                        scheduleRibbonRedraw();
                        syncInfoboxRowHighlight();
                        syncRibbonTrayUi();
                        return;
                    }
                }

                if (tapBank) {
                    if (dateStr) lastPointerDate = dateStr;
                    ribbonTrayHoverBank = '';
                    ribbonProductBank = tapBank;
                    hoveredBank = tapBank;
                    selectedProductName = '';
                    ribbonChartHoverProductKey = '';
                    hideRibbonInfoBox();
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    refreshRibbonUnderChartPanel();
                    scheduleRibbonRedraw();
                    syncRibbonTrayUi();
                    clientLog('info', 'Chart ribbon bank pin (chart click)', {
                        section: String(section || ''),
                        bank: chartLogClip(tapBank, 48),
                        date: dateStr || null,
                    });
                    return;
                }

                ribbonProductBank = '';
                ribbonTrayHoverBank = '';
                selectedProductName = '';
                ribbonChartHoverProductKey = '';
                hideRibbonInfoBox();
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                clientLog('info', 'Chart ribbon bank pin clear', { section: String(section || '') });
            }

            function ribbonAnchorYmdOrLast() {
                var cur = String(lastPointerDate || '').slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(cur) && dates.indexOf(cur) >= 0) return cur;
                return dates.length ? dates[dates.length - 1] : '';
            }

            ribbonChromeHandlers.onChipClick = function (fullName) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (!bn) return;
                ribbonTrayHoverBank = '';
                ribbonProductBank = bn;
                hoveredBank = bn;
                lastPointerDate = ribbonAnchorYmdOrLast();
                selectedProductName = '';
                ribbonChartHoverProductKey = '';
                hideRibbonInfoBox();
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                clientLog('info', 'Chart lender tray chip click', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                    anchorDate: lastPointerDate || null,
                });
            };

            ribbonChromeHandlers.onChipPointerEnter = function (fullName) {
                if (selectedProductName) return;
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
                clientLog('info', 'Chart lender tray logo hover', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                });
            };
            ribbonChromeHandlers.onChipPointerLeave = function (fullName) {
                if (selectedProductName) return;
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

            (function attachRibbonInfoboxProductHover() {
                var ibEl = options.infoBox && options.infoBox.el;
                if (!ibEl) return;
                if (ibEl._arRibbonListOver) {
                    try { ibEl.removeEventListener('mouseover', ibEl._arRibbonListOver); } catch (_e) {}
                    try { ibEl.removeEventListener('mouseout', ibEl._arRibbonListOut); } catch (_e2) {}
                }
                ibEl._arRibbonListOver = function (ev) {
                    var row = ev.target.closest('[data-ribbon-scope]');
                    if (!row || !ibEl.contains(row)) return;
                    var sid = row.getAttribute('data-ribbon-scope');
                    var keys = sid ? ribbonHoverScopeMap[sid] : null;
                    if (!keys || !keys.length) return;
                    ribbonListHoverKeys = keys.slice();
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    var rowIsLeaf = row.classList && row.classList.contains('ar-report-infobox-trow--leaf');
                    var preview = keys.length === 1 ? chartLogProductParts(keys[0]) : null;
                    clientLog('info', rowIsLeaf ? 'Chart infobox product row hover' : 'Chart infobox tier row hover', {
                        section: String(section || ''),
                        keys: keys.length,
                        bank: preview ? preview.bank : null,
                        product: preview ? preview.product : null,
                    });
                };
                ibEl._arRibbonListOut = function (ev) {
                    var toEl = ev.relatedTarget;
                    if (toEl && ibEl.contains(toEl)) return;
                    if (!ribbonListHoverKeys) return;
                    var n = ribbonListHoverKeys.length;
                    ribbonListHoverKeys = null;
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    clientLog('info', 'Chart infobox row hover clear', { section: String(section || ''), keys: n });
                };
                ibEl.addEventListener('mouseover', ibEl._arRibbonListOver);
                ibEl.addEventListener('mouseout', ibEl._arRibbonListOut);
                ibEl._arOnClose = function () {
                    ribbonListHoverKeys = null;
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                };
            })();

            zr.on('mousemove', onRibbonZrMouseMove);
            zr.on('globalout', onRibbonZrGlobalOut);
            zr.on('click', onRibbonZrClick);
            zrRibbonSubs.push({ type: 'mousemove', fn: onRibbonZrMouseMove });
            zrRibbonSubs.push({ type: 'globalout', fn: onRibbonZrGlobalOut });
            zrRibbonSubs.push({ type: 'click', fn: onRibbonZrClick });

            if (!useRibbonCanvas && productOverlay.length) {
                chart.on('click', function (params) {
                    var name = params.seriesName || '';
                    if (name.indexOf('[P]') !== 0) return;
                    var pbClk = ribbonPanelBank();
                    if (!pbClk) return;
                    var rest = name.slice(3);
                    var pipe = rest.indexOf('|');
                    var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                    if (normRibbonBankName(bn) !== normRibbonBankName(pbClk)) return;
                    var pn = pipe >= 0 ? rest.slice(pipe + 1) : '';
                    var rate = params.value && params.value[1] != null ? Number(params.value[1]) : null;
                    var dateStr = params.value && params.value[0] != null ? String(params.value[0]).slice(0, 10) : '';
                    ribbonChartHoverProductKey = '';
                    if (selectedProductName === name) {
                        selectedProductName = '';
                        hideRibbonInfoBox();
                        refreshRibbonUnderChartPanel();
                        clientLog('info', 'Chart ribbon product line deselect', {
                            section: String(section || ''),
                            overlay: 'echarts',
                        });
                    } else {
                        selectedProductName = name;
                        ribbonTrayHoverBank = '';
                        ribbonProductBank = bn;
                        hoveredBank = bn;
                        if (options.infoBox && typeof options.infoBox.show === 'function' && rate != null && Number.isFinite(rate)) {
                            var baseHex = options.bankColor(bn, bankColorIndexForName(bn));
                            options.infoBox.show({
                                heading: fmtReportDateYmd(dateStr),
                                meta: M.selectionMetaText ? M.selectionMetaText({
                                    selectionYmd: dateStr,
                                    rate: rate,
                                    entries: [{ bankName: bn, productName: pn, rate: rate, color: baseHex, selectionKey: name, subtitle: '' }],
                                }) : '',
                                compact: true,
                                items: [{
                                    bankName: bn,
                                    productName: pn,
                                    rate: rate,
                                    color: baseHex,
                                    selectionKey: name,
                                    subtitle: '',
                                }],
                            });
                        }
                        var pe = chartLogProductParts(name);
                        clientLog('info', 'Chart ribbon product line select', {
                            section: String(section || ''),
                            bank: pe.bank,
                            product: pe.product,
                            date: dateStr || null,
                            rate: Number.isFinite(rate) ? Math.round(rate * 100) / 100 : null,
                            overlay: 'echarts',
                        });
                    }
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    syncInfoboxRowHighlight();
                });
            }

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
                    if (ibx._arRibbonListOver) {
                        try { ibx.removeEventListener('mouseover', ibx._arRibbonListOver); } catch (_e) {}
                        ibx._arRibbonListOver = null;
                    }
                    if (ibx._arRibbonListOut) {
                        try { ibx.removeEventListener('mouseout', ibx._arRibbonListOut); } catch (_e2) {}
                        ibx._arRibbonListOut = null;
                    }
                    ibx._arOnClose = null;
                }
                try { chart.dispose(); } catch (_) {}
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
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
