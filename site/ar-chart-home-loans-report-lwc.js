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
            spread: dark ? '#fb923c' : '#ea580c'
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
        var ranking = model && model.lenderRanking && Array.isArray(model.lenderRanking.entries)
            ? model.lenderRanking.entries
            : [];

        return ranking.map(function (entry, index) {
            var series = entry && entry.series ? entry.series : null;
            var points = series && Array.isArray(series.points)
                ? series.points.map(function (point) {
                    return {
                        date: String(point.date || ''),
                        value: Number(point.value),
                        row: point.row || null
                    };
                }).filter(function (point) {
                    return point.date && Number.isFinite(point.value) && point.value > 0.5;
                })
                : [];

            return {
                bankName: entry.bankName,
                productName: entry.productName || '',
                seriesKey: entry.seriesKey || (series ? series.key : ''),
                short: bankShort(entry.bankName),
                color: bankColor(entry.bankName, index),
                latest: Number(entry.value),
                points: points
            };
        }).filter(function (entry) {
            return entry.points.length > 0;
        }).sort(function (left, right) {
            if (Number.isFinite(left.latest) && Number.isFinite(right.latest) && left.latest !== right.latest) {
                return left.latest - right.latest;
            }
            return String(left.bankName || '').localeCompare(String(right.bankName || ''));
        });
    }

    function buildRbaSeries(rbaHistory) {
        if (!Array.isArray(rbaHistory) || !rbaHistory.length) return { points: [], decisions: [] };
        var all = rbaHistory.map(function (row) {
            return {
                date: String(row.effective_date || row.date || '').slice(0, 10),
                rate: Number(row.cash_rate != null ? row.cash_rate : row.value)
            };
        }).filter(function (row) {
            return row.date && Number.isFinite(row.rate);
        }).sort(function (left, right) {
            return left.date.localeCompare(right.date);
        });

        var deduped = [];
        all.forEach(function (row) {
            if (!deduped.length || row.rate !== deduped[deduped.length - 1].rate) deduped.push(row);
        });

        return { points: deduped.slice(), decisions: deduped.slice() };
    }

    function buildCpiSeries(cpiData) {
        return (Array.isArray(cpiData) ? cpiData : []).map(function (row) {
            return {
                date: String(row.quarter_date || row.date || '').slice(0, 10),
                value: Number(row.annual_change != null ? row.annual_change : row.value)
            };
        }).filter(function (row) {
            return row.date && Number.isFinite(row.value);
        }).sort(function (left, right) {
            return left.date.localeCompare(right.date);
        });
    }

    function cpiAtDate(points, dateStr) {
        var value = null;
        for (var i = 0; i < points.length; i++) {
            if (String(points[i].date) <= dateStr) value = points[i].value;
        }
        return value;
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
        var rbaData = buildRbaSeries(rbaHistory || []);
        var cpiPoints = buildCpiSeries(cpiData || []);

        (function clipRba() {
            var carry = null;
            var inWindow = [];
            rbaData.points.forEach(function (point) {
                if (point.date < ctxMin) carry = point;
                else if (point.date <= ctxMax) inWindow.push(point);
            });
            var next = [];
            var carryRate = carry ? carry.rate : (inWindow.length ? inWindow[0].rate : null);
            if (carryRate != null) next.push({ date: ctxMin, rate: carryRate });
            next = next.concat(inWindow);
            if (next.length) {
                var last = next[next.length - 1];
                if (last.date < ctxMax) next.push({ date: ctxMax, rate: last.rate });
            }
            rbaData.points = next;
        })();

        if (cpiPoints.length) {
            var cpiLast = cpiPoints[cpiPoints.length - 1];
            if (cpiLast.date < ctxMax) {
                cpiPoints.push({ date: ctxMax, value: cpiLast.value });
            }
        }

        var width = container.clientWidth || 800;
        var compact = width < 480;
        var narrow = width < 720;
        var maxBanks = compact ? 6 : (narrow ? 10 : banks.length);
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
                scaleMargins: { top: 0.06, bottom: 0.06 }
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
                timeFormatter: function (time) { return fmtMonYr(String(time).slice(0, 10)); }
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
        });

        var cpiSeriesApi = null;
        if (cpiPoints.length) {
            cpiSeriesApi = chart.addSeries(L.LineSeries, {
                color: t.cpi,
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                lineType: LineType.WithSteps,
                title: 'CPI',
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3
            });
            cpiSeriesApi.setData(cpiPoints.map(function (point) {
                return { time: point.date, value: point.value };
            }));
        }

        var bankSeriesApis = [];
        visibleBanks.forEach(function (bank) {
            var data = clipSteppedPoints(bank.points, ctxMin, ctxMax).map(function (point) {
                return { time: point.date, value: point.value };
            });
            if (!data.length) return;
            var seriesApi = chart.addSeries(L.LineSeries, {
                color: bank.color,
                lineWidth: compact ? 1.5 : 2,
                lineType: LineType.WithSteps,
                title: bank.short,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3
            });
            seriesApi.setData(data);
            bankSeriesApis.push({ api: seriesApi, bank: bank });
        });

        var rbaSeriesApi = null;
        if (rbaData.points.length) {
            rbaSeriesApi = chart.addSeries(L.LineSeries, {
                color: t.rba,
                lineWidth: 2,
                lineType: LineType.WithSteps,
                title: 'RBA',
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3
            });
            rbaSeriesApi.setData(rbaData.points.map(function (point) {
                return { time: point.date, value: point.rate };
            }));
        }

        chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax });

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
            'max-width:320px',
            'min-width:180px'
        ].join(';');
        mount.appendChild(tooltipEl);

        mount.addEventListener('mouseleave', function () {
            tooltipEl.style.display = 'none';
        });
        mount.addEventListener('dblclick', function () {
            chart.timeScale().setVisibleRange({ from: ctxMin, to: ctxMax });
        });

        chart.subscribeCrosshairMove(function (param) {
            if (!param || !param.point || !param.time) {
                tooltipEl.style.display = 'none';
                return;
            }

            var time = String(param.time).slice(0, 10);
            var rbaValue = null;
            var cpiValue = cpiAtDate(cpiPoints, time);
            var lines = [
                '<div style="font-size:10.5px;color:' + t.muted + ';letter-spacing:0.04em;margin-bottom:5px;">' + fmtFull(time) + '</div>'
            ];

            if (rbaSeriesApi) {
                var rbaDataPoint = param.seriesData && param.seriesData.get(rbaSeriesApi);
                if (rbaDataPoint && Number.isFinite(rbaDataPoint.value)) rbaValue = rbaDataPoint.value;
            }

            var hasBanks = false;
            bankSeriesApis.forEach(function (entry) {
                var point = param.seriesData && param.seriesData.get(entry.api);
                var value = point && Number.isFinite(point.value) ? point.value : null;
                if (value == null) return;
                hasBanks = true;
                var spreadHtml = '';
                if (rbaValue != null) {
                    var spread = value - rbaValue;
                    var spreadLabel = (spread >= 0 ? '+' : '') + spread.toFixed(2) + '% vs RBA';
                    spreadHtml = ' <span style="color:' + t.spread + ';font-size:9.5px;">' + spreadLabel + '</span>';
                }
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">' +
                        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + entry.bank.color + ';flex-shrink:0;"></span>' +
                        '<span style="font-weight:600;white-space:nowrap;">' + entry.bank.short + '</span>' +
                        '<span style="margin-left:auto;padding-left:10px;font-variant-numeric:tabular-nums;">' + value.toFixed(2) + '%</span>' +
                        spreadHtml +
                    '</div>'
                );
            });

            if (hasBanks && (rbaValue != null || cpiValue != null)) {
                lines.push('<div style="border-top:1px solid rgba(148,163,184,0.15);margin:5px 0 3px;"></div>');
            }

            if (rbaValue != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">' +
                        '<span style="display:inline-block;width:12px;height:3px;background:' + t.rba + ';flex-shrink:0;"></span>' +
                        '<span style="color:' + t.rba + ';font-weight:700;">RBA</span>' +
                        '<span style="margin-left:auto;padding-left:10px;color:' + t.rba + ';font-variant-numeric:tabular-nums;">' + rbaValue.toFixed(2) + '%</span>' +
                    '</div>'
                );
            }

            if (cpiValue != null) {
                lines.push(
                    '<div style="margin:2px 0;display:flex;align-items:baseline;gap:4px;">' +
                        '<span style="display:inline-block;width:12px;height:2px;border-top:2px dashed ' + t.cpi + ';flex-shrink:0;"></span>' +
                        '<span style="color:' + t.cpi + ';font-weight:600;">CPI</span>' +
                        '<span style="color:' + t.muted + ';font-size:9px;margin-left:2px;">annual</span>' +
                        '<span style="margin-left:auto;padding-left:10px;color:' + t.cpi + ';font-variant-numeric:tabular-nums;">' + Number(cpiValue).toFixed(1) + '%</span>' +
                    '</div>'
                );
            }

            if (lines.length <= 1) {
                tooltipEl.style.display = 'none';
                return;
            }

            tooltipEl.innerHTML = lines.join('');
            tooltipEl.style.display = 'block';

            var mountWidth = mount.clientWidth;
            var mountHeight = mount.clientHeight;
            var tooltipWidth = 300;
            var tooltipHeight = tooltipEl.offsetHeight || 120;
            var left = param.point.x + 14;
            var top = param.point.y + 14;

            if (left + tooltipWidth > mountWidth - 4) left = param.point.x - tooltipWidth - 10;
            if (top + tooltipHeight > mountHeight - 4) top = param.point.y - tooltipHeight - 10;

            tooltipEl.style.left = Math.max(4, left) + 'px';
            tooltipEl.style.top = Math.max(4, top) + 'px';
        });

        var resizeObserver = new ResizeObserver(function (entries) {
            var entry = entries[0];
            if (!entry) return;
            chart.resize(entry.contentRect.width, Math.max(200, entry.contentRect.height));
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
