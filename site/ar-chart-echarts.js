(function () {
    'use strict';
    window.AR = window.AR || {};
    var chartConfig = window.AR.chartConfig || {}, helpers = window.AR.chartEchartsHelpers || {};
    var paletteColor = helpers.paletteColor, tooltipMetric = helpers.tooltipMetric, baseTextStyles = helpers.baseTextStyles, gridStyles = helpers.gridStyles;
    var tooltipStyles = helpers.tooltipStyles, chartSize = helpers.chartSize;
    function defaultChartSize(el) {
        var w = (el && el.clientWidth) || 320;
        var h = (el && el.clientHeight) || 180;
        return { width: Math.max(0, w), height: Math.max(0, h) };
    }
    var chartSizeWithFallback = (helpers.chartSizeWithFallback && typeof helpers.chartSizeWithFallback === 'function')
        ? helpers.chartSizeWithFallback
        : (typeof chartSize === 'function' ? chartSize : defaultChartSize);
    var formatDateAxisLabel = helpers.formatDateAxisLabel, formatSurfaceAxisLabel = helpers.formatSurfaceAxisLabel;
    var metricAxisLabel = helpers.metricAxisLabel, maxMetric = helpers.maxMetric, minMetric = helpers.minMetric, categoryInterval = helpers.categoryInterval;
    var trimAxisLabel = typeof helpers.trimAxisLabel === 'function'
        ? helpers.trimAxisLabel
        : function (value, maxLength) {
            var s = String(value == null ? '' : value);
            var n = Number(maxLength);
            if (!Number.isFinite(n) || n <= 0 || s.length <= n) return s;
            return s.slice(0, Math.max(0, n - 1)).trim() + '\u2026';
        };
    var axisPointerConfig = helpers.axisPointerConfig, axisLabelFontSize = helpers.axisLabelFontSize, chartTheme = helpers.chartTheme;
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
        var tStyles = tooltipStyles();
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                    fontSize: typeof axisLabelFontSize === 'function' ? axisLabelFontSize(narrow, veryNarrow) : 12,
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
                    fontSize: typeof axisLabelFontSize === 'function' ? axisLabelFontSize(narrow, veryNarrow) : 12,
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
        var tStyles = tooltipStyles();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var entries = model.lenderRanking && model.lenderRanking.entries ? model.lenderRanking.entries : [];
        var minValue = minMetric(entries);
        var maxValue = maxMetric(entries);
        var valueRange = valueRangeWithPadding(minValue, maxValue, fields.yField);
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            tooltip: {
                trigger: 'item',
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                scale: true,
                min: valueRange.min,
                max: valueRange.max,
                splitNumber: narrow ? 4 : 6,
                name: compact ? '' : chartConfig.fieldLabel(fields.yField),
                nameGap: compact ? 10 : (narrow ? 18 : 26),
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.softText,
                    fontSize: typeof axisLabelFontSize === 'function' ? axisLabelFontSize(narrow, compact) : 12,
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
                    fontSize: typeof axisLabelFontSize === 'function' ? axisLabelFontSize(narrow, compact) : 12,
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
        var tStyles = tooltipStyles();
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                alwaysShowContent: true,
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                scale: true,
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
        var tStyles = tooltipStyles();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var entries = model.lenderRanking && model.lenderRanking.entries ? model.lenderRanking.entries : [];
        var minValue = minMetric(entries);
        var maxValue = maxMetric(entries);
        var valueRange = valueRangeWithPadding(minValue, maxValue, fields.yField);
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                scale: true,
                min: valueRange.min,
                max: valueRange.max,
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

    /** Y-axis range that fits data with padding; for percent fields min is floored at 0. */
    function valueRangeWithPadding(lo, hi, yField) {
        if (lo == null || !Number.isFinite(lo)) lo = 0;
        if (hi == null || !Number.isFinite(hi)) hi = lo + 1;
        if (lo === hi) hi = lo + 1;
        var pad = (hi - lo) * 0.06 || 0.25;
        var minVal = lo - pad;
        if (typeof chartConfig.isPercentField === 'function' && chartConfig.isPercentField(yField)) minVal = Math.max(0, minVal);
        return { min: minVal, max: hi + pad };
    }

    function compareYRange(compareSeries, yField) {
        var lo = Infinity;
        var hi = -Infinity;
        (compareSeries || []).forEach(function (series) {
            (series.points || []).forEach(function (point) {
                if (point && Number.isFinite(point.value)) {
                    if (point.value < lo) lo = point.value;
                    if (point.value > hi) hi = point.value;
                }
            });
        });
        return valueRangeWithPadding(lo === Infinity ? null : lo, hi === -Infinity ? null : hi, yField);
    }

    function distributionYRange(distribution, yField) {
        var lo = Infinity;
        var hi = -Infinity;
        (distribution.boxes || []).forEach(function (box) {
            if (Array.isArray(box) && box.length >= 5) {
                if (Number.isFinite(box[0]) && box[0] < lo) lo = box[0];
                if (Number.isFinite(box[4]) && box[4] > hi) hi = box[4];
            }
        });
        (distribution.means || []).forEach(function (v) {
            if (Number.isFinite(v)) {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        });
        return valueRangeWithPadding(lo === Infinity ? null : lo, hi === -Infinity ? null : hi, yField);
    }

    /** Keep boxplot + scatter aligned; drop rows with non-finite box stats (avoids ECharts setOption errors). */
    function sanitizeDistributionForChart(dist) {
        if (!dist || !Array.isArray(dist.categories)) {
            return { categories: [], boxes: [], means: [], counts: [] };
        }
        var categories = [];
        var boxes = [];
        var means = [];
        var counts = [];
        for (var i = 0; i < dist.categories.length; i++) {
            var box = dist.boxes && dist.boxes[i];
            if (!Array.isArray(box) || box.length < 5) continue;
            var j;
            var ok = true;
            for (j = 0; j < 5; j++) {
                if (!Number.isFinite(box[j])) {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
            var meanVal = dist.means && dist.means[i];
            if (!Number.isFinite(meanVal)) meanVal = box[2];
            if (!Number.isFinite(meanVal)) continue;
            categories.push(dist.categories[i]);
            boxes.push([box[0], box[1], box[2], box[3], box[4]]);
            means.push(meanVal);
            counts.push(dist.counts && dist.counts[i] != null ? dist.counts[i] : 0);
        }
        return { categories: categories, boxes: boxes, means: means, counts: counts };
    }

    function buildCompareOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var tStyles = tooltipStyles();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var showLegend = !narrow && model.compareSeries.length <= 3;
        var showEndLabels = !narrow && model.compareSeries.length <= 2;
        var focusBlur = theme.focusBlurOpacity != null ? theme.focusBlurOpacity : 0.22;
        var yRange = compareYRange(model.compareSeries, fields.yField);
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                alwaysShowContent: true,
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                scale: true,
                min: yRange.min,
                max: yRange.max,
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
        var tStyles = tooltipStyles();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var dist = sanitizeDistributionForChart(model && model.distribution ? model.distribution : null);
        if (!dist.categories.length) {
            return {
                textStyle: base.textStyle,
                backgroundColor: 'transparent',
                title: {
                    text: 'Not enough valid values for distribution',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: theme.mutedText, fontSize: 14, fontWeight: 500 },
                },
            };
        }
        var yRange = distributionYRange(dist, fields.yField);
        var meanScatter = dist.means.map(function (value, index) {
            return [dist.categories[index], value];
        });
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            tooltip: {
                trigger: 'item',
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                data: dist.categories,
                axisLine: styles.axisLine,
                axisLabel: {
                    color: theme.mutedText,
                    interval: 0,
                    hideOverlap: true,
                    rotate: dist.categories.length > 6 ? (narrow ? 40 : 24) : 0,
                    formatter: function (value) { return trimAxisLabel(value, narrow ? 12 : 20); },
                },
            },
            yAxis: {
                type: 'value',
                scale: true,
                min: yRange.min,
                max: yRange.max,
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
                    data: dist.boxes,
                },
                {
                    name: 'Mean',
                    type: 'scatter',
                    symbolSize: 10,
                    itemStyle: { color: paletteColor(1) },
                    emphasis: { scale: 1.4 },
                    data: meanScatter,
                },
            ],
        };
    }
    function buildDetailOption(model, fields, size) {
        var base = baseTextStyles();
        var theme = (typeof chartTheme === 'function' ? chartTheme : themeFallback)();
        var tStyles = tooltipStyles();
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                alwaysShowContent: true,
                backgroundColor: tStyles.backgroundColor,
                borderColor: tStyles.borderColor,
                textStyle: tStyles.textStyle,
                extraCssText: tStyles.extraCssText,
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
                marketModel = Object.assign({}, model, { market: frames[idx] });
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

    function statusLineTextFromOption(option, dataIndex, otherValue, fields, categoryAxis) {
        if (!option || dataIndex == null) return '';
        var labelStr = '';
        var valueStr = '';
        if (categoryAxis === 'x') {
            var xAxis = option.xAxis && (Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis);
            var xCategories = xAxis && xAxis.data;
            if (Array.isArray(xCategories) && xCategories[dataIndex] != null) {
                labelStr = formatDateAxisLabel(xCategories[dataIndex], false);
            }
            if (otherValue != null && Number.isFinite(otherValue) && fields && chartConfig.fieldLabel) {
                valueStr = chartConfig.fieldLabel(fields.yField) + ': ' + metricAxisLabel(fields.yField, otherValue, false);
            }
        } else {
            var yAxis = option.yAxis && (Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis);
            var yCategories = yAxis && yAxis.data;
            if (Array.isArray(yCategories) && yCategories[dataIndex] != null) {
                labelStr = String(yCategories[dataIndex]);
            }
            if (otherValue != null && Number.isFinite(otherValue) && fields && chartConfig.fieldLabel) {
                valueStr = chartConfig.fieldLabel(fields.yField) + ': ' + metricAxisLabel(fields.yField, otherValue, false);
            }
        }
        return (labelStr && valueStr ? labelStr + '   ' + valueStr : labelStr || valueStr || '').trim();
    }

    function statusLineRepaymentShort(repaymentType) {
        var v = String(repaymentType || '').trim().toLowerCase();
        if (v === 'principal_and_interest' || v === 'p+i') return 'P+I';
        if (v === 'interest_only' || v === 'io') return 'IO';
        return v ? v : '';
    }

    function statusLineStructureShort(rateStructure) {
        var v = String(rateStructure || '').trim().toLowerCase();
        if (v === 'variable') return 'VAR';
        var m = v.match(/^fixed_(\d+)yr$/);
        if (m) return 'FT' + m[1];
        return v ? v : '';
    }

    function statusLineTextFromMarketPoint(row, bucketKey, value, fields) {
        if (!row) return '';
        var bank = String(row.bank_name || '').trim() || '—';
        var rateStr = (chartConfig.formatMetricValue && fields && value != null) ? chartConfig.formatMetricValue(fields.yField, value) : (value != null ? String(value) : '');
        var dateStr = bucketKey != null ? formatDateAxisLabel(bucketKey, false) : '';
        var lvrRaw = row.lvr_tier != null ? row.lvr_tier : '';
        var lvrStr = (chartConfig.formatFieldValue && lvrRaw !== '') ? chartConfig.formatFieldValue('lvr_tier', lvrRaw, row) : (lvrRaw ? String(lvrRaw) : '');
        var repayStr = statusLineRepaymentShort(row.repayment_type);
        var structStr = statusLineStructureShort(row.rate_structure);
        var parts = [bank, rateStr ? 'Rate: ' + rateStr : '', dateStr ? 'Date: ' + dateStr : '', lvrStr ? 'LVR: ' + lvrStr : '', repayStr ? repayStr : '', structStr ? structStr : ''];
        return parts.filter(Boolean).join('  ·  ');
    }

    function ensureChartStatusLine(element) {
        if (!element) return null;
        var el = element.querySelector('.chart-status-line');
        if (el) return el;
        el = document.createElement('div');
        el.className = 'chart-status-line';
        el.setAttribute('aria-hidden', 'true');
        element.appendChild(el);
        return el;
    }

    function resolveStatusLineState(instance, opts) {
        var chartState = opts && opts.chartState && typeof opts.chartState === 'object' ? opts.chartState : null;
        var state = chartState ? chartState.statusLine : instance._statusLineState;
        if (!state || typeof state !== 'object') {
            state = {
                view: '',
                text: '',
                pinnedText: '',
                hoveringBar: false,
            };
            if (chartState) chartState.statusLine = state;
            else instance._statusLineState = state;
        }
        var nextView = String((opts && opts.view) || '');
        if (state.view !== nextView) {
            state.view = nextView;
            state.text = '';
            state.pinnedText = '';
            state.hoveringBar = false;
        }
        if (state.text == null) state.text = '';
        if (state.pinnedText == null) state.pinnedText = '';
        state.hoveringBar = !!state.hoveringBar;
        return state;
    }

    var HIT_RADIUS = 28;

    function findMarketPointUnderPixel(instance, option, pixel) {
        if (!instance || !option || !pixel || pixel.length < 2) return null;
        var series = option.series;
        if (!Array.isArray(series) || !series.length) return null;
        var xAxisOpt = option.xAxis && (Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis);
        var categoryAxis = (xAxisOpt && xAxisOpt.type === 'category') ? 'x' : null;
        if (!categoryAxis || categoryAxis !== 'x') return null;
        var dataCoord;
        try {
            dataCoord = instance.convertFromPixel({ seriesIndex: 0 }, pixel);
        } catch (e) { return null; }
        if (!dataCoord || !Array.isArray(dataCoord)) return null;
        var xIndex = Math.round(dataCoord[0]);
        var categories = xAxisOpt && xAxisOpt.data;
        if (!Array.isArray(categories) || xIndex < 0 || xIndex >= categories.length) return null;
        var best = null;
        var bestDist = HIT_RADIUS * HIT_RADIUS;
        for (var si = 0; si < series.length; si++) {
            var s = series[si];
            var data = s && s.data;
            if (!Array.isArray(data) || xIndex >= data.length) continue;
            var item = data[xIndex];
            if (!item || typeof item !== 'object' || !item.row) continue;
            var val = item.value;
            var yVal = typeof val === 'number' ? val : (Array.isArray(val) ? val[1] : (val && val[1] != null ? val[1] : null));
            if (yVal == null || !Number.isFinite(yVal)) continue;
            var pointPixel;
            try {
                pointPixel = instance.convertToPixel({ seriesIndex: si }, [xIndex, yVal]);
            } catch (e2) { continue; }
            if (!pointPixel || pointPixel.length < 2) continue;
            var dx = pixel[0] - pointPixel[0];
            var dy = pixel[1] - pointPixel[1];
            var dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = { seriesIndex: si, dataIndex: xIndex, row: item.row, bucketKey: item.bucketKey, value: yVal };
            }
        }
        return best;
    }

    function bindChartStatusLine(instance, element, option, fields, opts) {
        if (!instance || !element || !option) return;
        var statusEl = ensureChartStatusLine(element);
        if (!statusEl) return;
        opts = opts || {};
        var statusState = resolveStatusLineState(instance, opts);
        var isMarket = opts.view === 'market' && opts.model && opts.model.market;
        var series = option.series;
        var hasMarketRows = isMarket && Array.isArray(series) && series.some(function (s) {
            var d = s && s.data;
            return Array.isArray(d) && d.length && d[0] && d[0].row;
        });
        var useMarketStatus = isMarket && hasMarketRows;

        statusEl.textContent = statusState.pinnedText || statusState.text || '\u2014';
        if (!statusState.text) statusState.text = statusEl.textContent;
        var zr = instance.getZr && instance.getZr();
        if (!zr) return;

        var pinned = null;
        var hovered = null;

        function setStatusVisible(show) {
            if (show) statusEl.classList.add('visible');
            else statusEl.classList.remove('visible');
        }

        function setStatusText(text) {
            var nextText = text ? String(text) : '';
            if (!nextText) nextText = statusState.pinnedText || statusState.text || '\u2014';
            statusState.text = nextText;
            statusEl.textContent = nextText;
            return nextText;
        }

        function setStatusFromPoint(pt) {
            if (!pt || !pt.row) return;
            setStatusText(statusLineTextFromMarketPoint(pt.row, pt.bucketKey, pt.value, fields));
        }

        function refreshStatus() {
            if (hovered) {
                setStatusFromPoint(hovered);
                return;
            }
            if (pinned) {
                setStatusFromPoint(pinned);
                return;
            }
            if (statusState.pinnedText) {
                setStatusText(statusState.pinnedText);
                return;
            }
            setStatusText(statusState.text || '\u2014');
        }

        function onMouseMove(event) {
            if (!event) {
                hovered = null;
                setStatusVisible(false);
                refreshStatus();
                return;
            }
            var point = null;
            if (event.point && Array.isArray(event.point) && event.point.length >= 2) {
                point = [event.point[0], event.point[1]];
            } else if (event.offsetX != null && event.offsetY != null) {
                point = [event.offsetX, event.offsetY];
            } else if (event.event && event.event.offsetX != null && event.event.offsetY != null) {
                point = [event.event.offsetX, event.event.offsetY];
            }
            if (!point) {
                hovered = null;
                setStatusVisible(false);
                refreshStatus();
                return;
            }

            if (useMarketStatus) {
                var hit = findMarketPointUnderPixel(instance, option, point);
                hovered = hit;
                if (hit) {
                    setStatusFromPoint(hit);
                    setStatusVisible(true);
                } else {
                    refreshStatus();
                    setStatusVisible(false);
                }
                return;
            }

            setStatusText(statusEl.textContent || '\u2014');
            if (!instance.convertFromPixel) {
                setStatusVisible(false);
                return;
            }
            var inGrid = true;
            if (instance.containPixel && typeof instance.containPixel === 'function') {
                try { inGrid = instance.containPixel('grid', point); } catch (e) { inGrid = true; }
            }
            var dataCoord = null;
            try {
                dataCoord = instance.convertFromPixel({ seriesIndex: 0 }, point);
            } catch (e) {}
            if ((!dataCoord || !Array.isArray(dataCoord)) && instance.convertFromPixel) {
                try {
                    dataCoord = instance.convertFromPixel({ gridIndex: 0 }, point);
                } catch (e2) {}
            }
            if (!dataCoord || !Array.isArray(dataCoord)) {
                setStatusVisible(false);
                refreshStatus();
                return;
            }
            var xAxisOpt = option.xAxis && (Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis);
            var yAxisOpt = option.yAxis && (Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis);
            var categoryAxis = (xAxisOpt && xAxisOpt.type === 'category') ? 'x' : ((yAxisOpt && yAxisOpt.type === 'category') ? 'y' : null);
            if (!categoryAxis) {
                setStatusVisible(false);
                refreshStatus();
                return;
            }
            var dataIndex = categoryAxis === 'x' ? Math.round(dataCoord[0]) : Math.round(dataCoord[1]);
            var otherVal = categoryAxis === 'x' ? dataCoord[1] : dataCoord[0];
            var categories = categoryAxis === 'x' ? (xAxisOpt && xAxisOpt.data) : (yAxisOpt && yAxisOpt.data);
            if (!Array.isArray(categories) || dataIndex < 0 || dataIndex >= categories.length) {
                setStatusVisible(false);
                refreshStatus();
                return;
            }
            var s0 = option.series;
            if (Array.isArray(s0) && s0.length && s0[0].data && s0[0].data[dataIndex] != null) {
                var d = s0[0].data[dataIndex];
                if (d && typeof d === 'object' && d.value != null) otherVal = typeof d.value === 'number' ? d.value : (Array.isArray(d.value) ? d.value[0] : d.value);
            }
            var text = statusLineTextFromOption(option, dataIndex, otherVal, fields, categoryAxis);
            if (text) {
                setStatusText(text);
                setStatusVisible(true);
            } else {
                setStatusVisible(false);
                refreshStatus();
            }
        }

        function onGlobalOut() {
            hovered = null;
            setStatusVisible(false);
            if (statusState.hoveringBar) return;
            refreshStatus();
        }

        function onClick(event) {
            if (!useMarketStatus) {
                if (!event || !event.target || !statusState.text || statusState.text === '\u2014') return;
                statusState.pinnedText = statusState.text;
                refreshStatus();
                return;
            }
            var point = null;
            if (event && event.point && Array.isArray(event.point) && event.point.length >= 2) {
                point = [event.point[0], event.point[1]];
            } else if (event && event.offsetX != null && event.offsetY != null) {
                point = [event.offsetX, event.offsetY];
            } else if (event && event.event && event.event.offsetX != null && event.event.offsetY != null) {
                point = [event.event.offsetX, event.event.offsetY];
            }
            if (point) {
                var hit = findMarketPointUnderPixel(instance, option, point);
                pinned = hit;
                statusState.pinnedText = hit ? statusLineTextFromMarketPoint(hit.row, hit.bucketKey, hit.value, fields) : '';
            } else {
                pinned = null;
                statusState.pinnedText = '';
            }
            refreshStatus();
        }

        function onStatusMouseEnter() {
            statusState.hoveringBar = true;
            setStatusText(statusState.pinnedText || statusState.text || '\u2014');
        }

        function onStatusMouseLeave() {
            statusState.hoveringBar = false;
            refreshStatus();
        }

        zr.off('mousemove', instance._statusLineMove);
        zr.off('globalout', instance._statusLineOut);
        zr.off('click', instance._statusLineClick);
        if (instance._statusLineEl && instance._statusLineMouseEnter) {
            instance._statusLineEl.removeEventListener('mouseenter', instance._statusLineMouseEnter);
        }
        if (instance._statusLineEl && instance._statusLineMouseLeave) {
            instance._statusLineEl.removeEventListener('mouseleave', instance._statusLineMouseLeave);
        }
        instance._statusLineMove = onMouseMove;
        instance._statusLineOut = onGlobalOut;
        instance._statusLineClick = onClick;
        instance._statusLineEl = statusEl;
        instance._statusLineMouseEnter = onStatusMouseEnter;
        instance._statusLineMouseLeave = onStatusMouseLeave;
        zr.on('mousemove', onMouseMove);
        zr.on('globalout', onGlobalOut);
        zr.on('click', onClick);
        statusEl.addEventListener('mouseenter', onStatusMouseEnter);
        statusEl.addEventListener('mouseleave', onStatusMouseLeave);
    }

    function renderMainChart(instance, element, view, model, fields, handlers, rbaHistory, chartState) {
        if (!instance || !element) return;
        var size = chartSizeWithFallback(element);
        var option = optionForView(view, model, fields, size, chartState);
        var timeAxisViews = view === 'timeRibbon' || view === 'tdTermTime' || view === 'compare' || view === 'surface';
        if (timeAxisViews && option && Array.isArray(rbaHistory) && rbaHistory.length && helpers.addRbaMarkLine) {
            helpers.addRbaMarkLine(option, rbaHistory);
        }
        instance.setOption(option, true);
        instance.resize();
        element.setAttribute('data-chart-engine', 'echarts');
        element.setAttribute('data-chart-render-view', view);
        element.setAttribute('data-chart-rendered', 'true');

        var xAxisOpt = option.xAxis && (Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis);
        var yAxisOpt = option.yAxis && (Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis);
        var hasCategoryAxis = (xAxisOpt && xAxisOpt.type === 'category') || (yAxisOpt && yAxisOpt.type === 'category');
        if (view !== 'distribution' && hasCategoryAxis && option.grid != null) {
            bindChartStatusLine(instance, element, option, fields, { view: view, model: model, chartState: chartState });
        }

        instance.off('click');
        if (!handlers || typeof handlers.onMainClick !== 'function') return;
        instance.on('click', function (params) {
            handlers.onMainClick(params);
        });
    }

    function renderDetailChart(instance, element, model, fields, chartState) {
        if (!instance) return;
        if (element) instance.resize();
        var size = element ? chartSizeWithFallback(element) : { width: 320, height: 180 };
        var marketModule = window.AR.chartMarket || {};
        if (fields && fields.view === 'market' && typeof marketModule.buildDetailOption === 'function') {
            var detailModel = model;
            if (model.tdCurveFrames && model.tdCurveFrames.length && chartState && chartState.tdCurveFrameIndex != null) {
                var idx = Math.max(0, Math.min(chartState.tdCurveFrameIndex, model.tdCurveFrames.length - 1));
                detailModel = Object.assign({}, model, { market: model.tdCurveFrames[idx] });
            }
            instance.setOption(marketModule.buildDetailOption(detailModel, fields, size), true);
            if (element) instance.resize();
            return;
        }
        instance.setOption(buildDetailOption(model, fields, size), true);
        if (element) instance.resize();
    }

    window.AR.chartEcharts = {
        baseTextStyles: baseTextStyles,
        ensureChart: ensureChart,
        renderDetailChart: renderDetailChart,
        renderMainChart: renderMainChart,
    };
})();
