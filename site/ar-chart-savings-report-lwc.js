/**
 * Economic Report chart — LightweightCharts (TradingView) implementation.
 *
 * Shows:
 *   - Best savings rate per bank (stepped lines, title-labelled)
 *   - RBA cash rate             (thick amber step line, decision markers)
 *   - CPI inflation             (dashed rose step line)
 *
 * Native LWC pan / zoom / crosshair — no manual axis-drag code needed.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    // ── Embedded CPI data ─────────────────────────────────────────────────────
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
        'westpac banking corporation':    'Westpac',
        'anz':                            'ANZ',
        'national australia bank':        'NAB',
        'macquarie bank':                 'Macquarie',
        'ing':                            'ING',
        'ubank':                          'UBank',
        'bankwest':                       'Bankwest',
        'bank of queensland':             'BOQ',
        'suncorp bank':                   'Suncorp',
        'great southern bank':            'GSB',
        'amp bank':                       'AMP',
        'bendigo and adelaide bank':      'Bendigo',
        'bank of melbourne':              'BoM',
        'st. george bank':                'St.George',
        'hsbc australia':                 'HSBC',
        'teachers mutual bank':           'Teachers',
        'beyond bank australia':          'Beyond',
        'me bank':                        'ME Bank',
        'mystate bank':                   'MyState',
    };
    var BANK_COLOR = {
        'commonwealth bank of australia': '#e8b400',
        'westpac banking corporation':    '#d50032',
        'anz':                            '#0033a0',
        'national australia bank':        '#8a1538',
        'macquarie bank':                 '#006d5b',
        'ing':                            '#ff6200',
        'ubank':                          '#7d3e84',
        'bankwest':                       '#4a8f26',
        'bank of queensland':             '#00a3e0',
        'suncorp bank':                   '#1b5fa8',
        'great southern bank':            '#00a651',
        'amp bank':                       '#c85a00',
        'bendigo and adelaide bank':      '#a6192e',
        'bank of melbourne':              '#6b1f3a',
        'st. george bank':                '#b8000a',
        'hsbc australia':                 '#cc0000',
        'teachers mutual bank':           '#1a6b3c',
        'beyond bank australia':          '#005ea8',
        'me bank':                        '#003b6f',
        'mystate bank':                   '#e05c00',
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
            text:     dark ? '#e2e8f0'                : '#0f172a',
            muted:    dark ? '#94a3b8'                : '#64748b',
            grid:     dark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.16)',
            axis:     dark ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.35)',
            rba:      '#f59e0b',
            rbaLine:  dark ? 'rgba(245,158,11,0.20)'  : 'rgba(245,158,11,0.16)',
            cpi:      dark ? '#f87171'                : '#dc2626',
            cdrLine:  dark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.18)',
            ttBg:     dark ? 'rgba(15,23,42,0.96)'    : 'rgba(255,255,255,0.97)',
            ttBorder: dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText:   dark ? '#e2e8f0'                : '#1e293b',
            good:     dark ? '#34d399'                : '#059669',
            bad:      dark ? '#f87171'                : '#dc2626',
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

        var carry = null, decisions = [];
        deduped.forEach(function (r) {
            if (r.date < contextMin) carry = r;
            else if (r.date <= contextMax) decisions.push(r);
        });

        var carryRate = carry ? carry.rate : (decisions.length ? decisions[0].rate : null);
        var points = [];
        if (carryRate != null) points.push({ date: contextMin, rate: carryRate });
        decisions.forEach(function (r) { points.push({ date: r.date, rate: r.rate }); });

        var rateDecisions = decisions.filter(function (r, i) {
            var prev = i === 0 ? carryRate : decisions[i - 1].rate;
            return prev == null || r.rate !== prev;
        });

        return { points: points, decisions: rateDecisions };
    }

    function buildCpiSeries(contextMin, contextMax) {
        var carry = null, inRange = [];
        ABS_CPI.forEach(function (e) {
            if (e.date < contextMin) carry = e;
            else if (e.date <= contextMax) inRange.push(e);
        });
        var pts = [];
        if (carry) pts.push({ date: contextMin, value: carry.value });
        inRange.forEach(function (e) { pts.push({ date: e.date, value: e.value }); });
        return pts;
    }

    function extendToMax(pts, ctxMax, keyFn, valFn) {
        if (!pts.length) return pts;
        var last = pts[pts.length - 1];
        if (String(keyFn(last)) < ctxMax) {
            var clone = {};
            Object.keys(last).forEach(function (k) { clone[k] = last[k]; });
            clone[Object.keys(last)[0]] = ctxMax; // update date/first key — fine since all our objects have 'date' first
            // Safer: just push a new object
            var ext = {};
            if ('rate' in last) { ext.date = ctxMax; ext.rate = valFn(last); }
            else                { ext.date = ctxMax; ext.value = valFn(last); }
            return pts.concat([ext]);
        }
        return pts;
    }

    // CPI step carry-forward for tooltip
    function cpiAtDate(cpiPts, dateStr) {
        var best = null;
        for (var i = 0; i < cpiPts.length; i++) {
            if (String(cpiPts[i].date) <= dateStr) best = cpiPts[i].value;
        }
        return best;
    }

    // ── Overlay: RBA vertical decision markers ────────────────────────────────
    function updateRbaOverlay(overlayEl, chart, decisions, carryRate, chartW, t, narrow) {
        overlayEl.innerHTML = '';
        if (narrow || !decisions.length) return;
        decisions.forEach(function (r, i) {
            var x = chart.timeScale().timeToCoordinate(r.date);
            if (x == null || !Number.isFinite(x) || x < 2 || x > chartW - 2) return;

            var line = document.createElement('div');
            line.style.cssText = [
                'position:absolute',
                'top:0',
                'bottom:0',
                'left:' + Math.round(x) + 'px',
                'width:0',
                'border-left:1.5px dashed ' + t.rba,
                'opacity:0.30',
            ].join(';');
            overlayEl.appendChild(line);

            var prev = i === 0 ? carryRate : decisions[i - 1].rate;
            var delta = (prev != null) ? r.rate - prev : null;
            var arrow = delta == null ? '' : (delta > 0 ? ' ↑' : (delta < 0 ? ' ↓' : ''));
            var lbl = document.createElement('span');
            lbl.textContent = r.rate.toFixed(2) + '%' + arrow;
            lbl.style.cssText = [
                'position:absolute',
                'bottom:28px',
                'left:' + (Math.round(x) + 3) + 'px',
                'font-size:9px',
                'color:' + t.rba,
                'white-space:nowrap',
                "font-family:'Space Grotesk',system-ui,sans-serif",
                'writing-mode:vertical-rl',
                'transform:rotate(180deg)',
            ].join(';');
            overlayEl.appendChild(lbl);
        });
    }

    // ── Main render ───────────────────────────────────────────────────────────
    function render(container, model, rbaHistory) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        // ── Prepare data ──────────────────────────────────────────────────────
        var visibleSeries = (model && model.visibleSeries) || [];
        var banks = buildBankSeries(visibleSeries);

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
        var cpiPts  = buildCpiSeries(ctxMin, ctxMax);

        // Extend step lines to ctxMax so carry-forward reaches right edge
        if (rbaData.points.length) {
            var rbaLast = rbaData.points[rbaData.points.length - 1];
            if (rbaLast.date < ctxMax) rbaData.points.push({ date: ctxMax, rate: rbaLast.rate });
        }
        if (cpiPts.length) {
            var cpiLast = cpiPts[cpiPts.length - 1];
            if (cpiLast.date < ctxMax) cpiPts.push({ date: ctxMax, value: cpiLast.value });
        }

        // Carry-forward rate used for decisions preceeding context window
        var rbaCarryRate = rbaData.points.length ? rbaData.points[0].rate : null;

        var W = container.clientWidth || 800;
        var compact = W < 480, narrow = W < 720;
        var maxBanks = compact ? 4 : (narrow ? 7 : 10);
        var visiBanks = banks.slice(0, maxBanks);

        // ── DOM: mount fills container (same pattern as renderMainCompare) ─────
        container.innerHTML = '';
        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--econ-report';
        mount.style.width    = '100%';
        mount.style.height   = '100%';
        mount.style.minHeight = '400px';
        mount.style.position = 'relative';
        container.appendChild(mount);

        var t = th();

        // ── Create LWC chart ──────────────────────────────────────────────────
        var LineStyle = (L.LineStyle) || { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
        var LineType  = (L.LineType)  || { Simple: 0, WithSteps: 1, Curved: 2 };

        var chart = L.createChart(mount, {
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
            },
            timeScale: {
                borderColor: t.axis,
                timeVisible: false,
                secondsVisible: false,
                rightOffset: 5,
            },
            crosshair: {
                mode: L.CrosshairMode.Normal,
                vertLine: {
                    color: 'rgba(148,163,184,0.45)',
                    width: 1,
                    style: LineStyle.Dashed,
                    labelBackgroundColor: 'rgba(100,116,139,0.80)',
                },
                horzLine: {
                    color: 'rgba(148,163,184,0.45)',
                    width: 1,
                    labelBackgroundColor: 'rgba(100,116,139,0.80)',
                },
            },
            localization: {
                priceFormatter: function (p) { return Number(p).toFixed(2) + '%'; },
                timeFormatter: function (time) { return fmtMonYr(String(time).slice(0, 10)); },
            },
            handleScroll:  { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
            handleScale:   { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        });

        // ── CPI line ──────────────────────────────────────────────────────────
        var cpiSeriesApi = null;
        if (cpiPts.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, {
                color:                   t.cpi,
                lineWidth:               2,
                lineStyle:               LineStyle.Dashed,
                lineType:                LineType.WithSteps,
                title:                   'CPI',
                priceLineVisible:        false,
                lastValueVisible:        true,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            cpiSeriesApi.setData(cpiPts.map(function (p) { return { time: p.date, value: p.value }; }));
        }

        // ── Bank lines ────────────────────────────────────────────────────────
        var bankSeriesApis = []; // [{api, bank}]
        visiBanks.forEach(function (bank) {
            var rawPts = bank.points.slice();
            // Carry-forward first known rate back to ctxMin
            if (rawPts.length && rawPts[0].date > ctxMin) {
                rawPts = [{ date: ctxMin, value: rawPts[0].value }].concat(rawPts);
            }
            var data = rawPts.map(function (p) { return { time: p.date, value: p.value }; });
            var ser = chart.addSeries(L.LineSeries, {
                color:                   bank.color,
                lineWidth:               compact ? 1.5 : 2,
                lineType:                LineType.WithSteps,
                title:                   bank.short,
                priceLineVisible:        false,
                lastValueVisible:        true,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            ser.setData(data);
            bankSeriesApis.push({ api: ser, bank: bank });
        });

        // ── RBA line (added last = topmost render order) ───────────────────────
        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, {
                color:                   t.rba,
                lineWidth:               compact ? 2.5 : 3.5,
                lineType:                LineType.WithSteps,
                title:                   'RBA',
                priceLineVisible:        false,
                lastValueVisible:        true,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   4,
            });
            rbaSeriesApi.setData(rbaData.points.map(function (p) { return { time: p.date, value: p.rate }; }));
        }

        // Fit to 18-month context window
        chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax });

        // ── RBA decision vertical marker overlay ──────────────────────────────
        var overlayEl = document.createElement('div');
        overlayEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden;';
        mount.appendChild(overlayEl);

        function refreshRbaOverlay() {
            updateRbaOverlay(overlayEl, chart, rbaData.decisions, rbaCarryRate, mount.clientWidth, t, narrow || compact);
        }

        chart.timeScale().subscribeVisibleTimeRangeChange(refreshRbaOverlay);

        // ── Crosshair tooltip ─────────────────────────────────────────────────
        var tooltipEl = document.createElement('div');
        tooltipEl.style.cssText = [
            'position:absolute',
            'z-index:10',
            'pointer-events:none',
            'display:none',
            'background:' + t.ttBg,
            'border:1px solid ' + t.ttBorder,
            'border-radius:8px',
            'padding:10px 14px',
            'font-size:12px',
            'color:' + t.ttText,
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
            'max-width:300px',
            'min-width:160px',
        ].join(';');
        mount.appendChild(tooltipEl);

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                tooltipEl.style.display = 'none';
                return;
            }
            var time    = String(param.time).slice(0, 10);
            var T       = th();
            var cpiVal  = cpiAtDate(cpiPts, time);
            var sep     = '<div style="border-top:1px solid rgba(148,163,184,0.15);margin:5px 0 3px;"></div>';
            var lines   = ['<div style="font-size:10.5px;color:' + T.muted + ';letter-spacing:0.04em;margin-bottom:5px;">' + fmtFull(time) + '</div>'];

            var hasBanks = false;
            bankSeriesApis.forEach(function (si) {
                var sd = param.seriesData && param.seriesData.get(si.api);
                var val = (sd && Number.isFinite(sd.value)) ? sd.value : null;
                if (val == null) return;
                hasBanks = true;
                var real = (cpiVal != null) ? val - cpiVal : null;
                var realHtml = '';
                if (real != null) {
                    var c  = real >= 0 ? T.good : T.bad;
                    var rl = (real >= 0 ? '+' : '') + real.toFixed(2) + '% real';
                    realHtml = ' <span style="color:' + c + ';font-size:9.5px;">' + rl + '</span>';
                }
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + si.bank.color + ';flex-shrink:0;"></span>'
                    + '<span style="font-weight:600;white-space:nowrap;">' + si.bank.short + '</span>'
                    + '<span style="margin-left:auto;padding-left:10px;font-variant-numeric:tabular-nums;">' + val.toFixed(2) + '%</span>'
                    + realHtml
                    + '</div>'
                );
            });

            var rbaVal = null;
            if (rbaSeriesApi) {
                var rd = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rd && Number.isFinite(rd.value)) rbaVal = rd.value;
            }
            var cpiDisplayVal = null;
            if (cpiSeriesApi) {
                var cd = param.seriesData && param.seriesData.get(cpiSeriesApi);
                if (cd && Number.isFinite(cd.value)) cpiDisplayVal = cd.value;
                else if (cpiVal != null) cpiDisplayVal = cpiVal;
            }

            if (hasBanks && (rbaVal != null || cpiDisplayVal != null)) lines.push(sep);

            if (rbaVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:12px;height:3px;background:' + T.rba + ';flex-shrink:0;"></span>'
                    + '<span style="color:' + T.rba + ';font-weight:700;">RBA</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + T.rba + ';font-variant-numeric:tabular-nums;">' + rbaVal.toFixed(2) + '%</span>'
                    + '</div>'
                );
            }
            if (cpiDisplayVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:12px;height:2px;border-top:2px dashed ' + T.cpi + ';flex-shrink:0;"></span>'
                    + '<span style="color:' + T.cpi + ';font-weight:600;">CPI</span>'
                    + '<span style="color:' + T.muted + ';font-size:9px;margin-left:2px;">annual</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + T.cpi + ';font-variant-numeric:tabular-nums;">' + Number(cpiDisplayVal).toFixed(1) + '%</span>'
                    + '</div>'
                );
            }

            if (lines.length <= 1) { tooltipEl.style.display = 'none'; return; }

            tooltipEl.innerHTML = lines.join('');
            tooltipEl.style.display = 'block';

            var mW = mount.clientWidth, mH = mount.clientHeight;
            var ttW = 290, ttH = tooltipEl.offsetHeight || 120;
            var px = param.point.x + 14, py = param.point.y + 14;
            if (px + ttW > mW - 4) px = param.point.x - ttW - 10;
            if (py + ttH > mH - 4) py = param.point.y - ttH - 10;
            tooltipEl.style.left = Math.max(4, px) + 'px';
            tooltipEl.style.top  = Math.max(4, py) + 'px';
        });

        // ── Resize observer ───────────────────────────────────────────────────
        var ro = new ResizeObserver(function (entries) {
            var entry = entries[0];
            if (!entry) return;
            var w = entry.contentRect.width;
            var h = Math.max(200, entry.contentRect.height);
            chart.resize(w, h);
            refreshRbaOverlay();
        });
        ro.observe(mount);

        // Initial overlay draw after first paint
        setTimeout(refreshRbaOverlay, 80);

        return {
            chart: chart,
            mount: mount,
            kind:  'economicReport',
            dispose: function () {
                ro.disconnect();
                try { chart.remove(); } catch (_e) { /* ignore */ }
            },
        };
    }

    window.AR.chartSavingsReportLwc = { render: render };
})();
