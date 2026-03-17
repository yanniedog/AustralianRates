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

    var DATA_FONT = '"JetBrains Mono", "SF Mono", "Consolas", "Monaco", "ui-monospace", monospace';

    function chartTheme() {
        var light = isLightTheme();
        return {
            emphasisText: light ? '#0c1220' : '#f0f6ff',
            mutedText: light ? '#4a5c72' : '#94a3b8',
            shadowAccent: light ? 'rgba(37, 99, 235, 0.2)' : 'rgba(79, 141, 253, 0.28)',
            softText: light ? '#1e3a52' : '#b8c5d6',
            splitLine: light ? 'rgba(59, 78, 104, 0.08)' : 'rgba(226, 232, 240, 0.06)',
            surfaceScale: light
                ? ['#eef6ff', '#93c5fd']
                : ['#1e3a5f', '#2563eb'],
            text: light ? '#0f172a' : '#e2e8f0',
            tooltipBackground: light ? '#ffffff' : '#0f1419',
            tooltipBorder: light ? 'rgba(37, 99, 235, 0.35)' : 'rgba(79, 141, 253, 0.35)',
            tooltipShadow: light
                ? 'box-shadow: 0 24px 48px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(15, 23, 42, 0.06); border-radius: 10px;'
                : 'box-shadow: 0 32px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.08); border-radius: 10px;',
            tooltipText: light ? '#0f172a' : '#e2e8f0',
            axisLine: light ? 'rgba(59, 78, 104, 0.35)' : 'rgba(226, 232, 240, 0.18)',
            crosshairLine: light ? 'rgba(37, 99, 235, 0.55)' : 'rgba(99, 179, 237, 0.6)',
            crosshairLabelBg: light ? 'rgba(255,255,255,0.98)' : 'rgba(15, 20, 25, 0.96)',
            focusBlurOpacity: 0.2,
            dataFont: DATA_FONT,
        };
    }

    function baseTextStyles() {
        var theme = chartTheme();
        return {
            textStyle: { color: theme.text, fontFamily: '"Space Grotesk", "Segoe UI", system-ui, sans-serif' },
            animationDuration: 320,
            animationDurationUpdate: 280,
            animationEasing: 'cubicOut',
        };
    }

    function gridStyles() {
        var theme = chartTheme();
        return {
            axisLine: { lineStyle: { color: theme.axisLine, width: 1 } },
            axisLabel: { color: theme.softText },
            splitLine: { lineStyle: { color: theme.splitLine, width: 1, type: 'solid' } },
        };
    }

    function tooltipStyles() {
        var theme = chartTheme();
        return {
            backgroundColor: theme.tooltipBackground,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            textStyle: {
                color: theme.tooltipText,
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: theme.dataFont ? theme.dataFont : undefined,
            },
            padding: [14, 18],
            extraCssText: theme.tooltipShadow + '; transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); font-variant-numeric: tabular-nums;',
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

    function axisPointerConfig(theme) {
        if (!theme) theme = chartTheme();
        return {
            type: 'cross',
            lineStyle: { color: theme.crosshairLine, width: 1.5, type: 'dashed' },
            crossStyle: { color: theme.crosshairLine, width: 1 },
            label: {
                backgroundColor: theme.crosshairLabelBg != null ? theme.crosshairLabelBg : theme.tooltipBackground,
                borderColor: theme.tooltipBorder,
                borderWidth: 1,
                color: theme.tooltipText,
                fontSize: 11,
                fontFamily: theme.dataFont || undefined,
                padding: [4, 8],
            },
        };
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

    /** Add RBA cash rate change vertical lines to an ECharts option that has a category xAxis of dates. */
    function addRbaMarkLine(option, rbaRows) {
        if (!option || !Array.isArray(rbaRows) || !rbaRows.length) return;
        var xAxis = option.xAxis;
        var data = (xAxis && Array.isArray(xAxis) ? xAxis[0] : xAxis) && (xAxis && Array.isArray(xAxis) ? xAxis[0].data : xAxis.data);
        if (!Array.isArray(data) || !data.length) return;
        var dateSet = {};
        data.forEach(function (d) { dateSet[String(d)] = true; });
        var inRange = rbaRows.filter(function (r) {
            var d = r && r.effective_date != null ? String(r.effective_date) : '';
            return d && dateSet[d];
        });
        if (!inRange.length) return;
        var theme = chartTheme();
        var lineColor = theme.axisLine || 'rgba(148, 163, 184, 0.5)';
        var labelColor = theme.mutedText || '#94a3b8';
        var markLineData = inRange.map(function (r) {
            var rate = Number(r.cash_rate);
            var name = (r.effective_date || '') + '  RBA ' + (Number.isFinite(rate) ? rate.toFixed(2) : '') + '%';
            return { name: name, xAxis: String(r.effective_date) };
        });
        var rbaSeries = {
            name: 'RBA changes',
            type: 'line',
            data: [],
            silent: true,
            symbol: 'none',
            markLine: {
                symbol: 'none',
                lineStyle: { color: lineColor, width: 1.5, type: 'dashed' },
                label: {
                    show: true,
                    position: 'insideEndTop',
                    color: labelColor,
                    fontSize: 10,
                    formatter: function (params) {
                        return params && params.name ? String(params.name) : '';
                    },
                },
                data: markLineData,
            },
        };
        if (!option.series) option.series = [];
        option.series.push(rbaSeries);
    }

    window.AR.chartEchartsHelpers = {
        addRbaMarkLine: addRbaMarkLine,
        axisPointerConfig: axisPointerConfig,
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
