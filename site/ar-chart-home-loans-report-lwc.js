/**
 * Home Loan Report chart — LightweightCharts (TradingView) implementation.
 *
 * Shows:
 *   - Lowest variable OO P&I rate per bank (stepped lines, title-labelled)
 *   - RBA cash rate             (amber step line)
 *
 * Native LWC pan / zoom / crosshair — no manual axis-drag code needed.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

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
            cdrLine:  dark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.18)',
            ttBg:     dark ? 'rgba(15,23,42,0.96)'    : 'rgba(255,255,255,0.97)',
            ttBorder: dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText:   dark ? '#e2e8f0'                : '#1e293b',
            good:     dark ? '#34d399'                : '#059669',
            bad:      dark ? '#f87171'                : '#dc2626',
            spread:   dark ? '#fb923c'                : '#ea580c',
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
    // Builds one stepped line per bank showing the lowest variable OO P&I rate over time.
    // Uses allSeries (full unfiltered list) so density truncation doesn't exclude banks.
    function buildBankSeries(allSeries) {
        // Filter to variable owner-occupied P&I products only
        var filtered = (allSeries || []).filter(function (s) {
            var row = (s.points && s.points[0] && s.points[0].row) || s.latestRow || {};
            var rs = row.rate_structure;
            var sp = row.security_purpose;
            var rt = row.repayment_type;
            var okRs = (rs == null || rs === '' || rs === 'variable');
            var okSp = (sp == null || sp === '' || sp === 'owner_occupied');
            var okRt = (rt == null || rt === '' || rt === 'principal_and_interest');
            return okRs && okSp && okRt;
        });

        // Per-bank MIN rate per date.
        // Apply a floor of 4.0% to exclude anomalously low rates (gov-backed veterans products,
        // data collection errors) that are below typical cash-rate floors.
        var MIN_RATE = 4.0;
        var byBank = {};
        filtered.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                if (!d || !Number.isFinite(v) || v < MIN_RATE) return;
                if (byBank[k].byDate[d] == null || v < byBank[k].byDate[d]) byBank[k].byDate[d] = v;
            });
        });

        return Object.keys(byBank)
            .map(function (k) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) { return { date: d, value: e.byDate[d] }; });
                return { bankName: e.bankName, points: pts, latest: pts.length ? pts[pts.length - 1].value : 0 };
            })
            .filter(function (b) { return b.points.length > 0; })
            .sort(function (a, b) { return a.latest - b.latest; })
            .map(function (b, i) {
                b.short = bankShort(b.bankName);
                b.color = bankColor(b.bankName, i);
                return b;
            });
    }

    function buildRbaSeries(rbaHistory) {
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

        return { points: deduped.slice(), decisions: deduped.slice() };
    }

    // ── Main render ───────────────────────────────────────────────────────────
    function render(container, model, rbaHistory) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        // ── Prepare data ──────────────────────────────────────────────────────
        // Use allSeries (full product list, not density-truncated) filtered to variable OO P&I
        // so we show the competitive advertised rate per bank, not specialty products.
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var banks = buildBankSeries(allSeries);

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

        var rbaData = buildRbaSeries(rbaHistory || []);

        // Clip RBA points to context window with carry-back at ctxMin
        (function () {
            var all = rbaData.points;
            var carry = null, inWindow = [];
            all.forEach(function (p) {
                if (p.date < ctxMin) carry = p;
                else if (p.date <= ctxMax) inWindow.push(p);
            });
            var carryRate = carry ? carry.rate : (inWindow.length ? inWindow[0].rate : null);
            var pts = [];
            if (carryRate != null) pts.push({ date: ctxMin, rate: carryRate });
            inWindow.forEach(function (p) { pts.push(p); });
            rbaData.points = pts;
        }());

        // Extend step lines to ctxMax so carry-forward reaches right edge
        if (rbaData.points.length) {
            var rbaLast = rbaData.points[rbaData.points.length - 1];
            if (rbaLast.date < ctxMax) rbaData.points.push({ date: ctxMax, rate: rbaLast.rate });
        }

        var W = container.clientWidth || 800;
        var compact = W < 480, narrow = W < 720;
        var maxBanks = compact ? 4 : (narrow ? 7 : 10);
        var visiBanks = banks.slice(0, maxBanks);

        // ── DOM: mount fills container ────────────────────────────────────────
        container.innerHTML = '';
        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--hl-report';
        mount.style.width    = '100%';
        mount.style.height   = '100%';
        mount.style.minHeight = '400px';
        mount.style.position = 'relative';
        container.appendChild(mount);

        var t = th();

        // ── Context label ─────────────────────────────────────────────────────
        var ctxLabelEl = document.createElement('div');
        ctxLabelEl.textContent = 'Variable OO P&I';
        ctxLabelEl.style.cssText = [
            'position:absolute',
            'bottom:44px',
            'left:8px',
            'font-size:9px',
            'opacity:0.45',
            'color:inherit',
            'pointer-events:none',
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'white-space:nowrap',
            'z-index:3',
        ].join(';');
        mount.appendChild(ctxLabelEl);

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

        // ── Bank lines ────────────────────────────────────────────────────────
        var bankSeriesApis = [];
        visiBanks.forEach(function (bank) {
            var allPts = bank.points;
            // Find the last point at-or-before ctxMin for carry-back
            var carryPt = null;
            for (var j = 0; j < allPts.length; j++) {
                if (allPts[j].date <= ctxMin) carryPt = allPts[j];
                else break;
            }
            // Only include points strictly inside [ctxMin, ctxMax]
            var rawPts = allPts.filter(function (p) { return p.date >= ctxMin && p.date <= ctxMax; });
            // Carry back to ctxMin only when we have data predating ctxMin.
            // No fabricated carry-back when bank data starts after ctxMin.
            if (carryPt) {
                rawPts = [{ date: ctxMin, value: carryPt.value }].concat(rawPts);
            }
            // Carry-forward to ctxMax so the line reaches the right edge
            if (rawPts.length) {
                var lastPt = rawPts[rawPts.length - 1];
                if (lastPt.date < ctxMax) rawPts = rawPts.concat([{ date: ctxMax, value: lastPt.value }]);
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
                lineWidth:               2,
                lineType:                LineType.WithSteps,
                title:                   'RBA',
                priceLineVisible:        false,
                lastValueVisible:        true,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            rbaSeriesApi.setData(rbaData.points.map(function (p) { return { time: p.date, value: p.rate }; }));
        }

        // Fit to 18-month context window
        chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax });

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

        mount.addEventListener('mouseleave', function () { tooltipEl.style.display = 'none'; });
        mount.addEventListener('dblclick',   function () { chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax }); });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                tooltipEl.style.display = 'none';
                return;
            }
            var time = String(param.time).slice(0, 10);
            var T    = th();
            var sep  = '<div style="border-top:1px solid rgba(148,163,184,0.15);margin:5px 0 3px;"></div>';
            var lines = ['<div style="font-size:10.5px;color:' + T.muted + ';letter-spacing:0.04em;margin-bottom:5px;">' + fmtFull(time) + '</div>'];

            var rbaVal = null;
            if (rbaSeriesApi) {
                var rd = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rd && Number.isFinite(rd.value)) rbaVal = rd.value;
            }

            var hasBanks = false;
            bankSeriesApis.forEach(function (si) {
                var sd = param.seriesData && param.seriesData.get(si.api);
                var val = (sd && Number.isFinite(sd.value)) ? sd.value : null;
                if (val == null) return;
                hasBanks = true;
                var spreadHtml = '';
                if (rbaVal != null) {
                    var spread = val - rbaVal;
                    var spreadStr = spread >= 0
                        ? '+' + spread.toFixed(2) + '% above RBA'
                        : spread.toFixed(2) + '% vs RBA';
                    spreadHtml = ' <span style="color:' + T.spread + ';font-size:9.5px;">' + spreadStr + '</span>';
                }
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + si.bank.color + ';flex-shrink:0;"></span>'
                    + '<span style="font-weight:600;white-space:nowrap;">' + si.bank.short + '</span>'
                    + '<span style="margin-left:auto;padding-left:10px;font-variant-numeric:tabular-nums;">' + val.toFixed(2) + '%</span>'
                    + spreadHtml
                    + '</div>'
                );
            });

            if (hasBanks && rbaVal != null) lines.push(sep);

            if (rbaVal != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">'
                    + '<span style="display:inline-block;width:12px;height:3px;background:' + T.rba + ';flex-shrink:0;"></span>'
                    + '<span style="color:' + T.rba + ';font-weight:700;">RBA</span>'
                    + '<span style="margin-left:auto;padding-left:10px;color:' + T.rba + ';font-variant-numeric:tabular-nums;">' + rbaVal.toFixed(2) + '%</span>'
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
        });
        ro.observe(mount);

        return {
            chart: chart,
            mount: mount,
            kind:  'homeLoanReport',
            dispose: function () {
                ro.disconnect();
                try { chart.remove(); } catch (_e) { /* ignore */ }
            },
        };
    }

    window.AR.chartHomeLoanReportLwc = { render: render };
})();
