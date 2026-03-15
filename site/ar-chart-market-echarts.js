(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartConfig = window.AR.chartConfig || {};
    var helpers = window.AR.chartEchartsHelpers || {};
    var paletteColor = helpers.paletteColor || function () { return '#2563eb'; };
    var baseTextStyles = helpers.baseTextStyles || function () { return { textStyle: {}, animationDuration: 320, animationDurationUpdate: 240, animationEasing: 'cubicOut' }; };
    var gridStyles = helpers.gridStyles || function () { return {}; };
    var tooltipStyles = helpers.tooltipStyles || function () { return { backgroundColor: '#11161d', borderColor: '#2f3e4f', textStyle: { color: '#edf3f9' }, extraCssText: '' }; };
    var chartTheme = helpers.chartTheme || function () {
        return {
            emphasisText: '#f8fbff',
            mutedText: '#9aa9b9',
            softText: '#c5ced8',
            axisLine: 'rgba(237, 243, 249, 0.2)',
            shadowAccent: 'rgba(79, 141, 253, 0.24)',
        };
    };
    var trimAxisLabel = helpers.trimAxisLabel || function (value) { return String(value || ''); };
    var metricAxisLabel = helpers.metricAxisLabel || function (_field, value) { return String(value == null ? '' : value); };
    var categoryInterval = helpers.categoryInterval || function () { return 0; };

    function axisLabel(shortLabel, secondaryLabel, narrow) {
        var secondary = secondaryLabel ? trimAxisLabel(secondaryLabel, narrow ? 11 : 15) : '';
        return secondary ? (shortLabel + '\n' + secondary) : shortLabel;
    }

    function categoryAxis(market, narrow) {
        return {
            type: 'category',
            data: market.categories.map(function (category) { return category.key; }),
            axisLine: gridStyles().axisLine,
            axisTick: { show: false },
            axisLabel: {
                color: chartTheme().mutedText,
                interval: categoryInterval(market.categories.length, narrow ? 5 : 8),
                hideOverlap: false,
                formatter: function (value) {
                    var category = market.bucketByKey[value];
                    return category ? axisLabel(category.shortLabel, category.secondaryLabel, narrow) : value;
                },
            },
        };
    }

    function axisTooltip(params, market, fields) {
        var list = Array.isArray(params) ? params.filter(Boolean) : [];
        if (!list.length) return '';
        var axisKey = list[0].axisValue;
        var category = market.bucketByKey[axisKey];
        if (!category) return '';
        var hiddenNames = {
            Floor: true,
            Q1: true,
            'Full range': true,
            'Interquartile range': true,
        };
        return [
            '<strong>' + category.label + '</strong>',
            category.secondaryLabel || '',
            'Snapshot: ' + (market.snapshotDateDisplay || '-'),
            list.map(function (entry) {
                if (hiddenNames[entry.seriesName]) return '';
                if (entry.value == null) return '';
                var rawValue = Array.isArray(entry.value) ? entry.value[1] : entry.value;
                return entry.marker + ' ' + entry.seriesName + ': ' + chartConfig.formatMetricValue(fields.yField, rawValue);
            }).filter(Boolean).join('<br>'),
        ].filter(Boolean).join('<br>');
    }

    function boxTooltip(params, market, fields) {
        var bucketKey = params && params.data && params.data.bucketKey
            ? String(params.data.bucketKey)
            : (params && params.name ? String(params.name) : '');
        var category = market.bucketByKey[bucketKey];
        if (!category) return '';
        return [
            '<strong>' + category.label + '</strong>',
            category.secondaryLabel || '',
            'Median: ' + chartConfig.formatMetricValue(fields.yField, category.median),
            'Range: ' + chartConfig.formatMetricValue(fields.yField, category.min) + ' to ' + chartConfig.formatMetricValue(fields.yField, category.max),
            'Banks: ' + category.bankCount,
        ].filter(Boolean).join('<br>');
    }

    function buildLineOption(market, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var series = [];

        if (market.categories.length > 1) {
            series.push({
                name: 'Market median',
                type: 'line',
                showSymbol: true,
                symbolSize: 7,
                lineStyle: { width: 3, color: theme.softText, type: 'dashed' },
                itemStyle: { color: theme.softText },
                data: market.categories.map(function (category) {
                    return { value: [category.key, category.median], bucketKey: category.key };
                }),
            });
        }

        market.bankCurves.forEach(function (curve, index) {
            series.push({
                name: curve.bankName,
                type: 'line',
                connectNulls: false,
                showSymbol: true,
                symbolSize: 7,
                lineStyle: { width: 2.8, color: paletteColor(index) },
                itemStyle: { color: paletteColor(index) },
                emphasis: { focus: 'series' },
                data: curve.points.map(function (point) {
                    if (!point) return null;
                    return { value: [point.bucketKey, point.value], bucketKey: point.bucketKey, row: point.row };
                }),
            });
        });

        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            legend: {
                top: 0,
                left: 0,
                right: 0,
                type: 'scroll',
                textStyle: { color: theme.softText },
                formatter: function (name) { return trimAxisLabel(name, compact ? 14 : 22); },
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.shadowAccent } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return axisTooltip(params, market, fields); },
            },
            grid: {
                left: compact ? 46 : 58,
                right: 18,
                top: 54,
                bottom: narrow ? 78 : 64,
                containLabel: true,
            },
            xAxis: categoryAxis(market, compact),
            yAxis: {
                type: 'value',
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
            },
            series: series,
        };
    }

    function buildRibbonOption(market, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.shadowAccent } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return axisTooltip(params, market, fields); },
            },
            grid: {
                left: narrow ? 46 : 58,
                right: 20,
                top: 24,
                bottom: narrow ? 78 : 64,
                containLabel: true,
            },
            xAxis: categoryAxis(market, narrow),
            yAxis: {
                type: 'value',
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
            },
            series: [
                {
                    name: 'Floor',
                    type: 'line',
                    stack: 'envelope',
                    silent: true,
                    lineStyle: { opacity: 0 },
                    areaStyle: { opacity: 0 },
                    symbol: 'none',
                    data: market.categories.map(function (category) { return { value: category.min, bucketKey: category.key }; }),
                },
                {
                    name: 'Full range',
                    type: 'line',
                    stack: 'envelope',
                    lineStyle: { opacity: 0 },
                    symbol: 'none',
                    areaStyle: { color: 'rgba(79, 141, 253, 0.12)' },
                    data: market.categories.map(function (category) { return { value: category.max - category.min, bucketKey: category.key }; }),
                },
                {
                    name: 'Q1',
                    type: 'line',
                    stack: 'iqr',
                    silent: true,
                    lineStyle: { opacity: 0 },
                    areaStyle: { opacity: 0 },
                    symbol: 'none',
                    data: market.categories.map(function (category) { return { value: category.q1, bucketKey: category.key }; }),
                },
                {
                    name: 'Interquartile range',
                    type: 'line',
                    stack: 'iqr',
                    lineStyle: { opacity: 0 },
                    symbol: 'none',
                    areaStyle: { color: 'rgba(39, 194, 122, 0.18)' },
                    data: market.categories.map(function (category) { return { value: category.q3 - category.q1, bucketKey: category.key }; }),
                },
                {
                    name: 'Median',
                    type: 'line',
                    showSymbol: true,
                    symbolSize: 7,
                    lineStyle: { width: 3, color: paletteColor(0) },
                    itemStyle: { color: paletteColor(0) },
                    data: market.categories.map(function (category) {
                        return { value: [category.key, category.median], bucketKey: category.key };
                    }),
                },
                {
                    name: market.bestLabel,
                    type: 'line',
                    showSymbol: true,
                    symbolSize: 7,
                    lineStyle: { width: 2.5, color: paletteColor(1), type: 'dashed' },
                    itemStyle: { color: paletteColor(1) },
                    data: market.categories.map(function (category) {
                        return { value: [category.key, category.bestValue], bucketKey: category.key, row: category.bestRow };
                    }),
                },
            ],
        };
    }

    function buildBoxOption(market, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
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
                formatter: function (params) { return boxTooltip(params, market, fields); },
            },
            grid: {
                left: narrow ? 46 : 58,
                right: 18,
                top: 24,
                bottom: narrow ? 78 : 64,
                containLabel: true,
            },
            xAxis: categoryAxis(market, narrow),
            yAxis: {
                type: 'value',
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
            },
            series: [
                {
                    name: 'Distribution',
                    type: 'boxplot',
                    itemStyle: {
                        color: 'rgba(79, 141, 253, 0.14)',
                        borderColor: paletteColor(0),
                        borderWidth: 2,
                    },
                    data: market.categories.map(function (category) {
                        return { name: category.key, value: category.box, bucketKey: category.key };
                    }),
                },
                {
                    name: market.bestLabel,
                    type: 'scatter',
                    symbolSize: 10,
                    itemStyle: { color: paletteColor(1) },
                    data: market.categories.map(function (category) {
                        return { value: [category.key, category.bestValue], bucketKey: category.key, row: category.bestRow };
                    }),
                },
            ],
        };
    }

    function buildMainOption(model, fields, size) {
        var market = model && model.market ? model.market : null;
        if (!market || !market.categories.length) {
            return {
                textStyle: baseTextStyles().textStyle,
                backgroundColor: 'transparent',
                title: {
                    text: 'No market curve available for this slice',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: chartTheme().mutedText, fontSize: 14, fontWeight: 500 },
                },
            };
        }
        if (market.style === 'box') return buildBoxOption(market, fields, size);
        if (market.style === 'ribbon') return buildRibbonOption(market, fields, size);
        return buildLineOption(market, fields, size);
    }

    function buildDetailOption(model, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var market = model && model.market ? model.market : null;
        var bucket = market && market.focusBucket ? market.focusBucket : null;
        var narrow = size && size.width < 420;
        if (!bucket || !bucket.bankEntries.length) {
            return {
                textStyle: base.textStyle,
                backgroundColor: 'transparent',
                title: {
                    text: 'Select a market bucket to inspect the bank ranking',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: theme.mutedText, fontSize: 14, fontWeight: 500 },
                },
            };
        }

        var entries = bucket.bankEntries.slice(0, 8);
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) {
                    var row = params.data && params.data.row ? params.data.row : {};
                    return [
                        '<strong>' + (params.data.bankName || 'Bank') + '</strong>',
                        row.product_name || '',
                        bucket.label,
                        chartConfig.fieldLabel(fields.yField) + ': ' + chartConfig.formatMetricValue(fields.yField, params.data.value),
                    ].filter(Boolean).join('<br>');
                },
            },
            grid: {
                left: narrow ? 18 : 22,
                right: narrow ? 62 : 24,
                top: 36,
                bottom: 20,
                containLabel: true,
            },
            title: {
                text: bucket.label,
                subtext: bucket.secondaryLabel ? ('Target ' + bucket.secondaryLabel) : ('Snapshot ' + market.snapshotDateDisplay),
                left: 0,
                top: 0,
                textStyle: { color: theme.emphasisText, fontSize: 14, fontWeight: 700 },
                subtextStyle: { color: theme.mutedText, fontSize: 11 },
            },
            xAxis: {
                type: 'value',
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    formatter: function (value) { return metricAxisLabel(fields.yField, value, narrow); },
                },
            },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLine: gridStyles().axisLine,
                axisLabel: {
                    color: theme.emphasisText,
                    width: narrow ? 82 : 128,
                    overflow: 'truncate',
                },
                data: entries.map(function (entry) { return trimAxisLabel(entry.bankName, narrow ? 12 : 20); }),
            },
            series: [{
                type: 'bar',
                barWidth: narrow ? 12 : 16,
                data: entries.map(function (entry, index) {
                    return {
                        value: entry.value,
                        bankName: entry.bankName,
                        row: entry.row,
                        itemStyle: { color: paletteColor(index), borderRadius: [999, 999, 999, 999] },
                    };
                }),
                label: {
                    show: true,
                    position: 'right',
                    color: theme.emphasisText,
                    formatter: function (params) { return metricAxisLabel(fields.yField, params.value, true); },
                },
            }],
        };
    }

    window.AR.chartMarket = window.AR.chartMarket || {};
    window.AR.chartMarket.buildMainOption = buildMainOption;
    window.AR.chartMarket.buildDetailOption = buildDetailOption;
})();
