/**
 * Fetches public /site-ui and applies device-aware chart legend opacity + text brightness.
 * Dispatches "ar:site-ui-settings" with both desktop/mobile values plus the resolved current values.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var DEFAULT = 0.75;
    var DEFAULT_TEXT_BRIGHTNESS = 1;
    var DEFAULT_RIBBON_STYLE = {
        preset: 'glass',
        edge_width: 1.25,
        edge_opacity: 0.75,
        edge_opacity_others: 0.12,
        fill_opacity_end: 0.14,
        fill_opacity_peak: 0.42,
        focus_fill_opacity_end: 0.26,
        focus_fill_opacity_peak: 0.60,
        selected_fill_opacity_end: 0.34,
        selected_fill_opacity_peak: 0.72,
        fill_opacity_others_scale: 0.22,
        mean_width: 1,
        mean_opacity: 0.9,
        mean_opacity_others: 0.16,
        product_line_opacity_hover: 0.5,
        product_line_opacity_selected: 0.85,
        product_line_width_hover: 1.2,
        product_line_width_selected: 2.5,
        others_grey_mix: 0.62,
        active_z: 48,
        inactive_z: 2,
        gap_fill_enabled: true
    };
    var RIBBON_PRESETS = { glass: true, classic: true };
    var FEATURE_KEYS = [
        { key: 'chart_model_server_side' }
    ];

    var cached = {
        desktop: DEFAULT,
        mobile: DEFAULT,
        resolved: DEFAULT,
        textBrightnessDesktop: DEFAULT_TEXT_BRIGHTNESS,
        textBrightnessMobile: DEFAULT_TEXT_BRIGHTNESS,
        textBrightnessResolved: DEFAULT_TEXT_BRIGHTNESS,
        chartMaxProducts: null,
        chartMaxProductsMode: 'default',
        chartRibbonStyle: null,
        features: {}
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

    function resolvedTextBrightness() {
        return resolveIsMobile() ? cached.textBrightnessMobile : cached.textBrightnessDesktop;
    }

    function dispatchSettingsEvent() {
        try {
            window.dispatchEvent(new CustomEvent('ar:site-ui-settings', {
                detail: {
                    chart_legend_opacity: cached.resolved,
                    chart_legend_opacity_desktop: cached.desktop,
                    chart_legend_opacity_mobile: cached.mobile,
                    chart_legend_text_brightness: cached.textBrightnessResolved,
                    chart_legend_text_brightness_desktop: cached.textBrightnessDesktop,
                    chart_legend_text_brightness_mobile: cached.textBrightnessMobile,
                    chart_max_products: cached.chartMaxProducts,
                    chart_max_products_mode: cached.chartMaxProductsMode,
                    chart_ribbon_style: getChartRibbonStyleResolved(),
                    device_mode: resolveIsMobile() ? 'mobile' : 'desktop'
                }
            }));
        } catch (e) {}
    }

    function applyAll() {
        cached.resolved = resolvedOpacity();
        cached.textBrightnessResolved = resolvedTextBrightness();
        legends.forEach(function (el) {
            try {
                if (el && el.style) {
                    el.style.opacity = String(cached.resolved);
                    el.style.setProperty('--ar-chart-legend-text-brightness', String(cached.textBrightnessResolved));
                }
            } catch (e) {}
        });
        dispatchSettingsEvent();
    }

    function validOpacity(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0.05 && value <= 1;
    }

    function validTextBrightness(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 1.6;
    }

    function applyFeatureFlags() {
        if (!document.body || !document.body.classList) return;
        FEATURE_KEYS.forEach(function (entry) {
            var on = !!cached.features[entry.key];
            if (entry.bodyClass) document.body.classList.toggle(entry.bodyClass, on);
        });
    }

    function ingestFeatures(raw) {
        var out = {};
        if (raw && typeof raw === 'object') {
            FEATURE_KEYS.forEach(function (entry) {
                out[entry.key] = !!raw[entry.key];
            });
        } else {
            FEATURE_KEYS.forEach(function (entry) { out[entry.key] = false; });
        }
        cached.features = out;
        applyFeatureFlags();
    }

    function normalizeChartMaxProducts(value) {
        if (value == null || value === '' || value === 'unlimited') return null;
        var parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 1) return null;
        return Math.floor(parsed);
    }

    function mergeRibbonStyleClient(raw) {
        var d = DEFAULT_RIBBON_STYLE;
        function cloneDefaults() {
            return {
                preset: d.preset,
                edge_width: d.edge_width,
                edge_opacity: d.edge_opacity,
                edge_opacity_others: d.edge_opacity_others,
                fill_opacity_end: d.fill_opacity_end,
                fill_opacity_peak: d.fill_opacity_peak,
                focus_fill_opacity_end: d.focus_fill_opacity_end,
                focus_fill_opacity_peak: d.focus_fill_opacity_peak,
                selected_fill_opacity_end: d.selected_fill_opacity_end,
                selected_fill_opacity_peak: d.selected_fill_opacity_peak,
                fill_opacity_others_scale: d.fill_opacity_others_scale,
                mean_width: d.mean_width,
                mean_opacity: d.mean_opacity,
                mean_opacity_others: d.mean_opacity_others,
                product_line_opacity_hover: d.product_line_opacity_hover,
                product_line_opacity_selected: d.product_line_opacity_selected,
                product_line_width_hover: d.product_line_width_hover,
                product_line_width_selected: d.product_line_width_selected,
                others_grey_mix: d.others_grey_mix,
                active_z: d.active_z,
                inactive_z: d.inactive_z,
                gap_fill_enabled: d.gap_fill_enabled,
            };
        }
        if (!raw || typeof raw !== 'object') return cloneDefaults();
        function pick(key, lo, hi, fallback) {
            var v = raw[key];
            var n = typeof v === 'number' ? v : (v != null && String(v).trim() !== '' ? Number(String(v).trim()) : NaN);
            if (!Number.isFinite(n)) return fallback;
            return Math.min(hi, Math.max(lo, n));
        }
        function pick01(key, fallback) {
            return pick(key, 0, 1, fallback);
        }
        var active_z = pick('active_z', 4, 120, d.active_z);
        var inactive_z = pick('inactive_z', 0, 80, d.inactive_z);
        if (inactive_z >= active_z) inactive_z = Math.max(0, active_z - 1);
        var presetRaw = raw.preset != null ? String(raw.preset).trim().toLowerCase() : '';
        var preset = RIBBON_PRESETS[presetRaw] ? presetRaw : d.preset;
        return {
            preset: preset,
            edge_width: pick('edge_width', 0, 12, d.edge_width),
            edge_opacity: pick01('edge_opacity', d.edge_opacity),
            edge_opacity_others: pick01('edge_opacity_others', d.edge_opacity_others),
            fill_opacity_end: pick01('fill_opacity_end', d.fill_opacity_end),
            fill_opacity_peak: pick01('fill_opacity_peak', d.fill_opacity_peak),
            focus_fill_opacity_end: pick01('focus_fill_opacity_end', d.focus_fill_opacity_end),
            focus_fill_opacity_peak: pick01('focus_fill_opacity_peak', d.focus_fill_opacity_peak),
            selected_fill_opacity_end: pick01('selected_fill_opacity_end', d.selected_fill_opacity_end),
            selected_fill_opacity_peak: pick01('selected_fill_opacity_peak', d.selected_fill_opacity_peak),
            fill_opacity_others_scale: pick01('fill_opacity_others_scale', d.fill_opacity_others_scale),
            mean_width: pick('mean_width', 0, 8, d.mean_width),
            mean_opacity: pick01('mean_opacity', d.mean_opacity),
            mean_opacity_others: pick01('mean_opacity_others', d.mean_opacity_others),
            product_line_opacity_hover: pick01('product_line_opacity_hover', d.product_line_opacity_hover),
            product_line_opacity_selected: pick01('product_line_opacity_selected', d.product_line_opacity_selected),
            product_line_width_hover: pick('product_line_width_hover', 0, 6, d.product_line_width_hover),
            product_line_width_selected: pick('product_line_width_selected', 0, 8, d.product_line_width_selected),
            others_grey_mix: pick01('others_grey_mix', d.others_grey_mix),
            active_z: active_z,
            inactive_z: inactive_z,
            gap_fill_enabled: raw.gap_fill_enabled === false ? false : d.gap_fill_enabled,
        };
    }

    function getChartRibbonStyleResolved() {
        if (cached.chartRibbonStyle && typeof cached.chartRibbonStyle === 'object') return cached.chartRibbonStyle;
        return DEFAULT_RIBBON_STYLE;
    }

    function ingestPayload(body) {
        if (!body || body.ok !== true) return;
        var desktop = validOpacity(body.chart_legend_opacity_desktop)
            ? body.chart_legend_opacity_desktop
            : (validOpacity(body.chart_legend_opacity) ? body.chart_legend_opacity : DEFAULT);
        var mobile = validOpacity(body.chart_legend_opacity_mobile)
            ? body.chart_legend_opacity_mobile
            : desktop;
        var textBrightnessDesktop = validTextBrightness(body.chart_legend_text_brightness_desktop)
            ? body.chart_legend_text_brightness_desktop
            : (validTextBrightness(body.chart_legend_text_brightness) ? body.chart_legend_text_brightness : DEFAULT_TEXT_BRIGHTNESS);
        var textBrightnessMobile = validTextBrightness(body.chart_legend_text_brightness_mobile)
            ? body.chart_legend_text_brightness_mobile
            : textBrightnessDesktop;
        cached.desktop = desktop;
        cached.mobile = mobile;
        cached.textBrightnessDesktop = textBrightnessDesktop;
        cached.textBrightnessMobile = textBrightnessMobile;
        cached.chartMaxProducts = normalizeChartMaxProducts(body.chart_max_products);
        cached.chartMaxProductsMode = String(body.chart_max_products_mode || 'default').trim().toLowerCase() || 'default';
        cached.chartRibbonStyle = (body.chart_ribbon_style && typeof body.chart_ribbon_style === 'object')
            ? mergeRibbonStyleClient(body.chart_ribbon_style)
            : null;
        ingestFeatures(body.features);
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
                resolved: resolvedOpacity(),
                textBrightnessDesktop: cached.textBrightnessDesktop,
                textBrightnessMobile: cached.textBrightnessMobile,
                textBrightnessResolved: resolvedTextBrightness(),
                chartMaxProducts: cached.chartMaxProducts,
                chartMaxProductsMode: cached.chartMaxProductsMode
            };
        },
        getChartLegendTextBrightness: function () {
            return resolvedTextBrightness();
        },
        getChartLegendTextBrightnessSet: function () {
            return {
                desktop: cached.textBrightnessDesktop,
                mobile: cached.textBrightnessMobile,
                resolved: resolvedTextBrightness()
            };
        },
        getChartMaxProducts: function () {
            return cached.chartMaxProducts;
        },
        getChartMaxProductsMode: function () {
            return cached.chartMaxProductsMode;
        },
        getChartRibbonStyle: function () {
            return getChartRibbonStyleResolved();
        },
        getFeatures: function () {
            var snapshot = {};
            FEATURE_KEYS.forEach(function (entry) { snapshot[entry.key] = !!cached.features[entry.key]; });
            return snapshot;
        },
        registerReportLegend: function (el) {
            if (!el) return;
            legends.push(el);
            el.style.opacity = String(resolvedOpacity());
            el.style.setProperty('--ar-chart-legend-text-brightness', String(resolvedTextBrightness()));
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
