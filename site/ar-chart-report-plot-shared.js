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
        var flatData = [];
        dates.forEach(function (date, index) {
            var point = byDate[date] || {};
            var upCount = Number(point.up_count || 0);
            var flatCount = Number(point.flat_count || 0);
            var downCount = Number(point.down_count || 0);
            upData.push({ value: [index, upCount], raw: { date: date, up: upCount, flat: flatCount, down: downCount } });
            downData.push({ value: [index, -downCount], raw: { date: date, up: upCount, flat: flatCount, down: downCount } });
            flatData.push({ value: [index, flatCount], raw: { date: date, up: upCount, flat: flatCount, down: downCount } });
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
            {
                name: 'Flat',
                type: 'custom',
                yAxisIndex: 1,
                data: flatData,
                renderItem: function (params, api) {
                    var x = api.value(0);
                    var flatCount = Number(api.value(1) || 0);
                    if (!Number.isFinite(flatCount) || flatCount <= 0) return null;
                    var center = api.coord([x, 0]);
                    var top = api.coord([x, 0.35]);
                    var halfWidth = 4;
                    var width = Math.max(8, halfWidth * 2);
                    var height = Math.max(4, Math.abs(center[1] - top[1]) * 2);
                    return {
                        type: 'rect',
                        shape: {
                            x: center[0] - width / 2,
                            y: center[1] - height / 2,
                            width: width,
                            height: height,
                        },
                        style: {
                            fill: 'rgba(148,163,184,0.55)',
                            stroke: 'rgba(148,163,184,0.9)',
                            lineWidth: 1,
                        },
                    };
                },
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
            var bandData = (series.points || []).map(function (point) {
                return {
                    value: [
                        dates.indexOf(String(point.date || '').slice(0, 10)),
                        Number(point.min_delta_bps || 0),
                        Number(point.max_delta_bps || 0),
                    ],
                };
            }).filter(function (item) {
                return item.value[0] >= 0;
            });
            var midData = dates.map(function (date) {
                var match = (series.points || []).find(function (point) {
                    return String(point.date || '').slice(0, 10) === date;
                });
                return match == null
                    ? [date, null]
                    : [date, Number(match.mid_delta_bps || 0)];
            });
            out.push({
                name: series.bank_name,
                type: 'custom',
                yAxisIndex: 1,
                data: bandData,
                renderItem: function (params, api) {
                    var x = api.value(0);
                    var minVal = Number(api.value(1) || 0);
                    var maxVal = Number(api.value(2) || 0);
                    var p1 = api.coord([x, minVal]);
                    var p2 = api.coord([x, maxVal]);
                    var width = 6;
                    var top = Math.min(p1[1], p2[1]);
                    var height = Math.max(3, Math.abs(p1[1] - p2[1]));
                    return {
                        type: 'rect',
                        shape: {
                            x: p1[0] - width / 2,
                            y: top,
                            width: width,
                            height: height,
                        },
                        style: {
                            fill: color,
                            opacity: 0.28,
                            stroke: color,
                            lineWidth: 1,
                        },
                    };
                },
            });
            out.push({
                name: series.bank_name + ' midpoint',
                type: 'line',
                yAxisIndex: 1,
                symbol: 'none',
                lineStyle: { color: color, width: 1.4, opacity: 0.95 },
                data: midData,
            });
        });
        return out;
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
        if (plotPayload && plotPayload.mode === 'bands') series = series.concat(buildBandSeries({
            dates: dates,
            plotPayload: plotPayload,
            bankColor: options.bankColor,
        }));

        chart.setOption({
            animation: false,
            grid: { top: 18, right: 18, bottom: 56, left: 48, containLabel: true },
            tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
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
                    name: plotPayload && plotPayload.mode === 'moves' ? 'Count' : 'bps',
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

        return {
            mount: wrapper,
            chart: {
                resize: function (width, height) {
                    chart.resize({ width: width, height: height });
                },
            },
            kind: 'report-plot',
            dispose: function () {
                chart.dispose();
            },
        };
    }

    window.AR.chartReportPlot = {
        payloadDateRange: payloadDateRange,
        render: render,
    };
})();
