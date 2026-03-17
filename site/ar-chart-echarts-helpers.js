(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartConfig = window.AR.chartConfig || {};

    function paletteColor(index) {
        var palette = chartConfig.palette();
        return palette[index % palette.length];
    }

    function tooltipMetric(field, row, value) {
        if (row) return chartConfig.formatFieldValue(field, row[field], row);
        return chartConfig.formatMetricValue(field, value);
    }

    function isLightTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    function chartTheme() {
        var light = isLightTheme();
        return {
            emphasisText: light ? '#102033' : '#f8fbff',
            mutedText: light ? '#5b6d81' : '#9aa9b9',
            shadowAccent: light ? 'rgba(37, 99, 235, 0.18)' : 'rgba(79, 141, 253, 0.24)',
            softText: light ? '#31465c' : '#c5ced8',
            splitLine: light ? 'rgba(79, 98, 118, 0.18)' : 'rgba(237, 243, 249, 0.1)',
            surfaceScale: light
                ? ['#eef6ff', '#bfdbfe']
                : ['#173256', '#315f9a'],
            text: light ? '#15273c' : '#edf3f9',
            tooltipBackground: light ? '#ffffff' : '#11161d',
            tooltipBorder: light ? 'rgba(37, 99, 235, 0.28)' : 'rgba(79, 141, 253, 0.28)',
            tooltipShadow: light
                ? 'box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12); border-radius: 12px;'
                : 'box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24); border-radius: 12px;',
            tooltipText: light ? '#0f172a' : '#edf3f9',
            axisLine: light ? 'rgba(79, 98, 118, 0.42)' : 'rgba(237, 243, 249, 0.2)',
        };
    }

    function baseTextStyles() {
        var theme = chartTheme();
        return {
            textStyle: { color: theme.text, fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' },
            animationDuration: 320,
            animationDurationUpdate: 240,
            animationEasing: 'cubicOut',
        };
    }

    function gridStyles() {
        var theme = chartTheme();
        return {
            axisLine: { lineStyle: { color: theme.axisLine } },
            axisLabel: { color: theme.softText },
            splitLine: { lineStyle: { color: theme.splitLine } },
        };
    }

    function tooltipStyles() {
        var theme = chartTheme();
        return {
            backgroundColor: theme.tooltipBackground,
            borderColor: theme.tooltipBorder,
            textStyle: { color: theme.tooltipText },
            extraCssText: theme.tooltipShadow + '; transition: opacity 0.18s ease-out, transform 0.18s ease-out;',
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

    function categoryInterval(total, maxVisible) {
        if (!Number.isFinite(total) || !Number.isFinite(maxVisible) || maxVisible <= 0) return 0;
        if (total <= maxVisible) return 0;
        return Math.max(0, Math.ceil(total / maxVisible) - 1);
    }

    function formatSurfaceAxisLabel(value, options) {
        var text = String(value || '');
        var parts = text.split('|').map(function (part) { return part.trim(); }).filter(Boolean);
        var bank = parts[0] || text;
        var product = parts.slice(1).join(' | ');
        var isVeryNarrow = options && options.veryNarrow;
        var isNarrow = options && options.narrow;
        var isDense = options && options.dense;

        if (isVeryNarrow) return trimAxisLabel(bank, 10);
        if (isNarrow) return trimAxisLabel(bank, 14);
        if (!product) return trimAxisLabel(bank, isDense ? 22 : 32);
        return trimAxisLabel(bank, isDense ? 14 : 18) + ' | ' + trimAxisLabel(product, isDense ? 18 : 22);
    }

    window.AR.chartEchartsHelpers = {
        baseTextStyles: baseTextStyles,
        categoryInterval: categoryInterval,
        chartSize: chartSize,
        formatDateAxisLabel: formatDateAxisLabel,
        formatSurfaceAxisLabel: formatSurfaceAxisLabel,
        gridStyles: gridStyles,
        maxMetric: maxMetric,
        metricAxisLabel: metricAxisLabel,
        paletteColor: paletteColor,
        chartTheme: chartTheme,
        tooltipMetric: tooltipMetric,
        tooltipStyles: tooltipStyles,
        trimAxisLabel: trimAxisLabel,
    };
})();
