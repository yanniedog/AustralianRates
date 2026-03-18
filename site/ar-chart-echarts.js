(function () {
    'use strict';
    window.AR = window.AR || {};
    var chartConfig = window.AR.chartConfig || {}, helpers = window.AR.chartEchartsHelpers || {};
    var paletteColor = helpers.paletteColor, tooltipMetric = helpers.tooltipMetric, baseTextStyles = helpers.baseTextStyles, gridStyles = helpers.gridStyles;
    var tooltipStyles = helpers.tooltipStyles, chartSize = helpers.chartSize, trimAxisLabel = helpers.trimAxisLabel;
    var formatDateAxisLabel = helpers.formatDateAxisLabel, formatSurfaceAxisLabel = helpers.formatSurfaceAxisLabel;
    var metricAxisLabel = helpers.metricAxisLabel, maxMetric = helpers.maxMetric, categoryInterval = helpers.categoryInterval;
    var axisPointerConfig = helpers.axisPointerConfig, chartTheme = helpers.chartTheme;
    var themeFallback = function () {
        return (helpers.chartTheme && helpers.chartTheme()) || {
            emphasisText: '#0f172a',
            mutedText: '#475569',
            shadowAccent: 'rgba(37, 99, 235, 0.18)',
            softText: '#334155',
            splitLine: 'rgba(148, 163, 184, 0.12)',
            surfaceScale: ['#eef6ff', '#bfdbfe'],
            text: '#15273c',
            axisLine: 'rgba(148, 163, 184, 0.55)',
            crosshairLine: 'rgba(37, 99, 235, 0.45)',
            crosshairLabelBg: 'rgba(255,255,255,0.96)',
            focusBlurOpacity: 0.22,
        };
    };
    function ensureChart(element, instance) {
        if (!element || !window.echarts) return null;
        if (instance && !instance.isDisposed()) return instance;
        return window.echarts.init(element, null, { renderer: 'canvas' });
    }

    function buildSurfaceOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var narrow = size && size.width < 760;
        var veryNarrow = size && size.width < 420;
        var denseSurface = model.surface.yLabels.length > (narrow ? 12 : 16);
        var xLabelInterval = categoryInterval(model.surface.xLabels.length, veryNarrow ? 6 : (narrow ? 10 : 14));
        var yLabelInterval = categoryInterval(model.surface.yLabels.length, veryNarrow ? 8 : (narrow ? 10 : 12));
        var showVisualMap = !narrow && !denseSurface;
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) {
                    var row = params.data && params.data.row ? params.data.row : null;
                    return [
                        '<strong>' + (row && row.product_name ? row.product_name : params.name || 'Series') + '</strong>',
                        row && row.bank_name ? row.bank_name : '',
                        'Date: ' + (row ? chartConfig.formatFieldValue('collection_date', row.collection_date, row) : params.value[0]),
                        chartConfig.fieldLabel(fields.yField) + ': ' + tooltipMetric(fields.yField, row, params.value[2]),
                    ].filter(Boolean).join('<br>');
                },
            },
            axisPointer: axisPointerConfig(theme),
            grid: {
                left: veryNarrow ? 84 : (narrow ? 112 : (denseSurface ? 156 : 142)),
                right: showVisualMap ? 42 : 18,
                top: 20,
                bottom: narrow ? 42 : 28,
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: model.surface.xLabels,
                boundaryGap: false,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.mutedText,
                    hideOverlap: true,
                    margin: 12,
                    interval: xLabelInterval,
                    rotate: !veryNarrow && model.surface.xLabels.length > 10 ? (narrow ? 28 : 18) : 0,
                    formatter: function (value) { return formatDateAxisLabel(value, true); },
                },
                splitArea: { show: false },
            },
            yAxis: {
                type: 'category',
                data: model.surface.yLabels,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.emphasisText,
                    width: veryNarrow ? 64 : (narrow ? 104 : (denseSurface ? 220 : 250)),
                    overflow: 'truncate',
                    interval: yLabelInterval,
                    hideOverlap: true,
                    formatter: function (value) {
                        return formatSurfaceAxisLabel(value, {
                            dense: denseSurface,
                            narrow: narrow,
                            veryNarrow: veryNarrow,
                        });
                    },
                },
            },
            visualMap: {
                show: showVisualMap,
                min: model.surface.min == null ? 0 : model.surface.min,
                max: model.surface.max == null ? 1 : model.surface.max,
                calculable: false,
                orient: 'vertical',
                top: 28,
                right: 10,
                text: ['High', 'Low'],
                textStyle: { color: theme.mutedText, fontSize: 12 },
                itemWidth: 10,
                itemHeight: denseSurface ? 118 : 144,
                inRange: {
                    color: [theme.surfaceScale[0], theme.surfaceScale[1], paletteColor(1), paletteColor(0)],
                },
            },
            series: [{
                name: chartConfig.fieldLabel(fields.yField),
                type: 'heatmap',
                data: model.surface.cells,
                progressive: 0,
                label: { show: false },
                emphasis: {
                    itemStyle: {
                        borderColor: theme.emphasisText,
                        borderWidth: 2,
                        shadowBlur: 20,
                        shadowColor: theme.shadowAccent,
                    },
                },
                itemStyle: {
                    borderWidth: 1,
                    borderColor: theme.axisLine,
                    borderRadius: narrow ? 6 : 10,
                },
            }],
        };
    }
    function buildLenderOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var entries = model.lenderRanking && model.lenderRanking.entries ? model.lenderRanking.entries : [];
        var maxValue = maxMetric(entries);
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            tooltip: {
                trigger: 'item',
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) {
                    var data = params.data || {};
                    var row = data.row || {};
                    var lines = [
                        '<strong>' + chartConfig.formatFieldValue('bank_name', data.bankName || row.bank_name || 'Lender', row) + '</strong>',
                        data.productName || row.product_name || '',
                        'Date: ' + chartConfig.formatFieldValue('collection_date', data.date || row.collection_date, row),
                        chartConfig.fieldLabel(fields.yField) + ': ' + tooltipMetric(fields.yField, row, data.value),
                    ];
                    if (data.delta != null && Number.isFinite(data.delta)) {
                        var deltaStr = (data.delta >= 0 ? '+' : '') + chartConfig.formatMetricValue(fields.yField, data.delta);
                        lines.push('Change: ' + deltaStr);
                    }
                    return lines.filter(Boolean).join('<br>');
                },
            },
            grid: {
                left: compact ? 14 : 18,
                right: compact ? 66 : (narrow ? 76 : 28),
                top: 22,
                bottom: narrow ? 38 : 20,
                containLabel: true,
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: maxValue == null ? null : maxValue * (narrow ? 1.18 : 1.08),
                splitNumber: narrow ? 4 : 6,
                name: compact ? '' : chartConfig.fieldLabel(fields.yField),
                nameGap: compact ? 10 : (narrow ? 18 : 26),
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.softText,
                    hideOverlap: true,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
                splitLine: styles.splitLine,
            },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.emphasisText,
                    width: compact ? 104 : (narrow ? 128 : 180),
                    overflow: 'truncate',
                },
                data: entries.map(function (entry) {
                    var label = chartConfig.formatFieldValue('bank_name', entry.bankName, entry.row || null);
                    return trimAxisLabel(label, compact ? 14 : (narrow ? 18 : 28));
                }),
            },
            series: [{
                name: 'Best product by bank',
                type: 'bar',
                barWidth: compact ? 14 : (narrow ? 16 : 18),
                clip: false,
                data: entries.map(function (entry, index) {
                    return {
                        value: entry.value,
                        seriesKey: entry.seriesKey,
                        bankName: entry.bankName,
                        productName: entry.productName,
                        date: entry.latestDate,
                        delta: entry.delta,
                        row: entry.row,
                        itemStyle: {
                            color: paletteColor(index),
                            borderRadius: [999, 999, 999, 999],
                        },
                    };
                }),
                label: {
                    show: true,
                    position: 'right',
                    distance: compact ? 6 : (narrow ? 8 : 10),
                    color: theme.emphasisText,
                    fontSize: compact ? 11 : 12,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (params) {
                        var main = metricAxisLabel(fields.yField, params.value, narrow);
                        var d = params.data && params.data.delta;
                        if (d != null && Number.isFinite(d)) {
                            var arrow = d >= 0 ? '\u2191' : '\u2193';
                            var deltaStr = chartConfig.formatMetricValue(fields.yField, Math.abs(d));
                            return main + '  ' + arrow + deltaStr;
                        }
                        return main;
                    },
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 22,
                        shadowColor: theme.shadowAccent,
                    },
                },
            }],
        };
    }
    /** Slope graph: two dates, one line per product. Award-winning "who moved" encoding. */
    function buildSlopeOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var slope = model.slope;
        if (!slope || !slope.lines || !slope.lines.length) {
            return {
                textStyle: base.textStyle,
                backgroundColor: 'transparent',
                title: {
                    text: 'Not enough date range for slope graph',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: theme.mutedText, fontSize: 14, fontWeight: 500 },
                },
            };
        }
        var xCategories = [slope.dateLeftLabel || slope.dateLeft, slope.dateRightLabel || slope.dateRight];
        var series = slope.lines.slice(0, narrow ? 12 : 20).map(function (line, index) {
            return {
                name: trimAxisLabel(line.name, compact ? 16 : 28),
                type: 'line',
                showSymbol: true,
                symbolSize: narrow ? 6 : 8,
                lineStyle: { width: 2, color: paletteColor(index) },
                itemStyle: { color: paletteColor(index) },
                data: [
                    { value: [0, line.valueLeft], row: line.rowLeft },
                    { value: [1, line.valueRight], row: line.rowRight },
                ],
                emphasis: { focus: 'series', lineStyle: { width: 2.5 } },
            };
        });
        var pad = (slope.max - slope.min) * 0.06 || 0.1;
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            title: {
                text: 'Who moved? Rate change between two dates',
                subtext: slope.dateLeftLabel + ' \u2192 ' + slope.dateRightLabel,
                left: 0,
                top: 2,
                textStyle: { color: theme.emphasisText, fontSize: narrow ? 13 : 14, fontWeight: 700 },
                subtextStyle: { color: theme.mutedText, fontSize: 11 },
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) {
                    var list = Array.isArray(params) ? params.filter(Boolean) : [];
                    if (!list.length) return '';
                    var idx = list[0].dataIndex;
                    var dateStr = idx === 0 ? slope.dateLeftLabel : slope.dateRightLabel;
                    var lines = ['<strong>' + dateStr + '</strong>'];
                    list.forEach(function (entry) {
                        var raw = Array.isArray(entry.value) ? entry.value[1] : entry.value;
                        var deltaStr = '';
                        var lineEntry = slope.lines[entry.seriesIndex];
                        if (lineEntry && lineEntry.delta != null && Number.isFinite(lineEntry.delta)) {
                            deltaStr = ' (\u0394 ' + (lineEntry.delta >= 0 ? '+' : '') + chartConfig.formatMetricValue(fields.yField, lineEntry.delta) + ')';
                        }
                        lines.push(entry.marker + ' ' + entry.seriesName + ': ' + chartConfig.formatMetricValue(fields.yField, raw) + deltaStr);
                    });
                    return lines.join('<br>');
                },
            },
            legend: {
                type: 'scroll',
                top: 36,
                left: 0,
                right: 0,
                textStyle: { color: theme.softText },
                formatter: function (name) { return trimAxisLabel(name, compact ? 14 : 22); },
            },
            grid: {
                left: compact ? 48 : 58,
                right: 18,
                top: 72,
                bottom: narrow ? 52 : 48,
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: xCategories,
                boundaryGap: false,
                axisLine: styles.axisLine,
                axisTick: { show: false },
                axisLabel: { color: theme.mutedText },
            },
            yAxis: {
                type: 'value',
                name: compact ? '' : (slope.metricLabel || chartConfig.fieldLabel(fields.yField)),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                min: slope.min - pad,
                max: slope.max + pad,
                axisLine: styles.axisLine,
                splitLine: styles.splitLine,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
            },
            series: series,
        };
    }

    /** Rate ladder: rank + value. Award-winning "who is first and by how much". */
    function buildLadderOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var entries = model.lenderRanking && model.lenderRanking.entries ? model.lenderRanking.entries : [];
        var maxValue = maxMetric(entries);
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            title: {
                text: 'Rate ladder: rank and value',
                subtext: 'Best rate per lender, ranked. Lower is better for loans; higher for savings and term deposits.',
                left: 0,
                top: 2,
                textStyle: { color: theme.emphasisText, fontSize: narrow ? 13 : 14, fontWeight: 700 },
                subtextStyle: { color: theme.mutedText, fontSize: 11 },
            },
            tooltip: {
                trigger: 'item',
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) {
                    var data = params.data || {};
                    var row = data.row || {};
                    var rank = data.rank != null ? 'Rank #' + data.rank + '<br>' : '';
                    return rank + '<strong>' + chartConfig.formatFieldValue('bank_name', data.bankName || row.bank_name || 'Lender', row) + '</strong><br>' +
                        (data.productName || row.product_name || '') + '<br>' +
                        chartConfig.fieldLabel(fields.yField) + ': ' + tooltipMetric(fields.yField, row, data.value);
                },
            },
            grid: {
                left: compact ? 32 : 42,
                right: compact ? 66 : (narrow ? 76 : 28),
                top: 52,
                bottom: narrow ? 38 : 20,
                containLabel: true,
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: maxValue == null ? null : maxValue * (narrow ? 1.18 : 1.08),
                splitNumber: narrow ? 4 : 6,
                name: compact ? '' : chartConfig.fieldLabel(fields.yField),
                nameGap: compact ? 10 : (narrow ? 18 : 26),
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
                splitLine: styles.splitLine,
            },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.emphasisText,
                    width: compact ? 104 : (narrow ? 128 : 180),
                    overflow: 'truncate',
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value, index) {
                        var entry = entries[index];
                        var rank = entry && entry.rank != null ? entry.rank + '. ' : '';
                        return rank + value;
                    },
                },
                data: entries.map(function (entry) {
                    var label = chartConfig.formatFieldValue('bank_name', entry.bankName, entry.row || null);
                    return trimAxisLabel(label, compact ? 14 : (narrow ? 18 : 28));
                }),
            },
            series: [{
                name: 'Rate',
                type: 'bar',
                barWidth: compact ? 14 : (narrow ? 16 : 18),
                clip: false,
                data: entries.map(function (entry, index) {
                    return {
                        value: entry.value,
                        seriesKey: entry.seriesKey,
                        bankName: entry.bankName,
                        productName: entry.productName,
                        rank: entry.rank,
                        row: entry.row,
                        itemStyle: {
                            color: paletteColor(index),
                            borderRadius: [999, 999, 999, 999],
                        },
                    };
                }),
                label: {
                    show: true,
                    position: 'right',
                    distance: compact ? 6 : (narrow ? 8 : 10),
                    color: theme.emphasisText,
                    fontSize: compact ? 11 : 12,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (params) { return metricAxisLabel(fields.yField, params.value, narrow); },
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 22,
                        shadowColor: theme.shadowAccent,
                    },
                },
            }],
        };
    }

    function buildCompareOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var showLegend = !narrow && model.compareSeries.length <= 3;
        var showEndLabels = !narrow && model.compareSeries.length <= 2;
        var focusBlur = theme.focusBlurOpacity != null ? theme.focusBlurOpacity : 0.22;
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
            },
            grid: {
                left: narrow ? 52 : 62,
                right: showEndLabels ? 120 : 18,
                top: showLegend ? 42 : 22,
                bottom: narrow ? 48 : 54,
                containLabel: true,
            },
            legend: {
                show: showLegend,
                top: 0,
                type: 'scroll',
                left: 0,
                right: 0,
                textStyle: { color: theme.softText },
                itemWidth: 12,
                itemHeight: 12,
                formatter: function (name) { return trimAxisLabel(name, 36); },
            },
            xAxis: {
                type: 'category',
                data: model.surface.xLabels,
                boundaryGap: false,
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.mutedText,
                    hideOverlap: true,
                    margin: 12,
                    interval: categoryInterval(model.surface.xLabels.length, narrow ? 8 : 12),
                    formatter: function (value) { return formatDateAxisLabel(value, narrow); },
                },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                name: compact ? '' : chartConfig.fieldLabel(fields.yField),
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: styles.axisLine,
                splitNumber: narrow ? 4 : 6,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value) {
                        return metricAxisLabel(fields.yField, value, narrow);
                    },
                },
                splitLine: styles.splitLine,
            },
            series: model.compareSeries.map(function (series, index) {
                var byDate = {};
                series.points.forEach(function (point) {
                    byDate[point.date] = point;
                });
                return {
                    id: series.key,
                    name: series.name,
                    type: 'line',
                    smooth: false,
                    showSymbol: false,
                    symbolSize: 6,
                    connectNulls: false,
                    endLabel: {
                        show: showEndLabels,
                        color: theme.emphasisText,
                        distance: 10,
                        formatter: function () {
                            return trimAxisLabel(series.name, 24) + ' ' + metricAxisLabel(fields.yField, series.latestValue, true);
                        },
                    },
                    labelLayout: { hideOverlap: true },
                    emphasis: { focus: 'series', blurScope: 'coordinateSystem', lineStyle: { width: narrow ? 3 : 3.5 } },
                    animationDurationUpdate: 320,
                    lineStyle: { width: narrow ? 2.5 : 3, color: paletteColor(index) },
                    itemStyle: { color: paletteColor(index) },
                    data: model.surface.xLabels.map(function (date) {
                        var point = byDate[date];
                        return point
                            ? { value: [date, point.value], row: point.row, seriesKey: series.key }
                            : [date, null];
                    }),
                };
            }),
        };
    }
    function buildDistributionOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            tooltip: {
                trigger: 'item',
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
            },
            grid: {
                left: narrow ? 54 : 62,
                right: 20,
                top: 28,
                bottom: narrow ? 82 : 60,
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: model.distribution.categories,
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.mutedText,
                    interval: 0,
                    hideOverlap: true,
                    rotate: model.distribution.categories.length > 6 ? (narrow ? 40 : 24) : 0,
                    formatter: function (value) { return trimAxisLabel(value, narrow ? 12 : 20); },
                },
            },
            yAxis: {
                type: 'value',
                name: compact ? '' : chartConfig.fieldLabel(fields.yField),
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: styles.axisLine,
                splitNumber: narrow ? 4 : 6,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value) {
                        return metricAxisLabel(fields.yField, value, narrow);
                    },
                },
                splitLine: styles.splitLine,
            },
            series: [
                {
                    name: 'Distribution',
                    type: 'boxplot',
                    itemStyle: {
                        color: theme.shadowAccent,
                        borderColor: paletteColor(0),
                        borderWidth: 2,
                    },
                    emphasis: {
                        itemStyle: {
                            borderWidth: 2.5,
                            shadowBlur: 12,
                            shadowColor: theme.shadowAccent,
                        },
                    },
                    data: model.distribution.boxes,
                },
                {
                    name: 'Mean',
                    type: 'scatter',
                    symbolSize: 10,
                    itemStyle: { color: paletteColor(1) },
                    emphasis: { scale: 1.4 },
                    data: model.distribution.means.map(function (value, index) {
                        return [model.distribution.categories[index], value];
                    }),
                },
            ],
        };
    }
    function buildDetailOption(model, fields, size) {
        var base = baseTextStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var spotlight = model.spotlight;
        var narrow = size && size.width < 340;
        var compact = size && size.width < 420;
        var xLabelInterval = spotlight && spotlight.series
            ? categoryInterval(spotlight.series.points.length, narrow ? 4 : (compact ? 5 : 7))
            : 0;
        if (!spotlight || !spotlight.series) return {
            textStyle: base.textStyle,
            backgroundColor: 'transparent',
            title: {
                text: 'Select a rate cell to inspect a single product trend',
                left: 'center',
                top: 'middle',
                textStyle: { color: theme.mutedText, fontSize: 14, fontWeight: 500 },
            },
        };
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
            },
            grid: {
                left: narrow ? 44 : 48,
                right: 14,
                top: 24,
                bottom: compact ? 34 : 30,
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: spotlight.series.points.map(function (point) { return point.date; }),
                axisLine: { lineStyle: { color: theme.axisLine } },
                axisLabel: {
                    color: theme.mutedText,
                    hideOverlap: true,
                    interval: xLabelInterval,
                    formatter: function (value) { return formatDateAxisLabel(value, true); },
                },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLine: { lineStyle: { color: theme.axisLine } },
                splitNumber: narrow ? 3 : (compact ? 4 : 6),
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
                splitLine: { lineStyle: { color: theme.splitLine } },
            },
            series: [{
                type: 'line',
                smooth: false,
                showSymbol: true,
                symbolSize: 7,
                lineStyle: { width: 3, color: paletteColor(1) },
                itemStyle: { color: paletteColor(1) },
                areaStyle: { color: theme.shadowAccent },
                data: spotlight.series.points.map(function (point) {
                    return [point.date, point.value];
                }),
            }],
        };
    }

    function optionForView(view, model, fields, size, chartState) {
        var marketModule = window.AR.chartMarket || {};
        if (view === 'market' && typeof marketModule.buildMainOption === 'function') {
            var marketModel = model;
            if (model.tdCurveFrames && model.tdCurveFrames.length) {
                var frames = model.tdCurveFrames;
                var idx = (chartState && chartState.tdCurveFrameIndex != null)
                    ? Math.max(0, Math.min(chartState.tdCurveFrameIndex, frames.length - 1))
                    : frames.length - 1;
                marketModel = { market: frames[idx] };
                for (var k in model) { if (Object.prototype.hasOwnProperty.call(model, k)) marketModel[k] = model[k]; }
                marketModel.market = frames[idx];
            }
            return marketModule.buildMainOption(marketModel, fields, size);
        }
        if (view === 'timeRibbon' && model.timeRibbon && typeof marketModule.buildTimeRibbonOption === 'function') {
            return marketModule.buildTimeRibbonOption(model.timeRibbon, fields, size);
        }
        if (view === 'tdTermTime' && model.tdTermTime && typeof marketModule.buildTdTermTimeOption === 'function') {
            return marketModule.buildTdTermTimeOption(model.tdTermTime, fields, size);
        }
        if (view === 'slope') return buildSlopeOption(model, fields, size);
        if (view === 'ladder') return buildLadderOption(model, fields, size);
        if (view === 'lenders') return buildLenderOption(model, fields, size);
        if (view === 'compare') return buildCompareOption(model, fields, size);
        if (view === 'distribution') return buildDistributionOption(model, fields, size);
        return buildSurfaceOption(model, fields, size);
    }

    function renderMainChart(instance, element, view, model, fields, handlers, rbaHistory) {
        if (!instance || !element) return;
        var size = chartSize(element);
        var option = optionForView(view, model, fields, size);
        var timeAxisViews = view === 'timeRibbon' || view === 'tdTermTime' || view === 'compare' || view === 'surface';
        if (timeAxisViews && option && Array.isArray(rbaHistory) && rbaHistory.length && helpers.addRbaMarkLine) {
            helpers.addRbaMarkLine(option, rbaHistory);
        }
        instance.setOption(option, true);
        element.setAttribute('data-chart-engine', 'echarts');
        element.setAttribute('data-chart-render-view', view);
        element.setAttribute('data-chart-rendered', 'true');

        instance.off('click');
        if (!handlers || typeof handlers.onMainClick !== 'function') return;
        instance.on('click', function (params) {
            handlers.onMainClick(params);
        });
    }

    function renderDetailChart(instance, element, model, fields, chartState) {
        if (!instance) return;
        var marketModule = window.AR.chartMarket || {};
        if (fields && fields.view === 'market' && typeof marketModule.buildDetailOption === 'function') {
            var detailModel = model;
            if (model.tdCurveFrames && model.tdCurveFrames.length && chartState && chartState.tdCurveFrameIndex != null) {
                var idx = Math.max(0, Math.min(chartState.tdCurveFrameIndex, model.tdCurveFrames.length - 1));
                detailModel = { market: model.tdCurveFrames[idx] };
                for (var k in model) { if (Object.prototype.hasOwnProperty.call(model, k)) detailModel[k] = model[k]; }
                detailModel.market = model.tdCurveFrames[idx];
            }
            instance.setOption(marketModule.buildDetailOption(detailModel, fields, chartSize(element)), true);
            return;
        }
        instance.setOption(buildDetailOption(model, fields, chartSize(element)), true);
    }

    window.AR.chartEcharts = {
        baseTextStyles: baseTextStyles,
        ensureChart: ensureChart,
        renderDetailChart: renderDetailChart,
        renderMainChart: renderMainChart,
    };
})();
