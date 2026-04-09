(function () {
    'use strict';
    window.AR = window.AR || {};

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
                return [date, point != null ? Number(point.min_rate) : null];
            });
            var deltaData = dates.map(function (date) {
                var point = byDate[date];
                if (point == null) return [date, null];
                return [date, Math.max(0, Number(point.max_rate) - Number(point.min_rate))];
            });
            var meanData = dates.map(function (date) {
                var point = byDate[date];
                return [date, point != null && Number.isFinite(Number(point.mean_rate)) ? Number(point.mean_rate) : null];
            });
            var maxData = dates.map(function (date) {
                var point = byDate[date];
                return [date, point != null ? Number(point.max_rate) : null];
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
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
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
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
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
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
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
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
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
                if (d && Number.isFinite(v)) byDate[d] = v;
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
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
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
                if (d && Number.isFinite(v)) byDate[d] = v;
            });
            var hasData = false;
            for (var di = 0; di < dates.length; di++) {
                if (byDate[dates[di]] != null) { hasData = true; break; }
            }
            if (!hasData) return;
            var key = '[P]' + bn + '|' + pn;
            var entry = {
                key: key,
                bankName: bn,
                productName: pn,
                baseHex: baseHex,
                byDate: byDate,
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
        var ribbonChromeHandlers = { onChipClick: function () {} };
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
                    return [date, point ? Number(point.value) : null];
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
                    return [date, point ? Number(point.value) : null];
                }),
            },
            {
                name: 'Baseline',
                type: 'line',
                yAxisIndex: 1,
                symbol: 'none',
                silent: true,
                lineStyle: { color: theme.axis, width: 1, opacity: 0.65 },
                data: dates.map(function (date) { return [date, 0]; }),
            },
        ];
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
                    byDate[String(p.date || '').slice(0, 10)] = p;
                });
                bandByDateByBank[bank.bank_name] = byDate;
            });
        }

        var hoveredBank = '';
        var ribbonProductBank = '';
        var selectedProductName = '';
        var lastPointerDate = '';

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
                var lo = Number(p.min_rate);
                var hi = Number(p.max_rate);
                if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
                if (yVal >= lo && yVal <= hi) {
                    var w = hi - lo;
                    candidates.push({ bn: bn, w: Number.isFinite(w) ? w : 0 });
                }
            });
            candidates.sort(function (a, b) { return a.w - b.w; });
            return candidates.length ? candidates[0].bn : '';
        }

        function ribbonDimTarget() {
            return hoveredBank || ribbonProductBank || '';
        }

        function syncRibbonTrayUi() {
            if (!ribbonTrayRoot) return;
            var focus = ribbonDimTarget();
            var chips = ribbonTrayRoot.querySelectorAll('.lwc-focus-bank-chip');
            for (var i = 0; i < chips.length; i++) {
                var ch = chips[i];
                var full = String(ch.title || '').trim();
                ch.classList.toggle('is-ribbon-hover', !!hoveredBank && full === hoveredBank);
                ch.classList.toggle('is-ribbon-selected', !!ribbonProductBank && full === ribbonProductBank);
                ch.classList.toggle('is-ribbon-dim', !!focus && full !== focus);
            }
            if (ribbonHoverLabelEl) {
                var txt = ribbonDimTarget();
                ribbonHoverLabelEl.textContent = txt;
                ribbonHoverLabelEl.style.display = txt ? 'inline' : 'none';
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
                var show = ribbonProductBank && bn === ribbonProductBank;
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
            chart.setOption({ series: updates });
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
            if (!ribbonProductBank) return;
            var prods = ribbonCanvasModel.byBank[ribbonProductBank];
            if (!prods || !prods.length) return;
            var idxs = ribbonLodIndices;
            prods.forEach(function (prod) {
                var isSel = prod.key === selectedProductName;
                ctx.beginPath();
                var first = true;
                function plotAt(di) {
                    var d = dates[di];
                    var v = prod.byDate[d];
                    if (v == null) return;
                    var pix = chart.convertToPixel({ gridIndex: 0 }, [d, v]);
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
            var data = chart.convertFromPixel({ gridIndex: 0 }, [offsetX, offsetY]);
            if (!data || data.length < 2) return null;
            var dateStr = resolveDateFromAxisValue(data[0]);
            if (!dateStr || !ribbonProductBank) return null;
            var prods = ribbonCanvasModel.byBank[ribbonProductBank];
            if (!prods) return null;
            var best = null;
            var bestDist = Infinity;
            prods.forEach(function (prod) {
                var v = prod.byDate[dateStr];
                if (v == null) return;
                var pix = chart.convertToPixel({ gridIndex: 0 }, [dateStr, v]);
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
            var ib = options.infoBox;
            if (ib && typeof ib.hide === 'function') ib.hide();
        }

        function applyRibbonBankHighlightState(hoveredBankName) {
            if (!isBandsMode || !plotPayload || !plotPayload.series || !plotPayload.series.length) return;
            var rs = getRibbonStyleResolved();
            var updates = [];
            plotPayload.series.forEach(function (bank, index) {
                var active = !hoveredBankName || bank.bank_name === hoveredBankName;
                var c0 = options.bankColor(bank.bank_name, index);
                var strokeC = active ? c0 : mixHexWithGrey(c0, rs.others_grey_mix);
                var zRoot = active ? Number(rs.active_z) : Number(rs.inactive_z);
                var zb = zRoot + index * 0.08;
                var ew = Math.max(0, Number(rs.edge_width) || 0);
                var eo = Math.max(0, Math.min(1, Number(active ? rs.edge_opacity : rs.edge_opacity_others)));
                var edgeLine = { color: strokeC, width: ew > 0 ? ew : 0.01, opacity: ew > 0 ? eo : 0, cap: 'round', join: 'round' };
                var fe = Math.max(0, Math.min(1, Number(rs.fill_opacity_end)));
                var fp = Math.max(0, Math.min(1, Number(rs.fill_opacity_peak)));
                var sc = Math.max(0, Math.min(1, Number(rs.fill_opacity_others_scale)));
                var fillEnd = active ? fe : fe * sc;
                var fillPeak = active ? fp : fp * sc;
                var mw = Math.max(0, Number(rs.mean_width) || 0);
                var mo = Math.max(0, Math.min(1, Number(active ? rs.mean_opacity : rs.mean_opacity_others)));
                updates.push({ id: 'ribbon_min_' + index, z: zb, lineStyle: edgeLine, areaStyle: { opacity: 0 } });
                updates.push({
                    id: 'ribbon_fill_' + index,
                    z: zb + 0.01,
                    lineStyle: { color: strokeC, width: 0.01, opacity: 0, cap: 'round', join: 'round' },
                    areaStyle: ribbonFlowGradientFill(strokeC, fillEnd, fillPeak),
                });
                updates.push({ id: 'ribbon_max_' + index, z: zb + 0.02, lineStyle: edgeLine });
                updates.push({
                    id: 'ribbon_mean_' + index,
                    z: zb + 0.03,
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
                chart.setOption({ series: updates }, false, true);
            } catch (_e) {}
        }

        function refreshRibbonUnderChartPanel() {
            var ib = options.infoBox;
            if (!ib || typeof ib.show !== 'function') return;
            if (selectedProductName) return;
            if (!ribbonProductBank) {
                hideRibbonInfoBox();
                return;
            }
            var anchor = lastPointerDate || (dates.length ? dates[dates.length - 1] : '');
            if (!anchor) {
                hideRibbonInfoBox();
                return;
            }
            var plist = ribbonCanvasModel.byBank[ribbonProductBank] || [];
            var items = [];
            var sec = String(section || '');
            plist.forEach(function (prod) {
                var v = prod.byDate[anchor];
                if (v == null || !Number.isFinite(v) || v <= 0) return;
                if (sec === 'savings' && v < 1.0) return;
                items.push({
                    bankName: prod.bankName,
                    productName: prod.productName,
                    rate: v,
                    color: prod.baseHex,
                    selectionKey: prod.key,
                    subtitle: '',
                });
            });
            items.sort(function (a, b) { return b.rate - a.rate; });
            if (!items.length) {
                hideRibbonInfoBox();
                return;
            }
            ib.show({
                heading: fmtReportDateYmd(anchor),
                meta: ribbonProductBank + ' \u00b7 ' + items.length + ' product' + (items.length !== 1 ? 's' : ''),
                items: items,
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
            applyRibbonBankHighlightState(ribbonDimTarget());
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
                var data = chart.convertFromPixel({ gridIndex: 0 }, xy);
                if (!data || data.length < 2) return;
                var dateStr = resolveDateFromAxisValue(data[0]);
                if (dateStr) lastPointerDate = dateStr;
                var yVal = data[1];
                var next = pickBankFromRibbonBand(dateStr, yVal);
                if (next !== hoveredBank) {
                    hoveredBank = next;
                    applyRibbonBankHighlightState(ribbonDimTarget());
                    updateProductVisibility();
                }
                syncRibbonTrayUi();
                refreshRibbonUnderChartPanel();
            }
            function onRibbonZrGlobalOut() {
                hoveredBank = '';
                lastPointerDate = '';
                syncRibbonTrayUi();
                applyRibbonBankHighlightState(ribbonDimTarget());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
            }
            function onRibbonZrClick(ev) {
                var xy = ribbonZrXY(ev);
                var data = chart.convertFromPixel({ gridIndex: 0 }, xy);
                if (!data || data.length < 2) return;
                var dateStr = resolveDateFromAxisValue(data[0]);
                var yVal = data[1];
                var tapBank = pickBankFromRibbonBand(dateStr, yVal);

                if (useRibbonCanvas && ribbonProductBank && tapBank === ribbonProductBank) {
                    var pick = ribbonCanvasPickProduct(xy[0], xy[1]);
                    if (pick) {
                        if (selectedProductName === pick.prod.key) {
                            selectedProductName = '';
                            hideRibbonInfoBox();
                            refreshRibbonUnderChartPanel();
                        } else {
                            selectedProductName = pick.prod.key;
                            showRibbonInfoBox(pick);
                        }
                        applyRibbonBankHighlightState(ribbonDimTarget());
                        scheduleRibbonRedraw();
                        syncRibbonTrayUi();
                        return;
                    }
                }

                if (tapBank) {
                    if (dateStr) lastPointerDate = dateStr;
                    ribbonProductBank = tapBank;
                    hoveredBank = tapBank;
                    selectedProductName = '';
                    hideRibbonInfoBox();
                    applyRibbonBankHighlightState(ribbonDimTarget());
                    updateProductVisibility();
                    refreshRibbonUnderChartPanel();
                    scheduleRibbonRedraw();
                    syncRibbonTrayUi();
                    return;
                }

                ribbonProductBank = '';
                selectedProductName = '';
                hideRibbonInfoBox();
                applyRibbonBankHighlightState(ribbonDimTarget());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
            }

            ribbonChromeHandlers.onChipClick = function (fullName) {
                var bn = String(fullName || '').trim();
                if (!bn) return;
                ribbonProductBank = bn;
                hoveredBank = bn;
                lastPointerDate = dates.length ? dates[dates.length - 1] : '';
                selectedProductName = '';
                hideRibbonInfoBox();
                applyRibbonBankHighlightState(ribbonDimTarget());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
            };
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
                    if (!ribbonProductBank) return;
                    var rest = name.slice(3);
                    var pipe = rest.indexOf('|');
                    var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                    if (bn !== ribbonProductBank) return;
                    var pn = pipe >= 0 ? rest.slice(pipe + 1) : '';
                    var rate = params.value && params.value[1] != null ? Number(params.value[1]) : null;
                    var dateStr = params.value && params.value[0] != null ? String(params.value[0]).slice(0, 10) : '';
                    if (selectedProductName === name) {
                        selectedProductName = '';
                        hideRibbonInfoBox();
                        refreshRibbonUnderChartPanel();
                    } else {
                        selectedProductName = name;
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
                    }
                    applyRibbonBankHighlightState(ribbonDimTarget());
                    updateProductVisibility();
                });
            }

            chart.on('finished', function () {
                applyRibbonBankHighlightState(ribbonDimTarget());
                if (useRibbonCanvas) {
                    recomputeRibbonLod();
                    scheduleRibbonRedraw();
                }
            });

            siteUiRibbonListener = function () {
                applyRibbonBankHighlightState(ribbonDimTarget());
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
                    if (isBandsMode) applyRibbonBankHighlightState(ribbonDimTarget());
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
                try { chart.dispose(); } catch (_) {}
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
            },
        };
    }

    window.AR.chartReportPlot = {
        createMovesStrip: createMovesStrip,
        prepareLwcMovesHistogram: prepareLwcMovesHistogram,
        attachLwcMovesPane: attachLwcMovesPane,
        payloadDateRange: payloadDateRange,
        fallbackSeriesDateBoundsFromModel: fallbackSeriesDateBoundsFromModel,
        render: render,
    };
})();
