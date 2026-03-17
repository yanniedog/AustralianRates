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
            crosshairLine: 'rgba(79, 141, 253, 0.5)',
            crosshairLabelBg: 'rgba(17, 22, 29, 0.94)',
        };
    };
    var axisPointerConfig = helpers.axisPointerConfig || function (theme) {
        theme = theme || chartTheme();
        return {
            type: 'cross',
            lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5, type: 'dashed' },
            crossStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1 },
            label: { backgroundColor: theme.crosshairLabelBg, color: theme.emphasisText, fontSize: 11 },
        };
    };
    var trimAxisLabel = helpers.trimAxisLabel || function (value) { return String(value || ''); };
    var metricAxisLabel = helpers.metricAxisLabel || function (_field, value) { return String(value == null ? '' : value); };
    var categoryInterval = helpers.categoryInterval || function () { return 0; };
    var formatDateAxisLabel = helpers.formatDateAxisLabel || function (value, compact) { return String(value || ''); };

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
        var bestRow = category.bestRow || {};
        var lines = [
            '<strong>' + category.label + '</strong>',
            category.secondaryLabel || '',
            'Median: ' + chartConfig.formatMetricValue(fields.yField, category.median),
            'Range: ' + chartConfig.formatMetricValue(fields.yField, category.min) + ' to ' + chartConfig.formatMetricValue(fields.yField, category.max),
            'Banks: ' + category.bankCount,
        ];
        if (bestRow.bank_name) lines.push('Leader: ' + chartConfig.formatFieldValue('bank_name', bestRow.bank_name, bestRow));
        if (bestRow.product_name) lines.push('Product: ' + String(bestRow.product_name).slice(0, 40) + (String(bestRow.product_name).length > 40 ? '...' : ''));
        if (bestRow.conditions) lines.push('Conditions: ' + String(bestRow.conditions).slice(0, 60) + (String(bestRow.conditions).length > 60 ? '...' : ''));
        return lines.filter(Boolean).join('<br>');
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
                smooth: 0.2,
                showSymbol: true,
                symbolSize: 6,
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
                smooth: 0.2,
                connectNulls: false,
                showSymbol: true,
                symbolSize: 6,
                lineStyle: { width: 2.8, color: paletteColor(index) },
                itemStyle: { color: paletteColor(index) },
                emphasis: { focus: 'series', lineStyle: { width: 3.2 }, symbolSize: 9 },
                data: curve.points.map(function (point) {
                    if (!point) return null;
                    return { value: [point.bucketKey, point.value], bucketKey: point.bucketKey, row: point.row };
                }),
            });
        });

        var curveTitle = market.curveTitle || '';
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            title: curveTitle ? {
                text: curveTitle,
                left: 0,
                top: 2,
                textStyle: { color: theme.mutedText, fontSize: 12, fontWeight: 600 },
            } : undefined,
            legend: {
                top: curveTitle ? 20 : 0,
                left: 0,
                right: 0,
                type: 'scroll',
                textStyle: { color: theme.softText },
                formatter: function (name) { return trimAxisLabel(name, compact ? 14 : 22); },
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return axisTooltip(params, market, fields); },
            },
            grid: {
                left: compact ? 46 : 58,
                right: 18,
                top: curveTitle ? 72 : 54,
                bottom: narrow ? 78 : 64,
                containLabel: true,
            },
            xAxis: categoryAxis(market, compact),
            yAxis: {
                type: 'value',
                name: compact ? '' : (chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : ''),
                nameGap: compact ? 10 : (narrow ? 18 : 26),
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
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
        var curveTitle = market.curveTitle || '';
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            title: curveTitle ? {
                text: curveTitle,
                left: 0,
                top: 2,
                textStyle: { color: theme.mutedText, fontSize: 12, fontWeight: 600 },
            } : undefined,
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return axisTooltip(params, market, fields); },
            },
            grid: {
                left: narrow ? 46 : 58,
                right: 20,
                top: curveTitle ? 42 : 24,
                bottom: narrow ? 78 : 64,
                containLabel: true,
            },
            xAxis: categoryAxis(market, narrow),
            yAxis: {
                type: 'value',
                name: (chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : ''),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
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
        var curveTitle = market.curveTitle || '';
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            title: curveTitle ? {
                text: curveTitle,
                left: 0,
                top: 2,
                textStyle: { color: theme.mutedText, fontSize: 12, fontWeight: 600 },
            } : undefined,
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
                top: curveTitle ? 42 : 24,
                bottom: narrow ? 78 : 64,
                containLabel: true,
            },
            xAxis: categoryAxis(market, narrow),
            yAxis: {
                type: 'value',
                name: (chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : ''),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: {
                    color: theme.softText,
                    fontFamily: theme.dataFont || undefined,
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

    function timeRibbonTooltip(params, tr, fields) {
        var list = Array.isArray(params) ? params.filter(Boolean) : [];
        if (!list.length) return '';
        var dateKey = list[0].axisValue;
        var cat = tr.bucketByKey && tr.bucketByKey[dateKey] ? tr.bucketByKey[dateKey] : tr.categories.find(function (c) { return c.key === dateKey; });
        if (!cat) return '';
        var hiddenNames = { Floor: true, Q1: true, 'Full range': true, 'Interquartile range': true };
        var bestEntry = cat.bankEntries && cat.bankEntries[0];
        var lines = [
            '<strong>' + (cat.label || dateKey) + '</strong>',
            tr.termLabel ? (tr.termLabel + ' term') : '',
            'Banks: ' + (cat.bankCount || 0),
            'Range: ' + chartConfig.formatMetricValue(fields.yField, cat.min) + ' to ' + chartConfig.formatMetricValue(fields.yField, cat.max),
        ];
        if (bestEntry && bestEntry.bankName) lines.push('Leader: ' + bestEntry.bankName + ' ' + chartConfig.formatMetricValue(fields.yField, bestEntry.value));
        lines.push(list.map(function (entry) {
                if (hiddenNames[entry.seriesName]) return '';
                if (entry.value == null) return '';
                var rawValue = Array.isArray(entry.value) ? entry.value[1] : entry.value;
                return entry.marker + ' ' + entry.seriesName + ': ' + chartConfig.formatMetricValue(fields.yField, rawValue);
            }).filter(Boolean).join('<br>'));
        return lines.filter(Boolean).join('<br>');
    }

    function buildTimeRibbonOption(tr, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        tr.bucketByKey = {};
        tr.categories.forEach(function (c) { tr.bucketByKey[c.key] = c; });
        var xInterval = categoryInterval(tr.categories.length, compact ? 5 : (narrow ? 8 : 12));
        var series = [
            { name: 'Floor', type: 'line', stack: 'trEnv', silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', data: tr.categories.map(function (c) { return c.min; }) },
            { name: 'Full range', type: 'line', stack: 'trEnv', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: 'rgba(79, 141, 253, 0.14)' }, data: tr.categories.map(function (c) { return c.max - c.min; }) },
            { name: 'Q1', type: 'line', stack: 'trIqr', silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', data: tr.categories.map(function (c) { return c.q1; }) },
            { name: 'Interquartile range', type: 'line', stack: 'trIqr', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: 'rgba(39, 194, 122, 0.2)' }, data: tr.categories.map(function (c) { return c.q3 - c.q1; }) },
            { name: 'Median', type: 'line', smooth: 0.2, showSymbol: true, symbolSize: 6, lineStyle: { width: 3, color: paletteColor(0) }, itemStyle: { color: paletteColor(0) }, data: tr.categories.map(function (c) { return [c.key, c.median]; }) },
        ];
        tr.bankCurves.forEach(function (curve, index) {
            series.push({
                name: curve.bankName,
                type: 'line',
                smooth: 0.2,
                connectNulls: true,
                showSymbol: true,
                symbolSize: 5,
                lineStyle: { width: 2, color: paletteColor(index + 1) },
                itemStyle: { color: paletteColor(index + 1) },
                emphasis: { focus: 'series', lineStyle: { width: 2.5 } },
                data: curve.points.map(function (p) { return p ? [p.date, p.value] : null; }),
            });
        });
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            axisPointer: axisPointerConfig(theme),
            title: {
                text: 'Rate over time · ' + (tr.termLabel || '') + ' · mean and range across banks',
                left: 0,
                top: 2,
                textStyle: { color: theme.mutedText, fontSize: 12, fontWeight: 600 },
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return timeRibbonTooltip(params, tr, fields); },
            },
            grid: { left: compact ? 48 : 60, right: 20, top: 44, bottom: narrow ? 80 : 66, containLabel: true },
            xAxis: {
                type: 'category',
                data: tr.categories.map(function (c) { return c.key; }),
                axisLine: gridStyles().axisLine,
                axisTick: { show: false },
                axisLabel: {
                    color: theme.mutedText,
                    interval: xInterval,
                    formatter: function (value) { return formatDateAxisLabel(value, narrow); },
                },
            },
            yAxis: {
                type: 'value',
                name: compact ? '' : (chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : ''),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: theme.mutedText, fontFamily: theme.dataFont || undefined },
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: { color: theme.softText, fontFamily: theme.dataFont || undefined, formatter: function (v) { return metricAxisLabel(fields.yField, v, narrow); } },
            },
            series: series,
        };
    }

    function buildTdTermTimeOption(tt, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var termCount = tt.terms.length;
        var rowCount = Math.min(termCount, 4);
        var colCount = termCount <= 2 ? termCount : 2;
        var gap = 12;
        var topStart = 36;
        var titleHeight = 28;
        var h = (100 - topStart) / rowCount;
        var w = 100 / colCount;
        var grids = [];
        var xAxes = [];
        var yAxes = [];
        for (var i = 0; i < termCount; i++) {
            var row = Math.floor(i / colCount);
            var col = i % colCount;
            grids.push({
                left: (col * w) + '%',
                top: (topStart + row * h) + '%',
                width: (w - 0.5) + '%',
                height: (h - 2) + '%',
                containLabel: true,
            });
            xAxes.push({
                type: 'category',
                gridIndex: i,
                data: tt.terms[i].timeRibbon.categories.map(function (c) { return c.key; }),
                boundaryGap: false,
                axisLine: gridStyles().axisLine,
                axisTick: { show: false },
                axisLabel: {
                    color: theme.mutedText,
                    fontSize: 9,
                    interval: categoryInterval(tt.terms[i].timeRibbon.categories.length, 6),
                    formatter: function (value) { return formatDateAxisLabel(value, true); },
                },
            });
            yAxes.push({
                type: 'value',
                gridIndex: i,
                name: '',
                axisLine: gridStyles().axisLine,
                splitLine: { show: false },
                axisLabel: { color: theme.softText, fontSize: 9, fontFamily: theme.dataFont || undefined, formatter: function (v) { return metricAxisLabel(fields.yField, v, true); } },
            });
        }
        var series = [];
        tt.terms.forEach(function (term, gridIdx) {
            var tr = term.timeRibbon;
            if (!tr || !tr.categories.length) return;
            tr.bucketByKey = {};
            tr.categories.forEach(function (c) { tr.bucketByKey[c.key] = c; });
            series.push({ name: 'Floor', type: 'line', stack: 'g' + gridIdx, silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', xAxisIndex: gridIdx, yAxisIndex: gridIdx, data: tr.categories.map(function (c) { return c.min; }) });
            series.push({ name: 'Full range', type: 'line', stack: 'g' + gridIdx, lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: 'rgba(79, 141, 253, 0.12)' }, xAxisIndex: gridIdx, yAxisIndex: gridIdx, data: tr.categories.map(function (c) { return c.max - c.min; }) });
            series.push({ name: 'Median', type: 'line', smooth: 0.2, showSymbol: false, symbolSize: 4, lineStyle: { width: 2, color: paletteColor(0) }, itemStyle: { color: paletteColor(0) }, xAxisIndex: gridIdx, yAxisIndex: gridIdx, data: tr.categories.map(function (c) { return [c.key, c.median]; }) });
            var bankCurves = (tr.bankCurves || []).slice(0, 4);
            bankCurves.forEach(function (curve, bi) {
                series.push({
                    name: curve.bankName,
                    type: 'line',
                    smooth: 0.2,
                    connectNulls: true,
                    showSymbol: false,
                    symbolSize: 3,
                    lineStyle: { width: 1.5, color: paletteColor((bi + 1) % 6) },
                    itemStyle: { color: paletteColor((bi + 1) % 6) },
                    xAxisIndex: gridIdx,
                    yAxisIndex: gridIdx,
                    data: curve.points.map(function (p) { return p ? [p.date, p.value] : null; }),
                });
            });
        });
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            legend: { show: false },
            title: {
                text: 'Yield by term over time · how banks price across terms',
                left: 0,
                top: 4,
                textStyle: { color: theme.mutedText, fontSize: 13, fontWeight: 600 },
            },
            tooltip: { trigger: 'axis', backgroundColor: tooltipStyles().backgroundColor, borderColor: tooltipStyles().borderColor, textStyle: tooltipStyles().textStyle, extraCssText: tooltipStyles().extraCssText },
            grid: grids,
            xAxis: xAxes,
            yAxis: yAxes,
            series: series,
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
                    fontFamily: theme.dataFont || undefined,
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
                emphasis: {
                    itemStyle: {
                        shadowBlur: 14,
                        shadowColor: theme.shadowAccent,
                    },
                },
                label: {
                    show: true,
                    position: 'right',
                    color: theme.emphasisText,
                    fontFamily: theme.dataFont || undefined,
                    formatter: function (params) { return metricAxisLabel(fields.yField, params.value, true); },
                },
            }],
        };
    }

    window.AR.chartMarket = window.AR.chartMarket || {};
    window.AR.chartMarket.buildMainOption = buildMainOption;
    window.AR.chartMarket.buildDetailOption = buildDetailOption;
    window.AR.chartMarket.buildTimeRibbonOption = buildTimeRibbonOption;
    window.AR.chartMarket.buildTdTermTimeOption = buildTdTermTimeOption;
})();
