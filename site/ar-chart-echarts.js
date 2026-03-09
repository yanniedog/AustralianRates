(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartConfig = window.AR.chartConfig || {};

    function paletteColor(index) {
        var palette = chartConfig.palette();
        return palette[index % palette.length];
    }

    function ensureChart(element, instance) {
        if (!element || !window.echarts) return null;
        if (instance && !instance.isDisposed()) return instance;
        return window.echarts.init(element, null, { renderer: 'canvas' });
    }

    function tooltipMetric(field, row, value) {
        if (row) return chartConfig.formatFieldValue(field, row[field], row);
        return chartConfig.formatMetricValue(field, value);
    }

    function baseTextStyles() {
        return {
            textStyle: { color: '#1f2937', fontFamily: '"SF Pro Text", "Segoe UI", sans-serif' },
            animationDuration: 420,
            animationDurationUpdate: 300,
            animationEasing: 'cubicOut',
        };
    }

    function gridStyles() {
        return {
            axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.55)' } },
            axisLabel: { color: '#334155' },
            splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.24)' } },
        };
    }

    function tooltipStyles() {
        return {
            backgroundColor: '#ffffff',
            borderColor: 'rgba(37, 99, 235, 0.28)',
            textStyle: { color: '#0f172a' },
            extraCssText: 'box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12); border-radius: 12px;',
        };
    }

    function chartSize(element) {
        return {
            width: Math.max(0, Number(element && element.clientWidth) || 0),
            height: Math.max(0, Number(element && element.clientHeight) || 0),
        };
    }

    function trimAxisLabel(value, maxLength) {
        var text = String(value || '');
        if (text.length <= maxLength) return text;
        return text.slice(0, Math.max(0, maxLength - 1)).trim() + '...';
    }

    function trimTrailingZeros(value) {
        return String(value || '')
            .replace(/(\.\d*?[1-9])0+$/, '$1')
            .replace(/\.0+$/, '');
    }

    function formatDateAxisLabel(value, compact) {
        var text = String(value || '');
        var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return compact ? trimAxisLabel(text, 8) : text;
        if (compact) return match[3] + '/' + match[2];
        return match[1] + '-' + match[2] + '-' + match[3];
    }

    function compactMetricValue(field, value) {
        var num = Number(value);
        if (!Number.isFinite(num)) return chartConfig.formatMetricValue(field, value);

        if (chartConfig.isPercentField && chartConfig.isPercentField(field)) {
            return trimTrailingZeros(num.toFixed(2)) + '%';
        }

        if (chartConfig.isMoneyField && chartConfig.isMoneyField(field)) {
            var abs = Math.abs(num);
            if (abs >= 1000000) return '$' + trimTrailingZeros((num / 1000000).toFixed(1)) + 'm';
            if (abs >= 1000) return '$' + trimTrailingZeros((num / 1000).toFixed(1)) + 'k';
            return '$' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
        }

        return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    function metricAxisLabel(field, value, compact) {
        return compact ? compactMetricValue(field, value) : chartConfig.formatMetricValue(field, value);
    }

    function maxMetric(entries) {
        var max = null;
        entries.forEach(function (entry) {
            var value = Number(entry && entry.value);
            if (!Number.isFinite(value)) return;
            if (max == null || value > max) max = value;
        });
        return max;
    }

    function buildSurfaceOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var narrow = size && size.width < 760;
        var veryNarrow = size && size.width < 420;
        var showVisualMap = !veryNarrow;
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
            grid: {
                left: veryNarrow ? 70 : (narrow ? 92 : 112),
                right: 18,
                top: 24,
                bottom: narrow ? 52 : 78,
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: model.surface.xLabels,
                boundaryGap: false,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#475569',
                    hideOverlap: true,
                    margin: 12,
                    interval: narrow && model.surface.xLabels.length > (veryNarrow ? 5 : 7) ? 1 : 0,
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
                    color: '#0f172a',
                    width: veryNarrow ? 58 : (narrow ? 88 : 240),
                    overflow: 'truncate',
                    formatter: function (value) {
                        if (!narrow) return trimAxisLabel(value, 36);
                        var primary = String(value || '').split('|')[0];
                        return trimAxisLabel(primary, veryNarrow ? 10 : 14);
                    },
                },
            },
            visualMap: {
                show: showVisualMap,
                min: model.surface.min == null ? 0 : model.surface.min,
                max: model.surface.max == null ? 1 : model.surface.max,
                calculable: !narrow,
                orient: 'horizontal',
                left: narrow ? (veryNarrow ? 70 : 92) : 112,
                right: 18,
                bottom: narrow ? 8 : 20,
                text: ['High', 'Low'],
                textStyle: { color: '#475569', fontSize: narrow ? 11 : 12 },
                itemWidth: narrow ? 90 : 130,
                itemHeight: 12,
                inRange: {
                    color: ['#eef6ff', '#bfdbfe', paletteColor(1), paletteColor(0)],
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
                        borderColor: '#ffffff',
                        borderWidth: 1.5,
                        shadowBlur: 18,
                        shadowColor: 'rgba(37, 99, 235, 0.22)',
                    },
                },
                itemStyle: {
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.88)',
                    borderRadius: narrow ? 4 : 8,
                },
            }],
        };
    }

    function buildLenderOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var narrow = size && size.width < 760;
        var entries = model.lenderRanking && model.lenderRanking.entries ? model.lenderRanking.entries : [];
        var maxValue = maxMetric(entries);
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
                    var data = params.data || {};
                    var row = data.row || {};
                    return [
                        '<strong>' + (data.bankName || row.bank_name || 'Lender') + '</strong>',
                        data.productName || row.product_name || '',
                        'Date: ' + chartConfig.formatFieldValue('collection_date', data.date || row.collection_date, row),
                        chartConfig.fieldLabel(fields.yField) + ': ' + tooltipMetric(fields.yField, row, data.value),
                    ].filter(Boolean).join('<br>');
                },
            },
            grid: {
                left: 18,
                right: narrow ? 76 : 28,
                top: 22,
                bottom: narrow ? 38 : 20,
                containLabel: true,
            },
            xAxis: {
                type: 'value',
                min: 0,
                max: maxValue == null ? null : maxValue * (narrow ? 1.18 : 1.08),
                splitNumber: narrow ? 4 : 6,
                name: chartConfig.fieldLabel(fields.yField),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: '#475569' },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#334155',
                    hideOverlap: true,
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
                    color: '#0f172a',
                    width: narrow ? 128 : 180,
                    overflow: 'truncate',
                },
                data: entries.map(function (entry) { return trimAxisLabel(entry.bankName, narrow ? 18 : 28); }),
            },
            series: [{
                name: 'Best product by bank',
                type: 'bar',
                barWidth: narrow ? 16 : 18,
                clip: false,
                data: entries.map(function (entry, index) {
                    return {
                        value: entry.value,
                        seriesKey: entry.seriesKey,
                        bankName: entry.bankName,
                        productName: entry.productName,
                        date: entry.latestDate,
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
                    distance: narrow ? 8 : 10,
                    color: '#0f172a',
                    formatter: function (params) {
                        return metricAxisLabel(fields.yField, params.value, narrow);
                    },
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 18,
                        shadowColor: 'rgba(37, 99, 235, 0.16)',
                    },
                },
            }],
        };
    }

    function buildCompareOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var narrow = size && size.width < 760;
        var showLegend = !narrow && model.compareSeries.length <= 3;
        var showEndLabels = !narrow && model.compareSeries.length <= 2;
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(37, 99, 235, 0.28)' } },
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
                textStyle: { color: '#334155' },
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
                    color: '#475569',
                    hideOverlap: true,
                    margin: 12,
                    interval: narrow && model.surface.xLabels.length > 5 ? 1 : 0,
                    formatter: function (value) { return formatDateAxisLabel(value, narrow); },
                },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                name: chartConfig.fieldLabel(fields.yField),
                nameTextStyle: { color: '#475569' },
                axisLine: styles.axisLine,
                splitNumber: narrow ? 4 : 6,
                axisLabel: {
                    color: '#334155',
                    formatter: function (value) {
                        return metricAxisLabel(fields.yField, value, narrow);
                    },
                },
                splitLine: styles.splitLine,
            },
            series: model.compareSeries.map(function (series, index) {
                return {
                    id: series.key,
                    name: series.name,
                    type: 'line',
                    smooth: false,
                    showSymbol: false,
                    symbolSize: 6,
                    endLabel: {
                        show: showEndLabels,
                        color: '#0f172a',
                        distance: 10,
                        formatter: function () {
                            return trimAxisLabel(series.name, 24) + ' ' + metricAxisLabel(fields.yField, series.latestValue, true);
                        },
                    },
                    labelLayout: { hideOverlap: true },
                    emphasis: { focus: 'series' },
                    animationDurationUpdate: 280,
                    lineStyle: { width: narrow ? 2.5 : 3, color: paletteColor(index) },
                    itemStyle: { color: paletteColor(index) },
                    data: series.points.map(function (point) {
                        return {
                            value: [point.date, point.value],
                            row: point.row,
                            seriesKey: series.key,
                        };
                    }),
                };
            }),
        };
    }

    function buildDistributionOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var narrow = size && size.width < 760;
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
                    color: '#475569',
                    interval: 0,
                    hideOverlap: true,
                    rotate: model.distribution.categories.length > 6 ? (narrow ? 40 : 24) : 0,
                    formatter: function (value) { return trimAxisLabel(value, narrow ? 12 : 20); },
                },
            },
            yAxis: {
                type: 'value',
                name: chartConfig.fieldLabel(fields.yField),
                nameTextStyle: { color: '#475569' },
                axisLine: styles.axisLine,
                splitNumber: narrow ? 4 : 6,
                axisLabel: {
                    color: '#334155',
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
                        color: 'rgba(37, 99, 235, 0.14)',
                        borderColor: paletteColor(0),
                        borderWidth: 2,
                    },
                    data: model.distribution.boxes,
                },
                {
                    name: 'Mean',
                    type: 'scatter',
                    symbolSize: 10,
                    itemStyle: { color: paletteColor(1) },
                    data: model.distribution.means.map(function (value, index) {
                        return [model.distribution.categories[index], value];
                    }),
                },
            ],
        };
    }

    function buildDetailOption(model, fields) {
        var base = baseTextStyles();
        var spotlight = model.spotlight;
        var narrow = typeof window !== 'undefined' && window.innerWidth < 560;
        if (!spotlight || !spotlight.series) return {
            textStyle: base.textStyle,
            backgroundColor: 'transparent',
            title: {
                text: 'Select a rate cell to inspect a single product trend',
                left: 'center',
                top: 'middle',
                textStyle: { color: '#64748b', fontSize: 14, fontWeight: 500 },
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
                bottom: narrow ? 40 : 36,
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: spotlight.series.points.map(function (point) { return point.date; }),
                axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.55)' } },
                axisLabel: {
                    color: '#475569',
                    hideOverlap: true,
                    interval: narrow && spotlight.series.points.length > 4 ? 1 : 0,
                    formatter: function (value) { return formatDateAxisLabel(value, true); },
                },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.55)' } },
                splitNumber: narrow ? 4 : 6,
                axisLabel: {
                    color: '#334155',
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
                splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.18)' } },
            },
            series: [{
                type: 'line',
                smooth: false,
                showSymbol: true,
                symbolSize: 7,
                lineStyle: { width: 3, color: paletteColor(1) },
                itemStyle: { color: paletteColor(1) },
                areaStyle: { color: 'rgba(37, 99, 235, 0.10)' },
                data: spotlight.series.points.map(function (point) {
                    return [point.date, point.value];
                }),
            }],
        };
    }

    function optionForView(view, model, fields, size) {
        if (view === 'lenders') return buildLenderOption(model, fields, size);
        if (view === 'compare') return buildCompareOption(model, fields, size);
        if (view === 'distribution') return buildDistributionOption(model, fields, size);
        return buildSurfaceOption(model, fields, size);
    }

    function renderMainChart(instance, element, view, model, fields, handlers) {
        if (!instance || !element) return;
        instance.setOption(optionForView(view, model, fields, chartSize(element)), true);
        element.setAttribute('data-chart-engine', 'echarts');
        element.setAttribute('data-chart-view', view);
        element.setAttribute('data-chart-rendered', 'true');

        instance.off('click');
        if (!handlers || typeof handlers.onMainClick !== 'function') return;
        instance.on('click', function (params) {
            handlers.onMainClick(params);
        });
    }

    function renderDetailChart(instance, model, fields) {
        if (!instance) return;
        instance.setOption(buildDetailOption(model, fields), true);
    }

    window.AR.chartEcharts = {
        baseTextStyles: baseTextStyles,
        ensureChart: ensureChart,
        renderDetailChart: renderDetailChart,
        renderMainChart: renderMainChart,
    };
})();
