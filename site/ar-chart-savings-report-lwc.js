/**
 * Economic Report chart — LightweightCharts (TradingView) implementation.
 *
 * Replaces ar-chart-savings-report.js (ECharts) for the economicReport view.
 *
 * Shows:
 *   - Best savings rate per bank   (stepped lines, end-labelled)
 *   - RBA cash rate                (thick amber step line, decision markers)
 *   - CPI inflation                (dashed rose area, quarterly ABS data)
 *
 * LWC gives native pan / zoom / crosshair — no custom axis-drag code required.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    // ── Embedded CPI data ─────────────────────────────────────────────────────
    // Source: ABS 6401.0 CPI, All Groups, Eight Capital Cities. Annual % change.
    var ABS_CPI = [
        { date: '2021-01-01', value: 1.1 },
        { date: '2021-04-01', value: 3.8 },
        { date: '2021-07-01', value: 3.0 },
        { date: '2021-10-01', value: 3.5 },
        { date: '2022-01-01', value: 5.1 },
        { date: '2022-04-01', value: 6.1 },
        { date: '2022-07-01', value: 6.1 },
        { date: '2022-10-01', value: 7.3 },
        { date: '2023-01-01', value: 7.8 },
        { date: '2023-04-01', value: 7.0 },
        { date: '2023-07-01', value: 6.0 },
        { date: '2023-10-01', value: 5.4 },
        { date: '2024-01-01', value: 4.1 },
        { date: '2024-04-01', value: 3.6 },
        { date: '2024-07-01', value: 3.8 },
        { date: '2024-10-01', value: 2.8 },
        { date: '2025-01-01', value: 2.4 },
        { date: '2025-04-01', value: 2.7 },
        { date: '2025-07-01', value: 2.9 },
        { date: '2025-10-01', value: 2.8 },
        { date: '2026-01-01', value: 2.6 },
        { date: '2026-04-01', value: 2.5 },
    ];

    // ── Bank labels & brand colours ───────────────────────────────────────────
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
            text:      dark ? '#e2e8f0'                   : '#0f172a',
            muted:     dark ? '#94a3b8'                   : '#64748b',
            soft:      dark ? '#cbd5e1'                   : '#334155',
            grid:      dark ? 'rgba(148,163,184,0.08)'    : 'rgba(148,163,184,0.16)',
            axis:      dark ? 'rgba(148,163,184,0.20)'    : 'rgba(148,163,184,0.35)',
            rba:       '#f59e0b',
            rbaBg:     dark ? 'rgba(245,158,11,0.07)'     : 'rgba(245,158,11,0.05)',
            cpi:       dark ? '#f87171'                   : '#dc2626',
            cpiBg:     dark ? 'rgba(248,113,113,0.06)'    : 'rgba(220,38,38,0.05)',
            cdrLine:   dark ? 'rgba(148,163,184,0.22)'    : 'rgba(100,116,139,0.18)',
            ttBg:      dark ? 'rgba(15,23,42,0.96)'       : 'rgba(255,255,255,0.97)',
            ttBorder:  dark ? 'rgba(100,116,139,0.30)'    : 'rgba(100,116,139,0.20)',
            ttText:    dark ? '#e2e8f0'                   : '#1e293b',
            good:      dark ? '#34d399'                   : '#059669',
            bad:       dark ? '#f87171'                   : '#dc2626',
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

    function fmtMonYr(ymd) {
        var s = String(ymd || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var p = s.split('-');
        var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return m[+p[1] - 1] + ' \'' + p[0].slice(2);
    }

    // ── Data helpers ──────────────────────────────────────────────────────────
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

        var deduped = [];
        all.forEach(function (r) {
            if (!deduped.length || r.rate !== deduped[deduped.length - 1].rate) deduped.push(r);
        });

        var carry = null;
        var decisions = [];
        deduped.forEach(function (r) {
            if (r.date < contextMin) { carry = r; }
            else if (r.date <= contextMax) { decisions.push(r); }
        });

        var carryRate = carry ? carry.rate : (decisions.length ? decisions[0].rate : null);
        var points = [];
        if (carryRate != null) points.push([contextMin, carryRate]);
        decisions.forEach(function (r) { points.push([r.date, r.rate]); });

        var rateDecisions = decisions.filter(function (r, i) {
            var prev = i === 0 ? carryRate : decisions[i - 1].rate;
            return prev == null || r.rate !== prev;
        });

        return { points: points, decisions: rateDecisions };
    }

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

    function extendToMax(pts, ctxMax) {
        if (!pts.length) return pts;
        var last = pts[pts.length - 1];
        var lastDate = String(Array.isArray(last) ? last[0] : last.date);
        if (lastDate < ctxMax) {
            var lastVal = Array.isArray(last) ? last[1] : last.value;
            return pts.concat([[ctxMax, lastVal]]);
        }
        return pts;
    }

    // ── Overlap-resolve end labels ────────────────────────────────────────────
    // Returns array of {label, color, y} with y adjusted to avoid collisions.
    var END_LABEL_HEIGHT = 15; // px per label row

    function resolveEndLabelPositions(rawItems, paneHeight) {
        // rawItems: [{y, label, color}], sorted by y ascending
        var sorted = rawItems.slice().sort(function (a, b) { return a.y - b.y; });
        var n = sorted.length;
        if (!n) return sorted;

        // Forward pass: push down overlaps
        for (var i = 1; i < n; i++) {
            var prev = sorted[i - 1];
            var cur = sorted[i];
            if (cur.y - prev.y < END_LABEL_HEIGHT) {
                cur.y = prev.y + END_LABEL_HEIGHT;
            }
        }
        // Backward pass: if we've gone off the bottom, pull up
        var bottom = paneHeight - END_LABEL_HEIGHT;
        for (var j = n - 1; j >= 0; j--) {
            if (sorted[j].y > bottom) sorted[j].y = bottom;
            if (j > 0 && sorted[j - 1].y >= sorted[j].y - END_LABEL_HEIGHT) {
                sorted[j - 1].y = sorted[j].y - END_LABEL_HEIGHT;
            }
        }
        return sorted;
    }

    // ── Main render ───────────────────────────────────────────────────────────
    function render(container, model, rbaHistory) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        var visibleSeries = (model && model.visibleSeries) || [];
        var banks = buildBankSeries(visibleSeries);

        // Date bounds from CDR data
        var bankMax = null, bankMin = null;
        banks.forEach(function (b) {
            b.points.forEach(function (p) {
                if (!bankMax || p.date > bankMax) bankMax = p.date;
                if (!bankMin || p.date < bankMin) bankMin = p.date;
            });
        });
        if (!bankMax) bankMax = todayYmd();

        var ctxMin = subtractMonths(bankMax, 18);
        var ctxMax = bankMax;

        var rbaData = buildRbaSeries(rbaHistory || [], ctxMin, ctxMax);
        var cpiPts = buildCpiSeries(ctxMin, ctxMax);

        cpiPts    = extendToMax(cpiPts, ctxMax);
        rbaData.points = extendToMax(rbaData.points, ctxMax);

        // Responsive limits
        var W = container.clientWidth || 800;
        var compact = W < 480, narrow = W < 720;
        var maxBanks = compact ? 4 : (narrow ? 7 : 10);
        var visiBanks = banks.slice(0, maxBanks);

        // ── DOM structure ─────────────────────────────────────────────────────
        container.innerHTML = '';

        var mount = document.createElement('div');
        mount.className = 'lwc-er-mount';
        mount.style.cssText = 'position:relative;width:100%;height:100%;min-height:400px;display:flex;flex-direction:column;';
        container.appendChild(mount);

        // Title + subtitle bar
        var titleBar = document.createElement('div');
        titleBar.className = 'lwc-er-titlebar';
        titleBar.style.cssText = 'padding:12px 16px 0;flex-shrink:0;';
        var t = th();
        titleBar.innerHTML = [
            '<p style="margin:0;font-size:15px;font-weight:700;color:' + t.text + ';font-family:Merriweather,Georgia,serif;">Are Banks Passing on Rate Changes?</p>',
            '<p style="margin:2px 0 0;font-size:10px;color:' + t.muted + ';font-family:inherit;">',
            'Best savings rate per bank vs RBA cash rate and CPI inflation',
            compact ? '' : ('  ·  ' + fmtFull(ctxMin) + ' – ' + fmtFull(ctxMax)),
            bankMin && bankMin > ctxMin ? ('  ·  CDR data from ' + fmtFull(bankMin)) : '',
            '</p>',
        ].join('');
        mount.appendChild(titleBar);

        // Chart row: chart canvas + end-labels panel
        var chartRow = document.createElement('div');
        chartRow.style.cssText = 'position:relative;flex:1 1 0;min-height:0;display:flex;';
        mount.appendChild(chartRow);

        var labelPanelW = compact ? 0 : (narrow ? 80 : 120);
        var chartEl = document.createElement('div');
        chartEl.style.cssText = 'flex:1 1 0;min-width:0;';
        chartRow.appendChild(chartEl);

        // Overlay for vertical markers (sits over chart canvas)
        var overlayEl = document.createElement('div');
        overlayEl.style.cssText = 'position:absolute;inset:0;right:' + labelPanelW + 'px;pointer-events:none;overflow:hidden;';
        chartRow.appendChild(overlayEl);

        // End-labels panel
        var labelEl = null;
        if (labelPanelW > 0) {
            labelEl = document.createElement('div');
            labelEl.style.cssText = 'position:relative;width:' + labelPanelW + 'px;flex-shrink:0;overflow:hidden;';
            chartRow.appendChild(labelEl);
        }

        // Floating tooltip
        var tooltipEl = document.createElement('div');
        tooltipEl.style.cssText = [
            'position:absolute',
            'z-index:20',
            'pointer-events:none',
            'display:none',
            'background:' + t.ttBg,
            'border:1px solid ' + t.ttBorder,
            'border-radius:8px',
            'padding:10px 14px',
            'font-size:12px',
            'color:' + t.ttText,
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'box-shadow:0 8px 32px rgba(0,0,0,0.22)',
            'max-width:300px',
            'min-width:160px',
        ].join(';');
        chartRow.appendChild(tooltipEl);

        // ── Create LWC chart ──────────────────────────────────────────────────
        var chart = L.createChart(chartEl, {
            layout: {
                background: { type: L.ColorType.Solid, color: 'transparent' },
                textColor: t.muted,
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
            },
            grid: {
                vertLines: { color: t.grid },
                horzLines: { color: t.grid },
            },
            rightPriceScale: {
                borderColor: t.axis,
                scaleMargins: { top: 0.06, bottom: 0.06 },
                visible: true,
            },
            timeScale: {
                borderColor: t.axis,
                timeVisible: false,
                secondsVisible: false,
                rightOffset: compact ? 1 : 3,
                fixLeftEdge: false,
                fixRightEdge: false,
            },
            crosshair: {
                mode: L.CrosshairMode.Normal,
                vertLine: {
                    color: 'rgba(148,163,184,0.40)',
                    width: 1,
                    style: L.LineStyle ? L.LineStyle.Dashed : 2,
                    labelVisible: true,
                    labelBackgroundColor: 'rgba(100,116,139,0.80)',
                },
                horzLine: {
                    color: 'rgba(148,163,184,0.40)',
                    width: 1,
                    labelVisible: true,
                    labelBackgroundColor: 'rgba(100,116,139,0.80)',
                },
            },
            localization: {
                priceFormatter: function (p) { return Number(p).toFixed(2) + '%'; },
                timeFormatter: function (time) {
                    var s = typeof time === 'string' ? time : String(time);
                    return fmtMonYr(s.slice(0, 10));
                },
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        });

        // ── Add series: CPI area ──────────────────────────────────────────────
        var cpiSeries = null;
        if (cpiPts.length) {
            var cpiData = cpiPts.map(function (p) {
                return { time: Array.isArray(p) ? p[0] : p.date, value: Array.isArray(p) ? p[1] : p.value };
            }).filter(function (p) { return p.time && Number.isFinite(p.value); });

            cpiSeries = chart.addSeries(L.AreaSeries, {
                lineColor: t.cpi,
                topColor: t.cpiBg,
                bottomColor: 'rgba(0,0,0,0)',
                lineWidth: 2,
                lineStyle: L.LineStyle ? L.LineStyle.Dashed : 2,
                lineType: L.LineType ? L.LineType.WithSteps : 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3,
                crosshairMarkerBorderColor: t.cpi,
                crosshairMarkerBackgroundColor: t.cpi,
            });
            cpiSeries.setData(cpiData);
        }

        // ── Add series: bank step lines ───────────────────────────────────────
        var bankSeries = []; // [{api, bank, data}]
        visiBanks.forEach(function (bank) {
            var rawPts = bank.points.map(function (p) { return [p.date, p.value]; });
            if (rawPts.length && String(rawPts[0][0]) > ctxMin) {
                rawPts = [[ctxMin, rawPts[0][1]]].concat(rawPts);
            }
            var lineData = rawPts.map(function (p) {
                return { time: p[0], value: p[1] };
            }).filter(function (p) { return p.time && Number.isFinite(p.value); });

            var ser = chart.addSeries(L.LineSeries, {
                color: bank.color,
                lineWidth: compact ? 1.5 : 2,
                lineType: L.LineType ? L.LineType.WithSteps : 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3,
                crosshairMarkerBorderColor: bank.color,
                crosshairMarkerBackgroundColor: bank.color,
            });
            ser.setData(lineData);
            bankSeries.push({ api: ser, bank: bank, data: lineData });
        });

        // ── Add series: RBA step line (on top) ────────────────────────────────
        var rbaSeries = null;
        if (rbaData.points.length) {
            var rbaLineData = rbaData.points.map(function (p) {
                return { time: p[0], value: p[1] };
            }).filter(function (p) { return p.time && Number.isFinite(p.value); });

            rbaSeries = chart.addSeries(L.LineSeries, {
                color: t.rba,
                lineWidth: compact ? 2.5 : 3.5,
                lineType: L.LineType ? L.LineType.WithSteps : 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 4,
                crosshairMarkerBorderWidth: 2,
                crosshairMarkerBorderColor: t.rba,
                crosshairMarkerBackgroundColor: t.rba,
            });
            rbaSeries.setData(rbaLineData);
        }

        // Fit to 18-month context
        chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax });

        // ── CPI step-value lookup (carry-forward for tooltip) ─────────────────
        function cpiAtDate(dateStr) {
            var best = null;
            for (var i = 0; i < cpiPts.length; i++) {
                var d = Array.isArray(cpiPts[i]) ? cpiPts[i][0] : cpiPts[i].date;
                var v = Array.isArray(cpiPts[i]) ? cpiPts[i][1] : cpiPts[i].value;
                if (String(d) <= dateStr) best = v;
            }
            return best;
        }

        // ── Overlay updater (end labels + RBA decision markers) ───────────────
        function updateOverlays() {
            var chartW = chartEl.clientWidth;
            var chartH = chartEl.clientHeight;

            // ── RBA decision vertical markers ─────────────────────────────────
            overlayEl.innerHTML = '';
            if (!compact && rbaData.decisions.length) {
                rbaData.decisions.forEach(function (r, i) {
                    var x = chart.timeScale().timeToCoordinate(r.date);
                    if (x == null || !Number.isFinite(x) || x < 0 || x > chartW) return;

                    var prev = i === 0 ? (rbaData.points.length ? rbaData.points[0][1] : null) : rbaData.decisions[i - 1].rate;
                    var delta = (prev != null) ? r.rate - prev : null;
                    var arrow = delta == null ? '' : (delta > 0 ? ' ↑' : (delta < 0 ? ' ↓' : ''));

                    var line = document.createElement('div');
                    line.style.cssText = [
                        'position:absolute',
                        'top:0',
                        'bottom:0',
                        'left:' + Math.round(x) + 'px',
                        'width:1px',
                        'background:' + t.rba,
                        'opacity:0.25',
                        'border-left:1.5px dashed ' + t.rba,
                        'border-image:none',
                    ].join(';');
                    overlayEl.appendChild(line);

                    if (!narrow) {
                        var lbl = document.createElement('span');
                        lbl.textContent = r.rate.toFixed(2) + '%' + arrow;
                        lbl.style.cssText = [
                            'position:absolute',
                            'bottom:24px',
                            'left:' + (Math.round(x) + 3) + 'px',
                            'font-size:9px',
                            'color:' + t.rba,
                            'white-space:nowrap',
                            "font-family:'Space Grotesk',system-ui,sans-serif",
                            'writing-mode:vertical-rl',
                            'transform:rotate(180deg)',
                            'line-height:1',
                        ].join(';');
                        overlayEl.appendChild(lbl);
                    }
                });
            }

            // CDR data begins marker
            if (bankMin && bankMin > ctxMin && !compact) {
                var cx = chart.timeScale().timeToCoordinate(bankMin);
                if (cx != null && Number.isFinite(cx) && cx >= 0 && cx <= chartW) {
                    var cdrLine = document.createElement('div');
                    cdrLine.style.cssText = [
                        'position:absolute',
                        'top:0',
                        'bottom:0',
                        'left:' + Math.round(cx) + 'px',
                        'border-left:1.5px dashed ' + t.cdrLine,
                    ].join(';');
                    overlayEl.appendChild(cdrLine);
                    if (!narrow) {
                        var cdrLbl = document.createElement('span');
                        cdrLbl.textContent = 'CDR tracking begins';
                        cdrLbl.style.cssText = [
                            'position:absolute',
                            'bottom:20px',
                            'left:' + (Math.round(cx) + 3) + 'px',
                            'font-size:9px',
                            'color:' + t.muted,
                            'white-space:nowrap',
                            "font-family:'Space Grotesk',system-ui,sans-serif",
                            'writing-mode:vertical-rl',
                            'transform:rotate(180deg)',
                        ].join(';');
                        overlayEl.appendChild(cdrLbl);
                    }
                }
            }

            // ── End labels ────────────────────────────────────────────────────
            if (!labelEl) return;
            labelEl.innerHTML = '';

            var rawLabels = [];

            // Bank labels
            bankSeries.forEach(function (si) {
                if (!si.data.length) return;
                var last = si.data[si.data.length - 1];
                var y = si.api.priceToCoordinate(last.value);
                if (y == null || !Number.isFinite(y)) return;
                rawLabels.push({ y: y, label: si.bank.short, color: si.bank.color, rate: last.value, bold: false });
            });

            // RBA label
            if (rbaSeries && rbaData.points.length) {
                var rbaLast = rbaData.points[rbaData.points.length - 1];
                var rbaY = rbaSeries.priceToCoordinate(rbaLast[1]);
                if (rbaY != null && Number.isFinite(rbaY)) {
                    rawLabels.push({ y: rbaY, label: 'RBA', color: t.rba, rate: rbaLast[1], bold: true });
                }
            }

            // CPI label
            if (cpiSeries && cpiPts.length) {
                var cpiLast = cpiPts[cpiPts.length - 1];
                var cpiY = cpiSeries.priceToCoordinate(Array.isArray(cpiLast) ? cpiLast[1] : cpiLast.value);
                if (cpiY != null && Number.isFinite(cpiY)) {
                    rawLabels.push({ y: cpiY, label: 'CPI', color: t.cpi, rate: Array.isArray(cpiLast) ? cpiLast[1] : cpiLast.value, bold: false });
                }
            }

            var resolved = resolveEndLabelPositions(rawLabels, chartH);
            var panelH = labelEl.clientHeight || chartH;

            resolved.forEach(function (item) {
                if (item.y < 0 || item.y > panelH) return;
                var lbl = document.createElement('div');
                lbl.style.cssText = [
                    'position:absolute',
                    'left:4px',
                    'right:0',
                    'top:' + Math.round(item.y - END_LABEL_HEIGHT / 2) + 'px',
                    'height:' + END_LABEL_HEIGHT + 'px',
                    'display:flex',
                    'align-items:center',
                    'gap:3px',
                    'overflow:hidden',
                ].join(';');

                var dot = document.createElement('span');
                dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:' + item.color + ';flex-shrink:0;';
                lbl.appendChild(dot);

                var text = document.createElement('span');
                text.style.cssText = [
                    'font-size:10px',
                    'color:' + item.color,
                    'font-weight:' + (item.bold ? '700' : '600'),
                    'white-space:nowrap',
                    'overflow:hidden',
                    'text-overflow:ellipsis',
                    "font-family:'Space Grotesk',system-ui,sans-serif",
                    'line-height:1',
                ].join(';');
                text.textContent = item.label + '  ' + Number(item.rate).toFixed(2) + '%';
                lbl.appendChild(text);

                labelEl.appendChild(lbl);
            });
        }

        // ── Tooltip ───────────────────────────────────────────────────────────
        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                tooltipEl.style.display = 'none';
                return;
            }

            var time = String(param.time).slice(0, 10);
            var T = th();
            var sep = '<div style="border-top:1px solid rgba(148,163,184,0.15);margin:5px 0 3px;"></div>';
            var lines = [
                '<div style="font-size:10.5px;color:' + T.muted + ';letter-spacing:0.04em;margin-bottom:5px;">' + fmtFull(time) + '</div>',
            ];

            // Bank rows
            var cpiVal = cpiAtDate(time);
            var hasBanks = false;
            bankSeries.forEach(function (si) {
                var sd = param.seriesData && param.seriesData.get(si.api);
                var val = sd && Number.isFinite(sd.value) ? sd.value : null;
                if (val == null) return;
                hasBanks = true;
                var real = (cpiVal != null) ? val - cpiVal : null;
                var realHtml = '';
                if (real != null) {
                    var rc = real >= 0 ? T.good : T.bad;
                    var rl = (real >= 0 ? '+' : '') + real.toFixed(2) + '% real';
                    realHtml = ' <span style="color:' + rc + ';font-size:9.5px;">' + rl + '</span>';
                }
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + si.bank.color + ';margin-right:2px;flex-shrink:0;"></span>'
                    + '<span style="font-weight:600;white-space:nowrap;">' + si.bank.short + '</span>'
                    + '<span style="margin-left:auto;padding-left:10px;font-variant-numeric:tabular-nums;">' + val.toFixed(2) + '%</span>'
                    + realHtml
                    + '</div>'
                );
            });

            // RBA + CPI rows
            var rbaVal = null;
            if (rbaSeries) {
                var rd = param.seriesData && param.seriesData.get(rbaSeries);
                if (rd && Number.isFinite(rd.value)) rbaVal = rd.value;
            }
            var cpiDisplayVal = null;
            if (cpiSeries) {
                var cd = param.seriesData && param.seriesData.get(cpiSeries);
                if (cd && Number.isFinite(cd.value)) cpiDisplayVal = cd.value;
                else if (cpiVal != null) cpiDisplayVal = cpiVal;
            }

            if (hasBanks && (rbaVal != null || cpiDisplayVal != null)) lines.push(sep);

            if (rbaVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:12px;height:3px;background:' + T.rba + ';margin-right:2px;flex-shrink:0;"></span>'
                    + '<span style="color:' + T.rba + ';font-weight:600;">RBA Cash Rate</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + T.rba + ';font-variant-numeric:tabular-nums;">' + rbaVal.toFixed(2) + '%</span>'
                    + '</div>'
                );
            }
            if (cpiDisplayVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:12px;height:2px;background:' + T.cpi + ';border-top:1px dashed ' + T.cpi + ';margin-right:2px;flex-shrink:0;"></span>'
                    + '<span style="color:' + T.cpi + ';font-weight:600;">CPI</span>'
                    + '<span style="color:' + T.muted + ';font-size:9px;margin-left:2px;">annual</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + T.cpi + ';font-variant-numeric:tabular-nums;">' + Number(cpiDisplayVal).toFixed(1) + '%</span>'
                    + '</div>'
                );
            }

            if (lines.length <= 1) {
                tooltipEl.style.display = 'none';
                return;
            }

            tooltipEl.innerHTML = lines.join('');
            tooltipEl.style.display = 'block';

            // Position tooltip: avoid edges
            var containerW = chartRow.clientWidth;
            var containerH = chartRow.clientHeight;
            var ttW = 280, ttH = tooltipEl.offsetHeight || 120;
            var px = param.point.x, py = param.point.y;
            var left = Math.min(px + 14, containerW - ttW - 8);
            var top  = Math.min(py + 14, containerH - ttH - 8);
            if (left < 8) left = 8;
            if (top  < 8) top  = 8;
            tooltipEl.style.left = left + 'px';
            tooltipEl.style.top  = top  + 'px';
        });

        // Update overlays when time scale changes
        chart.timeScale().subscribeVisibleTimeRangeChange(updateOverlays);

        // ── Resize observer ───────────────────────────────────────────────────
        var ro = new ResizeObserver(function (entries) {
            var entry = entries[0];
            if (!entry) return;
            chart.resize(entry.contentRect.width, entry.contentRect.height);
            updateOverlays();
        });
        ro.observe(chartEl);

        // Initial overlay draw (after first paint)
        setTimeout(updateOverlays, 60);

        return {
            chart: chart,
            mount: mount,
            kind: 'economicReport',
            dispose: function () {
                ro.disconnect();
                try { chart.remove(); } catch (_e) { /* ignore */ }
            },
        };
    }

    window.AR.chartSavingsReportLwc = {
        render: render,
    };
})();
