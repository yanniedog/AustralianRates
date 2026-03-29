/**
 * Fetches public /site-ui (per-section apiBase) and applies chart_legend_opacity to registered LWC report legends.
 * Dispatches CustomEvent "ar:site-ui-settings" when opacity loads so pages that rebuild legend cssText (e.g. Economic Data) can refresh.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var DEFAULT = 0.75;
    var cached = DEFAULT;
    var legends = [];

    function applyAll() {
        legends.forEach(function (el) {
            try {
                if (el && el.style) el.style.opacity = String(cached);
            } catch (e) {}
        });
    }

    function ingestPayload(body) {
        if (
            body &&
            body.ok === true &&
            typeof body.chart_legend_opacity === 'number' &&
            Number.isFinite(body.chart_legend_opacity)
        ) {
            var o = body.chart_legend_opacity;
            if (o >= 0.05 && o <= 1) {
                cached = o;
                applyAll();
                try {
                    window.dispatchEvent(
                        new CustomEvent('ar:site-ui-settings', { detail: { chart_legend_opacity: cached } }),
                    );
                } catch (e) {}
            }
        }
    }

    function startFetch() {
        var cfg = window.AR.config || {};
        var base = String(cfg.apiBase || '').replace(/\/+$/, '');
        if (!base) return;
        var url = base + '/site-ui';
        var net = window.AR.network;
        if (net && typeof net.requestJson === 'function') {
            net
                .requestJson(url, { requestLabel: 'site-ui', timeoutMs: 8000, retryCount: 0 })
                .then(function (result) {
                    ingestPayload(result && result.data !== undefined ? result.data : result);
                })
                .catch(function () {});
        } else {
            fetch(url, { credentials: 'same-origin' })
                .then(function (r) {
                    return r.json();
                })
                .then(ingestPayload)
                .catch(function () {});
        }
    }

    window.AR.chartSiteUi = {
        getChartLegendOpacity: function () {
            return cached;
        },
        registerReportLegend: function (el) {
            if (!el) return;
            legends.push(el);
            el.style.opacity = String(cached);
        },
        unregisterReportLegend: function (el) {
            var i = legends.indexOf(el);
            if (i !== -1) legends.splice(i, 1);
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startFetch);
    } else {
        startFetch();
    }
})();
