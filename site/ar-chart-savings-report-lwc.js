/**
 * Savings Report chart — LightweightCharts (TradingView) implementation.
 *
 * View modes:
 *   'bank'     — Best savings rate per bank (default, one line per bank)
 *   'products' — Individual product lines across all banks
 *   'focus'    — All products for a single selected bank
 *
 * Always shows RBA cash rate + CPI overlay lines.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

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
            crosshairLine: dark ? 'rgba(99,179,237,0.60)' : 'rgba(37,99,235,0.55)',
            crosshairLabelBg: dark ? 'rgba(15,20,25,0.96)' : 'rgba(255,255,255,0.98)',
            rba:      '#f59e0b',
            cpi:      dark ? '#f87171'                : '#dc2626',
            ttBg:     dark ? 'rgba(15,23,42,0.96)'    : 'rgba(255,255,255,0.97)',
            ttBorder: dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText:   dark ? '#e2e8f0'                : '#1e293b',
            good:     dark ? '#34d399'                : '#059669',
            bad:      dark ? '#f87171'                : '#dc2626',
        };
    }

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

    // ── Data: best-per-bank (max rate + winning product per date) ───────────
    function buildBankSeries(visibleSeries) {
        var M = window.AR.chartMacroLwcShared;
        var byBank = {};
        (visibleSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            var pn = String(s.productName || 'Unknown');
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                if (!d || !Number.isFinite(v) || v < 1.0) return;
                byBank[k].byDate[d] = M.mergeWinningDeposit(byBank[k].byDate[d], v, pn);
            });
        });
        return Object.keys(byBank)
            .map(function (k) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) {
                    var cell = e.byDate[d];
                    return { date: d, value: cell.value, productName: cell.productName };
                });
                return { bankName: e.bankName, points: pts, latest: pts.length ? pts[pts.length - 1].value : 0 };
            })
            .sort(function (a, b) { return b.latest - a.latest; })
            .map(function (b, i) {
                b.short = bankShort(b.bankName);
                b.color = bankColor(b.bankName, i);
                b.legendLabel = b.short;
                return b;
            });
    }

    // ── Data: individual products ────────────────────────────────────────────
    function buildProductSeries(allSeries, focusBank) {
        var products = [];
        var bankIdx = {};
        var bankCount = {};
        (allSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var bk = bn.toLowerCase();
            if (focusBank && bk !== String(focusBank).toLowerCase()) return;
            var pts = (s.points || []).filter(function (p) {
                var v = Number(p.value);
                return p.date && Number.isFinite(v) && v >= 1.0;
            }).map(function (p) {
                return { date: String(p.date), value: Number(p.value) };
            });
            if (!pts.length) return;
            if (bankCount[bk] == null) { bankCount[bk] = 0; bankIdx[bk] = Object.keys(bankIdx).length; }
            products.push({
                bankName: bn,
                productName: String(s.productName || 'Unknown'),
                subtitle: s.subtitle || '',
                latestRow: s.latestRow,
                points: pts,
                latest: pts[pts.length - 1].value,
                _bk: bk,
                _bkIdx: bankCount[bk]++,
            });
        });
        products.sort(function (a, b) { return b.latest - a.latest; });
        if (!focusBank) products = products.slice(0, 25);
        var M = window.AR.chartMacroLwcShared;
        products.forEach(function (p, i) {
            p.short = bankShort(p.bankName);
            p.productShort = M.shortProductName(p.productName);
            if (focusBank) {
                p.color = PALETTE[i % PALETTE.length];
                p.legendLabel = p.productShort;
            } else {
                var base = bankColor(p.bankName, bankIdx[p._bk]);
                p.color = M.productColorVariant(base, p._bkIdx, bankCount[p._bk]);
                p.legendLabel = p.short + ' \u00b7 ' + p.productShort;
            }
        });
        return products;
    }

    // ── Unique sorted bank names from allSeries ─────────────────────────────
    function extractBankNames(allSeries) {
        var seen = {};
        var list = [];
        (allSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (seen[k]) return;
            seen[k] = true;
            list.push({ full: bn, short: bankShort(bn) });
        });
        list.sort(function (a, b) { return a.short.localeCompare(b.short); });
        return list;
    }

    // ── Info box below chart ────────────────────────────────────────────────
    function createInfoBox(t) {
        var M = window.AR.chartMacroLwcShared;
        return M.createReportSelectionInfoBox(t);
    }

    // ── Main render ─────────────────────────────────────────────────────────
    function render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        var M = window.AR.chartMacroLwcShared;
        var overlayModule = window.AR.chartEconomicOverlays || {};
        if (!M || typeof M.prepareRbaCpiForReport !== 'function') {
            throw new Error('chartMacroLwcShared not loaded');
        }

        // Dispose previous chart on internal re-render (toggle change)
        if (container._reportDispose) {
            try { container._reportDispose(); } catch (_) {}
            container._reportDispose = null;
        }

        var section = window.AR.section || 'savings';
        var vm = M.getViewMode(section);
        var reportRange = M.getReportRange(section);
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var isProductMode = vm.mode === 'products' || vm.mode === 'focus';

        // Build lines based on view mode
        var lines;
        if (vm.mode === 'products') {
            lines = buildProductSeries(allSeries, null);
        } else if (vm.mode === 'focus' && vm.focusBank) {
            lines = buildProductSeries(allSeries, vm.focusBank);
        } else {
            lines = buildBankSeries(allSeries);
        }

        // Date range
        var bankMin = null;
        var bankMax = null;
        lines.forEach(function (b) {
            b.points.forEach(function (p) {
                if (!bankMin || p.date < bankMin) bankMin = p.date;
                if (!bankMax || p.date > bankMax) bankMax = p.date;
            });
        });
        if (!bankMax) bankMax = todayYmd();
        if (!bankMin) bankMin = bankMax;

        var ctxMin = M.resolveReportDataMin(bankMin, rbaHistory, cpiData, economicOverlaySeries) || bankMin;
        var ctxMax = bankMax;
        var viewStart = M.resolveReportRangeStart(ctxMin, ctxMax, reportRange);

        var prep = M.prepareRbaCpiForReport(rbaHistory, cpiData, ctxMin, ctxMax);
        var rbaData = prep.rbaData;
        var cpiPts = prep.cpiPoints;
        var chartStart = prep.chartStart || ctxMin;
        var overlayDefs = overlayModule.prepareWindowSeries
            ? overlayModule.prepareWindowSeries(economicOverlaySeries || [], ctxMin, ctxMax)
            : [];

        var compact = (container.clientWidth || 800) < 480;
        var defaultMaxLines = vm.mode === 'focus' ? 50 : (vm.mode === 'products' ? 25 : 100);
        var maxLines = M.resolveChartProductLimit(defaultMaxLines);
        var visiLines = lines.slice(0, Math.min(lines.length, maxLines));

        // ── DOM: wrapper → toggle + mount + infoBox ─────────────────────────
        container.innerHTML = '';
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';
        container.appendChild(wrapper);

        var t = th();
        var bankList = extractBankNames(allSeries);
        var toggleBar = M.createReportViewModeBar({
            section: section,
            vm: vm,
            bankList: bankList,
            onReRender: function () {
                render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
            },
        });
        wrapper.appendChild(toggleBar);
        wrapper.appendChild(M.createReportRangeBar({
            section: section,
            range: reportRange,
            minDate: ctxMin,
            maxDate: ctxMax,
            onChange: function () {
                render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
            },
        }));

        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--econ-report';
        mount.style.cssText = 'width:100%;flex:1;min-height:380px;position:relative;';
        wrapper.appendChild(mount);

        var infoBox = createInfoBox(t);
        wrapper.appendChild(infoBox.el);

        // ── LWC chart ───────────────────────────────────────────────────────
        var LineStyle = L.LineStyle || { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
        var LineType  = L.LineType  || { Simple: 0, WithSteps: 1, Curved: 2 };

        var chartOptions = M.reportChartOptions(L, t, overlayDefs.length > 0);
        chartOptions.localization = {
            priceFormatter: function (p) { return Number(p).toFixed(2) + '%'; },
            timeFormatter: function (time) { return fmtFull(M.utcToYmd(time)); },
        };
        var chart = L.createChart(mount, chartOptions);

        // ── CPI line ────────────────────────────────────────────────────────
        var cpiSeriesApi = null;
        if (cpiPts.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, {
                color: t.cpi, lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.Simple,
                title: '', priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
            });
            cpiSeriesApi.setData(
                M.fillForwardDaily(cpiPts, 'date', 'value', chartStart, ctxMax)
                    .map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; })
            );
        }

        // ── Rate lines ──────────────────────────────────────────────────────
        var lineWidth = isProductMode && vm.mode !== 'focus' ? 1.5 : (compact ? 1.5 : 2);
        var seriesApis = [];
        visiLines.forEach(function (line) {
            var allPts = line.points;
            var carryPt = null;
            for (var j = 0; j < allPts.length; j++) {
                if (allPts[j].date <= ctxMin) carryPt = allPts[j];
                else break;
            }
            var rawPts = allPts.filter(function (p) { return p.date >= ctxMin && p.date <= ctxMax; });
            if (carryPt) {
                rawPts = [{
                    date: ctxMin,
                    value: carryPt.value,
                    productName: carryPt.productName,
                }].concat(rawPts);
            }
            if (rawPts.length) {
                var lastPt = rawPts[rawPts.length - 1];
                if (lastPt.date < ctxMax) {
                    rawPts = rawPts.concat([{
                        date: ctxMax,
                        value: lastPt.value,
                        productName: lastPt.productName,
                    }]);
                }
            }
            var data = rawPts.map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; });
            var ser = chart.addSeries(L.LineSeries, {
                color: line.color, lineWidth: lineWidth, lineType: LineType.Simple,
                title: '', priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
            });
            ser.setData(data);
            seriesApis.push({ api: ser, line: line, lastValue: data.length ? data[data.length - 1].value : null, stepPoints: rawPts });
        });

        // ── RBA line ────────────────────────────────────────────────────────
        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, {
                color: t.rba, lineWidth: 2, lineType: LineType.Simple,
                title: '', priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
            });
            rbaSeriesApi.setData(
                M.fillForwardDaily(rbaData.points, 'date', 'rate', chartStart, ctxMax)
                    .map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; })
            );
        }

        // ── Economic overlays ───────────────────────────────────────────────
        var overlaySeriesApis = [];
        overlayDefs.forEach(function (series) {
            var data = (series.points || []).map(function (point) {
                if (!Number.isFinite(Number(point.normalized_value))) return { time: M.ymdToUtc(point.date) };
                return { time: M.ymdToUtc(point.date), value: point.normalized_value };
            });
            if (!data.length) return;
            var api = chart.addSeries(L.LineSeries, {
                color: series.color, lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.Simple,
                title: '', priceLineVisible: false, lastValueVisible: false,
                crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
                priceScaleId: 'left', priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
            });
            api.setData(data);
            overlaySeriesApis.push({ api: api, def: series, lastValue: M.lastFiniteNormalizedOverlay(series.points) });
        });

        chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });

        // ── Legend ──────────────────────────────────────────────────────────
        var legendEl = document.createElement('div');
        legendEl.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 6px;font:9px/1.4 "Space Grotesk",system-ui,sans-serif;color:' + t.ttText + ';background:' + t.ttBg + ';border:1px solid ' + t.ttBorder + ';border-radius:4px;pointer-events:none;z-index:5;max-height:60%;overflow:hidden;';

        var LEGEND_CAP = 15;

        function buildLegendItems(entries, crosshairYmd) {
            var sorted = entries.slice().sort(function (a, b) {
                return (b.value != null ? b.value : -Infinity) - (a.value != null ? a.value : -Infinity);
            });
            var items = [];
            var shown = 0;
            sorted.forEach(function (entry) {
                if (entry.value == null || shown >= LEGEND_CAP) return;
                shown++;
                var prevB = M.prevStepValue(entry.stepPoints, crosshairYmd || ctxMax, 'value');
                var arrB = M.rateLegendArrowHtml(entry.value, prevB, 'deposit', t.good, t.bad);
                var lblHtml = M.legendSliceLabelHtml(entry.line, entry.stepPoints, crosshairYmd, ctxMax);
                items.push(
                    '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">' +
                    '<span style="display:inline-block;width:14px;height:2px;background:' + entry.line.color + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="opacity:0.7;">' + lblHtml + '</span>' +
                    '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + entry.value.toFixed(2) + '%' + arrB + '</span></span>'
                );
            });
            if (sorted.length > LEGEND_CAP) {
                items.push('<span style="opacity:0.35;font-size:8px;">+' + (sorted.length - LEGEND_CAP) + ' more</span>');
            }
            return items;
        }

        function buildMacroItems(rbaVal, cpiVal, crosshairYmd) {
            var items = [];
            if (rbaVal != null) {
                var prevR = M.prevStepValue(rbaData.points, crosshairYmd || ctxMax, 'rate');
                var arrR = M.rateLegendArrowHtml(rbaVal, prevR, 'deposit', t.good, t.bad);
                items.push(
                    '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);">' +
                    '<span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="color:' + t.rba + ';opacity:0.8;">RBA</span>' +
                    '<span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaVal.toFixed(2) + '%' + arrR + '</span></span>'
                );
            }
            if (cpiVal != null) {
                var prevC = M.prevStepValue(cpiPts, crosshairYmd || ctxMax, 'value');
                var arrC = M.rateLegendArrowHtml(Number(cpiVal), prevC, 'deposit', t.good, t.bad, 1);
                items.push(
                    '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">' +
                    '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                    '<span style="color:' + t.cpi + ';opacity:0.8;">CPI</span>' +
                    '<span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiVal).toFixed(1) + '%' + arrC + '</span></span>'
                );
            }
            return items;
        }

        function buildEconomicOverlayLegendItems(param) {
            var items = [];
            overlaySeriesApis.forEach(function (entry) {
                var val = entry.lastValue;
                if (param && param.seriesData && entry.api) {
                    var sd = param.seriesData.get(entry.api);
                    val = (sd && Number.isFinite(sd.value)) ? sd.value : null;
                }
                var row = M.economicOverlayLegendItemHtml(entry.def.color, entry.def.shortLabel || entry.def.label, val);
                if (row) items.push(row);
            });
            return items;
        }

        function refreshLegend(bankItems, rbaVal, cpiVal, crosshairYmd, param) {
            var parts = [];
            if (crosshairYmd) {
                parts.push('<span style="font-size:8px;color:' + t.muted + ';white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);letter-spacing:0.02em;">' + fmtFull(crosshairYmd) + '</span>');
            }
            parts = parts.concat(buildLegendItems(bankItems, crosshairYmd));
            parts = parts.concat(buildMacroItems(rbaVal, cpiVal, crosshairYmd));
            var econItems = buildEconomicOverlayLegendItems(param || null);
            if (econItems.length) {
                parts.push('<span aria-hidden="true" style="display:block;width:100%;height:0;margin-top:3px;margin-bottom:1px;border-top:1px solid rgba(148,163,184,0.2);"></span>');
                parts = parts.concat(econItems);
            }
            legendEl.innerHTML = parts.join('');
        }

        // Default legend
        var defaultEntries = seriesApis.map(function (si) { return { line: si.line, value: si.lastValue, stepPoints: si.stepPoints }; });
        var defaultRba = (rbaSeriesApi && rbaData.points.length) ? rbaData.points[rbaData.points.length - 1].rate : null;
        var defaultCpi = (cpiSeriesApi && cpiPts.length) ? cpiPts[cpiPts.length - 1].value : null;
        refreshLegend(defaultEntries, defaultRba, defaultCpi, null, null);
        var defaultLegendHTML = legendEl.innerHTML;
        mount.appendChild(legendEl);
        if (window.AR && window.AR.chartSiteUi && typeof window.AR.chartSiteUi.registerReportLegend === 'function') {
            window.AR.chartSiteUi.registerReportLegend(legendEl);
        } else {
            legendEl.style.opacity = '0.75';
        }

        // ── Crosshair ───────────────────────────────────────────────────────
        mount.addEventListener('mouseleave', function () { legendEl.innerHTML = defaultLegendHTML; });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) { legendEl.innerHTML = defaultLegendHTML; return; }
            var time = M.utcToYmd(param.time);
            var cpiVal = M.cpiAtDate(cpiPts, time);
            var rbaVal = null;
            if (rbaSeriesApi) {
                var rd = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rd && Number.isFinite(rd.value)) rbaVal = rd.value;
            }
            var bankItems = [];
            seriesApis.forEach(function (si) {
                var sd = param.seriesData && param.seriesData.get(si.api);
                var val = (sd && Number.isFinite(sd.value)) ? sd.value : null;
                if (val != null) bankItems.push({ line: si.line, value: val, stepPoints: si.stepPoints });
            });
            var hasEconOverlay = false;
            overlaySeriesApis.forEach(function (e) {
                var sd = param.seriesData && param.seriesData.get(e.api);
                if (sd && Number.isFinite(sd.value)) hasEconOverlay = true;
            });
            if (!bankItems.length && rbaVal == null && cpiVal == null && !hasEconOverlay) { legendEl.innerHTML = defaultLegendHTML; return; }
            refreshLegend(bankItems, rbaVal, cpiVal, time, param);
        });

        // ── Click → info box ────────────────────────────────────────────────
        chart.subscribeClick(function (param) {
            var cluster = M.findOverlappingClickEntries(seriesApis, param);
            if (!cluster || !cluster.entries.length) {
                infoBox.hide();
                return;
            }
            infoBox.show({
                heading: fmtFull(cluster.clickYmd),
                meta: cluster.entries.length > 1 ? (cluster.entries.length + ' overlapping products at ' + Number(cluster.rate).toFixed(2) + '%') : ('1 product at ' + Number(cluster.rate).toFixed(2) + '%'),
                items: cluster.entries,
            });
        });

        // ── Resize ──────────────────────────────────────────────────────────
        var ro = new ResizeObserver(function (entries) {
            var entry = entries[0];
            if (!entry) return;
            chart.resize(entry.contentRect.width, Math.max(200, entry.contentRect.height));
            chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });
        });
        ro.observe(mount);

        var disposed = false;
        var state = {
            chart: chart,
            mount: mount,
            kind: 'economicReport',
            dispose: function () {
                if (disposed) return;
                disposed = true;
                ro.disconnect();
                try {
                    if (window.AR && window.AR.chartSiteUi && typeof window.AR.chartSiteUi.unregisterReportLegend === 'function') {
                        window.AR.chartSiteUi.unregisterReportLegend(legendEl);
                    }
                } catch (_) {}
                try { chart.remove(); } catch (_) {}
                container._reportDispose = null;
            },
        };
        container._reportDispose = state.dispose;
        return state;
    }

    window.AR.chartSavingsReportLwc = { render: render };
})();
