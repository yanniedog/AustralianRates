/**
 * Economic Report chart for the Savings section.
 *
 * Renders a narrative time-series chart showing:
 *  - Best savings rate per bank (stepped line per bank)
 *  - RBA cash rate (thick stepped line, amber)
 *  - CPI inflation (quarterly, dashed line + subtle area fill)
 *  - Vertical markers at every RBA decision date
 *  - markPoints for the most significant bank rate moves
 *  - Rich cross-axis tooltip with real-return calculation
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    // ─── Embedded CPI data ────────────────────────────────────────────────────
    // Source: ABS 6401.0 Consumer Price Index – All Groups, Weighted Average
    // of Eight Capital Cities (annual % change, quarterly release).
    // Values from 2025 onwards are estimates based on RBA projections.
    var ABS_CPI = [
        { date: '2021-01-01', value: 1.1 },
        { date: '2021-04-01', value: 3.8 },
        { date: '2021-07-01', value: 3.0 },
        { date: '2021-10-01', value: 3.5 },
        { date: '2022-01-01', value: 5.1 },
        { date: '2022-04-01', value: 6.1 },
        { date: '2022-07-01', value: 6.1 },
        { date: '2022-10-01', value: 7.3 },
        { date: '2023-01-01', value: 7.8 }, // peak
        { date: '2023-04-01', value: 7.0 },
        { date: '2023-07-01', value: 6.0 },
        { date: '2023-10-01', value: 5.4 },
        { date: '2024-01-01', value: 4.1 },
        { date: '2024-04-01', value: 3.6 },
        { date: '2024-07-01', value: 3.8 },
        { date: '2024-10-01', value: 2.8 },
        { date: '2025-01-01', value: 2.4 },
        { date: '2025-04-01', value: 2.7 }, // est.
        { date: '2025-07-01', value: 2.9 }, // est.
        { date: '2025-10-01', value: 2.8 }, // est.
        { date: '2026-01-01', value: 2.6 }, // est.
    ];

    // ─── Bank short names ─────────────────────────────────────────────────────
    var BANK_SHORT = {
        'commonwealth bank of australia': 'CBA',
        'westpac banking corporation': 'Westpac',
        'anz': 'ANZ',
        'national australia bank': 'NAB',
        'macquarie bank': 'Macquarie',
        'ing': 'ING',
        'ubank': 'UBank',
        'bankwest': 'Bankwest',
        'bank of queensland': 'BOQ',
        'suncorp bank': 'Suncorp',
        'great southern bank': 'GSB',
        'amp bank': 'AMP',
        'bendigo and adelaide bank': 'Bendigo',
        'bank of melbourne': 'BoM',
        'st. george bank': 'St.George',
        'hsbc australia': 'HSBC',
    };

    // ─── Brand colours ────────────────────────────────────────────────────────
    // Pulled from ar-chart-config.js BANK_ACCENT_COLORS; duplicated here so
    // the economic report can run without depending on chartConfig internals.
    var BANK_COLOR = {
        'commonwealth bank of australia': '#e8b400',
        'westpac banking corporation': '#d50032',
        'anz': '#0033a0',
        'national australia bank': '#8a1538',
        'macquarie bank': '#006d5b',
        'ing': '#ff6200',
        'ubank': '#7d3e84',
        'bankwest': '#5a9e2f',
        'bank of queensland': '#00a3e0',
        'suncorp bank': '#1b365d',
        'great southern bank': '#00a651',
        'amp bank': '#e06400',
        'bendigo and adelaide bank': '#a6192e',
        'bank of melbourne': '#6b1f3a',
        'st. george bank': '#e60012',
        'hsbc australia': '#cc0000',
    };
    // Fallback palette for unlisted banks
    var FALLBACK_PALETTE = ['#4f8dfd', '#27c27a', '#f0b90b', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

    function bankShortName(name) {
        var key = String(name || '').trim().toLowerCase();
        return BANK_SHORT[key] || String(name || '').slice(0, 12);
    }

    function bankColor(name, fallbackIndex) {
        var key = String(name || '').trim().toLowerCase();
        if (BANK_COLOR[key]) return BANK_COLOR[key];
        return FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
    }

    // ─── Theme ────────────────────────────────────────────────────────────────
    function isDark() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    }

    function getTheme() {
        var dark = isDark();
        return {
            text:         dark ? '#e2e8f0' : '#0f172a',
            mutedText:    dark ? '#94a3b8' : '#64748b',
            softText:     dark ? '#cbd5e1' : '#334155',
            grid:         dark ? 'rgba(148,163,184,0.09)' : 'rgba(148,163,184,0.18)',
            axisLine:     dark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.40)',
            rbaColor:     '#f59e0b',
            rbaBand:      dark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)',
            cpiColor:     dark ? '#f87171' : '#dc2626',
            cpiArea:      dark ? 'rgba(248,113,113,0.08)' : 'rgba(220,38,38,0.06)',
            tooltipBg:    dark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.97)',
            tooltipBorder:dark ? 'rgba(100,116,139,0.35)' : 'rgba(100,116,139,0.25)',
            tooltipText:  dark ? '#e2e8f0' : '#1e293b',
            positiveReal: dark ? '#34d399' : '#059669',
            negativeReal: dark ? '#f87171' : '#dc2626',
        };
    }

    // ─── Date helpers ─────────────────────────────────────────────────────────
    function fmtDateFull(value) {
        var s = String(value || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var p = s.split('-');
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
    }

    function fmtDateShort(value) {
        // ECharts time-axis value can be number (timestamp) or string
        var d = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value).slice(0, 10) + 'T12:00:00Z');
        if (isNaN(d.getTime())) return String(value || '').slice(0, 10);
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[d.getUTCMonth()] + ' \'' + String(d.getUTCFullYear()).slice(2);
    }

    // ─── Data aggregation ─────────────────────────────────────────────────────

    /**
     * Aggregate visibleSeries by bank → best (max) rate per bank per date.
     * Returns [{bankName, shortName, color, index, latestValue, points:[{date,value}]}]
     * sorted by latestValue descending (highest rate saver first).
     */
    function buildBankSeries(visibleSeries) {
        if (!Array.isArray(visibleSeries) || !visibleSeries.length) return [];

        var byBank = {};
        visibleSeries.forEach(function (series) {
            var bank = String(series.bankName || '').trim();
            if (!bank) return;
            var key = bank.toLowerCase();
            if (!byBank[key]) byBank[key] = { bankName: bank, byDate: {} };
            series.points.forEach(function (pt) {
                var d = String(pt.date || '');
                var v = Number(pt.value);
                if (!d || !Number.isFinite(v)) return;
                if (byBank[key].byDate[d] == null || v > byBank[key].byDate[d]) {
                    byBank[key].byDate[d] = v;
                }
            });
        });

        var banks = Object.keys(byBank).map(function (key) {
            var entry = byBank[key];
            var dates = Object.keys(entry.byDate).sort();
            var points = dates.map(function (d) { return { date: d, value: entry.byDate[d] }; });
            var latestValue = points.length ? points[points.length - 1].value : 0;
            return { bankName: entry.bankName, points: points, latestValue: latestValue };
        });

        // Best rate first
        banks.sort(function (a, b) { return b.latestValue - a.latestValue; });

        return banks.map(function (bank, index) {
            bank.shortName = bankShortName(bank.bankName);
            bank.color = bankColor(bank.bankName, index);
            bank.index = index;
            return bank;
        });
    }

    /**
     * Build RBA cash rate step series from rbaHistory rows.
     * rbaHistory is [{effective_date, cash_rate}, ...]
     * Returns [[dateString, rate], ...] sorted ascending.
     */
    function buildRbaSeries(rbaHistory, dateMin, dateMax) {
        if (!Array.isArray(rbaHistory) || !rbaHistory.length) return [];
        return rbaHistory
            .map(function (r) {
                var d = String(r.effective_date || r.date || '').slice(0, 10);
                var v = Number(r.cash_rate != null ? r.cash_rate : r.value);
                return [d, v];
            })
            .filter(function (pt) {
                if (!pt[0] || !Number.isFinite(pt[1])) return false;
                if (dateMin && pt[0] < dateMin) return false;
                if (dateMax && pt[0] > dateMax) return false;
                return true;
            })
            .sort(function (a, b) { return a[0].localeCompare(b[0]); });
    }

    /**
     * Build CPI series filtered to chart date range.
     * Returns [[dateString, cpiRate], ...] (quarterly).
     */
    function buildCpiSeries(dateMin, dateMax) {
        // Extend range slightly so the step line reaches into view
        var extMin = dateMin ? dateMin.slice(0, 7) + '-01' : null;
        var extMax = dateMax;
        return ABS_CPI
            .filter(function (e) {
                if (extMin && e.date < extMin) {
                    // Include one entry before range so the step has context
                    return ABS_CPI.indexOf(e) === ABS_CPI.length - 1 ||
                        ABS_CPI[ABS_CPI.indexOf(e) + 1].date >= extMin;
                }
                if (extMax && e.date > extMax) return false;
                return true;
            })
            .map(function (e) { return [e.date, e.value]; });
    }

    /**
     * Find the top N most significant rate changes across all bank series.
     * Returns [{date, bankShortName, color, change, value}] sorted by |change| desc.
     */
    function findSignificantMoves(bankSeries, n) {
        var threshold = 0.15; // minimum % change to annotate
        var moves = [];
        bankSeries.forEach(function (bank) {
            var pts = bank.points;
            for (var i = 1; i < pts.length; i++) {
                var delta = pts[i].value - pts[i - 1].value;
                if (Math.abs(delta) >= threshold) {
                    moves.push({
                        date: pts[i].date,
                        bankShortName: bank.shortName,
                        color: bank.color,
                        change: delta,
                        value: pts[i].value,
                    });
                }
            }
        });
        moves.sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); });
        // Deduplicate: keep max one annotation per date
        var seenDates = {};
        return moves.filter(function (m) {
            if (seenDates[m.date]) return false;
            seenDates[m.date] = true;
            return true;
        }).slice(0, n || 6);
    }

    // ─── Axis helpers ─────────────────────────────────────────────────────────

    function computeYRange(bankSeries, rbaSeries, cpiSeries) {
        var lo = Infinity, hi = -Infinity;
        function touch(v) {
            if (!Number.isFinite(v)) return;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        bankSeries.forEach(function (b) { b.points.forEach(function (p) { touch(p.value); }); });
        rbaSeries.forEach(function (p) { touch(p[1]); });
        cpiSeries.forEach(function (p) { touch(p[1]); });
        if (!Number.isFinite(lo)) lo = 0;
        if (!Number.isFinite(hi)) hi = 6;
        if (lo === hi) { lo -= 0.5; hi += 0.5; }
        var pad = Math.max((hi - lo) * 0.14, 0.3);
        return { min: Math.max(0, lo - pad), max: hi + pad };
    }

    // ─── Main option builder ──────────────────────────────────────────────────

    function buildOption(model, fields, size, rbaHistory) {
        var th = getTheme();
        var narrow = size && size.width < 720;
        var compact = size && size.width < 440;

        var visibleSeries = (model && model.visibleSeries) ? model.visibleSeries : [];
        var bankSeries = buildBankSeries(visibleSeries);

        // Date range from bank data
        var dateMin = null, dateMax = null;
        bankSeries.forEach(function (b) {
            b.points.forEach(function (p) {
                if (!dateMin || p.date < dateMin) dateMin = p.date;
                if (!dateMax || p.date > dateMax) dateMax = p.date;
            });
        });

        var rbaSeries = buildRbaSeries(rbaHistory || [], dateMin, dateMax);
        var cpiSeries = buildCpiSeries(dateMin, dateMax);
        var yRange = computeYRange(bankSeries, rbaSeries, cpiSeries);

        // Limit banks shown for readability
        var maxBanks = compact ? 5 : (narrow ? 7 : 10);
        var visibleBanks = bankSeries.slice(0, maxBanks);

        var significantMoves = compact ? [] : findSignificantMoves(visibleBanks, narrow ? 3 : 6);

        // ── Build ECharts series array ─────────────────────────────────────

        var series = [];

        // 1. RBA vertical decision lines – attached to a ghost series so they
        //    span the full chart height independent of the RBA step data.
        if (rbaSeries.length > 1 && !compact) {
            var rbaMarkLines = rbaSeries.map(function (pt, i) {
                var prevRate = i > 0 ? rbaSeries[i - 1][1] : null;
                var change = prevRate != null ? pt[1] - prevRate : null;
                var dir = change == null ? '' : (change > 0 ? '↑' : (change < 0 ? '↓' : '→'));
                var label = 'RBA ' + Number(pt[1]).toFixed(2) + '%' + (dir ? ' ' + dir : '');
                return {
                    xAxis: pt[0],
                    lineStyle: { color: th.rbaBand ? 'rgba(245,158,11,0.28)' : 'rgba(245,158,11,0.22)', width: 1.5, type: 'dashed' },
                    label: {
                        show: !narrow,
                        position: 'insideEndBottom',
                        formatter: label,
                        color: th.rbaColor,
                        fontSize: 9,
                        fontWeight: 600,
                        distance: 4,
                        rotate: -90,
                        padding: [2, 3],
                        backgroundColor: isDark() ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.75)',
                        borderRadius: 2,
                    },
                };
            });
            series.push({
                name: '_rba_markers',
                type: 'line',
                data: [],
                symbol: 'none',
                lineStyle: { opacity: 0 },
                z: 1,
                markLine: {
                    silent: true,
                    animation: false,
                    symbol: ['none', 'none'],
                    data: rbaMarkLines,
                },
            });
        }

        // 2. CPI inflation area + line
        if (cpiSeries.length) {
            series.push({
                name: 'CPI Inflation',
                type: 'line',
                step: 'end',
                data: cpiSeries,
                lineStyle: { color: th.cpiColor, width: narrow ? 1.5 : 2, type: 'dashed' },
                itemStyle: { color: th.cpiColor },
                symbol: 'circle',
                symbolSize: compact ? 3 : 5,
                areaStyle: { color: th.cpiArea, origin: 'start' },
                emphasis: { focus: 'series', lineStyle: { width: 2.5 } },
                z: 2,
            });
        }

        // 3. RBA cash rate – bold step line
        if (rbaSeries.length) {
            series.push({
                name: 'RBA Cash Rate',
                type: 'line',
                step: 'end',
                data: rbaSeries,
                lineStyle: { color: th.rbaColor, width: compact ? 2 : 3, type: 'solid' },
                itemStyle: { color: th.rbaColor },
                symbol: 'diamond',
                symbolSize: compact ? 4 : 6,
                emphasis: { focus: 'series', lineStyle: { width: 4 } },
                z: 5,
            });
        }

        // 4. Bank savings rate step lines
        visibleBanks.forEach(function (bank) {
            var data = bank.points.map(function (p) { return [p.date, p.value]; });
            // Mark the top significant moves for this bank
            var myMoves = significantMoves.filter(function (m) { return m.bankShortName === bank.shortName; });
            var markPointData = myMoves.map(function (m) {
                var dir = m.change > 0 ? '↑' : '↓';
                return {
                    coord: [m.date, m.value],
                    symbol: 'circle',
                    symbolSize: 10,
                    itemStyle: { color: bank.color, borderColor: isDark() ? '#1e293b' : '#ffffff', borderWidth: 2 },
                    label: {
                        show: !narrow,
                        formatter: dir + Math.abs(m.change).toFixed(2) + '%',
                        position: m.change > 0 ? 'top' : 'bottom',
                        color: bank.color,
                        fontSize: 9,
                        fontWeight: 700,
                        distance: 8,
                        padding: [2, 4],
                        backgroundColor: isDark() ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.9)',
                        borderRadius: 3,
                    },
                };
            });

            series.push({
                name: bank.shortName,
                type: 'line',
                step: 'end',
                data: data,
                lineStyle: { color: bank.color, width: compact ? 1.5 : 2, type: 'solid' },
                itemStyle: { color: bank.color },
                symbol: 'none',
                emphasis: { focus: 'series', lineStyle: { width: 3 } },
                z: 3,
                markPoint: markPointData.length ? {
                    animation: false,
                    data: markPointData,
                } : undefined,
            });
        });

        // ── Legend ────────────────────────────────────────────────────────────

        var legendData = visibleBanks.map(function (b) {
            return {
                name: b.shortName,
                itemStyle: { color: b.color },
                lineStyle: { color: b.color, width: 2 },
            };
        });
        if (rbaSeries.length) {
            legendData.unshift({
                name: 'RBA Cash Rate',
                itemStyle: { color: th.rbaColor },
                lineStyle: { color: th.rbaColor, width: 3 },
            });
        }
        if (cpiSeries.length) {
            legendData.unshift({
                name: 'CPI Inflation',
                itemStyle: { color: th.cpiColor },
                lineStyle: { color: th.cpiColor, width: 2, type: 'dashed' },
            });
        }

        // ── Tooltip ───────────────────────────────────────────────────────────

        var tooltipFormatter = function (params) {
            if (!Array.isArray(params) || !params.length) return '';
            var entries = params.filter(function (p) {
                return p.seriesName && p.seriesName.charAt(0) !== '_' && p.value != null;
            });
            if (!entries.length) return '';

            var rawDate = Array.isArray(entries[0].value) ? entries[0].value[0] : entries[0].axisValue;
            var dateLabel = fmtDateFull(typeof rawDate === 'number'
                ? new Date(rawDate).toISOString().slice(0, 10)
                : String(rawDate).slice(0, 10));

            var cpiEntry = entries.find(function (e) { return e.seriesName === 'CPI Inflation'; });
            var rbaEntry = entries.find(function (e) { return e.seriesName === 'RBA Cash Rate'; });
            var cpiVal = cpiEntry ? Number(Array.isArray(cpiEntry.value) ? cpiEntry.value[1] : cpiEntry.value) : null;
            var rbaVal = rbaEntry ? Number(Array.isArray(rbaEntry.value) ? rbaEntry.value[1] : rbaEntry.value) : null;
            var bankEntries = entries.filter(function (e) {
                return e.seriesName !== 'CPI Inflation' && e.seriesName !== 'RBA Cash Rate';
            });

            var sep = '<div style="border-top:1px solid rgba(148,163,184,0.18);margin:5px 0 4px;"></div>';
            var lines = [
                '<div style="font-size:10.5px;color:' + th.mutedText + ';letter-spacing:0.03em;margin-bottom:5px;">' + dateLabel + '</div>',
            ];

            bankEntries.forEach(function (entry) {
                var val = Number(Array.isArray(entry.value) ? entry.value[1] : entry.value);
                if (!Number.isFinite(val)) return;
                var realStr = '';
                if (cpiVal != null && Number.isFinite(cpiVal)) {
                    var real = val - cpiVal;
                    var realColor = real >= 0 ? th.positiveReal : th.negativeReal;
                    var realLabel = real >= 0 ? 'beats CPI by ' : 'below CPI by ';
                    realStr = '<span style="color:' + realColor + ';font-size:10px;margin-left:5px;">'
                        + realLabel + Math.abs(real).toFixed(2) + '%</span>';
                }
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:center;gap:4px;">'
                    + entry.marker
                    + '<strong>' + entry.seriesName + '</strong>'
                    + '<span style="margin-left:auto;padding-left:10px;">' + val.toFixed(2) + '%</span>'
                    + realStr
                    + '</div>'
                );
            });

            if ((rbaEntry || cpiEntry) && bankEntries.length) lines.push(sep);

            if (rbaVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + (rbaEntry ? rbaEntry.marker : '')
                    + '<span style="color:' + th.rbaColor + ';font-weight:600;">RBA Cash Rate</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + th.rbaColor + ';">' + rbaVal.toFixed(2) + '%</span>'
                    + '</div>'
                );
            }
            if (cpiVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + (cpiEntry ? cpiEntry.marker : '')
                    + '<span style="color:' + th.cpiColor + ';font-weight:600;">CPI Inflation</span>'
                    + '<span style="font-size:9.5px;color:' + th.mutedText + ';margin-left:2px;">(annual)</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + th.cpiColor + ';">' + cpiVal.toFixed(1) + '%</span>'
                    + '</div>'
                );
            }

            return lines.join('');
        };

        // ── Subtitle ──────────────────────────────────────────────────────────

        var dateRangeStr = '';
        if (dateMin && dateMax) {
            dateRangeStr = fmtDateFull(dateMin) + ' – ' + fmtDateFull(dateMax);
        }
        var subtext = 'Best rate per bank vs monetary policy and inflation'
            + (dateRangeStr ? '  ·  ' + dateRangeStr : '')
            + (cpiSeries.length ? '  ·  CPI: ABS 6401.0' : '');

        // ── Grid / legend offsets ─────────────────────────────────────────────

        var legendTop = compact ? 40 : (narrow ? 44 : 48);
        var gridTop = compact ? 68 : (narrow ? 76 : 84);

        return {
            backgroundColor: 'transparent',
            textStyle: {
                fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif",
                color: th.text,
            },
            animation: true,
            animationDuration: 360,
            animationEasing: 'cubicOut',

            title: {
                text: 'Are Banks Passing on Rate Changes?',
                subtext: subtext,
                left: 0,
                top: 4,
                textStyle: {
                    color: th.text,
                    fontSize: compact ? 13 : (narrow ? 14 : 16),
                    fontWeight: 700,
                    fontFamily: "'Merriweather', Georgia, 'Times New Roman', serif",
                    lineHeight: 22,
                },
                subtextStyle: {
                    color: th.mutedText,
                    fontSize: compact ? 10 : 11,
                    fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    lineHeight: 16,
                },
            },

            legend: {
                show: !compact,
                type: 'scroll',
                top: legendTop,
                left: 0,
                right: 0,
                textStyle: { color: th.softText, fontSize: narrow ? 10 : 11 },
                itemWidth: 16,
                itemHeight: 3,
                selectedMode: true,
                data: legendData,
                formatter: function (name) {
                    if (name.charAt(0) === '_') return '';
                    return name;
                },
            },

            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                hideDelay: 800,
                axisPointer: {
                    type: 'line',
                    lineStyle: { color: 'rgba(148,163,184,0.35)', width: 1.5, type: 'solid' },
                },
                backgroundColor: th.tooltipBg,
                borderColor: th.tooltipBorder,
                textStyle: { color: th.tooltipText, fontSize: 12 },
                extraCssText: [
                    'border-radius:8px',
                    'padding:10px 13px',
                    'box-shadow:0 6px 28px rgba(0,0,0,0.20)',
                    'max-width:300px',
                    'font-family:\'Space Grotesk\',system-ui,sans-serif',
                ].join(';'),
                formatter: tooltipFormatter,
            },

            grid: {
                left: compact ? 44 : (narrow ? 52 : 58),
                right: compact ? 14 : (narrow ? 18 : 22),
                top: gridTop,
                bottom: compact ? 42 : (narrow ? 48 : 54),
                containLabel: true,
            },

            xAxis: {
                type: 'time',
                boundaryGap: ['1%', '2%'],
                axisLine: { lineStyle: { color: th.axisLine } },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: {
                    color: th.mutedText,
                    fontSize: compact ? 10 : 11,
                    hideOverlap: true,
                    margin: 10,
                    formatter: function (value) { return fmtDateShort(value); },
                },
            },

            yAxis: {
                type: 'value',
                min: parseFloat(yRange.min.toFixed(2)),
                max: parseFloat(yRange.max.toFixed(2)),
                name: compact ? '' : 'Rate %',
                nameLocation: 'end',
                nameGap: 8,
                nameTextStyle: {
                    color: th.mutedText,
                    fontSize: 10,
                    fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    padding: [0, 0, 0, 0],
                },
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    color: th.mutedText,
                    fontSize: compact ? 10 : 11,
                    formatter: function (v) { return Number(v).toFixed(1) + '%'; },
                },
                splitLine: {
                    lineStyle: { color: th.grid, width: 1 },
                },
            },

            series: series,
        };
    }

    window.AR.chartSavingsReport = {
        buildOption: buildOption,
    };
})();
