(function () {
    'use strict';

    window.AR = window.AR || {};

    var helpers = window.AR.chartEchartsHelpers || {};
    function fallbackPaletteColor(index) {
        return ['#2563eb', '#d97706', '#059669', '#7c3aed'][index % 4];
    }
    var paletteColor = function (index) {
        if (typeof helpers.paletteColor === 'function') {
            try {
                return helpers.paletteColor(index);
            } catch (_error) {
                return fallbackPaletteColor(index);
            }
        }
        return fallbackPaletteColor(index);
    };
    var chartTheme = helpers.chartTheme || function () {
        return {
            emphasisText: '#e2e8f0',
            mutedText: '#94a3b8',
            softText: '#cbd5e1',
            splitLine: 'rgba(148, 163, 184, 0.16)',
            axisLine: 'rgba(148, 163, 184, 0.24)',
            tooltipBackground: '#0f172a',
            tooltipBorder: 'rgba(148, 163, 184, 0.35)',
            tooltipText: '#e2e8f0',
        };
    };
    var tooltipStyles = helpers.tooltipStyles || function () {
        var theme = chartTheme();
        return {
            backgroundColor: theme.tooltipBackground,
            borderColor: theme.tooltipBorder,
            textStyle: { color: theme.tooltipText },
            extraCssText: 'border-radius:10px;',
        };
    };

    var refs = {
        chart: document.getElementById('forward-pricing-chart'),
        status: document.getElementById('forward-pricing-status'),
        meta: document.getElementById('forward-pricing-meta'),
        table: document.getElementById('forward-pricing-table-body'),
        modeRow: document.getElementById('forward-pricing-mode-row'),
        rba: document.getElementById('forward-pricing-rba'),
        tdSlope: document.getElementById('forward-pricing-td-slope'),
        mortgageSlope: document.getElementById('forward-pricing-mortgage-slope'),
        sample: document.getElementById('forward-pricing-sample'),
    };

    var state = {
        mode: 'spread',
        chart: null,
        model: null,
    };

    function isLocalHost() {
        return /^(localhost|127\.0\.0\.1)$/i.test(String(window.location.hostname || ''));
    }
    function ratesOrigin() {
        var params = new URLSearchParams(window.location.search || '');
        return String(params.get('ratesOrigin') || (isLocalHost() ? 'https://www.australianrates.com' : window.location.origin)).replace(/\/+$/, '');
    }

    function apiUrl(path) {
        return ratesOrigin() + path;
    }
    function getJson(url) {
        return fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(function (response) {
            return response.json().then(function (body) {
                if (!response.ok || !body || body.ok === false) {
                    throw new Error((body && body.error && body.error.message) || ('HTTP ' + response.status));
                }
                return body;
            });
        });
    }

    function latestRows(path, params) {
        var url = new URL(apiUrl(path + '/latest'), window.location.href);
        Object.keys(params || {}).forEach(function (key) {
            if (params[key] != null && params[key] !== '') url.searchParams.set(key, params[key]);
        });
        if (!url.searchParams.has('limit')) url.searchParams.set('limit', '20000');
        return getJson(url.toString()).then(function (body) {
            return Array.isArray(body.rows) ? body.rows : [];
        });
    }

    function fixedMortgageRows() {
        var structures = ['fixed_1yr', 'fixed_2yr', 'fixed_3yr', 'fixed_4yr', 'fixed_5yr'];
        return Promise.all(structures.map(function (structure) {
            return latestRows('/api/home-loan-rates', {
                rate_structure: structure,
                security_purpose: 'owner_occupied',
                repayment_type: 'principal_and_interest',
                min_rate: '0.01',
            });
        })).then(function (sets) {
            return sets.reduce(function (all, rows) { return all.concat(rows); }, []);
        });
    }

    function rbaHistory() {
        return getJson(apiUrl('/api/home-loan-rates/rba/history')).then(function (body) {
            return Array.isArray(body.rows) ? body.rows : [];
        }).catch(function () {
            return [];
        });
    }

    function parseDate(value) {
        var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Math.min(Number(match[3]), 28)));
    }
    function addMonthsYmd(dateText, months) {
        var date = parseDate(dateText);
        if (!date) return '';
        date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
        return date.toISOString().slice(0, 10);
    }
    function termLabel(months) {
        var n = Number(months);
        if (!Number.isFinite(n)) return '';
        if (n % 12 === 0) return String(n / 12) + 'Y';
        return String(n) + 'M';
    }
    function fixedMonths(rateStructure) {
        var match = String(rateStructure || '').match(/^fixed_(\d+)yr$/);
        return match ? Number(match[1]) * 12 : null;
    }
    function quantile(sorted, q) {
        if (!sorted.length) return null;
        if (sorted.length === 1) return sorted[0];
        var position = (sorted.length - 1) * q;
        var base = Math.floor(position);
        var next = Math.min(sorted.length - 1, base + 1);
        return sorted[base] + (sorted[next] - sorted[base]) * (position - base);
    }
    function summarizeBucket(bucket) {
        var values = bucket.values.sort(function (a, b) { return a - b; });
        var banks = Object.keys(bucket.banks);
        return {
            key: bucket.key,
            market: bucket.market,
            label: bucket.label,
            months: bucket.months,
            maturityDate: bucket.maturityDate,
            snapshotDate: bucket.snapshotDate,
            min: values[0],
            q1: quantile(values, 0.25),
            median: quantile(values, 0.5),
            q3: quantile(values, 0.75),
            max: values[values.length - 1],
            rowCount: values.length,
            bankCount: banks.length,
        };
    }
    function addBucket(map, input) {
        if (!input.maturityDate || !Number.isFinite(input.value)) return;
        var key = input.market + '|' + input.months;
        if (!map[key]) {
            map[key] = {
                key: key,
                market: input.market,
                label: input.label,
                months: input.months,
                maturityDate: input.maturityDate,
                snapshotDate: input.snapshotDate,
                values: [],
                banks: {},
            };
        }
        map[key].values.push(input.value);
        map[key].banks[input.bankName || 'Unknown bank'] = true;
    }
    function buildCurve(rows, market) {
        var buckets = {};
        rows.forEach(function (row) {
            var snapshotDate = String(row.collection_date || '');
            var value = Number(row.interest_rate);
            var months = market === 'td' ? Number(row.term_months) : fixedMonths(row.rate_structure);
            if (!snapshotDate || !Number.isFinite(value) || !Number.isFinite(months) || months <= 0) return;
            if (market === 'mortgage') {
                if (String(row.security_purpose || '') !== 'owner_occupied') return;
                if (String(row.repayment_type || '') !== 'principal_and_interest') return;
            }
            addBucket(buckets, {
                market: market,
                label: market === 'td' ? ('TD ' + termLabel(months)) : ('Fixed mortgage ' + termLabel(months)),
                months: months,
                maturityDate: addMonthsYmd(snapshotDate, months),
                snapshotDate: snapshotDate,
                value: value,
                bankName: String(row.bank_name || ''),
            });
        });
        var curve = Object.keys(buckets).map(function (key) {
            return summarizeBucket(buckets[key]);
        }).filter(function (bucket) {
            return Number.isFinite(bucket.median);
        }).sort(function (left, right) {
            return left.months - right.months;
        });
        var base = curve[0] || null;
        curve.forEach(function (bucket) {
            bucket.spreadBp = base ? (bucket.median - base.median) * 100 : 0;
            bucket.q1SpreadBp = base ? (bucket.q1 - base.median) * 100 : 0;
            bucket.q3SpreadBp = base ? (bucket.q3 - base.median) * 100 : 0;
        });
        return curve;
    }

    function latestRba(rows) {
        var latest = null;
        (rows || []).forEach(function (row) {
            var rate = Number(row.cash_rate);
            var date = String(row.effective_date || '');
            if (!Number.isFinite(rate) || !date) return;
            if (!latest || date > latest.effectiveDate) latest = { effectiveDate: date, cashRate: rate };
        });
        return latest;
    }

    function slope(curve) {
        if (!curve || curve.length < 2) return null;
        return curve[curve.length - 1].spreadBp;
    }

    function formatRate(value) {
        return Number(value).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
    }

    function formatBp(value) {
        if (!Number.isFinite(Number(value))) return 'n/a';
        var n = Math.round(Number(value));
        return (n > 0 ? '+' : '') + n + ' bps';
    }

    function dateLabel(value) {
        var date = parseDate(value);
        if (!date) return String(value || '');
        return date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }

    function fullDateLabel(value) {
        var date = parseDate(value);
        if (!date) return String(value || '');
        return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }

    function metricValue(bucket) {
        return state.mode === 'rate' ? bucket.median : bucket.spreadBp;
    }

    function iqrLow(bucket) {
        return state.mode === 'rate' ? bucket.q1 : bucket.q1SpreadBp;
    }

    function iqrHigh(bucket) {
        return state.mode === 'rate' ? bucket.q3 : bucket.q3SpreadBp;
    }

    function tooltip(params) {
        var rows = Array.isArray(params) ? params : [params];
        var lines = [];
        rows.forEach(function (entry) {
            var bucket = entry && entry.data && entry.data.bucket;
            if (!bucket || entry.seriesName.indexOf('IQR') >= 0 || entry.seriesName.indexOf('base') >= 0) return;
            lines.push(
                '<strong>' + bucket.label + '</strong><br>' +
                'Snapshot date: ' + fullDateLabel(bucket.snapshotDate) + '<br>' +
                'Maturity date: ' + fullDateLabel(bucket.maturityDate) + '<br>' +
                'Term: ' + termLabel(bucket.months) + '<br>' +
                'Curve type: ' + (bucket.market === 'td' ? 'Term deposit' : 'Fixed mortgage') + '<br>' +
                'Median rate: ' + formatRate(bucket.median) + '<br>' +
                'Spread vs shortest maturity: ' + formatBp(bucket.spreadBp) + '<br>' +
                'IQR: ' + formatRate(bucket.q1) + ' to ' + formatRate(bucket.q3) + '<br>' +
                'Banks: ' + bucket.bankCount + ' | Rows: ' + bucket.rowCount
            );
        });
        return lines.join('<hr>');
    }

    function bandSeries(name, curve, color) {
        return [
            {
                name: name + ' IQR base',
                type: 'line',
                silent: true,
                symbol: 'none',
                stack: name + 'Iqr',
                lineStyle: { opacity: 0 },
                areaStyle: { opacity: 0 },
                data: curve.map(function (bucket) { return [bucket.maturityDate, iqrLow(bucket)]; }),
            },
            {
                name: name + ' IQR',
                type: 'line',
                symbol: 'none',
                stack: name + 'Iqr',
                lineStyle: { opacity: 0 },
                areaStyle: { color: color, opacity: 0.12 },
                data: curve.map(function (bucket) { return [bucket.maturityDate, iqrHigh(bucket) - iqrLow(bucket)]; }),
            },
        ];
    }

    function lineSeries(name, curve, color) {
        return {
            name: name,
            type: 'line',
            smooth: 0.18,
            showSymbol: true,
            symbolSize: 7,
            lineStyle: { color: color, width: 3 },
            itemStyle: { color: color },
            emphasis: { focus: 'series' },
            data: curve.map(function (bucket) {
                return { value: [bucket.maturityDate, metricValue(bucket)], bucket: bucket };
            }),
        };
    }

    function buildModel(payloads) {
        var tdCurve = buildCurve(payloads.tdRows, 'td');
        var mortgageCurve = buildCurve(payloads.mortgageRows, 'mortgage');
        return {
            tdCurve: tdCurve,
            mortgageCurve: mortgageCurve,
            rba: latestRba(payloads.rbaRows),
            totalRows: payloads.tdRows.length + payloads.mortgageRows.length,
        };
    }

    function renderStats(model) {
        if (refs.rba) refs.rba.textContent = model.rba ? formatRate(model.rba.cashRate) : 'n/a';
        if (refs.tdSlope) refs.tdSlope.textContent = formatBp(slope(model.tdCurve));
        if (refs.mortgageSlope) refs.mortgageSlope.textContent = formatBp(slope(model.mortgageCurve));
        if (refs.sample) refs.sample.textContent = model.totalRows.toLocaleString('en-AU');
        if (!refs.table) return;
        var rows = model.tdCurve.concat(model.mortgageCurve).sort(function (left, right) {
            return left.months - right.months || left.market.localeCompare(right.market);
        }).map(function (bucket) {
            var tr = document.createElement('tr');
            [
                bucket.label,
                dateLabel(bucket.maturityDate),
                formatRate(bucket.median),
                formatBp(bucket.spreadBp),
                String(bucket.bankCount),
                String(bucket.rowCount),
            ].forEach(function (value) {
                var td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });
            return tr;
        });
        refs.table.replaceChildren.apply(refs.table, rows);
    }

    function renderChart() {
        if (!window.echarts || !refs.chart || !state.model) return;
        if (!state.chart) state.chart = window.echarts.init(refs.chart);
        var theme = chartTheme();
        var tdColor = paletteColor(0);
        var mortgageColor = paletteColor(1);
        var series = []
            .concat(bandSeries('TD', state.model.tdCurve, tdColor))
            .concat(bandSeries('Fixed mortgage', state.model.mortgageCurve, mortgageColor))
            .concat([
                lineSeries('TD median', state.model.tdCurve, tdColor),
                lineSeries('Fixed mortgage median', state.model.mortgageCurve, mortgageColor),
            ]);
        if (state.mode === 'spread') {
            series.push({
                name: 'Near-term baseline',
                type: 'line',
                symbol: 'none',
                lineStyle: { color: theme.mutedText, type: 'dashed', width: 1.5 },
                data: state.model.tdCurve.concat(state.model.mortgageCurve).map(function (bucket) {
                    return [bucket.maturityDate, 0];
                }),
            });
        } else if (state.model.rba) {
            series.push({
                name: 'Current RBA',
                type: 'line',
                symbol: 'none',
                lineStyle: { color: theme.mutedText, type: 'dashed', width: 1.5 },
                data: state.model.tdCurve.concat(state.model.mortgageCurve).map(function (bucket) {
                    return [bucket.maturityDate, state.model.rba.cashRate];
                }),
            });
        }
        state.chart.setOption({
            animation: false,
            backgroundColor: 'transparent',
            textStyle: { color: theme.softText, fontFamily: '"Space Grotesk", "Segoe UI", system-ui, sans-serif' },
            color: [tdColor, mortgageColor],
            legend: { bottom: 0, type: 'scroll', textStyle: { color: theme.mutedText, fontSize: 11 } },
            tooltip: Object.assign({
                trigger: 'axis',
                confine: true,
                transitionDuration: 0,
                formatter: tooltip,
            }, tooltipStyles()),
            grid: { left: 54, right: 18, top: 18, bottom: 70, containLabel: true },
            xAxis: {
                type: 'time',
                name: 'Maturity date',
                nameLocation: 'middle',
                nameGap: 34,
                nameTextStyle: { color: theme.mutedText },
                axisLine: { lineStyle: { color: theme.axisLine } },
                splitLine: { show: false },
                axisLabel: { color: theme.mutedText, formatter: dateLabel },
            },
            yAxis: {
                type: 'value',
                scale: true,
                name: state.mode === 'rate' ? 'Median rate' : 'Spread vs shortest maturity',
                nameTextStyle: { color: theme.mutedText },
                axisLine: { lineStyle: { color: theme.axisLine } },
                splitLine: { lineStyle: { color: theme.splitLine } },
                axisLabel: {
                    color: theme.softText,
                    formatter: function (value) {
                        return state.mode === 'rate' ? Number(value).toFixed(1) + '%' : formatBp(value);
                    },
                },
            },
            series: series,
        }, true);
        state.chart.resize();
        if (refs.meta) {
            refs.meta.textContent = state.mode === 'rate'
                ? 'Median rate by maturity date; dashed line is current RBA cash rate.'
                : 'Spread in basis points versus each market shortest maturity.';
        }
    }

    function setStatus(text) {
        if (refs.status) refs.status.textContent = text;
    }

    function load() {
        if (!refs.chart) {
            setStatus('Unavailable');
            if (refs.meta) refs.meta.textContent = 'Forward pricing chart container unavailable.';
            return;
        }
        setStatus('Loading...');
        Promise.all([
            latestRows('/api/term-deposit-rates', { min_rate: '0.01' }),
            fixedMortgageRows(),
            rbaHistory(),
        ]).then(function (parts) {
            state.model = buildModel({ tdRows: parts[0], mortgageRows: parts[1], rbaRows: parts[2] });
            renderStats(state.model);
            renderChart();
            setStatus('Ready');
        }).catch(function (error) {
            setStatus('Error');
            if (refs.meta) refs.meta.textContent = error && error.message ? error.message : 'Forward pricing data unavailable.';
        });
    }

    function bind() {
        if (refs.modeRow) {
            refs.modeRow.addEventListener('click', function (event) {
                var button = event.target.closest('[data-forward-mode]');
                if (!button) return;
                state.mode = button.getAttribute('data-forward-mode') || 'spread';
                Array.from(refs.modeRow.querySelectorAll('[data-forward-mode]')).forEach(function (node) {
                    node.classList.toggle('active', node === button);
                });
                renderChart();
            });
        }
        window.addEventListener('resize', function () {
            if (state.chart) state.chart.resize();
        });
        window.addEventListener('ar:theme-changed', renderChart);
    }

    window.AR.forwardPricing = {
        load: load,
        getModel: function () { return state.model; },
    };

    bind();
    load();
})();
