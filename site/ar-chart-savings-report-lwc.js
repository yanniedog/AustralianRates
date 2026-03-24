/**
 * Economic Report chart — LightweightCharts (TradingView) implementation.
 *
 * Shows:
 *   - Best savings rate per bank (stepped lines, title-labelled)
 *   - RBA cash rate             (amber step line)
 *   - CPI inflation             (dashed rose step line, live from /cpi/history API)
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
                // Exclude points below 1% — collection errors or non-savings products
                if (!d || !Number.isFinite(v) || v < 1.0) return;
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

    // ── Main render ───────────────────────────────────────────────────────────
    function render(container, model, rbaHistory, cpiData) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        var M = window.AR.chartMacroLwcShared;
        if (!M || typeof M.prepareRbaCpiForReport !== 'function') {
            throw new Error('chartMacroLwcShared not loaded');
        }

        // ── Prepare data ──────────────────────────────────────────────────────
        // Use allSeries so MAX aggregation covers all products from all banks,
        // not just the density-limited visibleSeries (which might over-represent one bank).
        var visibleSeries = (model && (model.allSeries || model.visibleSeries)) || [];
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
        var viewStart = subtractMonths(ctxMax, 3);

        var prep = M.prepareRbaCpiForReport(rbaHistory, cpiData, ctxMax);
        var rbaData = prep.rbaData;
        var cpiPts = prep.cpiPoints;
        var rbaStart = prep.rbaStart;

        var compact = (container.clientWidth || 800) < 480;
        var maxBanks = Math.min(banks.length, 100);
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
                scaleMargins: { top: 0.06, bottom: 0.12 },
                lastValueVisible: false,
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
                timeFormatter: function (time) { return fmtFull(M.utcToYmd(time)); },
            },
            handleScroll:  { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
            handleScale:   { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
        });

        // ── CPI line ──────────────────────────────────────────────────────────
        var cpiSeriesApi = null;
        if (cpiPts.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, {
                color:                   t.cpi,
                lineWidth:               2,
                lineStyle:               LineStyle.Dashed,
                lineType:                LineType.Simple,
                title:                   '',
                priceLineVisible:        false,
                lastValueVisible:        false,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            cpiSeriesApi.setData(
                M.fillForwardDaily(cpiPts, 'date', 'value', rbaStart, ctxMax)
                    .map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; })
            );
        }

        // ── Bank lines ────────────────────────────────────────────────────────
        var bankSeriesApis = []; // [{api, bank}]
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
            // Carry the last known rate back to ctxMin only when we have data preceding ctxMin.
            // Do NOT carry forward when bank data starts after ctxMin — that would fabricate
            // a flat "historical" line across months where we have no actual data.
            if (carryPt) {
                rawPts = [{ date: ctxMin, value: carryPt.value }].concat(rawPts);
            }
            // Carry-forward to ctxMax so the line reaches the right edge
            if (rawPts.length) {
                var lastPt = rawPts[rawPts.length - 1];
                if (lastPt.date < ctxMax) rawPts = rawPts.concat([{ date: ctxMax, value: lastPt.value }]);
            }
            var data = rawPts.map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; });
            var ser = chart.addSeries(L.LineSeries, {
                color:                   bank.color,
                lineWidth:               compact ? 1.5 : 2,
                lineType:                LineType.Simple,
                title:                   '',
                priceLineVisible:        false,
                lastValueVisible:        false,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            ser.setData(data);
            bankSeriesApis.push({ api: ser, bank: bank, lastValue: data.length ? data[data.length - 1].value : null });
        });

        // ── RBA line (added last = topmost render order) ───────────────────────
        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, {
                color:                   t.rba,
                lineWidth:               2,
                lineType:                LineType.Simple,
                title:                   '',
                priceLineVisible:        false,
                lastValueVisible:        false,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            rbaSeriesApi.setData(
                M.fillForwardDaily(rbaData.points, 'date', 'rate', rbaStart, ctxMax)
                    .map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; })
            );
        }

        chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });

        // ── Persistent legend column (top-left, vertical stack) ──
        var legendEl = document.createElement('div');
        legendEl.style.cssText = [
            'position:absolute',
            'top:8px',
            'left:8px',
            'display:flex',
            'flex-direction:column',
            'align-items:flex-start',
            'gap:1px',
            'padding:4px 6px',
            'font-size:9px',
            'line-height:1.4',
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'color:' + t.ttText,
            'background:' + t.ttBg,
            'border:1px solid ' + t.ttBorder,
            'border-radius:4px',
            'pointer-events:none',
            'z-index:5'
        ].join(';');
        var sortedLegend = bankSeriesApis.slice().sort(function (a, b) {
            return (b.lastValue != null ? b.lastValue : -Infinity) - (a.lastValue != null ? a.lastValue : -Infinity);
        });
        sortedLegend.forEach(function (entry) {
            if (entry.lastValue == null) return;
            var item = document.createElement('span');
            item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
            item.innerHTML =
                '<span style="display:inline-block;width:14px;height:2px;background:' + entry.bank.color + ';flex-shrink:0;border-radius:1px;"></span>' +
                '<span style="opacity:0.7;">' + entry.bank.short + '</span>' +
                '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + entry.lastValue.toFixed(2) + '%</span>';
            legendEl.appendChild(item);
        });
        if (rbaSeriesApi && rbaData.points.length) {
            var rbaLast = rbaData.points[rbaData.points.length - 1].rate;
            var rbaItem = document.createElement('span');
            rbaItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);';
            rbaItem.innerHTML =
                '<span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span>' +
                '<span style="color:' + t.rba + ';opacity:0.8;">RBA</span>' +
                '<span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaLast.toFixed(2) + '%</span>';
            legendEl.appendChild(rbaItem);
        }
        if (cpiSeriesApi && cpiPts.length) {
            var cpiLast = cpiPts[cpiPts.length - 1].value;
            var cpiItem = document.createElement('span');
            cpiItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
            cpiItem.innerHTML =
                '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                '<span style="color:' + t.cpi + ';opacity:0.8;">CPI</span>' +
                '<span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiLast).toFixed(1) + '%</span>';
            legendEl.appendChild(cpiItem);
        }
        mount.appendChild(legendEl);

        var defaultLegendHTML = legendEl.innerHTML;

        function populateLegend(bankItems, rbaVal, cpiDisplayVal, dateLabel) {
            legendEl.innerHTML = '';
            if (dateLabel) {
                var dl = document.createElement('span');
                dl.style.cssText = 'font-size:8px;color:' + t.muted + ';white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);flex-shrink:0;letter-spacing:0.02em;';
                dl.textContent = dateLabel;
                legendEl.appendChild(dl);
            }
            var sorted = bankItems.slice().sort(function (a, b) {
                return (b.value != null ? b.value : -Infinity) - (a.value != null ? a.value : -Infinity);
            });
            sorted.forEach(function (entry) {
                if (entry.value == null) return;
                var item = document.createElement('span');
                item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
                item.innerHTML =
                    '<span style="display:inline-block;width:14px;height:2px;background:' + entry.bank.color + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="opacity:0.7;">' + entry.bank.short + '</span>' +
                    '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + entry.value.toFixed(2) + '%</span>';
                legendEl.appendChild(item);
            });
            if (rbaVal != null) {
                var rbaItem = document.createElement('span');
                rbaItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);';
                rbaItem.innerHTML =
                    '<span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="color:' + t.rba + ';opacity:0.8;">RBA</span>' +
                    '<span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaVal.toFixed(2) + '%</span>';
                legendEl.appendChild(rbaItem);
            }
            if (cpiDisplayVal != null) {
                var cpiItem = document.createElement('span');
                cpiItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
                cpiItem.innerHTML =
                    '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                    '<span style="color:' + t.cpi + ';opacity:0.8;">CPI</span>' +
                    '<span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiDisplayVal).toFixed(1) + '%</span>';
                legendEl.appendChild(cpiItem);
            }
        }

        mount.addEventListener('mouseleave', function () { legendEl.innerHTML = defaultLegendHTML; });
        mount.addEventListener('dblclick',   function () { chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) }); });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                legendEl.innerHTML = defaultLegendHTML;
                return;
            }
            var time = M.utcToYmd(param.time);
            var cpiVal = M.cpiAtDate(cpiPts, time);
            var rbaVal = null;
            if (rbaSeriesApi) {
                var rd = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rd && Number.isFinite(rd.value)) rbaVal = rd.value;
            }
            var bankItems = [];
            bankSeriesApis.forEach(function (si) {
                var sd  = param.seriesData && param.seriesData.get(si.api);
                var val = (sd && Number.isFinite(sd.value)) ? sd.value : null;
                if (val != null) bankItems.push({ bank: si.bank, value: val });
            });
            if (!bankItems.length && rbaVal == null && cpiVal == null) {
                legendEl.innerHTML = defaultLegendHTML;
                return;
            }
            populateLegend(bankItems, rbaVal, cpiVal, fmtFull(time));
        });

        // ── Resize observer ───────────────────────────────────────────────────
        var ro = new ResizeObserver(function (entries) {
            var entry = entries[0];
            if (!entry) return;
            var w = entry.contentRect.width;
            var h = Math.max(200, entry.contentRect.height);
            chart.resize(w, h);
            chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });
        });
        ro.observe(mount);

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
