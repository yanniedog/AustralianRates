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

    /** Horizontal light band (along time) so filled ribbons read a bit like Sankey flows, not flat slabs. */
    function ribbonSankeyFlowAreaFill(hex) {
        var rgb = parseHexRgb(hex);
        var r = rgb.r;
        var g = rgb.g;
        var b = rgb.b;
        return {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
                { offset: 0, color: 'rgba(' + r + ',' + g + ',' + b + ',0.28)' },
                { offset: 0.42, color: 'rgba(' + r + ',' + g + ',' + b + ',0.58)' },
                { offset: 0.58, color: 'rgba(' + r + ',' + g + ',' + b + ',0.58)' },
                { offset: 1, color: 'rgba(' + r + ',' + g + ',' + b + ',0.28)' },
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

    /**
     * Ribbon touch: tap reveals products for the bank whose inner band contains the tap (same inner band as hover).
     * Mouse: move within the inner band to reveal; edge of ribbon stays masked.
     */
    function ribbonTouchNote() {
        return 'Ribbon: move the pointer over the middle of a bank\u2019s band to show products; tap inside the band on touch.';
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
            var flowEdge = { color: color, width: 2, opacity: 1, cap: 'round', join: 'round' };
            // Lower edge: sets the base of the ribbon (transparent fill, min line at full opacity)
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
                z: 2,
            });
            // Upper delta: fills the ribbon between min and max rate (Sankey-like flow shading along time)
            out.push({
                id: 'ribbon_fill_' + index,
                name: series.bank_name + ' ribbon',
                type: 'line',
                yAxisIndex: 0,
                stack: stackKey,
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
                lineStyle: { color: color, width: 1.5, opacity: 0.35, cap: 'round', join: 'round' },
                areaStyle: ribbonSankeyFlowAreaFill(color),
                data: deltaData,
                z: 2,
            });
            // Max boundary: full-opacity bank colour (explicit top edge)
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
                z: 3,
            });
            // Mean line: solid, full bank colour
            out.push({
                id: 'ribbon_mean_' + index,
                name: series.bank_name + ' mean',
                type: 'line',
                yAxisIndex: 0,
                smooth: RIBBON_SANKEY_SMOOTH,
                symbol: 'none',
                connectNulls: true,
                lineStyle: { color: color, width: 1.25, opacity: 1, cap: 'round', join: 'round' },
                data: meanData,
                z: 4,
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

        container.innerHTML = '';
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';
        container.appendChild(wrapper);

        wrapper.appendChild(M.createReportViewModeBar({
            section: section,
            vm: options.vm,
            bankList: bankList,
            onReRender: options.onReRender,
        }));
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

        if (isBandsMode) {
            series = series.concat(buildBandSeries({
                dates: dates,
                plotPayload: plotPayload,
                bankColor: options.bankColor,
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
        var selectedProductName = '';

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

        function bankInInnerBandAtDate(bankName, yVal, dateStr) {
            var p = bandByDateByBank[bankName] && bandByDateByBank[bankName][dateStr];
            if (!p) return false;
            var lo = Number(p.min_rate);
            var hi = Number(p.max_rate);
            if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(yVal)) return false;
            var span = hi - lo;
            var margin = span > 1e-9 ? span * 0.15 : 0.02;
            var innerLo = lo + margin;
            var innerHi = hi - margin;
            if (innerLo >= innerHi) {
                innerLo = lo;
                innerHi = hi;
            }
            return yVal >= innerLo && yVal <= innerHi;
        }

        function pickBankFromInnerBand(dateStr, yVal) {
            if (!dateStr) return '';
            var candidates = [];
            Object.keys(knownBanks).forEach(function (bn) {
                if (bankInInnerBandAtDate(bn, yVal, dateStr)) {
                    var p = bandByDateByBank[bn][dateStr];
                    var w = Number(p.max_rate) - Number(p.min_rate);
                    candidates.push({ bn: bn, w: Number.isFinite(w) ? w : 0 });
                }
            });
            candidates.sort(function (a, b) { return a.w - b.w; });
            return candidates.length ? candidates[0].bn : '';
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
            var updates = [];
            productOverlay.forEach(function (s) {
                var rest = s.name.slice(3);
                var pipe = rest.indexOf('|');
                var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                var show = bn === hoveredBank;
                var isSelected = s.name === selectedProductName;
                var base = s._ribbonBaseHex || '#64748b';
                updates.push({
                    id: s.id,
                    lineStyle: {
                        color: hexToRgba(base, isSelected ? 0.85 : 0.5),
                        width: isSelected ? 2.5 : 1.2,
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
            if (!hoveredBank) return;
            var prods = ribbonCanvasModel.byBank[hoveredBank];
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
                ctx.strokeStyle = hexToRgba(prod.baseHex, isSel ? 0.85 : 0.5);
                ctx.lineWidth = isSel ? 2.5 : 1.2;
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
            if (!dateStr || !hoveredBank) return null;
            var prods = ribbonCanvasModel.byBank[hoveredBank];
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
                heading: pick.date,
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

        function bankColorIndexForName(bn) {
            var want = String(bn || '').trim();
            for (var i = 0; i < bankList.length; i++) {
                var entry = bankList[i];
                var full = typeof entry === 'string' ? entry : (entry && entry.full);
                if (String(full || '').trim() === want) return i;
            }
            return 0;
        }

        // Custom tooltip for bands mode
        var tooltipConfig;
        if (isBandsMode) {
            tooltipConfig = {
                trigger: 'axis',
                axisPointer: { type: 'line' },
                confine: true,
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var date = params[0].axisValue || '';
                    var parts = ['<b>' + date + '</b>'];
                    params.forEach(function (p) {
                        if ((p.seriesName === 'RBA' || p.seriesName === 'CPI') && p.value && p.value[1] != null) {
                            parts.push('<span style="color:' + p.color + ';">\u25A0</span> ' + p.seriesName + ': ' + Number(p.value[1]).toFixed(2) + '%');
                        }
                    });
                    if (plotPayload.series) {
                        plotPayload.series.forEach(function (bank, bi) {
                            var point = bandByDateByBank[bank.bank_name] && bandByDateByBank[bank.bank_name][date];
                            if (!point) return;
                            var c = options.bankColor(bank.bank_name, bi);
                            parts.push('<span style="color:' + c + ';">\u25A0</span> <b>' + bank.bank_name + '</b>: ' +
                                Number(point.min_rate).toFixed(2) + ' \u2013 ' + Number(point.max_rate).toFixed(2) + '% (avg ' + Number(point.mean_rate).toFixed(2) + '%)');
                            if (hoveredBank === bank.bank_name) {
                                if (useRibbonCanvas) {
                                    var plist = ribbonCanvasModel.byBank[hoveredBank] || [];
                                    plist.forEach(function (prod) {
                                        var v = prod.byDate[date];
                                        if (v == null) return;
                                        var sel = prod.key === selectedProductName;
                                        parts.push('&nbsp;&nbsp;\u00b7 ' + (sel ? '<b>' : '') + prod.productName + ': ' + Number(v).toFixed(2) + '%' + (sel ? '</b>' : ''));
                                    });
                                } else {
                                    params.forEach(function (p) {
                                        if (p.seriesName && p.seriesName.indexOf('[P]' + bank.bank_name + '|') === 0 && p.value && p.value[1] != null) {
                                            var prodName = p.seriesName.slice(3 + bank.bank_name.length + 1);
                                            var sel = p.seriesName === selectedProductName;
                                            parts.push('&nbsp;&nbsp;\u00b7 ' + (sel ? '<b>' : '') + prodName + ': ' + Number(p.value[1]).toFixed(2) + '%' + (sel ? '</b>' : ''));
                                        }
                                    });
                                }
                            }
                        });
                    }
                    return parts.join('<br>');
                },
            };
        } else {
            tooltipConfig = { trigger: 'axis', axisPointer: { type: 'line' } };
        }

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

        if (isBandsMode && useRibbonCanvas) {
            ribbonCanvas = document.createElement('canvas');
            ribbonCanvas.className = 'lwc-ribbon-products-canvas';
            ribbonCanvas.setAttribute('aria-hidden', 'true');
            ribbonCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;';
            mount.appendChild(ribbonCanvas);
            ribbonCanvasCtx = ribbonCanvas.getContext('2d');
            mount.setAttribute('title', ribbonTouchNote());
        }

        if (isBandsMode && (productOverlay.length || useRibbonCanvas)) {
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
                var yVal = data[1];
                var next = pickBankFromInnerBand(dateStr, yVal);
                if (next !== hoveredBank) {
                    hoveredBank = next;
                    updateProductVisibility();
                }
            }
            function onRibbonZrGlobalOut() {
                if (selectedProductName) return;
                hoveredBank = '';
                updateProductVisibility();
            }
            function onRibbonZrClick(ev) {
                if (!useRibbonCanvas) return;
                var xy = ribbonZrXY(ev);
                var data = chart.convertFromPixel({ gridIndex: 0 }, xy);
                var dateStr = data && data.length >= 2 ? resolveDateFromAxisValue(data[0]) : '';
                var yVal = data && data.length >= 2 ? data[1] : NaN;
                var tapBank = pickBankFromInnerBand(dateStr, yVal);
                if (tapBank) hoveredBank = tapBank;
                var pick = ribbonCanvasPickProduct(xy[0], xy[1]);
                if (pick) {
                    if (selectedProductName === pick.prod.key) {
                        selectedProductName = '';
                        hideRibbonInfoBox();
                    } else {
                        selectedProductName = pick.prod.key;
                        showRibbonInfoBox(pick);
                    }
                    scheduleRibbonRedraw();
                    return;
                }
                if (selectedProductName) {
                    selectedProductName = '';
                    hideRibbonInfoBox();
                    hoveredBank = tapBank || hoveredBank;
                    scheduleRibbonRedraw();
                }
            }
            zr.on('mousemove', onRibbonZrMouseMove);
            zr.on('globalout', onRibbonZrGlobalOut);
            zr.on('click', onRibbonZrClick);
            zrRibbonSubs.push({ type: 'mousemove', fn: onRibbonZrMouseMove });
            zrRibbonSubs.push({ type: 'globalout', fn: onRibbonZrGlobalOut });
            zrRibbonSubs.push({ type: 'click', fn: onRibbonZrClick });

            if (!useRibbonCanvas) {
                chart.on('click', function (params) {
                    var name = params.seriesName || '';
                    if (name.indexOf('[P]') === 0) {
                        var rest = name.slice(3);
                        var pipe = rest.indexOf('|');
                        var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                        var pn = pipe >= 0 ? rest.slice(pipe + 1) : '';
                        var rate = params.value && params.value[1] != null ? Number(params.value[1]) : null;
                        var dateStr = params.value && params.value[0] != null ? String(params.value[0]).slice(0, 10) : '';
                        if (selectedProductName === name) {
                            selectedProductName = '';
                            hideRibbonInfoBox();
                        } else {
                            selectedProductName = name;
                            hoveredBank = bn;
                            if (options.infoBox && typeof options.infoBox.show === 'function' && rate != null && Number.isFinite(rate)) {
                                var baseHex = options.bankColor(bn, bankColorIndexForName(bn));
                                options.infoBox.show({
                                    heading: dateStr,
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
                        updateProductVisibility();
                    } else {
                        var bank = resolveHoverBank(name);
                        if (selectedProductName) {
                            selectedProductName = '';
                            hideRibbonInfoBox();
                            hoveredBank = bank || '';
                            updateProductVisibility();
                        }
                    }
                });
            }

            chart.on('finished', function () {
                if (useRibbonCanvas) {
                    recomputeRibbonLod();
                    scheduleRibbonRedraw();
                }
            });
        }

        return {
            mount: mount,
            chart: {
                resize: function (width, height) {
                    chart.resize({ width: width, height: height });
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
