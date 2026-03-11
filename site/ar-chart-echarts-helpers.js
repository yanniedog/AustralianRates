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

    function baseTextStyles() {
        var light = isLightTheme();
        return {
            textStyle: { color: light ? '#1f2937' : '#e7edf4', fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' },
            animationDuration: 420,
            animationDurationUpdate: 300,
            animationEasing: 'cubicOut',
        };
    }

    function gridStyles() {
        var light = isLightTheme();
        return {
            axisLine: { lineStyle: { color: light ? 'rgba(93, 109, 130, 0.42)' : 'rgba(231, 237, 244, 0.18)' } },
            axisLabel: { color: light ? '#2f435a' : '#b7c0cb' },
            splitLine: { lineStyle: { color: light ? 'rgba(93, 109, 130, 0.16)' : 'rgba(231, 237, 244, 0.08)' } },
        };
    }

    function tooltipStyles() {
        var light = isLightTheme();
        return {
            backgroundColor: light ? '#ffffff' : '#11161d',
            borderColor: light ? 'rgba(37, 99, 235, 0.28)' : 'rgba(79, 141, 253, 0.28)',
            textStyle: { color: light ? '#0f172a' : '#e7edf4' },
            extraCssText: light
                ? 'box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12); border-radius: 12px;'
                : 'box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24); border-radius: 12px;',
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
        tooltipMetric: tooltipMetric,
        tooltipStyles: tooltipStyles,
        trimAxisLabel: trimAxisLabel,
    };
})();
