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
            textStyle: { color: '#dbe7ff', fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' },
            animationDuration: 420,
            animationDurationUpdate: 300,
            animationEasing: 'cubicOut',
        };
    }

    function gridStyles() {
        return {
            axisLine: { lineStyle: { color: 'rgba(141, 162, 192, 0.24)' } },
            axisLabel: { color: '#d6e6ff' },
            splitLine: { lineStyle: { color: 'rgba(141, 162, 192, 0.12)' } },
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

    function buildSurfaceOption(model, fields, size) {
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
                backgroundColor: 'rgba(7, 10, 18, 0.96)',
                borderColor: 'rgba(126, 176, 255, 0.32)',
                textStyle: { color: '#eef5ff' },
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
            grid: { left: narrow ? 24 : 112, right: 18, top: 26, bottom: narrow ? 90 : 78, containLabel: false },
            xAxis: {
                type: 'category',
                data: model.surface.xLabels,
                boundaryGap: false,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#d6e6ff',
                    interval: narrow && model.surface.xLabels.length > 7 ? 1 : 0,
                    rotate: model.surface.xLabels.length > 10 ? (narrow ? 44 : 28) : 0,
                    formatter: function (value) { return String(value || '').replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2'); },
                },
                splitArea: { show: false },
            },
            yAxis: {
                type: 'category',
                data: model.surface.yLabels,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#eef5ff',
                    width: narrow ? 96 : 240,
                    overflow: 'truncate',
                    formatter: function (value) {
                        if (!narrow) return trimAxisLabel(value, 36);
                        var primary = String(value || '').split('|')[0];
                        return trimAxisLabel(primary, 14);
                    },
                },
            },
            visualMap: {
                min: model.surface.min == null ? 0 : model.surface.min,
                max: model.surface.max == null ? 1 : model.surface.max,
                calculable: !narrow,
                orient: 'horizontal',
                left: narrow ? 22 : 112,
                right: 18,
                bottom: narrow ? 18 : 20,
                text: ['High', 'Low'],
                textStyle: { color: '#c3daf7' },
                itemWidth: narrow ? 90 : 130,
                itemHeight: 12,
                inRange: {
                    color: ['#0e213f', paletteColor(0), paletteColor(1), '#f8f4ff'],
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
                        shadowColor: 'rgba(79, 210, 255, 0.36)',
                    },
                },
                itemStyle: {
                    borderWidth: 1,
                    borderColor: 'rgba(7, 10, 18, 0.28)',
                    borderRadius: 8,
                },
            }],
        };
    }

    function buildLenderOption(model, fields, size) {
        var base = baseTextStyles();
        var styles = gridStyles();
        var narrow = size && size.width < 760;
        var entries = model.lenderRanking && model.lenderRanking.entries ? model.lenderRanking.entries : [];
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(7, 10, 18, 0.96)',
                borderColor: 'rgba(126, 176, 255, 0.32)',
                textStyle: { color: '#eef5ff' },
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
            grid: { left: 18, right: 22, top: 22, bottom: 20, containLabel: true },
            xAxis: {
                type: 'value',
                name: chartConfig.fieldLabel(fields.yField),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: '#b9d2f2' },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#d6e6ff',
                    formatter: function (value) { return chartConfig.formatMetricValue(fields.yField, value); },
                },
                splitLine: styles.splitLine,
            },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#eef5ff',
                    width: narrow ? 104 : 180,
                    overflow: 'truncate',
                },
                data: entries.map(function (entry) { return trimAxisLabel(entry.bankName, narrow ? 16 : 28); }),
            },
            series: [{
                name: 'Best product by bank',
                type: 'bar',
                barWidth: narrow ? 16 : 18,
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
                    color: '#eef5ff',
                    formatter: function (params) {
                        return chartConfig.formatMetricValue(fields.yField, params.value);
                    },
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 18,
                        shadowColor: 'rgba(79, 210, 255, 0.24)',
                    },
                },
            }],
        };
    }

    function buildCompareOption(model, fields, size) {
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
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(79, 210, 255, 0.28)' } },
                backgroundColor: 'rgba(7, 10, 18, 0.96)',
                borderColor: 'rgba(126, 176, 255, 0.32)',
                textStyle: { color: '#eef5ff' },
            },
            grid: { left: 62, right: 30, top: narrow ? 58 : 42, bottom: 54 },
            legend: {
                top: 0,
                type: 'scroll',
                left: 0,
                right: 0,
                textStyle: { color: '#eef5ff' },
                itemWidth: 12,
                itemHeight: 12,
            },
            xAxis: {
                type: 'category',
                data: model.surface.xLabels,
                boundaryGap: false,
                axisLine: styles.axisLine,
                axisLabel: { color: '#d6e6ff', interval: narrow && model.surface.xLabels.length > 7 ? 1 : 0 },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                name: chartConfig.fieldLabel(fields.yField),
                nameTextStyle: { color: '#9db8da' },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#d6e6ff',
                    formatter: function (value) {
                        return chartConfig.formatMetricValue(fields.yField, value);
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
                        show: true,
                        color: '#eef5ff',
                        formatter: function () {
                            return series.name + '  ' + chartConfig.formatMetricValue(fields.yField, series.latestValue);
                        },
                    },
                    emphasis: { focus: 'series' },
                    animationDurationUpdate: 280,
                    lineStyle: { width: 3, color: paletteColor(index) },
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
                backgroundColor: 'rgba(7, 10, 18, 0.96)',
                borderColor: 'rgba(126, 176, 255, 0.32)',
                textStyle: { color: '#eef5ff' },
            },
            grid: { left: 62, right: 28, top: 36, bottom: narrow ? 82 : 60 },
            xAxis: {
                type: 'category',
                data: model.distribution.categories,
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#d6e6ff',
                    interval: 0,
                    rotate: model.distribution.categories.length > 6 ? (narrow ? 40 : 24) : 0,
                },
            },
            yAxis: {
                type: 'value',
                name: chartConfig.fieldLabel(fields.yField),
                nameTextStyle: { color: '#9db8da' },
                axisLine: styles.axisLine,
                axisLabel: {
                    color: '#d6e6ff',
                    formatter: function (value) {
                        return chartConfig.formatMetricValue(fields.yField, value);
                    },
                },
                splitLine: styles.splitLine,
            },
            series: [
                {
                    name: 'Distribution',
                    type: 'boxplot',
                    itemStyle: {
                        color: 'rgba(79, 141, 255, 0.22)',
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
        if (!spotlight || !spotlight.series) return {
            textStyle: base.textStyle,
            backgroundColor: 'transparent',
            title: {
                text: 'Select a rate cell to inspect a single product trend',
                left: 'center',
                top: 'middle',
                textStyle: { color: '#8da2c0', fontSize: 14, fontWeight: 500 },
            },
        };
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(7, 10, 18, 0.96)',
                borderColor: 'rgba(126, 176, 255, 0.32)',
                textStyle: { color: '#eef5ff' },
            },
            grid: { left: 48, right: 18, top: 24, bottom: 36 },
            xAxis: {
                type: 'category',
                data: spotlight.series.points.map(function (point) { return point.date; }),
                axisLine: { lineStyle: { color: 'rgba(141, 162, 192, 0.22)' } },
                axisLabel: { color: '#9db8da', formatter: function (value) { return String(value || '').slice(5); } },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLine: { lineStyle: { color: 'rgba(141, 162, 192, 0.22)' } },
                axisLabel: {
                    color: '#9db8da',
                    formatter: function (value) { return chartConfig.formatMetricValue(fields.yField, value); },
                },
                splitLine: { lineStyle: { color: 'rgba(141, 162, 192, 0.10)' } },
            },
            series: [{
                type: 'line',
                smooth: false,
                showSymbol: true,
                symbolSize: 7,
                lineStyle: { width: 3, color: paletteColor(1) },
                itemStyle: { color: paletteColor(1) },
                areaStyle: { color: 'rgba(79, 210, 255, 0.12)' },
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
