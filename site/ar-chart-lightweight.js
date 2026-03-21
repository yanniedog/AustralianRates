(function () {
    'use strict';
    window.AR = window.AR || {};

    var CHART_ENGINE_STORAGE = 'ar.chartEngine';
    var loadPromise = null;

    function helpers() {
        return window.AR.chartEchartsHelpers || {};
    }

    function isViewSupported(view) {
        var v = String(view || '');
        return v === 'compare' || v === 'economicReport' || v === 'homeLoanReport' || v === 'termDepositReport';
    }

    function effectiveEngine(pref, view) {
        var v = String(view || '');
        // report views always use lightweight — no ECharts fallback
        if (v === 'economicReport' || v === 'homeLoanReport' || v === 'termDepositReport') return 'lightweight';
        if (String(pref || 'echarts') !== 'lightweight') return 'echarts';
        return isViewSupported(v) ? 'lightweight' : 'echarts';
    }

    function engineStatusHint(pref, eff, view) {
        var p = String(pref || '');
        var e = String(eff || '');
        var v = String(view || '');
        if (p === 'lightweight' && e === 'echarts') {
            if (v === 'compare') return 'Classic charts — Lightweight unavailable or failed to load.';
            return 'Classic charts — switch to Compare view for Lightweight mode.';
        }
        if (e === 'lightweight' && (v === 'economicReport' || v === 'homeLoanReport' || v === 'termDepositReport')) return 'Lightweight (TradingView)';
        if (e === 'lightweight') return 'Lightweight (TradingView); RBA markers not shown.';
        return '';
    }

    function resolveBundleUrl() {
        var el = document.querySelector('script[src*="ar-charts.js"]');
        if (!el) return '';
        var src = el.getAttribute('src') || '';
        var base = new URL(src, window.location.href);
        var p = base.pathname;
        var slash = p.lastIndexOf('/');
        var dir = slash >= 0 ? p.slice(0, slash + 1) : '/';
        base.pathname = dir + 'vendor/lightweight-charts/lightweight-charts.bundle.js';
        return base.href;
    }

    function ensureLoaded() {
        if (window.LightweightCharts && typeof window.LightweightCharts.createChart === 'function') {
            return Promise.resolve();
        }
        if (loadPromise) return loadPromise;
        loadPromise = new Promise(function (resolve, reject) {
            var url = resolveBundleUrl();
            if (!url) {
                loadPromise = null;
                reject(new Error('Could not resolve Lightweight Charts bundle URL'));
                return;
            }
            var s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () {
                loadPromise = null;
                reject(new Error('Failed to load Lightweight Charts bundle'));
            };
            document.head.appendChild(s);
        });
        return loadPromise;
    }

    function dispose(state) {
        if (!state) return null;
        try {
            if (typeof state.dispose === 'function') {
                // economicReport state has its own dispose() that handles cleanup
                state.dispose();
            } else if (state.chart && typeof state.chart.remove === 'function') {
                state.chart.remove();
            }
        } catch (_e) { /* ignore */ }
        if (state.mount && state.mount.parentNode) state.mount.parentNode.removeChild(state.mount);
        return null;
    }

    function themeFallback() {
        return {
            softText: '#475569',
            mutedText: '#64748b',
            splitLine: 'rgba(148, 163, 184, 0.12)',
            axisLine: 'rgba(148, 163, 184, 0.55)',
            shadowAccent: 'rgba(37, 99, 235, 0.18)',
        };
    }

    function renderMainCompare(container, model, fields) {
        var L = window.LightweightCharts;
        var h = helpers();
        var paletteColor = typeof h.paletteColor === 'function' ? h.paletteColor : function (i) { return '#2563eb'; };
        var chartThemeFn = typeof h.chartTheme === 'function' ? h.chartTheme : function () { return themeFallback(); };
        var theme = chartThemeFn();
        var compareSeries = model.compareSeries || [];
        var xLabels = (model.surface && model.surface.xLabels) || [];

        container.innerHTML = '';
        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount';
        mount.style.width = '100%';
        mount.style.height = '100%';
        mount.style.minHeight = '360px';
        container.appendChild(mount);

        var chart = L.createChart(mount, {
            layout: {
                background: { type: L.ColorType.Solid, color: 'transparent' },
                textColor: theme.softText || theme.mutedText || '#475569',
            },
            grid: {
                vertLines: { color: theme.splitLine || 'rgba(148,163,184,0.12)' },
                horzLines: { color: theme.splitLine || 'rgba(148,163,184,0.12)' },
            },
            rightPriceScale: {
                borderColor: theme.axisLine || 'rgba(148,163,184,0.55)',
                scaleMargins: { top: 0.08, bottom: 0.12 },
            },
            timeScale: {
                borderColor: theme.axisLine || 'rgba(148,163,184,0.55)',
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: {
                mode: L.CrosshairMode.Normal,
            },
            localization: {
                priceFormatter: function (price) {
                    if (typeof h.metricAxisLabel === 'function') {
                        return h.metricAxisLabel(fields.yField, price, false);
                    }
                    return String(price);
                },
            },
        });

        compareSeries.forEach(function (series, index) {
            var byDate = {};
            (series.points || []).forEach(function (p) {
                if (p && p.date) byDate[p.date] = p;
            });
            var data = [];
            xLabels.forEach(function (date) {
                var pt = byDate[date];
                if (pt && Number.isFinite(pt.value)) {
                    data.push({ time: date, value: pt.value });
                } else {
                    data.push({ time: date });
                }
            });
            var line = chart.addSeries(L.LineSeries, {
                color: paletteColor(index),
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: compareSeries.length <= 3,
            });
            line.setData(data);
        });

        chart.timeScale().fitContent();

        return { chart: chart, mount: mount, kind: (fields && fields.view) || 'compare' };
    }

    function renderDetail(container, model, fields) {
        var L = window.LightweightCharts;
        var h = helpers();
        var paletteColor = typeof h.paletteColor === 'function' ? h.paletteColor : function () { return '#2563eb'; };
        var chartThemeFn = typeof h.chartTheme === 'function' ? h.chartTheme : function () { return themeFallback(); };
        var theme = chartThemeFn();
        var spotlight = model.spotlight;

        container.innerHTML = '';
        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--detail';
        mount.style.width = '100%';
        mount.style.height = '100%';
        mount.style.minHeight = '200px';
        container.appendChild(mount);

        if (!spotlight || !spotlight.series || !spotlight.series.points || !spotlight.series.points.length) {
            mount.innerHTML = '<p class="chart-detail-empty">' +
                'Select a rate cell to inspect a single product trend' +
                '</p>';
            return { chart: null, mount: mount, kind: 'detail' };
        }

        var points = spotlight.series.points;
        var chart = L.createChart(mount, {
            layout: {
                background: { type: L.ColorType.Solid, color: 'transparent' },
                textColor: theme.softText || theme.mutedText || '#475569',
            },
            grid: {
                vertLines: { color: theme.splitLine || 'rgba(148,163,184,0.12)' },
                horzLines: { color: theme.splitLine || 'rgba(148,163,184,0.12)' },
            },
            rightPriceScale: {
                borderColor: theme.axisLine || 'rgba(148,163,184,0.55)',
                scaleMargins: { top: 0.1, bottom: 0.15 },
            },
            timeScale: {
                borderColor: theme.axisLine || 'rgba(148,163,184,0.55)',
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: { mode: L.CrosshairMode.Normal },
            localization: {
                priceFormatter: function (price) {
                    if (typeof h.metricAxisLabel === 'function') {
                        return h.metricAxisLabel(fields.yField, price, false);
                    }
                    return String(price);
                },
            },
        });

        var data = points.map(function (point) {
            return { time: point.date, value: point.value };
        }).filter(function (row) { return row.time && Number.isFinite(row.value); });

        var topCol = theme.shadowAccent || 'rgba(37, 99, 235, 0.18)';
        var area = chart.addSeries(L.AreaSeries, {
            lineColor: paletteColor(1),
            topColor: topCol,
            bottomColor: 'transparent',
            lineWidth: 2,
            priceLineVisible: false,
        });
        area.setData(data);
        chart.timeScale().fitContent();

        return { chart: chart, mount: mount, kind: 'detail' };
    }

    function renderEconomicReport(container, model, fields, rbaHistory) {
        var mod = window.AR.chartSavingsReportLwc;
        if (!mod || typeof mod.render !== 'function') {
            throw new Error('chartSavingsReportLwc not loaded');
        }
        return mod.render(container, model, rbaHistory);
    }

    function renderHomeLoanReport(container, model, fields, rbaHistory) {
        var mod = window.AR.chartHomeLoanReportLwc;
        if (!mod || typeof mod.render !== 'function') throw new Error('chartHomeLoanReportLwc not loaded');
        return mod.render(container, model, rbaHistory);
    }

    function renderTermDepositReport(container, model, fields, rbaHistory) {
        var mod = window.AR.chartTermDepositReportLwc;
        if (!mod || typeof mod.render !== 'function') throw new Error('chartTermDepositReportLwc not loaded');
        return mod.render(container, model, rbaHistory);
    }

    function resizeState(state) {
        if (!state || !state.mount) return;
        if (state.chart && typeof state.chart.resize === 'function') {
            var w = Math.max(0, state.mount.clientWidth);
            var h = Math.max(0, state.mount.clientHeight);
            if (w > 0 && h > 0) state.chart.resize(w, h);
        }
    }

    window.AR.chartLightweight = {
        CHART_ENGINE_STORAGE: CHART_ENGINE_STORAGE,
        dispose: dispose,
        effectiveEngine: effectiveEngine,
        engineStatusHint: engineStatusHint,
        ensureLoaded: ensureLoaded,
        isViewSupported: isViewSupported,
        renderDetail: renderDetail,
        renderEconomicReport: renderEconomicReport,
        renderHomeLoanReport: renderHomeLoanReport,
        renderTermDepositReport: renderTermDepositReport,
        renderMainCompare: renderMainCompare,
        resizeState: resizeState,
    };
})();
