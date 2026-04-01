/**
 * Fetches public /site-ui and applies device-aware chart legend opacity.
 * Dispatches "ar:site-ui-settings" with both desktop/mobile values plus the resolved current value.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var DEFAULT = 0.75;
    var cached = {
        desktop: DEFAULT,
        mobile: DEFAULT,
        resolved: DEFAULT
    };
    var legends = [];
    var mobileMedia = null;

    function resolveIsMobile() {
        if (mobileMedia && typeof mobileMedia.matches === 'boolean') return mobileMedia.matches;
        return !!(window.innerWidth && window.innerWidth <= 767);
    }

    function resolvedOpacity() {
        return resolveIsMobile() ? cached.mobile : cached.desktop;
    }

    function dispatchSettingsEvent() {
        try {
            window.dispatchEvent(new CustomEvent('ar:site-ui-settings', {
                detail: {
                    chart_legend_opacity: cached.resolved,
                    chart_legend_opacity_desktop: cached.desktop,
                    chart_legend_opacity_mobile: cached.mobile,
                    device_mode: resolveIsMobile() ? 'mobile' : 'desktop'
                }
            }));
        } catch (e) {}
    }

    function applyAll() {
        cached.resolved = resolvedOpacity();
        legends.forEach(function (el) {
            try {
                if (el && el.style) el.style.opacity = String(cached.resolved);
            } catch (e) {}
        });
        dispatchSettingsEvent();
    }

    function validOpacity(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0.05 && value <= 1;
    }

    function ingestPayload(body) {
        if (!body || body.ok !== true) return;
        var desktop = validOpacity(body.chart_legend_opacity_desktop)
            ? body.chart_legend_opacity_desktop
            : (validOpacity(body.chart_legend_opacity) ? body.chart_legend_opacity : DEFAULT);
        var mobile = validOpacity(body.chart_legend_opacity_mobile)
            ? body.chart_legend_opacity_mobile
            : desktop;
        cached.desktop = desktop;
        cached.mobile = mobile;
        applyAll();
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
                .then(function (r) { return r.json(); })
                .then(ingestPayload)
                .catch(function () {});
        }
    }

    function bindDeviceListener() {
        if (typeof window.matchMedia === 'function') {
            mobileMedia = window.matchMedia('(max-width: 767px)');
            if (mobileMedia.addEventListener) {
                mobileMedia.addEventListener('change', applyAll);
            } else if (mobileMedia.addListener) {
                mobileMedia.addListener(applyAll);
            }
        }
        window.addEventListener('resize', applyAll);
    }

    window.AR.chartSiteUi = {
        getChartLegendOpacity: function () {
            return resolvedOpacity();
        },
        getChartLegendOpacitySet: function () {
            return {
                desktop: cached.desktop,
                mobile: cached.mobile,
                resolved: resolvedOpacity()
            };
        },
        registerReportLegend: function (el) {
            if (!el) return;
            legends.push(el);
            el.style.opacity = String(resolvedOpacity());
        },
        unregisterReportLegend: function (el) {
            var i = legends.indexOf(el);
            if (i !== -1) legends.splice(i, 1);
        }
    };

    bindDeviceListener();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startFetch);
    } else {
        startFetch();
    }
})();
