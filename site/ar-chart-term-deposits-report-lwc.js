/**
 * Term Deposit Report chart — LightweightCharts (TradingView) implementation.
 *
 * Shows:
 *   - Best TD rate per bank for the preferred term (stepped lines, title-labelled)
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
    function determineTargetTerm(visibleSeries) {
        var termPreference = [12, 6, 24, 3, 18, 36, 9, 2, 1];
        var termsFound = {};
        (visibleSeries || []).forEach(function (s) {
            var sampleRow = (s.points && s.points[0]) ? (s.points[0].row || {}) : {};
            var tm = sampleRow.term_months;
            if (tm != null && tm !== undefined && tm !== '') {
                termsFound[Number(tm)] = true;
            }
        });
        for (var i = 0; i < termPreference.length; i++) {
            if (termsFound[termPreference[i]]) return termPreference[i];
        }
        return null;
    }

    function buildBankSeries(visibleSeries, targetTerm) {
        var byBank = {};
        var filterApplied = targetTerm != null;

        var sourceSeries = visibleSeries || [];
        if (filterApplied) {
            var filtered = sourceSeries.filter(function (s) {
                var sampleRow = (s.points && s.points[0]) ? (s.points[0].row || {}) : {};
                var tm = sampleRow.term_months;
                // Accept series with matching term OR absent term_months
                if (tm == null || tm === undefined || tm === '') return true;
                return Number(tm) === targetTerm;
            });

            // Count banks in filtered pass
            var filteredBanks = {};
            filtered.forEach(function (s) {
                var bn = String(s.bankName || '').trim();
                if (bn) filteredBanks[bn.toLowerCase()] = true;
            });

            if (Object.keys(filteredBanks).length === 0) {
                // Fallback: accept all series
                filterApplied = false;
                sourceSeries = visibleSeries || [];
            } else {
                sourceSeries = filtered;
            }
        }

        sourceSeries.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                // Exclude points below 0.5% — collection errors or non-TD products
                if (!d || !Number.isFinite(v) || v < 0.5) return;
                // MAX rate per bank per date (higher = better for depositor)
                if (byBank[k].byDate[d] == null || v > byBank[k].byDate[d]) byBank[k].byDate[d] = v;
            });
        });

        var result = Object.keys(byBank)
            .map(function (k) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) { return { date: d, value: e.byDate[d] }; });
                return { bankName: e.bankName, points: pts, latest: pts.length ? pts[pts.length - 1].value : 0 };
            })
            .sort(function (a, b) { return b.latest - a.latest; }) // descending: highest first
            .map(function (b, i) {
                b.short = bankShort(b.bankName);
                b.color = bankColor(b.bankName, i);
                return b;
            });

        return { banks: result, filterApplied: filterApplied };
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

    function buildCpiSeries(cpiData) {
        return (Array.isArray(cpiData) ? cpiData : []).map(function (e) {
            return { date: String(e.quarter_date || e.date || ''), value: Number(e.annual_change != null ? e.annual_change : e.value) };
        }).filter(function (p) { return p.date && Number.isFinite(p.value); });
    }

    // CPI step carry-forward for tooltip
    function cpiAtDate(cpiPts, dateStr) {
        var best = null;
        for (var i = 0; i < cpiPts.length; i++) {
            if (String(cpiPts[i].date) <= dateStr) best = cpiPts[i].value;
        }
        return best;
    }

    // ── Main render ───────────────────────────────────────────────────────────
    function render(container, model, rbaHistory, cpiData) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        // ── Prepare data ──────────────────────────────────────────────────────
        // Use allSeries so MAX aggregation covers all products from all banks,
        // not just the density-limited visibleSeries (which might over-represent one bank).
        var visibleSeries = (model && (model.allSeries || model.visibleSeries)) || [];

        // Determine preferred term before building series
        var targetTerm = determineTargetTerm(visibleSeries);

        var seriesResult = buildBankSeries(visibleSeries, targetTerm);
        var banks = seriesResult.banks;
        var filterApplied = seriesResult.filterApplied;
        var resolvedTerm = filterApplied ? targetTerm : null;

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
        var cpiPts  = buildCpiSeries(cpiData);

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
        if (cpiPts.length) {
            var cpiLast = cpiPts[cpiPts.length - 1];
            if (cpiLast.date < ctxMax) cpiPts.push({ date: ctxMax, value: cpiLast.value });
        }

        var compact = (container.clientWidth || 800) < 480;
        var maxBanks = Math.min(banks.length, 100);
        var visiBanks = banks.slice(0, maxBanks);

        // ── DOM: mount fills container ────────────────────────────────────────
        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--td-report';
        mount.style.width    = '100%';
        mount.style.flex     = '1';
        mount.style.minHeight = '400px';
        mount.style.position = 'relative';
        container.appendChild(mount);

        var t = th();

        // ── Context label ─────────────────────────────────────────────────────
        var ctxLabelText = '';
        if (resolvedTerm != null) {
            ctxLabelText = resolvedTerm + '-Month Term';
        }
        var ctxLabelEl = document.createElement('div');
        ctxLabelEl.textContent = ctxLabelText;
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
                lineType:                LineType.WithSteps,
                title:                   'CPI',
                priceLineVisible:        false,
                lastValueVisible:        false,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            cpiSeriesApi.setData(cpiPts.map(function (p) { return { time: p.date, value: p.value }; }));
        }

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
                lineType:                LineType.WithSteps,
                title:                   'RBA',
                priceLineVisible:        false,
                lastValueVisible:        false,
                crosshairMarkerVisible:  true,
                crosshairMarkerRadius:   3,
            });
            rbaSeriesApi.setData(rbaData.points.map(function (p) { return { time: p.date, value: p.rate }; }));
        }

        // Fit to 18-month context window
        chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax });

        // ── Persistent legend strip (below chart, no overlap) ─────────────────
        var legendEl = document.createElement('div');
        legendEl.style.cssText = [
            'display:flex',
            'flex-wrap:wrap',
            'align-items:center',
            'gap:3px 10px',
            'padding:5px 8px',
            'font-size:10px',
            'line-height:1.6',
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'color:' + t.ttText,
            'border-top:1px solid ' + t.grid,
            'flex-shrink:0'
        ].join(';');
        var sortedLegend = bankSeriesApis.slice().sort(function (a, b) {
            return (b.lastValue != null ? b.lastValue : -Infinity) - (a.lastValue != null ? a.lastValue : -Infinity);
        });
        sortedLegend.forEach(function (entry) {
            if (entry.lastValue == null) return;
            var item = document.createElement('span');
            item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
            item.innerHTML =
                '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + entry.bank.color + ';flex-shrink:0;"></span>' +
                '<span>' + entry.bank.short + '</span>' +
                '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + entry.lastValue.toFixed(2) + '%</span>';
            legendEl.appendChild(item);
        });
        if (rbaSeriesApi && rbaData.points.length) {
            var rbaLast = rbaData.points[rbaData.points.length - 1].rate;
            var rbaItem = document.createElement('span');
            rbaItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;padding-left:8px;border-left:1px solid rgba(148,163,184,0.2);';
            rbaItem.innerHTML =
                '<span style="display:inline-block;width:10px;height:2px;background:' + t.rba + ';flex-shrink:0;"></span>' +
                '<span style="color:' + t.rba + ';">RBA</span>' +
                '<span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaLast.toFixed(2) + '%</span>';
            legendEl.appendChild(rbaItem);
        }
        if (cpiSeriesApi && cpiPts.length) {
            var cpiLast = cpiPts[cpiPts.length - 1].value;
            var cpiItem = document.createElement('span');
            cpiItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
            cpiItem.innerHTML =
                '<span style="display:inline-block;width:10px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                '<span style="color:' + t.cpi + ';">CPI</span>' +
                '<span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiLast).toFixed(1) + '%</span>';
            legendEl.appendChild(cpiItem);
        }
        container.appendChild(legendEl);

        // ── Crosshair tooltip ─────────────────────────────────────────────────
        var tooltipEl = document.createElement('div');
        tooltipEl.style.cssText = [
            'position:absolute',
            'z-index:10',
            'pointer-events:none',
            'display:none',
            'top:6px',
            'right:6px',
            'background:' + t.ttBg,
            'border:1px solid ' + t.ttBorder,
            'border-radius:6px',
            'padding:6px 10px',
            'font-size:10px',
            'line-height:1.5',
            'color:' + t.ttText,
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'box-shadow:0 4px 16px rgba(0,0,0,0.12)',
            'min-width:120px',
        ].join(';');
        mount.appendChild(tooltipEl);

        mount.addEventListener('mouseleave', function () { tooltipEl.style.display = 'none'; });
        mount.addEventListener('dblclick',   function () { chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax }); });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                tooltipEl.style.display = 'none';
                return;
            }
            var time   = String(param.time).slice(0, 10);
            var T      = th();
            var cpiVal = cpiAtDate(cpiPts, time);
            var lines  = ['<div style="font-size:9.5px;color:' + T.muted + ';letter-spacing:0.03em;margin-bottom:3px;">' + fmtFull(time) + '</div>'];

            var rbaVal = null;
            if (rbaSeriesApi) {
                var rd = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rd && Number.isFinite(rd.value)) rbaVal = rd.value;
            }

            var hasBanks = false;
            bankSeriesApis.forEach(function (si) {
                var sd  = param.seriesData && param.seriesData.get(si.api);
                var val = (sd && Number.isFinite(sd.value)) ? sd.value : null;
                if (val == null) return;
                hasBanks = true;
                lines.push(
                    '<div style="display:flex;align-items:center;gap:5px;">'
                    + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + si.bank.color + ';flex-shrink:0;"></span>'
                    + '<span style="flex:1;white-space:nowrap;">' + si.bank.short + '</span>'
                    + '<span style="font-variant-numeric:tabular-nums;">' + val.toFixed(2) + '%</span>'
                    + '</div>'
                );
            });

            var cpiDisplayVal = null;
            if (cpiSeriesApi) {
                var cd = param.seriesData && param.seriesData.get(cpiSeriesApi);
                if (cd && Number.isFinite(cd.value)) cpiDisplayVal = cd.value;
                else if (cpiVal != null) cpiDisplayVal = cpiVal;
            }

            if (hasBanks && (rbaVal != null || cpiDisplayVal != null)) {
                lines.push('<div style="border-top:1px solid rgba(148,163,184,0.15);margin:3px 0 2px;"></div>');
            }

            if (rbaVal != null) {
                lines.push(
                    '<div style="display:flex;align-items:center;gap:5px;">'
                    + '<span style="display:inline-block;width:10px;height:2px;background:' + T.rba + ';flex-shrink:0;"></span>'
                    + '<span style="flex:1;color:' + T.rba + ';">RBA</span>'
                    + '<span style="color:' + T.rba + ';font-variant-numeric:tabular-nums;">' + rbaVal.toFixed(2) + '%</span>'
                    + '</div>'
                );
            }
            if (cpiDisplayVal != null) {
                lines.push(
                    '<div style="display:flex;align-items:center;gap:5px;">'
                    + '<span style="display:inline-block;width:10px;height:2px;border-top:2px dashed ' + T.cpi + ';flex-shrink:0;"></span>'
                    + '<span style="flex:1;color:' + T.cpi + ';">CPI</span>'
                    + '<span style="color:' + T.cpi + ';font-variant-numeric:tabular-nums;">' + Number(cpiDisplayVal).toFixed(1) + '%</span>'
                    + '</div>'
                );
            }

            if (lines.length <= 1) { tooltipEl.style.display = 'none'; return; }

            tooltipEl.innerHTML = lines.join('');
            tooltipEl.style.display = 'block';
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
            kind:  'termDepositReport',
            dispose: function () {
                ro.disconnect();
                try { chart.remove(); } catch (_e) { /* ignore */ }
            },
        };
    }

    window.AR.chartTermDepositReportLwc = { render: render };
})();
