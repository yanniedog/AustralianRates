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
            var stackKey = 'band_' + series.bank_name;
            // Lower edge: sets the base of the ribbon (transparent fill, min line at full opacity)
            out.push({
                id: 'ribbon_min_' + index,
                name: series.bank_name,
                type: 'line',
                yAxisIndex: 0,
                stack: stackKey,
                symbol: 'none',
                connectNulls: true,
                lineStyle: { color: color, width: 1.5, opacity: 1 },
                areaStyle: { opacity: 0 },
                data: minData,
                z: 2,
            });
            // Upper delta: fills the ribbon between min and max rate (50% transparent bank colour)
            out.push({
                id: 'ribbon_fill_' + index,
                name: series.bank_name + ' ribbon',
                type: 'line',
                yAxisIndex: 0,
                stack: stackKey,
                symbol: 'none',
                connectNulls: true,
                lineStyle: { color: color, width: 1.5, opacity: 1 },
                areaStyle: { color: color, opacity: 0.5 },
                data: deltaData,
                z: 2,
            });
            // Mean line
            out.push({
                id: 'ribbon_mean_' + index,
                name: series.bank_name + ' mean',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                connectNulls: true,
                lineStyle: { color: color, width: 1.5, type: 'dashed', opacity: 0.85 },
                data: meanData,
                z: 3,
            });
        });
        return out;
    }

    /** Build hidden product overlay lines for ribbon hover reveal. */
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
            var color = bankColor(bn, bankIndexMap[bk]);
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
                symbol: 'none',
                connectNulls: true,
                lineStyle: { color: color, width: 1.2, opacity: 0 },
                silent: true,
                data: data,
                z: 4,
            });
        });
        return out;
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
        if (isBandsMode) {
            series = series.concat(buildBandSeries({
                dates: dates,
                plotPayload: plotPayload,
                bankColor: options.bankColor,
            }));
            productOverlay = buildProductOverlay(dates, options.allSeries || [], options.bankColor);
            series = series.concat(productOverlay);
        }

        // Pre-build lookup structures for ribbon tooltip and hover
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

        // Product series grouped by bank for quick hover updates
        var productByBank = {};
        productOverlay.forEach(function (s) {
            var rest = s.name.slice(3); // strip '[P]'
            var pipe = rest.indexOf('|');
            var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
            if (!productByBank[bn]) productByBank[bn] = [];
            productByBank[bn].push({ id: s.id, color: s.lineStyle.color });
        });

        var hoveredBank = '';
        var selectedProductName = '';

        function resolveHoverBank(seriesName) {
            if (!seriesName) return '';
            if (seriesName.endsWith(' ribbon')) return seriesName.slice(0, -7);
            if (seriesName.endsWith(' mean')) return seriesName.slice(0, -5);
            if (knownBanks[seriesName]) return seriesName;
            return '';
        }

        function updateProductVisibility() {
            if (!productOverlay.length) return;
            var updates = [];
            productOverlay.forEach(function (s) {
                var rest = s.name.slice(3);
                var pipe = rest.indexOf('|');
                var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                var show = bn === hoveredBank;
                var isSelected = s.name === selectedProductName;
                updates.push({
                    id: s.id,
                    lineStyle: {
                        color: s.lineStyle.color,
                        width: isSelected ? 2.5 : 1.2,
                        opacity: isSelected ? 0.85 : (show ? 0.5 : 0),
                    },
                    silent: !show,
                });
            });
            chart.setOption({ series: updates });
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
                                params.forEach(function (p) {
                                    if (p.seriesName && p.seriesName.indexOf('[P]' + bank.bank_name + '|') === 0 && p.value && p.value[1] != null) {
                                        var prodName = p.seriesName.slice(3 + bank.bank_name.length + 1);
                                        var sel = p.seriesName === selectedProductName;
                                        parts.push('&nbsp;&nbsp;\u00b7 ' + (sel ? '<b>' : '') + prodName + ': ' + Number(p.value[1]).toFixed(2) + '%' + (sel ? '</b>' : ''));
                                    }
                                });
                            }
                        });
                    }
                    return parts.join('<br>');
                },
            };
        } else {
            tooltipConfig = { trigger: 'axis', axisPointer: { type: 'line' } };
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

        // Wire up ribbon hover/click interactivity
        if (isBandsMode && productOverlay.length) {
            chart.on('mouseover', function (params) {
                var bank = resolveHoverBank(params.seriesName);
                if (!bank || bank === hoveredBank) return;
                hoveredBank = bank;
                updateProductVisibility();
            });
            chart.on('globalout', function () {
                if (selectedProductName) return;
                hoveredBank = '';
                updateProductVisibility();
            });
            chart.on('click', function (params) {
                var name = params.seriesName || '';
                if (name.indexOf('[P]') === 0) {
                    if (selectedProductName === name) {
                        selectedProductName = '';
                    } else {
                        selectedProductName = name;
                    }
                    var rest = name.slice(3);
                    var pipe = rest.indexOf('|');
                    hoveredBank = pipe >= 0 ? rest.slice(0, pipe) : rest;
                    updateProductVisibility();
                } else {
                    var bank = resolveHoverBank(name);
                    if (selectedProductName) {
                        selectedProductName = '';
                        hoveredBank = bank || '';
                        updateProductVisibility();
                    }
                }
            });
        }

        return {
            mount: mount,
            chart: {
                resize: function (width, height) {
                    chart.resize({ width: width, height: height });
                },
            },
            kind: options.reportViewKind || 'report-plot',
            dispose: function () {
                chart.dispose();
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
