/**
 * Home Loan Report chart — LightweightCharts (TradingView) implementation.
 *
 * View modes:
 *   'bank'     — Best (lowest) rate per bank for current filter slice (default)
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
    var PALETTE = ['#4f8dfd', '#27c27a', '#f0b90b', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b', '#a78bfa', '#fb923c'];

    function bankShort(name) {
        var key = String(name || '').trim().toLowerCase();
        return BANK_SHORT[key] || String(name || '').slice(0, 12).trim();
    }
    function bankColor(name, index) {
        var key = String(name || '').trim().toLowerCase();
        return BANK_COLOR[key] || PALETTE[index % PALETTE.length];
    }

    function isDark() { return document.documentElement.getAttribute('data-theme') !== 'light'; }
    function theme() {
        var dark = isDark();
        return {
            muted: dark ? '#94a3b8' : '#64748b',
            grid: dark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.16)',
            axis: dark ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.35)',
            crosshairLine: dark ? 'rgba(99,179,237,0.60)' : 'rgba(37,99,235,0.55)',
            crosshairLabelBg: dark ? 'rgba(15,20,25,0.96)' : 'rgba(255,255,255,0.98)',
            rba: '#f59e0b',
            cpi: dark ? '#f87171' : '#dc2626',
            ttBg: dark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.97)',
            ttBorder: dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText: dark ? '#e2e8f0' : '#1e293b',
            good: dark ? '#34d399' : '#059669',
            bad: dark ? '#f87171' : '#dc2626',
        };
    }

    function todayYmd() { return new Date().toISOString().slice(0, 10); }
    function subtractMonths(ymd, count) {
        var d = new Date(ymd + 'T12:00:00Z');
        d.setUTCMonth(d.getUTCMonth() - count);
        return d.toISOString().slice(0, 10);
    }
    function fmtFull(ymd) {
        var s = String(ymd || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var parts = s.split('-');
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[+parts[1] - 1] + ' ' + +parts[2] + ', ' + parts[0];
    }

    function currentFilterParams() {
        var filters = window.AR.filters || {};
        if (typeof filters.buildFilterParams === 'function') return filters.buildFilterParams() || {};
        return {};
    }
    function formatFilterValue(field, value) {
        var utils = window.AR.utils || {};
        if (typeof utils.formatFilterValue === 'function') return utils.formatFilterValue(field, value);
        return String(value == null ? '' : value);
    }
    function contextLabel() {
        var params = currentFilterParams();
        var parts = [];
        [['security_purpose', 'Purpose'], ['repayment_type', 'Repayment'], ['rate_structure', 'Structure'], ['lvr_tier', 'LVR'], ['feature_set', 'Feature']].forEach(function (entry) {
            var value = String(params[entry[0]] || '').trim();
            if (!value) return;
            parts.push(formatFilterValue(entry[0], value));
        });
        return parts.join(' \u2022 ') || 'Current filtered slice';
    }

    function clipSteppedPoints(points, ctxMin, ctxMax) {
        var carry = null;
        var inWindow = [];
        for (var i = 0; i < points.length; i++) {
            var point = points[i];
            if (point.date < ctxMin) carry = point;
            else if (point.date <= ctxMax) inWindow.push(point);
        }
        var clipped = [];
        if (carry) clipped.push({ date: ctxMin, value: carry.value, productName: carry.productName, row: carry.row || null });
        clipped = clipped.concat(inWindow);
        if (clipped.length) {
            var last = clipped[clipped.length - 1];
            if (last.date < ctxMax) clipped.push({ date: ctxMax, value: last.value, productName: last.productName, row: last.row || null });
        }
        return clipped;
    }

    // ── Data: best-per-bank (min rate + winning product per date) ───────────
    function buildBankSeries(model) {
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var M = window.AR.chartMacroLwcShared;
        var byBank = {};
        allSeries.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            var pn = String(s.productName || 'Unknown');
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                if (!d || !Number.isFinite(v) || v < 4.0) return;
                byBank[k].byDate[d] = M.mergeWinningMortgage(byBank[k].byDate[d], v, pn);
            });
        });
        return Object.keys(byBank)
            .map(function (k) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) {
                    var cell = e.byDate[d];
                    return { date: d, value: cell.value, productName: cell.productName };
                });
                var latest = pts.length ? pts[pts.length - 1].value : 0;
                return { bankName: e.bankName, short: bankShort(e.bankName), color: bankColor(e.bankName, 0), latest: latest, points: pts };
            })
            .filter(function (entry) { return entry.points.length > 0; })
            .sort(function (a, b) {
                if (Number.isFinite(a.latest) && Number.isFinite(b.latest) && a.latest !== b.latest) return a.latest - b.latest;
                return String(a.bankName || '').localeCompare(String(b.bankName || ''));
            })
            .map(function (entry, index) {
                entry.color = bankColor(entry.bankName, index);
                entry.legendLabel = entry.short;
                return entry;
            });
    }

    // ── Data: individual products ────────────────────────────────────────────
    function buildProductSeries(model, focusBank) {
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var products = [];
        var bankIdx = {};
        var bankCount = {};
        allSeries.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var bk = bn.toLowerCase();
            if (focusBank && bk !== String(focusBank).toLowerCase()) return;
            var pts = (s.points || []).filter(function (p) {
                var v = Number(p.value);
                return p.date && Number.isFinite(v) && v >= 4.0;
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
        // Ascending sort for mortgages (lower = better)
        products.sort(function (a, b) { return a.latest - b.latest; });
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

    function extractBankNames(model) {
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var seen = {};
        var list = [];
        allSeries.forEach(function (s) {
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
        var overlayModule = window.AR.chartEconomicOverlays || {};
        if (!M || typeof M.prepareRbaCpiForReport !== 'function') throw new Error('chartMacroLwcShared not loaded');

        if (container._reportDispose) { try { container._reportDispose(); } catch (_) {} container._reportDispose = null; }

        var section = window.AR.section || 'home-loans';
        var vm = M.getViewMode(section);
        var reportRange = M.getReportRange(section);
        var isProductMode = vm.mode === 'products' || vm.mode === 'focus';

        // Build lines based on mode
        var lines;
        if (vm.mode === 'products') {
            lines = buildProductSeries(model, null);
        } else if (vm.mode === 'focus' && vm.focusBank) {
            lines = buildProductSeries(model, vm.focusBank);
        } else {
            lines = buildBankSeries(model);
        }

        var bankMin = null;
        var bankMax = null;
        lines.forEach(function (bank) {
            bank.points.forEach(function (point) {
                if (!bankMin || point.date < bankMin) bankMin = point.date;
                if (!bankMax || point.date > bankMax) bankMax = point.date;
            });
        });
        if (!bankMax) bankMax = todayYmd();
        if (!bankMin) bankMin = bankMax;

        var ctxMin = M.resolveReportDataMin(bankMin, rbaHistory, cpiData, economicOverlaySeries) || bankMin;
        var ctxMax = bankMax;
        var viewStart = M.resolveReportRangeStart(ctxMin, ctxMax, reportRange);

        var prep = M.prepareRbaCpiForReport(rbaHistory, cpiData, ctxMin, ctxMax);
        var rbaData = prep.rbaData;
        var cpiPoints = prep.cpiPoints;
        var chartStart = prep.chartStart || ctxMin;
        var overlayDefs = overlayModule.prepareWindowSeries ? overlayModule.prepareWindowSeries(economicOverlaySeries || [], ctxMin, ctxMax) : [];

        var compact = (container.clientWidth || 800) < 480;
        var defaultMaxLines = vm.mode === 'focus' ? 50 : (vm.mode === 'products' ? 25 : 100);
        var maxLines = M.resolveChartProductLimit(defaultMaxLines);
        var visiLines = lines.slice(0, Math.min(lines.length, maxLines));

        // ── DOM ─────────────────────────────────────────────────────────────
        container.innerHTML = '';
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';
        container.appendChild(wrapper);

        var t = theme();
        var bankList = extractBankNames(model);
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
        mount.className = 'lwc-chart-mount lwc-chart-mount--hl-report';
        mount.style.cssText = 'width:100%;flex:1;min-height:380px;position:relative;';
        wrapper.appendChild(mount);

        var infoBox = createInfoBox(t);
        wrapper.appendChild(infoBox.el);

        // Context label
        var label = document.createElement('div');
        label.textContent = contextLabel();
        label.style.cssText = 'position:absolute;bottom:44px;left:8px;font-size:9px;opacity:0.5;color:inherit;pointer-events:none;font-family:"Space Grotesk",system-ui,sans-serif;white-space:nowrap;z-index:3;';
        mount.appendChild(label);

        // ── LWC chart ───────────────────────────────────────────────────────
        var LineStyle = L.LineStyle || { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
        var LineType = L.LineType || { Simple: 0, WithSteps: 1, Curved: 2 };
        var chartOptions = M.reportChartOptions(L, t, overlayDefs.length > 0);
        chartOptions.localization = {
            priceFormatter: function (price) { return Number(price).toFixed(2) + '%'; },
            timeFormatter: function (time) { return fmtFull(M.utcToYmd(time)); },
        };
        var chart = L.createChart(mount, chartOptions);

        // CPI
        var cpiSeriesApi = null;
        if (cpiPoints.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, { color: t.cpi, lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3 });
            cpiSeriesApi.setData(M.fillForwardDaily(cpiPoints, 'date', 'value', chartStart, ctxMax).map(function (point) { return { time: M.ymdToUtc(point.date), value: point.value }; }));
        }

        // Rate lines
        var lineWidth = isProductMode && vm.mode !== 'focus' ? 1.5 : (compact ? 1.5 : 2);
        var seriesApis = [];
        visiLines.forEach(function (bank) {
            var clippedPts = clipSteppedPoints(bank.points, ctxMin, ctxMax);
            var data = clippedPts.map(function (point) { return { time: M.ymdToUtc(point.date), value: point.value }; });
            if (!data.length) return;
            var seriesApi = chart.addSeries(L.LineSeries, { color: bank.color, lineWidth: lineWidth, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3 });
            seriesApi.setData(data);
            seriesApis.push({ api: seriesApi, line: bank, lastValue: data.length ? data[data.length - 1].value : null, stepPoints: clippedPts });
        });

        // RBA
        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, { color: t.rba, lineWidth: 2, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3 });
            rbaSeriesApi.setData(M.fillForwardDaily(rbaData.points, 'date', 'rate', chartStart, ctxMax).map(function (point) { return { time: M.ymdToUtc(point.date), value: point.value }; }));
        }

        // Overlays (keep APIs for crosshair + left legend)
        var overlaySeriesApis = [];
        overlayDefs.forEach(function (series) {
            var data = (series.points || []).map(function (point) {
                if (!Number.isFinite(Number(point.normalized_value))) return { time: M.ymdToUtc(point.date) };
                return { time: M.ymdToUtc(point.date), value: point.normalized_value };
            });
            if (!data.length) return;
            var api = chart.addSeries(L.LineSeries, { color: series.color, lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.Simple, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3, priceScaleId: 'left', priceFormat: { type: 'price', precision: 1, minMove: 0.1 } });
            api.setData(data);
            overlaySeriesApis.push({
                api: api,
                def: series,
                lastValue: M.lastFiniteNormalizedOverlay(series.points),
            });
        });

        chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });

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
                var arr = M.rateLegendArrowHtml(e.value, prev, 'mortgage', t.good, t.bad);
                var lblHtml = M.legendSliceLabelHtml(e.line, e.stepPoints, ymd, ctxMax);
                items.push('<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;"><span style="display:inline-block;width:14px;height:2px;background:' + e.line.color + ';flex-shrink:0;border-radius:1px;"></span><span style="opacity:0.7;">' + lblHtml + '</span><span style="font-variant-numeric:tabular-nums;font-weight:600;">' + e.value.toFixed(2) + '%' + arr + '</span></span>');
            });
            if (sorted.length > LEGEND_CAP) items.push('<span style="opacity:0.35;font-size:8px;">+' + (sorted.length - LEGEND_CAP) + ' more</span>');
            return items;
        }
        function buildMacroItems(rbaVal, cpiVal, ymd) {
            var items = [];
            if (rbaVal != null) { var p = M.prevStepValue(rbaData.points, ymd || ctxMax, 'rate'); var a = M.rateLegendArrowHtml(rbaVal, p, 'mortgage', t.good, t.bad); items.push('<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);"><span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span><span style="color:' + t.rba + ';opacity:0.8;">RBA</span><span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaVal.toFixed(2) + '%' + a + '</span></span>'); }
            if (cpiVal != null) { var pc = M.prevStepValue(cpiPoints, ymd || ctxMax, 'value'); var ac = M.rateLegendArrowHtml(Number(cpiVal), pc, 'mortgage', t.good, t.bad, 1); items.push('<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;"><span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span><span style="color:' + t.cpi + ';opacity:0.8;">CPI</span><span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiVal).toFixed(1) + '%' + ac + '</span></span>'); }
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
            if (ymd) parts.push('<span style="font-size:8px;color:' + t.muted + ';white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);letter-spacing:0.02em;">' + fmtFull(ymd) + '</span>');
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
        var defaultCpi = (cpiSeriesApi && cpiPoints.length) ? cpiPoints[cpiPoints.length - 1].value : null;
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
                infoBox.hide();
                return;
            }
            infoBox.show({
                heading: fmtFull(cluster.selectionYmd),
                meta: M.selectionMetaText(cluster),
                items: cluster.entries,
            });
        }

        mount.addEventListener('mouseleave', function () {
            legendEl.innerHTML = defaultLegendHTML;
            infoBox.hide();
        });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                legendEl.innerHTML = defaultLegendHTML;
                infoBox.hide();
                return;
            }
            var time = M.utcToYmd(param.time);
            var rbaValue = null;
            var cpiValue = M.cpiAtDate(cpiPoints, time);
            if (rbaSeriesApi) { var rbaDataPoint = param.seriesData && param.seriesData.get(rbaSeriesApi); if (rbaDataPoint && Number.isFinite(rbaDataPoint.value)) rbaValue = rbaDataPoint.value; }
            var bankItems = [];
            seriesApis.forEach(function (entry) { var point = param.seriesData && param.seriesData.get(entry.api); var value = point && Number.isFinite(point.value) ? point.value : null; if (value != null) bankItems.push({ line: entry.line, value: value, stepPoints: entry.stepPoints }); });
            var hasEconOverlay = false;
            overlaySeriesApis.forEach(function (e) {
                var sd = param.seriesData && param.seriesData.get(e.api);
                if (sd && Number.isFinite(sd.value)) hasEconOverlay = true;
            });
            if (!bankItems.length && rbaValue == null && cpiValue == null && !hasEconOverlay) {
                legendEl.innerHTML = defaultLegendHTML;
                infoBox.hide();
                return;
            }
            refreshLegend(bankItems, rbaValue, cpiValue, time, param);
            refreshSelectionInfo(param);
        });

        // Click → info box
        chart.subscribeClick(function (param) {
            refreshSelectionInfo(param);
        });

        // Resize
        var resizeObserver = new ResizeObserver(function (entries) { var entry = entries[0]; if (!entry) return; chart.resize(entry.contentRect.width, Math.max(200, entry.contentRect.height)); chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) }); });
        resizeObserver.observe(mount);

        var disposed = false;
        var state = {
            chart: chart, mount: mount, kind: 'homeLoanReport',
            dispose: function () {
                if (disposed) return;
                disposed = true;
                resizeObserver.disconnect();
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

    window.AR.chartHomeLoanReportLwc = { render: render };
})();
