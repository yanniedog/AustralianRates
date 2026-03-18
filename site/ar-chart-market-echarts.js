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
        var theme = chartTheme();
        var axis = {
            type: 'category',
            data: market.categories.map(function (category) { return category.key; }),
            axisLine: gridStyles().axisLine,
            axisTick: { show: false },
            axisLabel: {
                color: theme.mutedText,
                interval: categoryInterval(market.categories.length, narrow ? 5 : 8),
                hideOverlap: true,
                overflow: 'truncate',
                formatter: function (value) {
                    var category = market.bucketByKey[value];
                    return category ? axisLabel(category.shortLabel, category.secondaryLabel, narrow) : value;
                },
            },
        };
        if (market.dimensionLabel) {
            axis.name = market.dimensionLabel;
            axis.nameLocation = 'middle';
            axis.nameGap = narrow ? 32 : 42;
            axis.nameTextStyle = { color: theme.mutedText, fontFamily: theme.dataFont || undefined };
        }
        return axis;
    }

    function itemTooltipHlLvr(params, market, fields) {
        if (!params || !market || !market.bucketByKey) return '';
        var bucketKey = params.name || (params.data && params.data.bucketKey);
        var category = bucketKey ? market.bucketByKey[bucketKey] : null;
        var dateLabel = category ? (category.shortLabel || category.label || bucketKey) : (bucketKey || '');
        var rawValue = Array.isArray(params.value) ? params.value[1] : (params.value != null ? params.value : (params.data && params.data.value));
        var rateStr = chartConfig.formatMetricValue && rawValue != null ? chartConfig.formatMetricValue(fields.yField, rawValue) : (rawValue != null ? String(rawValue) : '');
        var yLabel = (chartConfig.fieldLabel && chartConfig.fieldLabel(fields.yField)) || 'Rate';
        var lvrLabel = (params.data && params.data.lvrLabel) ? String(params.data.lvrLabel) : '';
        var lines = [
            '<strong>' + (params.seriesName || '') + '</strong>',
            lvrLabel ? 'LVR: ' + lvrLabel : '',
            dateLabel ? 'Date: ' + dateLabel : '',
            rateStr !== '' ? yLabel + ': ' + rateStr : '',
        ];
        return lines.filter(Boolean).join('<br>');
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

    function marketCurveYRange(market, yField) {
        var lo = Infinity;
        var hi = -Infinity;
        (market.categories || []).forEach(function (category) {
            if (Number.isFinite(category.min)) lo = Math.min(lo, category.min);
            if (Number.isFinite(category.max)) hi = Math.max(hi, category.max);
            if (Number.isFinite(category.median)) {
                lo = Math.min(lo, category.median);
                hi = Math.max(hi, category.median);
            }
            if (Number.isFinite(category.bestValue)) {
                lo = Math.min(lo, category.bestValue);
                hi = Math.max(hi, category.bestValue);
            }
        });
        (market.bankCurves || []).forEach(function (curve) {
            (curve.points || []).forEach(function (point) {
                if (point && Number.isFinite(point.value)) {
                    lo = Math.min(lo, point.value);
                    hi = Math.max(hi, point.value);
                }
            });
        });
        (market.bankRibbons || []).forEach(function (ribbon) {
            (ribbon.points || []).forEach(function (p) {
                if (p && Number.isFinite(p.lowRate)) lo = Math.min(lo, p.lowRate);
                if (p && Number.isFinite(p.highRate)) hi = Math.max(hi, p.highRate);
            });
        });
        if (!Number.isFinite(lo)) lo = 0;
        if (!Number.isFinite(hi)) hi = 8;
        var pad = (hi - lo) * 0.06 || 0.25;
        var minVal = lo - pad;
        if (typeof chartConfig.isPercentField === 'function' && chartConfig.isPercentField(yField)) minVal = Math.max(0, minVal);
        return { min: minVal, max: hi + pad };
    }

    function buildLineOption(market, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var gridLeft = compact ? 46 : 58;
        var series = [];

        if (market.bankLvrCurves && market.bankLvrCurves.length) {
            var curveTitle = market.curveTitle || 'Variable rate over time by LVR tier';
            var yRange = marketCurveYRange(market, fields.yField);
            var legendBankNames = [];
            market.bankLvrCurves.forEach(function (curve, index) {
                var bankColor = (chartConfig.bankAccentColor && typeof chartConfig.bankAccentColor === 'function')
                    ? chartConfig.bankAccentColor(curve.bankName, curve.colorIndex || 0)
                    : paletteColor(curve.colorIndex || 0);
                if (legendBankNames.indexOf(curve.bankName) < 0) legendBankNames.push(curve.bankName);
                series.push({
                    name: curve.bankName,
                    type: 'line',
                    smooth: 0.22,
                    connectNulls: false,
                    showSymbol: true,
                    symbolSize: 4,
                    lineStyle: { width: 1.6, color: bankColor, opacity: 0.9 },
                    itemStyle: { color: bankColor, opacity: 0.9 },
                    emphasis: { focus: 'series', lineStyle: { width: 2.2 }, symbolSize: 7 },
                    data: (curve.points || []).map(function (point) {
                        if (!point) return null;
                        return {
                            value: [point.bucketKey, point.value],
                            bucketKey: point.bucketKey,
                            row: point.row,
                            lvrLabel: curve.lvrLabel || curve.lvrTier || '',
                        };
                    }),
                });
            });

            return {
                textStyle: base.textStyle,
                animationDuration: base.animationDuration,
                animationDurationUpdate: base.animationDurationUpdate,
                animationEasing: base.animationEasing,
                backgroundColor: 'transparent',
                axisPointer: { show: false },
                title: curveTitle ? {
                    text: curveTitle,
                    left: 0,
                    top: 2,
                    textStyle: { color: theme.mutedText, fontSize: 12, fontWeight: 600 },
                } : undefined,
                legend: {
                    data: legendBankNames,
                    bottom: 8,
                    left: 0,
                    right: 0,
                    type: 'scroll',
                    textStyle: { color: theme.softText },
                    formatter: function (name) { return trimAxisLabel(name, compact ? 16 : 26); },
                },
                tooltip: {
                    trigger: 'item',
                    transitionDuration: 0,
                    confine: true,
                    hideDelay: 1e9,
                    backgroundColor: tooltipStyles().backgroundColor,
                    borderColor: tooltipStyles().borderColor,
                    textStyle: tooltipStyles().textStyle,
                    extraCssText: tooltipStyles().extraCssText,
                    formatter: function (params) { return itemTooltipHlLvr(params, market, fields); },
                },
                grid: {
                    left: gridLeft,
                    right: 18,
                    top: curveTitle ? 36 : 24,
                    bottom: narrow ? 88 : 76,
                    containLabel: true,
                },
                xAxis: categoryAxis(market, compact),
                yAxis: {
                    type: 'value',
                    min: yRange.min,
                    max: yRange.max,
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

        if (market.categories.length > 1) {
            series.push({
                name: 'Market median',
                type: 'line',
                smooth: 0.28,
                showSymbol: true,
                symbolSize: 6,
                lineStyle: { width: 3.2, color: theme.softText, type: 'dashed' },
                itemStyle: { color: theme.softText },
                data: market.categories.map(function (category) {
                    return { value: [category.key, category.median], bucketKey: category.key };
                }),
            });
        }

        market.bankCurves.forEach(function (curve, index) {
            var lineStyle = { width: 2.8, color: paletteColor(index) };
            if (curve.lineDashed) lineStyle.type = 'dashed';
            series.push({
                name: curve.bankName,
                type: 'line',
                smooth: 0.26,
                connectNulls: false,
                showSymbol: true,
                symbolSize: 6,
                lineStyle: lineStyle,
                itemStyle: { color: paletteColor(index) },
                emphasis: { focus: 'series', lineStyle: { width: 3.2 }, symbolSize: 9 },
                data: curve.points.map(function (point) {
                    if (!point) return null;
                    return { value: [point.bucketKey, point.value], bucketKey: point.bucketKey, row: point.row };
                }),
            });
        });

        var curveTitle = market.curveTitle || '';
        var yRange = marketCurveYRange(market, fields.yField);
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
                bottom: 8,
                left: 0,
                right: 0,
                type: 'scroll',
                textStyle: { color: theme.softText },
                formatter: function (name) { return trimAxisLabel(name, compact ? 14 : 22); },
            },
            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return axisTooltip(params, market, fields); },
            },
            grid: {
                left: gridLeft,
                right: 18,
                top: curveTitle ? 36 : 24,
                bottom: narrow ? 88 : 76,
                containLabel: true,
            },
            xAxis: categoryAxis(market, compact),
            yAxis: {
                type: 'value',
                min: yRange.min,
                max: yRange.max,
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

    function hexToRgba(hex, alpha) {
        var m = String(hex).match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!m) return 'rgba(79, 141, 253, ' + (alpha != null ? alpha : 0.5) + ')';
        return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + (alpha != null ? alpha : 0.5) + ')';
    }

    function buildHlLvrRibbonOption(market, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var gridLeft = narrow ? 46 : 58;
        var curveTitle = market.curveTitle || 'Variable rate over time (LVR band: lower = lowest LVR, upper = highest LVR)';
        var series = [];
        (market.bankRibbons || []).forEach(function (ribbon, idx) {
            var color = (chartConfig.bankAccentColor && typeof chartConfig.bankAccentColor === 'function')
                ? chartConfig.bankAccentColor(ribbon.bankName, ribbon.colorIndex)
                : paletteColor(ribbon.colorIndex);
            var fillColor = hexToRgba(color, 0.5);
            var categoryKeys = market.categories.map(function (c) { return c.key; });
            var lowData = ribbon.points.map(function (p, i) {
                if (!p || p.lowRate == null) return null;
                return { value: [categoryKeys[i], p.lowRate], bucketKey: p.bucketKey, lowLvrLabel: p.lowLvrLabel, highLvrLabel: p.highLvrLabel };
            });
            var highData = ribbon.points.map(function (p, i) {
                if (!p || p.highRate == null) return null;
                return { value: [categoryKeys[i], p.highRate], bucketKey: p.bucketKey, lowLvrLabel: p.lowLvrLabel, highLvrLabel: p.highLvrLabel };
            });
            var stackId = 'hlribbon_' + idx;
            series.push({
                name: ribbon.bankName + ' (base)',
                type: 'line',
                stack: stackId,
                silent: true,
                showInLegend: false,
                lineStyle: { opacity: 0 },
                areaStyle: { opacity: 0 },
                symbol: 'none',
                data: ribbon.points.map(function (p, i) { return p && p.lowRate != null ? { value: [categoryKeys[i], p.lowRate], bucketKey: p.bucketKey } : null; }),
            });
            series.push({
                name: ribbon.bankName + ' (band)',
                type: 'line',
                stack: stackId,
                showInLegend: false,
                lineStyle: { opacity: 0 },
                symbol: 'none',
                areaStyle: { color: fillColor },
                data: ribbon.points.map(function (p, i) {
                    if (!p || p.lowRate == null || p.highRate == null) return null;
                    return { value: [categoryKeys[i], (p.highRate - p.lowRate)], bucketKey: p.bucketKey };
                }),
            });
            series.push({
                name: ribbon.bankName,
                type: 'line',
                showSymbol: true,
                symbolSize: 4,
                lineStyle: { width: 1.5, color: color },
                itemStyle: { color: color },
                data: lowData,
                label: { show: true, fontSize: 6, distance: 0, color: color, formatter: function (params) { return (params.data && params.data.lowLvrLabel) || ''; } },
            });
            series.push({
                name: ribbon.bankName,
                type: 'line',
                showSymbol: true,
                symbolSize: 4,
                lineStyle: { width: 1.5, color: color },
                itemStyle: { color: color },
                data: highData,
                label: { show: true, fontSize: 6, distance: 0, color: color, formatter: function (params) { return (params.data && params.data.highLvrLabel) || ''; } },
            });
        });
        var yRange = marketCurveYRange(market, fields.yField);
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
                data: (market.bankRibbons || []).map(function (r) { return r.bankName; }),
                bottom: 8,
                left: 0,
                right: 20,
                type: 'scroll',
                textStyle: { color: theme.softText },
            },
            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return axisTooltip(params, market, fields); },
            },
            grid: {
                left: gridLeft,
                right: 20,
                top: curveTitle ? 36 : 24,
                bottom: narrow ? 88 : 76,
                containLabel: true,
            },
            xAxis: categoryAxis(market, narrow),
            yAxis: {
                type: 'value',
                min: yRange.min,
                max: yRange.max,
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
            series: series,
        };
    }

    function buildRibbonOption(market, fields, size) {
        if (market.bankRibbons && market.bankRibbons.length) {
            return buildHlLvrRibbonOption(market, fields, size);
        }
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
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
            yAxis: (function () {
                var yRange = marketCurveYRange(market, fields.yField);
                return {
                    type: 'value',
                    min: yRange.min,
                    max: yRange.max,
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
                };
            })(),
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
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
            yAxis: (function () {
                var yRange = marketCurveYRange(market, fields.yField);
                return {
                    type: 'value',
                    min: yRange.min,
                    max: yRange.max,
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
                };
            })(),
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
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
                    hideOverlap: true,
                    overflow: 'truncate',
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

    function tdTermTimeGlobalRange(tt) {
        var lo = Infinity;
        var hi = -Infinity;
        tt.terms.forEach(function (term) {
            var tr = term.timeRibbon;
            if (!tr || !tr.categories) return;
            tr.categories.forEach(function (c) {
                if (Number.isFinite(c.min) && c.min < lo) lo = c.min;
                if (Number.isFinite(c.max) && c.max > hi) hi = c.max;
            });
            (tr.bankCurves || []).forEach(function (curve) {
                (curve.points || []).forEach(function (p) {
                    if (p && Number.isFinite(p.value)) {
                        if (p.value < lo) lo = p.value;
                        if (p.value > hi) hi = p.value;
                    }
                });
            });
        });
        if (!Number.isFinite(lo)) lo = 0;
        if (!Number.isFinite(hi)) hi = 5;
        var pad = (hi - lo) * 0.06 || 0.5;
        return { min: Math.max(0, lo - pad), max: hi + pad };
    }

    /* Unified single-frame chart: one line per term (median yield over time). Full width, one story. */
    function buildTdTermTimeOption(tt, fields, size) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var sharedRange = tdTermTimeGlobalRange(tt);
        var allDates = [];
        var dateSet = {};
        tt.terms.forEach(function (term) {
            var tr = term.timeRibbon;
            if (!tr || !tr.categories) return;
            tr.categories.forEach(function (c) {
                if (c.key && !dateSet[c.key]) {
                    dateSet[c.key] = true;
                    allDates.push(c.key);
                }
            });
        });
        allDates.sort();
        var categoryByTerm = {};
        tt.terms.forEach(function (term) {
            var tr = term.timeRibbon;
            if (!tr || !tr.categories) return;
            categoryByTerm[term.termKey] = {};
            tr.categories.forEach(function (c) { categoryByTerm[term.termKey][c.key] = c; });
        });
        var series = tt.terms.map(function (term, index) {
            var byDate = categoryByTerm[term.termKey] || {};
            var data = allDates.map(function (d) {
                var c = byDate[d];
                return c && Number.isFinite(c.median) ? [d, c.median] : null;
            });
            return {
                name: term.termLabel || term.termKey,
                type: 'line',
                smooth: 0.2,
                connectNulls: true,
                showSymbol: !compact,
                symbolSize: narrow ? 4 : 6,
                lineStyle: { width: narrow ? 2 : 2.5, color: paletteColor(index) },
                itemStyle: { color: paletteColor(index) },
                emphasis: { focus: 'series', lineStyle: { width: 3 } },
                data: data,
            };
        });
        var xInterval = categoryInterval(allDates.length, narrow ? 8 : 12);
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            legend: {
                show: true,
                type: 'scroll',
                bottom: 8,
                left: 0,
                right: 0,
                textStyle: { color: theme.mutedText, fontSize: narrow ? 10 : 11 },
                pageButtonItemGap: 8,
                pageIconInactiveColor: theme.softText,
                pageTextStyle: { color: theme.mutedText },
            },
            axisPointer: axisPointerConfig(theme),
            title: {
                text: 'Yield by term over time',
                subtext: 'Median rate across banks at each term. One line per term.',
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
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
            },
            grid: { left: compact ? 48 : 56, right: compact ? 16 : 24, top: 52, bottom: narrow ? 76 : 88, containLabel: true },
            xAxis: {
                type: 'category',
                data: allDates,
                boundaryGap: false,
                axisLine: gridStyles().axisLine,
                axisTick: { show: false },
                axisLabel: {
                    color: theme.mutedText,
                    interval: xInterval,
                    hideOverlap: true,
                    overflow: 'truncate',
                    formatter: function (value) { return formatDateAxisLabel(value, narrow); },
                },
            },
            yAxis: {
                type: 'value',
                name: compact ? '' : (chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : 'Rate (%)'),
                min: sharedRange.min,
                max: sharedRange.max,
                nameGap: narrow ? 20 : 28,
                nameTextStyle: { color: theme.mutedText },
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: { color: theme.softText, fontFamily: theme.dataFont || undefined, formatter: function (v) { return metricAxisLabel(fields.yField, v, narrow); } },
            },
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
        if (market.style === 'ribbon' && market.bankRibbons && market.bankRibbons.length) return buildRibbonOption(market, fields, size);
        if (market.bankLvrCurves && market.bankLvrCurves.length) return buildLineOption(market, fields, size);
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
                transitionDuration: 0,
                confine: true,
                hideDelay: 1e9,
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
