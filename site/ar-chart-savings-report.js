/**
 * Economic Report chart for the Savings section.
 *
 * Narrative time-series showing:
 *  - Best savings rate per bank (stepped lines, end-labelled)
 *  - RBA cash rate (thick amber step line, end-labelled, vertical decision markers)
 *  - CPI inflation (quarterly ABS data, dashed rose line with area)
 *
 * Context window is always 18 months even if CDR data is recent, so
 * CPI and RBA always tell the full economic story.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    // ── Embedded CPI data ─────────────────────────────────────────────────────
    // Source: ABS 6401.0 Consumer Price Index, All Groups, Eight Capital Cities
    // Annual % change. Values after 2024 Q4 are estimates (est.).
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
        { date: '2025-01-01', value: 2.4 }, // est.
        { date: '2025-04-01', value: 2.7 }, // est.
        { date: '2025-07-01', value: 2.9 }, // est.
        { date: '2025-10-01', value: 2.8 }, // est.
        { date: '2026-01-01', value: 2.6 }, // est.
        { date: '2026-04-01', value: 2.5 }, // est.
    ];

    // ── Bank labels & colours ─────────────────────────────────────────────────
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
        'teachers mutual bank': 'Teachers',
        'beyond bank australia': 'Beyond',
        'me bank': 'ME Bank',
        'mystate bank': 'MyState',
    };
    var BANK_COLOR = {
        'commonwealth bank of australia': '#e8b400',
        'westpac banking corporation': '#d50032',
        'anz': '#0033a0',
        'national australia bank': '#8a1538',
        'macquarie bank': '#006d5b',
        'ing': '#ff6200',
        'ubank': '#7d3e84',
        'bankwest': '#4a8f26',
        'bank of queensland': '#00a3e0',
        'suncorp bank': '#1b5fa8',
        'great southern bank': '#00a651',
        'amp bank': '#c85a00',
        'bendigo and adelaide bank': '#a6192e',
        'bank of melbourne': '#6b1f3a',
        'st. george bank': '#b8000a',
        'hsbc australia': '#cc0000',
        'teachers mutual bank': '#1a6b3c',
        'beyond bank australia': '#005ea8',
        'me bank': '#003b6f',
        'mystate bank': '#e05c00',
    };
    var PALETTE = ['#4f8dfd','#27c27a','#f0b90b','#f97316','#8b5cf6','#ef4444','#14b8a6','#64748b','#a78bfa','#fb923c'];

    function bankShort(name) {
        var k = String(name || '').trim().toLowerCase();
        return BANK_SHORT[k] || String(name || '').slice(0, 12).trim();
    }
    function bankColor(name, idx) {
        var k = String(name || '').trim().toLowerCase();
        return BANK_COLOR[k] || PALETTE[idx % PALETTE.length];
    }

    // ── Theme ─────────────────────────────────────────────────────────────────
    function isDark() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    }
    function th() {
        var dark = isDark();
        return {
            text:          dark ? '#e2e8f0' : '#0f172a',
            muted:         dark ? '#94a3b8' : '#64748b',
            soft:          dark ? '#cbd5e1' : '#334155',
            grid:          dark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.16)',
            axis:          dark ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.35)',
            rba:           '#f59e0b',
            rbaBg:         dark ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.05)',
            rbaLine:       dark ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.18)',
            cpi:           dark ? '#f87171' : '#dc2626',
            cpiBg:         dark ? 'rgba(248,113,113,0.06)' : 'rgba(220,38,38,0.05)',
            cdrLine:       dark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.18)',
            ttBg:          dark ? 'rgba(15,23,42,0.96)'    : 'rgba(255,255,255,0.97)',
            ttBorder:      dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText:        dark ? '#e2e8f0' : '#1e293b',
            good:          dark ? '#34d399' : '#059669',
            bad:           dark ? '#f87171' : '#dc2626',
            labelBg:       dark ? 'rgba(15,23,42,0.72)'   : 'rgba(255,255,255,0.80)',
        };
    }

    // ── Date helpers ──────────────────────────────────────────────────────────
    function todayYmd() { return new Date().toISOString().slice(0, 10); }

    function subtractMonths(ymd, n) {
        var d = new Date(ymd + 'T12:00:00Z');
        d.setUTCMonth(d.getUTCMonth() - n);
        return d.toISOString().slice(0, 10);
    }

    function fmtFull(ymd) {
        var s = String(ymd || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var p = s.split('-');
        var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return m[+p[1] - 1] + ' ' + +p[2] + ', ' + p[0];
    }

    function fmtShort(ts) {
        // ECharts time axis passes timestamps as numbers
        var d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts).slice(0, 10) + 'T12:00:00Z');
        if (isNaN(d.getTime())) return '';
        var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return m[d.getUTCMonth()] + ' \'' + String(d.getUTCFullYear()).slice(2);
    }

    // ── Data helpers ──────────────────────────────────────────────────────────

    /** Aggregate visibleSeries to best (max) rate per bank per date. */
    function buildBankSeries(visibleSeries) {
        var byBank = {};
        (visibleSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                if (!d || !Number.isFinite(v)) return;
                if (byBank[k].byDate[d] == null || v > byBank[k].byDate[d]) byBank[k].byDate[d] = v;
            });
        });

        return Object.keys(byBank)
            .map(function (k) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) { return { date: d, value: e.byDate[d] }; });
                return { bankName: e.bankName, points: pts, latest: pts.length ? pts[pts.length - 1].value : 0 };
            })
            .sort(function (a, b) { return b.latest - a.latest; })
            .map(function (b, i) {
                b.short = bankShort(b.bankName);
                b.color = bankColor(b.bankName, i);
                return b;
            });
    }

    /**
     * Build RBA step series for the context window.
     * Projects the last-known rate (or first available rate) to contextMin
     * so the step line always spans the full chart width.
     * Only returns rate-change events as "decisions" (for vertical markers).
     */
    function buildRbaSeries(rbaHistory, contextMin, contextMax) {
        if (!Array.isArray(rbaHistory) || !rbaHistory.length) return { points: [], decisions: [] };
        var all = rbaHistory
            .map(function (r) {
                return {
                    date: String(r.effective_date || r.date || '').slice(0, 10),
                    rate: Number(r.cash_rate != null ? r.cash_rate : r.value),
                };
            })
            .filter(function (r) { return r.date && Number.isFinite(r.rate); })
            .sort(function (a, b) { return a.date.localeCompare(b.date); });

        // Deduplicate — keep only entries where rate changes (or first entry)
        var deduped = [];
        all.forEach(function (r) {
            if (!deduped.length || r.rate !== deduped[deduped.length - 1].rate) {
                deduped.push(r);
            }
        });

        // Last rate before contextMin (used to project leftward)
        var carry = null;
        var decisions = [];
        deduped.forEach(function (r) {
            if (r.date < contextMin) { carry = r; }
            else if (r.date <= contextMax) { decisions.push(r); }
        });

        // If no carry, project the first available rate back to contextMin
        // (so the line always spans the full x-axis from the left edge)
        var carryRate = carry ? carry.rate : (decisions.length ? decisions[0].rate : null);

        var points = [];
        if (carryRate != null) points.push([contextMin, carryRate]);
        decisions.forEach(function (r) { points.push([r.date, r.rate]); });

        // Only mark decisions where rate actually changes from previous
        var rateDecisions = decisions.filter(function (r, i) {
            var prev = i === 0 ? carryRate : decisions[i - 1].rate;
            return prev == null || r.rate !== prev;
        });

        return { points: points, decisions: rateDecisions };
    }

    /**
     * Build CPI step series for the context window.
     * Carries forward the last quarterly value to contextMin.
     */
    function buildCpiSeries(contextMin, contextMax) {
        var carry = null;
        var inRange = [];
        ABS_CPI.forEach(function (e) {
            if (e.date < contextMin) carry = e;
            else if (e.date <= contextMax) inRange.push(e);
        });
        var pts = [];
        if (carry) pts.push([contextMin, carry.value]);
        inRange.forEach(function (e) { pts.push([e.date, e.value]); });
        return pts;
    }

    function yRange(bankSeries, rbaPoints, cpiPoints) {
        var lo = Infinity, hi = -Infinity;
        function v(x) { if (Number.isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; } }
        bankSeries.forEach(function (b) { b.points.forEach(function (p) { v(p.value); }); });
        rbaPoints.forEach(function (p) { v(p[1]); });
        cpiPoints.forEach(function (p) { v(p[1]); });
        if (!Number.isFinite(lo)) lo = 0;
        if (!Number.isFinite(hi)) hi = 6;
        if (lo === hi) { lo -= 0.5; hi += 0.5; }
        var pad = Math.max((hi - lo) * 0.06, 0.15);
        return { min: Math.max(0, parseFloat((lo - pad).toFixed(2))), max: parseFloat((hi + pad).toFixed(2)) };
    }

    // ── Main option builder ───────────────────────────────────────────────────

    function buildOption(model, fields, size, rbaHistory) {
        var t = th();
        var dark = isDark();
        var narrow  = size && size.width < 720;
        var compact = size && size.width < 480;

        var visibleSeries = (model && model.visibleSeries) || [];
        var banks = buildBankSeries(visibleSeries);

        // Date bounds from actual CDR data
        var bankMax = null, bankMin = null;
        banks.forEach(function (b) {
            b.points.forEach(function (p) {
                if (!bankMax || p.date > bankMax) bankMax = p.date;
                if (!bankMin || p.date < bankMin) bankMin = p.date;
            });
        });
        if (!bankMax) bankMax = todayYmd();

        // Always 18-month context so CPI/RBA have meaningful history
        var ctxMin = subtractMonths(bankMax, 18);
        var ctxMax = bankMax;

        var rba      = buildRbaSeries(rbaHistory || [], ctxMin, ctxMax);
        var cpi      = buildCpiSeries(ctxMin, ctxMax);

        // Extend CPI and RBA step lines to ctxMax so end-labels land at right edge
        function extendToMax(pts) {
            if (!pts.length) return pts;
            var last = pts[pts.length - 1];
            var lastDate = String(Array.isArray(last) ? last[0] : last.date);
            if (lastDate < ctxMax) {
                var lastVal = Array.isArray(last) ? last[1] : last.value;
                pts = pts.concat([[ctxMax, lastVal]]);
            }
            return pts;
        }
        cpi = extendToMax(cpi);
        rba.points = extendToMax(rba.points);

        var yr       = yRange(banks, rba.points, cpi);

        var maxBanks = compact ? 5 : (narrow ? 7 : 10);
        var visiBanks = banks.slice(0, maxBanks);

        // Right margin large enough for end labels
        var rightM = compact ? 14 : (narrow ? 22 : 115);
        var leftM  = compact ? 48 : (narrow ? 52 : 58);
        var topM   = compact ? 64 : (narrow ? 72 : 80);
        var botM   = compact ? 40 : (narrow ? 46 : 52);

        var series = [];

        // ── 1. "CDR data begins" vertical marker ─────────────────────────────
        if (bankMin && bankMin > ctxMin) {
            series.push({
                name: '_cdr',
                type: 'line',
                data: [],
                symbol: 'none',
                lineStyle: { opacity: 0 },
                z: 1,
                markLine: {
                    silent: true,
                    animation: false,
                    symbol: ['none', 'none'],
                    data: [{
                        xAxis: bankMin,
                        lineStyle: { color: t.cdrLine, width: 1.5, type: 'dashed' },
                        label: {
                            show: !compact,
                            position: 'insideEndTop',
                            formatter: 'CDR tracking begins',
                            color: t.muted,
                            fontSize: 9,
                            rotate: -90,
                            distance: 5,
                            backgroundColor: t.labelBg,
                            borderRadius: 2,
                            padding: [2, 4],
                        },
                    }],
                },
            });
        }

        // ── 2. CPI inflation line + area ─────────────────────────────────────
        if (cpi.length) {
            series.push({
                name: 'CPI Inflation',
                type: 'line',
                step: 'end',
                data: cpi,
                lineStyle: { color: t.cpi, width: 2, type: 'dashed' },
                itemStyle: { color: t.cpi },
                symbol: 'circle',
                symbolSize: compact ? 3 : 5,
                areaStyle: { color: t.cpiBg, origin: 'start' },
                endLabel: {
                    show: !compact,
                    distance: 6,
                    color: t.cpi,
                    fontSize: 10,
                    fontWeight: 700,
                    formatter: function (p) {
                        var v = Array.isArray(p.value) ? p.value[1] : p.value;
                        return 'CPI ' + Number(v).toFixed(1) + '%';
                    },
                },
                emphasis: { focus: 'series', lineStyle: { width: 3 } },
                z: 2,
            });
        }

        // ── 3. RBA decision vertical lines (ghost series + markLine) ─────────
        if (rba.decisions.length && !compact) {
            var rbaLines = rba.decisions.map(function (r, i) {
                var prev = i > 0 ? rba.decisions[i - 1].rate : (rba.points.length ? rba.points[0][1] : null);
                var delta = prev != null ? r.rate - prev : null;
                var arrow = delta == null ? '' : (delta > 0 ? ' ↑' : (delta < 0 ? ' ↓' : ''));
                return {
                    xAxis: r.date,
                    lineStyle: { color: t.rbaLine, width: 1.5, type: 'dashed' },
                    label: {
                        show: !narrow,
                        position: 'insideEndTop',
                        formatter: r.rate.toFixed(2) + '%' + arrow,
                        color: t.rba,
                        fontSize: 9,
                        rotate: -90,
                        distance: 4,
                        backgroundColor: t.labelBg,
                        borderRadius: 2,
                        padding: [2, 3],
                    },
                };
            });
            series.push({
                name: '_rba_lines',
                type: 'line',
                data: [],
                symbol: 'none',
                lineStyle: { opacity: 0 },
                z: 1,
                markLine: {
                    silent: true,
                    animation: false,
                    symbol: ['none', 'none'],
                    data: rbaLines,
                },
            });
        }

        // ── 4. RBA cash rate step line ────────────────────────────────────────
        if (rba.points.length) {
            series.push({
                name: 'RBA Cash Rate',
                type: 'line',
                step: 'end',
                data: rba.points,
                lineStyle: { color: t.rba, width: compact ? 2.5 : 3.5 },
                itemStyle: { color: t.rba },
                symbol: 'none',
                endLabel: {
                    show: !compact,
                    distance: 6,
                    color: t.rba,
                    fontSize: 10,
                    fontWeight: 700,
                    formatter: function (p) {
                        var v = Array.isArray(p.value) ? p.value[1] : p.value;
                        return 'RBA ' + Number(v).toFixed(2) + '%';
                    },
                },
                emphasis: { focus: 'series', lineStyle: { width: 5 } },
                z: 5,
            });
        }

        // ── 5. Bank savings rate lines ────────────────────────────────────────
        visiBanks.forEach(function (bank) {
            // Carry-forward the earliest known rate back to ctxMin so the
            // line spans the full chart width (makes "tracking began" visually clear)
            var rawPts = bank.points.map(function (p) { return [p.date, p.value]; });
            if (rawPts.length && String(rawPts[0][0]) > ctxMin) {
                rawPts = [[ctxMin, rawPts[0][1]]].concat(rawPts);
            }
            series.push({
                name: bank.short,
                type: 'line',
                step: 'end',
                data: rawPts,
                lineStyle: { color: bank.color, width: compact ? 1.5 : 2 },
                itemStyle: { color: bank.color },
                symbol: 'none',
                endLabel: {
                    show: !compact,
                    distance: 6,
                    color: bank.color,
                    fontSize: 10,
                    fontWeight: 600,
                    formatter: function (p) {
                        var v = Array.isArray(p.value) ? p.value[1] : p.value;
                        return bank.short + '  ' + Number(v).toFixed(2) + '%';
                    },
                },
                labelLayout: { moveOverlap: 'shiftY' },
                emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
                z: 3,
            });
        });

        // ── Legend ────────────────────────────────────────────────────────────
        var legendItems = [];
        if (cpi.length) legendItems.push({ name: 'CPI Inflation', itemStyle: { color: t.cpi }, lineStyle: { color: t.cpi, width: 2, type: 'dashed' } });
        if (rba.points.length) legendItems.push({ name: 'RBA Cash Rate', itemStyle: { color: t.rba }, lineStyle: { color: t.rba, width: 3 } });
        visiBanks.forEach(function (b) {
            legendItems.push({ name: b.short, itemStyle: { color: b.color }, lineStyle: { color: b.color, width: 2 } });
        });

        // ── Tooltip ───────────────────────────────────────────────────────────
        // Build a lookup: date → cpi value (step carry-forward)
        function cpiAtDate(dateStr) {
            var best = null;
            for (var i = 0; i < cpi.length; i++) {
                var d = Array.isArray(cpi[i]) ? cpi[i][0] : cpi[i].date;
                var v = Array.isArray(cpi[i]) ? cpi[i][1] : cpi[i].value;
                if (String(d) <= dateStr) best = v;
            }
            return best;
        }

        function tooltipFmt(params) {
            if (!Array.isArray(params) || !params.length) return '';
            var visible = params.filter(function (p) {
                return p.seriesName && p.seriesName.charAt(0) !== '_' && p.value != null;
            });
            if (!visible.length) return '';

            // Recover date string from time-axis value (timestamp or string)
            var rawDate = Array.isArray(visible[0].value) ? visible[0].value[0] : visible[0].axisValue;
            var dateYmd = typeof rawDate === 'number'
                ? new Date(rawDate).toISOString().slice(0, 10)
                : String(rawDate || '').slice(0, 10);
            var dateLabel = fmtFull(dateYmd);

            var cpiVal = cpiAtDate(dateYmd);
            var rbaEntry = visible.find(function (e) { return e.seriesName === 'RBA Cash Rate'; });
            var cpiEntry = visible.find(function (e) { return e.seriesName === 'CPI Inflation'; });
            var bankEntries = visible.filter(function (e) {
                return e.seriesName !== 'RBA Cash Rate' && e.seriesName !== 'CPI Inflation';
            });

            var rbaVal = rbaEntry ? Number(Array.isArray(rbaEntry.value) ? rbaEntry.value[1] : rbaEntry.value) : null;
            if (cpiEntry) {
                var cv = Number(Array.isArray(cpiEntry.value) ? cpiEntry.value[1] : cpiEntry.value);
                if (Number.isFinite(cv)) cpiVal = cv;
            }

            var T = th();
            var sep = '<div style="border-top:1px solid rgba(148,163,184,0.15);margin:6px 0 4px;"></div>';
            var lines = [
                '<div style="font-size:10.5px;color:' + T.muted + ';letter-spacing:0.04em;margin-bottom:6px;">' + dateLabel + '</div>',
            ];

            bankEntries.forEach(function (e) {
                var val = Number(Array.isArray(e.value) ? e.value[1] : e.value);
                if (!Number.isFinite(val)) return;
                var real = (cpiVal != null && Number.isFinite(cpiVal)) ? val - cpiVal : null;
                var realHtml = '';
                if (real != null) {
                    var c = real >= 0 ? T.good : T.bad;
                    var label = real >= 0 ? '+' + real.toFixed(2) + '% real' : real.toFixed(2) + '% real';
                    realHtml = ' <span style="color:' + c + ';font-size:9.5px;">' + label + '</span>';
                }
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + e.marker
                    + '<span style="font-weight:600;">' + e.seriesName + '</span>'
                    + '<span style="margin-left:auto;padding-left:12px;font-variant-numeric:tabular-nums;">' + val.toFixed(2) + '%</span>'
                    + realHtml
                    + '</div>'
                );
            });

            if (bankEntries.length && (rbaVal != null || cpiVal != null)) lines.push(sep);

            if (rbaVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + (rbaEntry ? rbaEntry.marker : '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + T.rba + ';margin-right:4px;"></span>')
                    + '<span style="color:' + T.rba + ';font-weight:600;">RBA Cash Rate</span>'
                    + '<span style="margin-left:auto;padding-left:12px;color:' + T.rba + ';font-variant-numeric:tabular-nums;">' + rbaVal.toFixed(2) + '%</span>'
                    + '</div>'
                );
            }
            if (cpiVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + (cpiEntry ? cpiEntry.marker : '<span style="display:inline-block;width:10px;height:3px;background:' + T.cpi + ';margin-right:4px;"></span>')
                    + '<span style="color:' + T.cpi + ';font-weight:600;">CPI</span>'
                    + '<span style="color:' + T.muted + ';font-size:9px;margin-left:2px;">annual</span>'
                    + '<span style="margin-left:auto;padding-left:12px;color:' + T.cpi + ';font-variant-numeric:tabular-nums;">' + Number(cpiVal).toFixed(1) + '%</span>'
                    + '</div>'
                );
            }

            return lines.join('');
        }

        // ── Subtitle ──────────────────────────────────────────────────────────
        var subParts = ['Best savings rate per bank vs RBA cash rate and CPI inflation'];
        if (ctxMin && ctxMax) subParts.push(fmtFull(ctxMin) + ' – ' + fmtFull(ctxMax));
        if (bankMin && bankMin > ctxMin) subParts.push('CDR rate data from ' + fmtFull(bankMin));
        if (cpi.length) subParts.push('CPI: ABS 6401.0');

        return {
            backgroundColor: 'transparent',
            textStyle: {
                fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif",
                color: t.text,
            },
            animation: true,
            animationDuration: 400,
            animationEasing: 'cubicOut',

            title: {
                text: 'Are Banks Passing on Rate Changes?',
                subtext: subParts.join('  ·  '),
                left: 0,
                top: 4,
                textStyle: {
                    color: t.text,
                    fontSize: compact ? 13 : (narrow ? 14 : 16),
                    fontWeight: 700,
                    fontFamily: "'Merriweather', Georgia, 'Times New Roman', serif",
                },
                subtextStyle: {
                    color: t.muted,
                    fontSize: compact ? 9.5 : 10.5,
                    fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    lineHeight: 16,
                },
            },

            legend: {
                show: !compact,
                type: 'scroll',
                top: compact ? 40 : (narrow ? 44 : 48),
                left: 0,
                right: rightM,
                textStyle: { color: t.soft, fontSize: narrow ? 10 : 11 },
                itemWidth: 14,
                itemHeight: 3,
                selectedMode: true,
                data: legendItems,
                formatter: function (name) { return name.charAt(0) === '_' ? '' : name; },
            },

            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                hideDelay: 600,
                axisPointer: {
                    type: 'line',
                    lineStyle: { color: 'rgba(148,163,184,0.30)', width: 1.5 },
                },
                backgroundColor: t.ttBg,
                borderColor: t.ttBorder,
                textStyle: { color: t.ttText, fontSize: 12 },
                extraCssText: [
                    'border-radius:8px',
                    'padding:10px 14px',
                    'box-shadow:0 8px 32px rgba(0,0,0,0.22)',
                    'max-width:320px',
                    "font-family:'Space Grotesk',system-ui,sans-serif",
                ].join(';'),
                formatter: tooltipFmt,
            },

            grid: {
                left: leftM,
                right: rightM,
                top: topM,
                bottom: botM,
                containLabel: true,
            },

            xAxis: {
                type: 'time',
                min: ctxMin,
                max: ctxMax,
                boundaryGap: false,
                axisLine: { lineStyle: { color: t.axis } },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: {
                    color: t.muted,
                    fontSize: compact ? 10 : 11,
                    hideOverlap: true,
                    margin: 10,
                    formatter: function (v) { return fmtShort(v); },
                },
            },

            yAxis: {
                type: 'value',
                min: yr.min,
                max: yr.max,
                name: compact ? '' : 'Rate %',
                nameLocation: 'end',
                nameGap: 6,
                nameTextStyle: { color: t.muted, fontSize: 10 },
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    color: t.muted,
                    fontSize: compact ? 10 : 11,
                    formatter: function (v) { return Number(v).toFixed(1) + '%'; },
                },
                splitLine: { lineStyle: { color: t.grid, width: 1 } },
            },

            series: series,
        };
    }

    window.AR.chartSavingsReport = { buildOption: buildOption };
})();
