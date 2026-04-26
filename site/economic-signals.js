(function () {
    'use strict';

    window.AR = window.AR || {};

    function createSignalDashboard(deps) {
        var state = deps.state;
        var refs = deps.refs;
        var esc = deps.esc;
        var formatSigned = deps.formatSigned;
        var formatNumber = deps.formatNumber;
        var formatDate = deps.formatDate;
        var fetchJson = deps.fetchJson;
        var describeError = deps.describeError;
        var logEvent = deps.logEvent;
        var ensureLegendStackEl = deps.ensureLegendStackEl;
        var syncYScaleButton = deps.syncYScaleButton;

        function signalScoreClass(value) {
            var n = Number(value);
            if (!Number.isFinite(n) || n === 0) return '';
            return n > 0 ? 'score-pos' : 'score-neg';
        }

        function freshnessLabel(component) {
            var rows = (component && component.freshness) || [];
            if (!rows.length) return 'n/a';
            var stale = rows.some(function (row) {
                return row && row.status && row.status !== 'ok' && row.status !== 'derived';
            });
            var latest = rows.map(function (row) { return row.last_observation_date; }).filter(Boolean).sort().slice(-1)[0] || '';
            return (stale ? '<span class="economic-stale-chip">stale</span> ' : '') + esc(latest || 'n/a');
        }

        function renderSignals() {
            var signal = state.signal;
            if (!signal) return;
            if (refs.signalBias) refs.signalBias.textContent = String(signal.overall_bias || 'hold').toUpperCase() + ' ' + formatSigned(signal.overall_score, '');
            if (refs.signalMarket) refs.signalMarket.textContent = formatSigned(signal.market_expected_change_bps, 'bp');
            if (refs.signalCash) refs.signalCash.textContent = signal.cash_rate == null ? 'n/a' : formatNumber(signal.cash_rate) + '%';
            if (refs.signalInflation) refs.signalInflation.textContent = formatSigned(signal.inflation_gap_pp, 'pp');
            if (refs.signalLabour) refs.signalLabour.textContent = formatSigned(signal.labour_slack, '');
            if (refs.signalWages) refs.signalWages.textContent = formatSigned(signal.wage_pressure, '');
            if (refs.signalUpdated) refs.signalUpdated.textContent = formatDate(signal.generated_at);
            if (!refs.componentBody) return;
            refs.componentBody.innerHTML = (signal.components || []).map(function (row) {
                return '<tr>' +
                    '<td>' + esc(row.label || row.key) + '</td>' +
                    '<td>' + esc(formatSigned(row.value, '')) + '</td>' +
                    '<td>' + esc(formatSigned(row.change, '')) + '</td>' +
                    '<td class="' + signalScoreClass(row.score) + '">' + esc(formatSigned(row.score, '')) + '</td>' +
                    '<td>' + freshnessLabel(row) + '</td>' +
                '</tr>';
            }).join('');
        }

        function loadSignals(onChartReady) {
            return fetchJson('/signals').then(function (payload) {
                state.signal = payload;
                renderSignals();
                if (state.chartMode === 'signal' && state.chart && typeof onChartReady === 'function') onChartReady();
            }).catch(function (error) {
                logEvent('warn', 'Economic signals load failed', {
                    message: describeError(error, 'Failed to load RBA signals.'),
                    status: error && error.status,
                }, { remote: true });
            });
        }

        function renderSignalChart(chart, options) {
            var theme = options.theme;
            var styles = options.styles;
            var narrow = options.narrow;
            var legendEl = ensureLegendStackEl();
            if (legendEl) legendEl.innerHTML = '';
            var signalRows = ((state.signal && state.signal.components) || []).filter(function (row) {
                return row.score != null;
            });
            var rowLabels = signalRows.map(function (row) { return row.label; });
            chart.setOption({
                animation: false,
                textStyle: { color: theme.text, fontFamily: '"Space Grotesk", "Segoe UI", system-ui, sans-serif' },
                backgroundColor: 'transparent',
                color: options.palette,
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'shadow' },
                    confine: true,
                    formatter: function (params) {
                        var entry = Array.isArray(params) ? params[0] : params;
                        var row = signalRows[entry && entry.dataIndex] || {};
                        return '<strong>' + esc(row.label || row.key || '') + '</strong><br>' +
                            'Score: ' + esc(formatSigned(row.score, '')) + '<br>' +
                            'Value: ' + esc(formatSigned(row.value, '')) + '<br>' +
                            'Change: ' + esc(formatSigned(row.change, '')) + '<br>' +
                            'Freshness: ' + freshnessLabel(row);
                    }
                },
                grid: { left: narrow ? 96 : 132, right: narrow ? 28 : 42, top: 16, bottom: 28, containLabel: true },
                xAxis: {
                    type: 'value',
                    min: -2,
                    max: 2,
                    axisLine: styles.axisLine,
                    axisLabel: { color: theme.mutedText, fontSize: narrow ? 10 : 11 },
                    splitLine: { show: true, lineStyle: styles.splitLine.lineStyle },
                },
                yAxis: {
                    type: 'category',
                    data: rowLabels,
                    axisLine: styles.axisLine,
                    axisTick: { show: false },
                    axisLabel: { color: theme.mutedText, fontSize: narrow ? 9 : 11, width: narrow ? 82 : 120, overflow: 'truncate' },
                },
                series: [{
                    name: 'Pressure score',
                    type: 'bar',
                    barMaxWidth: narrow ? 18 : 26,
                    data: signalRows.map(function (row) { return row.score; }),
                    label: {
                        show: true,
                        position: 'right',
                        color: theme.softText,
                        fontWeight: 700,
                        formatter: function (params) { return formatSigned(params.value, ''); }
                    },
                    itemStyle: {
                        borderRadius: [4, 4, 4, 4],
                        color: function (params) {
                            var value = Number(params.value);
                            return value > 0 ? '#d95f02' : (value < 0 ? '#1b9e77' : '#7570b3');
                        }
                    },
                    markLine: {
                        symbol: 'none',
                        silent: true,
                        lineStyle: { color: theme.axisLine, width: 1, type: 'dashed' },
                        data: [{ xAxis: 0 }]
                    }
                }]
            }, true);
            syncYScaleButton({ effectiveYAxis: 'value' });
            if (refs.chartMeta) refs.chartMeta.textContent = 'Policy pressure by component; left = easier, right = tighter.';
        }

        return {
            loadSignals: loadSignals,
            renderSignalChart: renderSignalChart,
            renderSignals: renderSignals
        };
    }

    window.AR.economicSignals = { create: createSignalDashboard };
})();
