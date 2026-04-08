/**
 * Term Deposit Report chart — LightweightCharts (TradingView) implementation.
 *
 * View modes:
 *   'bank'     — Best TD rate per bank for preferred term
 *   'products' — Individual product lines across all banks (default)
 *   'focus'    — All products for a single selected bank
 *
 * Always shows RBA cash rate + CPI overlay lines.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var BANK_SHORT = {
        'commonwealth bank of australia': 'CBA',
        'westpac banking corporation':    'WBC',
        'anz':                            'ANZ',
        'national australia bank':        'NAB',
        'macquarie bank':                 'MQG',
        'ing':                            'ING',
        'ubank':                          'UBank',
        'bankwest':                       'BWT',
        'bank of queensland':             'BOQ',
        'suncorp bank':                   'SUN',
        'great southern bank':            'GSB',
        'amp bank':                       'AMP',
        'bendigo and adelaide bank':      'BEN',
        'bank of melbourne':              'BoM',
        'st. george bank':                'STG',
        'hsbc australia':                 'HSBC',
        'teachers mutual bank':           'TMB',
        'beyond bank australia':          'BBA',
        'me bank':                        'MEB',
        'mystate bank':                   'MYS',
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
        var shared = window.AR && window.AR.chartMacroLwcShared;
        if (shared && typeof shared.bankAcronym === 'function') return shared.bankAcronym(name);
        var k = String(name || '').trim().toLowerCase();
        return BANK_SHORT[k] || String(name || '').slice(0, 12).trim();
    }
    function bankColor(name, idx) {
        var k = String(name || '').trim().toLowerCase();
        return BANK_COLOR[k] || PALETTE[idx % PALETTE.length];
    }

    function isDark() { return document.documentElement.getAttribute('data-theme') !== 'light'; }
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

    // ── Term detection ──────────────────────────────────────────────────────
    function determineTargetTerm(visibleSeries) {
        var termPreference = [12, 6, 24, 3, 18, 36, 9, 2, 1];
        var termsFound = {};
        (visibleSeries || []).forEach(function (s) {
            var sampleRow = (s.points && s.points[0]) ? (s.points[0].row || {}) : {};
            var tm = sampleRow.term_months;
            if (tm != null && tm !== undefined && tm !== '') termsFound[Number(tm)] = true;
        });
        for (var i = 0; i < termPreference.length; i++) {
            if (termsFound[termPreference[i]]) return termPreference[i];
        }
        return null;
    }

    function filterByTerm(seriesList, targetTerm) {
        if (targetTerm == null) return { series: seriesList, applied: false };
        var filtered = (seriesList || []).filter(function (s) {
            var sampleRow = (s.points && s.points[0]) ? (s.points[0].row || {}) : {};
            var tm = sampleRow.term_months;
            if (tm == null || tm === undefined || tm === '') return true;
            return Number(tm) === targetTerm;
        });
        var banks = {};
        filtered.forEach(function (s) { var bn = String(s.bankName || '').trim(); if (bn) banks[bn.toLowerCase()] = true; });
        if (!Object.keys(banks).length) return { series: seriesList, applied: false };
        return { series: filtered, applied: true };
    }

    // ── Data: best-per-bank (max rate + winning product per date) ───────────
    function buildBankSeries(sourceSeries) {
        var M = window.AR.chartMacroLwcShared;
        var byBank = {};
        (sourceSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            var pn = String(s.productName || 'Unknown');
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                if (!d || !Number.isFinite(v) || v < 0.5) return;
                byBank[k].byDate[d] = M.mergeWinningDeposit(byBank[k].byDate[d], v, pn, p.row || null);
            });
        });
        return Object.keys(byBank)
            .map(function (k) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) {
                    var cell = e.byDate[d];
                    return { date: d, value: cell.value, productName: cell.productName, row: cell.row || null };
                });
                return { bankName: e.bankName, points: pts, latest: pts.length ? pts[pts.length - 1].value : 0 };
            })
            .sort(function (a, b) { return b.latest - a.latest; })
            .map(function (b, i) {
                b.short = bankShort(b.bankName);
                b.color = bankColor(b.bankName, i);
                b.legendLabel = b.short;
                b.section = 'term-deposits';
                b.selectionKey = String(b.bankName || '').trim().toLowerCase();
                return b;
            });
    }

    // ── Data: individual products ────────────────────────────────────────────
    function buildProductSeries(sourceSeries, focusBank) {
        var products = [];
        var bankIdx = {};
        var bankCount = {};
        (sourceSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var bk = bn.toLowerCase();
            if (focusBank && bk !== String(focusBank).toLowerCase()) return;
            var pts = (s.points || []).filter(function (p) {
                var v = Number(p.value);
                return p.date && Number.isFinite(v) && v >= 0.5;
            }).map(function (p) {
                return { date: String(p.date), value: Number(p.value), row: p.row || null };
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
        var M = window.AR.chartMacroLwcShared;
        products.forEach(function (p, i) {
            p.short = bankShort(p.bankName);
            p.productShort = M.shortProductName(p.productName);
            p.section = 'term-deposits';
            p.selectionKey = String((p.latestRow && p.latestRow.product_key) || (p.bankName + '|' + p.productName)).trim().toLowerCase();
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

    // ── Info box ─────────────────────────────────────────────────────────────
    function createInfoBox(t) {
        var M = window.AR.chartMacroLwcShared;
        return M.createReportSelectionInfoBox(t);
    }

    // ── Main render ─────────────────────────────────────────────────────────
    function render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;
        var M = window.AR.chartMacroLwcShared;
        var reportPlot = window.AR.chartReportPlot;
        var overlayModule = window.AR.chartEconomicOverlays || {};
        if (!M || typeof M.prepareRbaCpiForReport !== 'function') throw new Error('chartMacroLwcShared not loaded');

        if (container._reportDispose) { try { container._reportDispose(); } catch (_) {} container._reportDispose = null; }

        var section = window.AR.section || 'term-deposits';
        var vm = M.getViewMode(section);
        var reportRange = M.getReportRange(section);
        container.setAttribute('data-report-view-mode', vm.mode);
        if (vm.mode === 'bands' && reportPlot && typeof reportPlot.render === 'function') {
            var plotPayload = model && model.reportPlots ? model.reportPlots.bands : null;
            var plotRange = reportPlot.payloadDateRange(plotPayload);
            var plotMin = plotRange.minDate || todayYmd();
            var plotMax = plotRange.maxDate || plotMin;
            var dataMinPlot = reportRange === 'All'
                ? (M.resolveReportDataMin(plotMin, rbaHistory, cpiData, economicOverlaySeries) || plotMin)
                : plotMin;
            var ctxMaxPlot = plotMax;
            var viewStartPlot = reportRange === 'All'
                ? dataMinPlot
                : M.resolveReportRangeStart(plotMin, ctxMaxPlot, reportRange);
            var resolvedTermLabel = plotPayload && plotPayload.meta && plotPayload.meta.resolved_term_months != null
                ? String(plotPayload.meta.resolved_term_months) + '-Month Term'
                : '';
            return reportPlot.render({
                container: container,
                section: section,
                vm: vm,
                bankList: extractBankNames((model && (model.allSeries || model.visibleSeries)) || []),
                plotPayload: plotPayload,
                range: {
                    reportRange: reportRange,
                    dataMin: dataMinPlot,
                    ctxMax: ctxMaxPlot,
                    viewStart: viewStartPlot,
                    chartStart: viewStartPlot,
                },
                theme: th(),
                rbaHistory: rbaHistory,
                cpiData: cpiData,
                economicOverlaySeries: economicOverlaySeries,
                bankColor: bankColor,
                noteText: resolvedTermLabel,
                onReRender: function () {
                    render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
                },
                onRangeChange: function () {
                    if (window.AR && window.AR.charts && typeof window.AR.charts.drawChart === 'function') {
                        window.AR.charts.drawChart();
                    } else {
                        render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
                    }
                },
            });
        }
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var isProductMode = vm.mode === 'products' || vm.mode === 'focus';

        // Term filtering
        var targetTerm = determineTargetTerm(allSeries);
        var termResult = filterByTerm(allSeries, targetTerm);
        var sourceSeries = termResult.series;
        var filterApplied = termResult.applied;
        var resolvedTerm = filterApplied ? targetTerm : null;

        // Build lines based on mode
        var lines;
        if (vm.mode === 'products') {
            lines = buildProductSeries(sourceSeries, null);
        } else if (vm.mode === 'focus' && vm.focusBank) {
            lines = buildProductSeries(sourceSeries, vm.focusBank);
        } else {
            lines = buildBankSeries(sourceSeries);
        }

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

        var dataMin = reportRange === 'All'
            ? (M.resolveReportDataMin(bankMin, rbaHistory, cpiData, economicOverlaySeries) || bankMin)
            : bankMin;
        var ctxMax = bankMax;
        var viewStart = reportRange === 'All'
            ? dataMin
            : M.resolveReportRangeStart(bankMin, ctxMax, reportRange);
        var windowStart = viewStart;

        var prep = M.prepareRbaCpiForReport(rbaHistory, cpiData, windowStart, ctxMax);
        var rbaData = prep.rbaData;
        var cpiPts = prep.cpiPoints;
        var chartStart = prep.chartStart || windowStart;
        var overlayDefs = overlayModule.prepareWindowSeries ? overlayModule.prepareWindowSeries(economicOverlaySeries || [], windowStart, ctxMax) : [];

        var compact = (container.clientWidth || 800) < 480;
        var defaultMaxLines = vm.mode === 'focus' ? 50 : (vm.mode === 'products' ? Number.MAX_SAFE_INTEGER : 100);
        var maxLines = M.resolveChartProductLimit(defaultMaxLines);
        var visiLines = lines.slice(0, Math.min(lines.length, maxLines));

        // ── DOM ─────────────────────────────────────────────────────────────
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
            minDate: dataMin,
            maxDate: ctxMax,
            onChange: function () {
                if (window.AR && window.AR.charts && typeof window.AR.charts.drawChart === 'function') {
                    window.AR.charts.drawChart();
                } else {
                    render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
                }
            },
        }));

        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--td-report';
        mount.style.cssText = 'width:100%;flex:1;min-height:380px;position:relative;';
        wrapper.appendChild(mount);

        var infoBox = createInfoBox(t);
        wrapper.appendChild(infoBox.el);
        var movesStrip = reportPlot && typeof reportPlot.createMovesStrip === 'function'
            ? reportPlot.createMovesStrip({
                section: section,
                plotPayload: model && model.reportPlots ? model.reportPlots.moves : null,
                range: {
                    viewStart: viewStart,
                    ctxMax: ctxMax,
                },
                theme: t,
            })
            : null;
        if (movesStrip) wrapper.appendChild(movesStrip);

        // Context label
        if (resolvedTerm != null) {
            var ctxLabel = document.createElement('div');
            ctxLabel.textContent = resolvedTerm + '-Month Term';
            ctxLabel.style.cssText = 'position:absolute;bottom:44px;left:8px;font-size:9px;opacity:0.45;color:inherit;pointer-events:none;font-family:"Space Grotesk",system-ui,sans-serif;white-space:nowrap;z-index:3;';
            mount.appendChild(ctxLabel);
        }

        // ── LWC chart ───────────────────────────────────────────────────────
        var LineStyle = L.LineStyle || { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
        var LineType  = L.LineType  || { Simple: 0, WithSteps: 1, Curved: 2 };
        var chartOptions = M.reportChartOptions(L, t, overlayDefs.length > 0);
        chartOptions.localization = {
            priceFormatter: function (p) { return Number(p).toFixed(2) + '%'; },
            timeFormatter: function (time) { return fmtFull(M.utcToYmd(time)); },
        };
        var chart = L.createChart(mount, chartOptions);

        // CPI
        var cpiSeriesApi = null;
        if (cpiPts.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, { color: t.cpi, lineWidth: 3, lineStyle: LineStyle.LargeDashed || LineStyle.Dashed, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 4 });
            cpiSeriesApi.setData(M.fillForwardDaily(cpiPts, 'date', 'value', chartStart, ctxMax).map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; }));
        }

        // Rate lines
        var lineWidth = isProductMode && vm.mode !== 'focus' ? 1.5 : (compact ? 1.5 : 2);
        var seriesApis = [];
        visiLines.forEach(function (line) {
            var allPts = line.points;
            var carryPt = null;
            for (var j = 0; j < allPts.length; j++) { if (allPts[j].date <= windowStart) carryPt = allPts[j]; else break; }
            var rawPts = allPts.filter(function (p) { return p.date >= windowStart && p.date <= ctxMax; });
            if (carryPt) {
                rawPts = [{ date: windowStart, value: carryPt.value, productName: carryPt.productName, row: carryPt.row || null }].concat(rawPts);
            }
            if (rawPts.length) {
                var lp = rawPts[rawPts.length - 1];
                if (lp.date < ctxMax) {
                    rawPts = rawPts.concat([{ date: ctxMax, value: lp.value, productName: lp.productName, row: lp.row || null }]);
                }
            }
            var data = rawPts.map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; });
            var ser = chart.addSeries(L.LineSeries, { color: line.color, lineWidth: lineWidth, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3 });
            ser.setData(data);
            seriesApis.push({
                api: ser,
                line: line,
                lastValue: data.length ? data[data.length - 1].value : null,
                stepPoints: rawPts,
                baseColor: line.color,
                baseLineWidth: lineWidth,
                selectionKey: line.selectionKey,
            });
        });

        // RBA
        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, { color: t.rba, lineWidth: 3, lineStyle: LineStyle.Dashed, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 4 });
            rbaSeriesApi.setData(M.fillForwardDaily(rbaData.points, 'date', 'rate', chartStart, ctxMax).map(function (p) { return { time: M.ymdToUtc(p.date), value: p.value }; }));
        }

        // Overlays
        var overlaySeriesApis = [];
        overlayDefs.forEach(function (series) {
            var data = (series.points || []).map(function (point) {
                if (!Number.isFinite(Number(point.normalized_value))) return { time: M.ymdToUtc(point.date) };
                return { time: M.ymdToUtc(point.date), value: point.normalized_value };
            });
            if (!data.length) return;
            var api = chart.addSeries(L.LineSeries, { color: series.color, lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3, priceScaleId: 'left', priceFormat: { type: 'price', precision: 1, minMove: 0.1 } });
            api.setData(data);
            overlaySeriesApis.push({ api: api, def: series, lastValue: M.lastFiniteNormalizedOverlay(series.points) });
        });

        chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });
        M.renderRbaDecisionLines(mount, chart, rbaData.decisions || [], {
            startYmd: viewStart,
            endYmd: ctxMax,
            lineColor: t.rba,
            labelBg: t.ttBg,
            labelColor: t.rba,
        });

        // ── Legend ───────────────────────────────────────────────────────────
        var legendEl = document.createElement('div');
        legendEl.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 6px;font:9px/1.4 "Space Grotesk",system-ui,sans-serif;color:' + t.ttText + ';background:' + t.ttBg + ';border:1px solid ' + t.ttBorder + ';border-radius:4px;pointer-events:none;z-index:5;max-height:60%;overflow:hidden;';
        var LEGEND_CAP = 15;

        function buildLegendItems(entries, ymd) {
            var sorted = entries.slice().sort(function (a, b) { return (b.value != null ? b.value : -Infinity) - (a.value != null ? a.value : -Infinity); });
            var items = []; var shown = 0;
            sorted.forEach(function (e) {
                if (e.value == null || shown >= LEGEND_CAP) return; shown++;
                var prev = M.prevStepValue(e.stepPoints, ymd || ctxMax, 'value');
                var arr = M.rateLegendArrowHtml(e.value, prev, 'deposit', t.good, t.bad);
                var lblHtml = M.legendSliceLabelHtml(e.line, e.stepPoints, ymd, ctxMax);
                items.push('<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;"><span style="display:inline-block;width:14px;height:2px;background:' + e.line.color + ';flex-shrink:0;border-radius:1px;"></span><span style="' + M.legendTextStyle('opacity:0.7;') + '">' + lblHtml + '</span><span style="' + M.legendTextStyle('font-variant-numeric:tabular-nums;font-weight:600;') + '">' + e.value.toFixed(2) + '%' + arr + '</span></span>');
            });
            if (sorted.length > LEGEND_CAP) items.push('<span style="' + M.legendTextStyle('opacity:0.35;font-size:8px;') + '">+' + (sorted.length - LEGEND_CAP) + ' more</span>');
            return items;
        }
        function buildMacroItems(rbaVal, cpiVal, ymd) {
            var items = [];
            if (rbaVal != null) { var p = M.prevStepValue(rbaData.points, ymd || ctxMax, 'rate'); var a = M.rateLegendArrowHtml(rbaVal, p, 'deposit', t.good, t.bad); items.push('<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);"><span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span><span style="' + M.legendTextStyle('color:' + t.rba + ';opacity:0.8;') + '">RBA</span><span style="' + M.legendTextStyle('color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;') + '">' + rbaVal.toFixed(2) + '%' + a + '</span></span>'); }
            if (cpiVal != null) { var pc = M.prevStepValue(cpiPts, ymd || ctxMax, 'value'); var ac = M.rateLegendArrowHtml(Number(cpiVal), pc, 'deposit', t.good, t.bad, 1); items.push('<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;"><span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span><span style="' + M.legendTextStyle('color:' + t.cpi + ';opacity:0.8;') + '">CPI</span><span style="' + M.legendTextStyle('color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;') + '">' + Number(cpiVal).toFixed(1) + '%' + ac + '</span></span>'); }
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
        function refreshLegend(bankItems, rbaVal, cpiVal, ymd, param) {
            var parts = [];
            if (ymd) parts.push('<span style="' + M.legendTextStyle('font-size:8px;color:' + t.muted + ';white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);letter-spacing:0.02em;') + '">' + fmtFull(ymd) + '</span>');
            parts = parts.concat(buildLegendItems(bankItems, ymd));
            parts = parts.concat(buildMacroItems(rbaVal, cpiVal, ymd));
            var econItems = buildEconomicOverlayLegendItems(param || null);
            if (econItems.length) {
                parts.push('<span aria-hidden="true" style="display:block;width:100%;height:0;margin-top:3px;margin-bottom:1px;border-top:1px solid rgba(148,163,184,0.2);"></span>');
                parts = parts.concat(econItems);
            }
            legendEl.innerHTML = parts.join('');
        }

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

        function refreshSelectionInfo(param) {
            var cluster = M.findOverlappingSelectionEntries(seriesApis, param);
            if (!cluster || !cluster.entries.length) {
                M.clearSeriesSelectionState(seriesApis);
                infoBox.hide();
                return null;
            }
            M.applySeriesSelectionState(seriesApis, cluster.entries.map(function (entry) { return entry.selectionKey; }));
            infoBox.show({
                heading: fmtFull(cluster.selectionYmd),
                meta: M.selectionMetaText(cluster),
                items: cluster.entries,
            });
            return cluster;
        }

        mount.addEventListener('mouseleave', function () {
            legendEl.innerHTML = defaultLegendHTML;
            M.clearSeriesSelectionState(seriesApis);
            infoBox.hide();
        });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                legendEl.innerHTML = defaultLegendHTML;
                M.clearSeriesSelectionState(seriesApis);
                infoBox.hide();
                return;
            }
            var time = M.utcToYmd(param.time);
            var cpiVal = M.cpiAtDate(cpiPts, time);
            var rbaVal = null;
            if (rbaSeriesApi) { var rd = param.seriesData && param.seriesData.get(rbaSeriesApi); if (rd && Number.isFinite(rd.value)) rbaVal = rd.value; }
            var bankItems = [];
            seriesApis.forEach(function (si) { var sd = param.seriesData && param.seriesData.get(si.api); var val = (sd && Number.isFinite(sd.value)) ? sd.value : null; if (val != null) bankItems.push({ line: si.line, value: val, stepPoints: si.stepPoints }); });
            var hasEconOverlay = false;
            overlaySeriesApis.forEach(function (e) {
                var sd = param.seriesData && param.seriesData.get(e.api);
                if (sd && Number.isFinite(sd.value)) hasEconOverlay = true;
            });
            if (!bankItems.length && rbaVal == null && cpiVal == null && !hasEconOverlay) {
                legendEl.innerHTML = defaultLegendHTML;
                M.clearSeriesSelectionState(seriesApis);
                infoBox.hide();
                return;
            }
            refreshLegend(bankItems, rbaVal, cpiVal, time, param);
            refreshSelectionInfo(param);
        });

        // Click → info box
        chart.subscribeClick(function (param) {
            refreshSelectionInfo(param);
        });

        // Resize
        var disposed = false;
        var ro = new ResizeObserver(function (entries) {
            if (disposed) return;
            var e = entries[0];
            if (!e) return;
            var rw = Number(e.contentRect.width);
            var rh = Number(e.contentRect.height);
            if (!Number.isFinite(rw) || rw < 1 || !Number.isFinite(rh) || rh < 1) return;
            try {
                chart.resize(rw, Math.max(200, rh));
                chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });
                M.renderRbaDecisionLines(mount, chart, rbaData.decisions || [], {
                    startYmd: viewStart,
                    endYmd: ctxMax,
                    lineColor: t.rba,
                    labelBg: t.ttBg,
                    labelColor: t.rba,
                });
            } catch (_e) {}
        });
        ro.observe(mount);
        var state = {
            chart: chart, mount: mount, kind: 'termDepositReport',
            dispose: function () {
                if (disposed) return;
                disposed = true;
                try { ro.disconnect(); } catch (_) {}
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

    window.AR.chartTermDepositReportLwc = { render: render };
})();
