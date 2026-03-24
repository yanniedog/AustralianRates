/**
 * Home Loan Report chart - Lightweight Charts implementation.
 *
 * Shows one selected product per bank for the current like-for-like slice,
 * plus persistent RBA and CPI reference lines.
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
        'mystate bank': 'MyState'
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
        'mystate bank': '#e05c00'
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

    function isDark() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    }

    function theme() {
        var dark = isDark();
        return {
            muted: dark ? '#94a3b8' : '#64748b',
            grid: dark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.16)',
            axis: dark ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.35)',
            rba: '#f59e0b',
            cpi: dark ? '#f87171' : '#dc2626',
            ttBg: dark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.97)',
            ttBorder: dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText: dark ? '#e2e8f0' : '#1e293b',
            spread: dark ? '#fb923c' : '#ea580c',
            good: dark ? '#34d399' : '#059669',
            bad: dark ? '#f87171' : '#dc2626',
        };
    }

    function todayYmd() {
        return new Date().toISOString().slice(0, 10);
    }

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

    function fmtMonYr(ymd) {
        var s = String(ymd || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var parts = s.split('-');
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[+parts[1] - 1] + ' \'' + parts[0].slice(2);
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
        [
            ['security_purpose', 'Purpose'],
            ['repayment_type', 'Repayment'],
            ['rate_structure', 'Structure'],
            ['lvr_tier', 'LVR'],
            ['feature_set', 'Feature']
        ].forEach(function (entry) {
            var value = String(params[entry[0]] || '').trim();
            if (!value) return;
            parts.push(formatFilterValue(entry[0], value));
        });
        return parts.join(' • ') || 'Current filtered slice';
    }

    function buildBankSeries(model) {
        // Use allSeries so MIN aggregation covers all products across the current filter slice.
        // Each bank shows its best (lowest) rate at each date for the selected product type.
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        var byBank = {};

        allSeries.forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (!byBank[k]) byBank[k] = { bankName: bn, byDate: {} };
            (s.points || []).forEach(function (p) {
                var d = String(p.date || '');
                var v = Number(p.value);
                // 4% floor excludes collection errors, government-backed or specialty loans
                if (!d || !Number.isFinite(v) || v < 4.0) return;
                // MIN rate per bank per date (lower = better for borrower)
                if (byBank[k].byDate[d] == null || v < byBank[k].byDate[d]) byBank[k].byDate[d] = v;
            });
        });

        return Object.keys(byBank)
            .map(function (k, index) {
                var e = byBank[k];
                var pts = Object.keys(e.byDate).sort().map(function (d) { return { date: d, value: e.byDate[d] }; });
                var latest = pts.length ? pts[pts.length - 1].value : 0;
                return {
                    bankName: e.bankName,
                    short: bankShort(e.bankName),
                    color: bankColor(e.bankName, index),
                    latest: latest,
                    points: pts
                };
            })
            .filter(function (entry) { return entry.points.length > 0; })
            .sort(function (left, right) {
                if (Number.isFinite(left.latest) && Number.isFinite(right.latest) && left.latest !== right.latest) {
                    return left.latest - right.latest;
                }
                return String(left.bankName || '').localeCompare(String(right.bankName || ''));
            })
            .map(function (entry, index) {
                entry.color = bankColor(entry.bankName, index);
                return entry;
            });
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
        if (carry) clipped.push({ date: ctxMin, value: carry.value, row: carry.row || null });
        clipped = clipped.concat(inWindow);
        if (clipped.length) {
            var last = clipped[clipped.length - 1];
            if (last.date < ctxMax) clipped.push({ date: ctxMax, value: last.value, row: last.row || null });
        }
        return clipped;
    }

    function render(container, model, rbaHistory, cpiData) {
        var L = window.LightweightCharts;
        if (!L || !container) return null;

        var M = window.AR.chartMacroLwcShared;
        if (!M || typeof M.prepareRbaCpiForReport !== 'function') {
            throw new Error('chartMacroLwcShared not loaded');
        }

        var banks = buildBankSeries(model);
        var bankMax = null;
        banks.forEach(function (bank) {
            bank.points.forEach(function (point) {
                if (!bankMax || point.date > bankMax) bankMax = point.date;
            });
        });
        if (!bankMax) bankMax = todayYmd();

        var ctxMin = subtractMonths(bankMax, 18);
        var ctxMax = bankMax;
        var viewStart = subtractMonths(ctxMax, 3);

        var prep = M.prepareRbaCpiForReport(rbaHistory, cpiData, ctxMax);
        var rbaData = prep.rbaData;
        var cpiPoints = prep.cpiPoints;
        var rbaStart = prep.rbaStart;

        var compact = (container.clientWidth || 800) < 480;
        var maxBanks = Math.min(banks.length, 100);
        var visibleBanks = banks.slice(0, maxBanks);

        container.innerHTML = '';
        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--hl-report';
        mount.style.width = '100%';
        mount.style.height = '100%';
        mount.style.minHeight = '400px';
        mount.style.position = 'relative';
        container.appendChild(mount);

        var label = document.createElement('div');
        label.textContent = contextLabel();
        label.style.cssText = [
            'position:absolute',
            'bottom:44px',
            'left:8px',
            'font-size:9px',
            'opacity:0.5',
            'color:inherit',
            'pointer-events:none',
            "font-family:'Space Grotesk',system-ui,sans-serif",
            'white-space:nowrap',
            'z-index:3'
        ].join(';');
        mount.appendChild(label);

        var t = theme();
        var LineStyle = L.LineStyle || { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
        var LineType = L.LineType || { Simple: 0, WithSteps: 1, Curved: 2 };

        var chart = L.createChart(mount, {
            layout: {
                background: { type: L.ColorType.Solid, color: 'transparent' },
                textColor: t.muted,
                fontFamily: "'Space Grotesk', system-ui, sans-serif"
            },
            grid: {
                vertLines: { color: t.grid },
                horzLines: { color: t.grid }
            },
            rightPriceScale: {
                borderColor: t.axis,
                scaleMargins: { top: 0.06, bottom: 0.12 },
                lastValueVisible: false
            },
            timeScale: {
                borderColor: t.axis,
                timeVisible: false,
                secondsVisible: false,
                rightOffset: 5
            },
            crosshair: {
                mode: L.CrosshairMode.Normal,
                vertLine: {
                    color: 'rgba(148,163,184,0.45)',
                    width: 1,
                    style: LineStyle.Dashed,
                    labelBackgroundColor: 'rgba(100,116,139,0.80)'
                },
                horzLine: {
                    color: 'rgba(148,163,184,0.45)',
                    width: 1,
                    labelBackgroundColor: 'rgba(100,116,139,0.80)'
                }
            },
            localization: {
                priceFormatter: function (price) { return Number(price).toFixed(2) + '%'; },
                timeFormatter: function (time) { return fmtFull(M.utcToYmd(time)); }
            },
            handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true }
        });

        var cpiSeriesApi = null;
        if (cpiPoints.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, {
                color: t.cpi,
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                lineType: LineType.Simple,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3
            });
            cpiSeriesApi.setData(
                M.fillForwardDaily(cpiPoints, 'date', 'value', rbaStart, ctxMax)
                    .map(function (point) { return { time: M.ymdToUtc(point.date), value: point.value }; })
            );
        }

        var bankSeriesApis = [];
        visibleBanks.forEach(function (bank) {
            var clippedPts = clipSteppedPoints(bank.points, ctxMin, ctxMax);
            var data = clippedPts.map(function (point) {
                return { time: M.ymdToUtc(point.date), value: point.value };
            });
            if (!data.length) return;
            var seriesApi = chart.addSeries(L.LineSeries, {
                color: bank.color,
                lineWidth: compact ? 1.5 : 2,
                lineType: LineType.Simple,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3
            });
            seriesApi.setData(data);
            bankSeriesApis.push({
                api: seriesApi,
                bank: bank,
                lastValue: data.length ? data[data.length - 1].value : null,
                stepPoints: clippedPts,
            });
        });

        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, {
                color: t.rba,
                lineWidth: 2,
                lineType: LineType.Simple,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3
            });
            rbaSeriesApi.setData(
                M.fillForwardDaily(rbaData.points, 'date', 'rate', rbaStart, ctxMax)
                    .map(function (point) { return { time: M.ymdToUtc(point.date), value: point.value }; })
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
            var prevB = M.prevStepValue(entry.stepPoints, ctxMax, 'value');
            var arrB = M.rateLegendArrowHtml(entry.lastValue, prevB, 'mortgage', t.good, t.bad);
            item.innerHTML =
                '<span style="display:inline-block;width:14px;height:2px;background:' + entry.bank.color + ';flex-shrink:0;border-radius:1px;"></span>' +
                '<span style="opacity:0.7;">' + entry.bank.short + '</span>' +
                '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + entry.lastValue.toFixed(2) + '%' + arrB + '</span>';
            legendEl.appendChild(item);
        });
        if (rbaSeriesApi && rbaData.points.length) {
            var rbaLast = rbaData.points[rbaData.points.length - 1].rate;
            var rbaItem = document.createElement('span');
            rbaItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);';
            var prevR = M.prevStepValue(rbaData.points, ctxMax, 'rate');
            var arrR = M.rateLegendArrowHtml(rbaLast, prevR, 'mortgage', t.good, t.bad);
            rbaItem.innerHTML =
                '<span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span>' +
                '<span style="color:' + t.rba + ';opacity:0.8;">RBA</span>' +
                '<span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaLast.toFixed(2) + '%' + arrR + '</span>';
            legendEl.appendChild(rbaItem);
        }
        if (cpiSeriesApi && cpiPoints.length) {
            var cpiLast = cpiPoints[cpiPoints.length - 1].value;
            var cpiItem = document.createElement('span');
            cpiItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
            var prevC = M.prevStepValue(cpiPoints, ctxMax, 'value');
            var arrC = M.rateLegendArrowHtml(Number(cpiLast), prevC, 'mortgage', t.good, t.bad);
            cpiItem.innerHTML =
                '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                '<span style="color:' + t.cpi + ';opacity:0.8;">CPI</span>' +
                '<span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiLast).toFixed(1) + '%' + arrC + '</span>';
            legendEl.appendChild(cpiItem);
        }
        mount.appendChild(legendEl);

        var defaultLegendHTML = legendEl.innerHTML;

        function populateLegend(bankItems, rbaValue, cpiValue, crosshairYmd) {
            legendEl.innerHTML = '';
            if (crosshairYmd) {
                var dl = document.createElement('span');
                dl.style.cssText = 'font-size:8px;color:' + t.muted + ';white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);flex-shrink:0;letter-spacing:0.02em;';
                dl.textContent = fmtFull(crosshairYmd);
                legendEl.appendChild(dl);
            }
            var sorted = bankItems.slice().sort(function (a, b) {
                return (b.value != null ? b.value : -Infinity) - (a.value != null ? a.value : -Infinity);
            });
            sorted.forEach(function (entry) {
                if (entry.value == null) return;
                var item = document.createElement('span');
                item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
                var prevB = M.prevStepValue(entry.stepPoints, crosshairYmd, 'value');
                var arrB = M.rateLegendArrowHtml(entry.value, prevB, 'mortgage', t.good, t.bad);
                item.innerHTML =
                    '<span style="display:inline-block;width:14px;height:2px;background:' + entry.bank.color + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="opacity:0.7;">' + entry.bank.short + '</span>' +
                    '<span style="font-variant-numeric:tabular-nums;font-weight:600;">' + entry.value.toFixed(2) + '%' + arrB + '</span>';
                legendEl.appendChild(item);
            });
            if (rbaValue != null) {
                var rbaItem = document.createElement('span');
                rbaItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;padding-top:2px;border-top:1px solid rgba(148,163,184,0.15);';
                var prevR = M.prevStepValue(rbaData.points, crosshairYmd, 'rate');
                var arrR = M.rateLegendArrowHtml(rbaValue, prevR, 'mortgage', t.good, t.bad);
                rbaItem.innerHTML =
                    '<span style="display:inline-block;width:14px;height:2px;background:' + t.rba + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="color:' + t.rba + ';opacity:0.8;">RBA</span>' +
                    '<span style="color:' + t.rba + ';font-variant-numeric:tabular-nums;font-weight:600;">' + rbaValue.toFixed(2) + '%' + arrR + '</span>';
                legendEl.appendChild(rbaItem);
            }
            if (cpiValue != null) {
                var cpiItem = document.createElement('span');
                cpiItem.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
                var prevC = M.prevStepValue(cpiPoints, crosshairYmd, 'value');
                var arrC = M.rateLegendArrowHtml(Number(cpiValue), prevC, 'mortgage', t.good, t.bad);
                cpiItem.innerHTML =
                    '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                    '<span style="color:' + t.cpi + ';opacity:0.8;">CPI</span>' +
                    '<span style="color:' + t.cpi + ';font-variant-numeric:tabular-nums;font-weight:600;">' + Number(cpiValue).toFixed(1) + '%' + arrC + '</span>';
                legendEl.appendChild(cpiItem);
            }
        }

        mount.addEventListener('mouseleave', function () {
            legendEl.innerHTML = defaultLegendHTML;
        });
        mount.addEventListener('dblclick', function () {
            chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });
        });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                legendEl.innerHTML = defaultLegendHTML;
                return;
            }
            var time = M.utcToYmd(param.time);
            var rbaValue = null;
            var cpiValue = M.cpiAtDate(cpiPoints, time);
            if (rbaSeriesApi) {
                var rbaDataPoint = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rbaDataPoint && Number.isFinite(rbaDataPoint.value)) rbaValue = rbaDataPoint.value;
            }
            var bankItems = [];
            bankSeriesApis.forEach(function (entry) {
                var point = param.seriesData && param.seriesData.get(entry.api);
                var value = point && Number.isFinite(point.value) ? point.value : null;
                if (value != null) bankItems.push({ bank: entry.bank, value: value, stepPoints: entry.stepPoints });
            });
            if (!bankItems.length && rbaValue == null && cpiValue == null) {
                legendEl.innerHTML = defaultLegendHTML;
                return;
            }
            populateLegend(bankItems, rbaValue, cpiValue, time);
        });

        var resizeObserver = new ResizeObserver(function (entries) {
            var entry = entries[0];
            if (!entry) return;
            chart.resize(entry.contentRect.width, Math.max(200, entry.contentRect.height));
            chart.timeScale().setVisibleRange({ from: M.ymdToUtc(viewStart), to: M.ymdToUtc(ctxMax) });
        });
        resizeObserver.observe(mount);

        return {
            chart: chart,
            mount: mount,
            kind: 'homeLoanReport',
            dispose: function () {
                resizeObserver.disconnect();
                try { chart.remove(); } catch (_e) { /* ignore */ }
            }
        };
    }

    window.AR.chartHomeLoanReportLwc = { render: render };
})();
