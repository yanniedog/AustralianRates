(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartConfig = window.AR.chartConfig || {};
    var helpers = window.AR.chartEchartsHelpers || {};
    var paletteColor = helpers.paletteColor || function () { return '#2563eb'; };
    var baseTextStyles = helpers.baseTextStyles || function () { return { textStyle: {}, animationDuration: 320, animationDurationUpdate: 240, animationEasing: 'cubicOut' }; };
    var gridStyles = helpers.gridStyles || function () { return {}; };
    var tooltipStyles = helpers.tooltipStyles || function () { return { backgroundColor: '#11161d', borderColor: '#2f3e4f', textStyle: { color: '#edf3f9' }, extraCssText: '' }; };
    var chartTheme = helpers.chartTheme || function () { return { emphasisText: '#f8fbff', mutedText: '#9aa9b9', softText: '#c5ced8' }; };
    var axisPointerConfig = helpers.axisPointerConfig || function () { return { type: 'cross' }; };
    var metricAxisLabel = helpers.metricAxisLabel || function (_field, value) { return String(value == null ? '' : value); };
    var categoryInterval = helpers.categoryInterval || function () { return 0; };
    var formatDateAxisLabel = helpers.formatDateAxisLabel || function (value) { return String(value || ''); };

    function latestRbaCashRate(rbaHistory) {
        var latest = null;
        (Array.isArray(rbaHistory) ? rbaHistory : []).forEach(function (row) {
            var rate = Number(row && row.cash_rate);
            var date = String(row && row.effective_date || '');
            if (!Number.isFinite(rate) || !date) return;
            if (!latest || date >= latest.effectiveDate) latest = { effectiveDate: date, cashRate: rate };
        });
        return latest;
    }

    function tdSettlementTooltip(params, model, fields, currentRba) {
        var list = Array.isArray(params) ? params.filter(Boolean) : [];
        if (!list.length) return '';
        var key = list[0].axisValue;
        var cat = model.bucketByKey && model.bucketByKey[key] ? model.bucketByKey[key] : null;
        if (!cat) return '';
        var lines = [
            '<strong>' + cat.maturityLabel + '</strong>',
            cat.termLabel + ' term from ' + (model.snapshotDateDisplay || model.snapshotDate || '-'),
            'Median: ' + chartConfig.formatMetricValue(fields.yField, cat.median),
            'Range: ' + chartConfig.formatMetricValue(fields.yField, cat.min) + ' to ' + chartConfig.formatMetricValue(fields.yField, cat.max),
            'Banks: ' + cat.bankCount,
        ];
        if (currentRba && Number.isFinite(currentRba.cashRate)) {
            lines.push('Current RBA: ' + chartConfig.formatMetricValue(fields.yField, currentRba.cashRate));
        }
        var hidden = { Floor: true, Q1: true, 'Full range': true, 'Interquartile range': true, 'Current RBA': true };
        var seriesLines = list.map(function (entry) {
            if (hidden[entry.seriesName]) return '';
            var raw = Array.isArray(entry.value) ? entry.value[1] : entry.value;
            if (!Number.isFinite(Number(raw))) return '';
            return entry.marker + ' ' + entry.seriesName + ': ' + chartConfig.formatMetricValue(fields.yField, Number(raw));
        }).filter(Boolean);
        if (seriesLines.length) lines.push(seriesLines.join('<br>'));
        return lines.filter(Boolean).join('<br>');
    }

    function buildTdSettlementExpectationsOption(model, fields, size, rbaHistory) {
        var base = baseTextStyles();
        var theme = chartTheme();
        var narrow = size && size.width < 760;
        var compact = size && size.width < 420;
        var categories = model.categories || [];
        var currentRba = latestRbaCashRate(rbaHistory);
        model.bucketByKey = model.bucketByKey || {};
        categories.forEach(function (c) { model.bucketByKey[c.key] = c; });
        var dataKeys = categories.map(function (c) { return c.key; });
        var series = [
            { name: 'Floor', type: 'line', stack: 'tdExpectRange', silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', data: categories.map(function (c) { return c.min; }) },
            { name: 'Full range', type: 'line', stack: 'tdExpectRange', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: 'rgba(240, 185, 11, 0.16)' }, data: categories.map(function (c) { return c.max - c.min; }) },
            { name: 'Q1', type: 'line', stack: 'tdExpectIqr', silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', data: categories.map(function (c) { return c.q1; }) },
            { name: 'Interquartile range', type: 'line', stack: 'tdExpectIqr', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: 'rgba(79, 141, 253, 0.18)' }, data: categories.map(function (c) { return c.q3 - c.q1; }) },
            { name: 'Median TD', type: 'line', smooth: 0.18, showSymbol: true, symbolSize: narrow ? 5 : 7, lineStyle: { width: 3, color: paletteColor(0) }, itemStyle: { color: paletteColor(0) }, data: categories.map(function (c) { return [c.key, c.median]; }) },
        ];
        if (currentRba && Number.isFinite(currentRba.cashRate)) {
            series.push({ name: 'Current RBA', type: 'line', symbol: 'none', lineStyle: { width: 2, type: 'dashed', color: theme.mutedText }, data: dataKeys.map(function (key) { return [key, currentRba.cashRate]; }) });
        }
        (model.bankCurves || []).forEach(function (curve, index) {
            series.push({
                name: curve.bankName,
                type: 'line',
                smooth: 0.18,
                connectNulls: true,
                showSymbol: !compact,
                symbolSize: narrow ? 4 : 5,
                lineStyle: { width: 1.8, color: paletteColor(index + 1), opacity: 0.82 },
                itemStyle: { color: paletteColor(index + 1) },
                emphasis: { focus: 'series', lineStyle: { width: 2.6, opacity: 1 } },
                data: (curve.points || []).map(function (p) { return p ? [p.maturityDate, p.value] : null; }),
            });
        });
        var xInterval = categoryInterval(categories.length, compact ? 5 : (narrow ? 7 : 10));
        return {
            textStyle: base.textStyle,
            animationDuration: base.animationDuration,
            animationDurationUpdate: base.animationDurationUpdate,
            animationEasing: base.animationEasing,
            backgroundColor: 'transparent',
            legend: { show: !compact, type: 'scroll', bottom: 8, left: 0, right: 0, textStyle: { color: theme.mutedText, fontSize: narrow ? 10 : 11 } },
            axisPointer: axisPointerConfig(theme),
            title: {
                text: 'TD-implied RBA path proxy',
                subtext: 'Latest term deposit rates by settlement date',
                left: 0,
                top: 2,
                textStyle: { color: theme.emphasisText, fontSize: narrow ? 13 : 14, fontWeight: 700 },
                subtextStyle: { color: theme.mutedText, fontSize: 11 },
            },
            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                hideDelay: 220,
                axisPointer: { type: 'line', lineStyle: { color: theme.crosshairLine || theme.shadowAccent, width: 1.5 } },
                backgroundColor: tooltipStyles().backgroundColor,
                borderColor: tooltipStyles().borderColor,
                textStyle: tooltipStyles().textStyle,
                extraCssText: tooltipStyles().extraCssText,
                formatter: function (params) { return tdSettlementTooltip(params, model, fields, currentRba); },
            },
            grid: { left: compact ? 46 : 56, right: compact ? 14 : 22, top: 56, bottom: compact ? 48 : 88, containLabel: true },
            xAxis: {
                type: 'category',
                data: dataKeys,
                boundaryGap: false,
                name: compact ? '' : 'Settlement date',
                nameLocation: 'middle',
                nameGap: narrow ? 32 : 42,
                nameTextStyle: { color: theme.mutedText },
                axisLine: gridStyles().axisLine,
                axisTick: { show: false },
                axisLabel: {
                    color: theme.mutedText,
                    interval: xInterval,
                    hideOverlap: true,
                    overflow: 'truncate',
                    formatter: function (value) {
                        var c = model.bucketByKey[value];
                        return c ? (c.termLabel + '\n' + c.maturityLabel) : formatDateAxisLabel(value, narrow);
                    },
                },
            },
            yAxis: {
                type: 'value',
                scale: true,
                name: compact ? '' : (chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : 'Rate (%)'),
                nameGap: narrow ? 18 : 26,
                nameTextStyle: { color: theme.mutedText },
                axisLine: gridStyles().axisLine,
                splitLine: gridStyles().splitLine,
                axisLabel: { color: theme.softText, fontFamily: theme.dataFont || undefined, formatter: function (v) { return metricAxisLabel(fields.yField, v, narrow); } },
            },
            series: series,
        };
    }

    window.AR.chartMarket = window.AR.chartMarket || {};
    window.AR.chartMarket.buildTdSettlementExpectationsOption = buildTdSettlementExpectationsOption;
})();
