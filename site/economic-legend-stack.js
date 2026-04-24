(function () {
    'use strict';

    window.AR = window.AR || {};

    function createLegendStack(deps) {
        var state = deps.state;
        var refs = deps.refs;
        var esc = deps.esc;
        var formatDate = deps.formatDate;
        var getTheme = deps.getTheme;
        var palette = deps.palette;

        function stackOverlayTheme() {
            var theme = getTheme();
            var light = document.documentElement.getAttribute('data-theme') === 'light';
            return {
                ttBg: theme.stackBg != null ? theme.stackBg : (light ? 'rgba(255,255,255,0.97)' : 'rgba(15,23,42,0.96)'),
                ttBorder: theme.stackBorder != null ? theme.stackBorder : (light ? 'rgba(100,116,139,0.20)' : 'rgba(100,116,139,0.30)'),
                ttText: theme.stackText != null ? theme.stackText : theme.text,
            };
        }

        function chartLegendOpacity() {
            if (window.AR && window.AR.chartSiteUi && typeof window.AR.chartSiteUi.getChartLegendOpacity === 'function') {
                return String(window.AR.chartSiteUi.getChartLegendOpacity());
            }
            return '0.75';
        }

        function chartLegendTextBrightness() {
            if (window.AR && window.AR.chartSiteUi && typeof window.AR.chartSiteUi.getChartLegendTextBrightness === 'function') {
                return String(window.AR.chartSiteUi.getChartLegendTextBrightness());
            }
            return '1';
        }

        function ensureEl() {
            if (!refs.chartEl) return null;
            var el = refs.chartEl.querySelector('.economic-chart-legend-stack');
            if (!el) {
                el = document.createElement('div');
                el.className = 'economic-chart-legend-stack';
                el.setAttribute('aria-hidden', 'true');
                refs.chartEl.appendChild(el);
            }
            return el;
        }

        function resolvedNormalized(series, ymd) {
            var pts = (series.points || []).filter(function (p) {
                return p != null && p.normalized_value != null && isFinite(Number(p.normalized_value));
            });
            if (!pts.length) return null;
            if (!ymd) {
                var last = pts[pts.length - 1];
                return { value: Number(last.normalized_value), atYmd: last.date };
            }
            var exact = pts.filter(function (p) { return p.date === ymd; })[0];
            if (exact) return { value: Number(exact.normalized_value), atYmd: exact.date };
            var best = null;
            for (var i = 0; i < pts.length; i++) {
                if (pts[i].date <= ymd) best = pts[i];
            }
            return best ? { value: Number(best.normalized_value), atYmd: best.date } : null;
        }

        function formatIndex(value) {
            if (value == null || !isFinite(value)) return 'n/a';
            return Number(value).toLocaleString('en-AU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
        }

        function sync() {
            var legendEl = ensureEl();
            if (!legendEl) return;
            if (!state.series.length) {
                legendEl.innerHTML = '';
                return;
            }
            var t = stackOverlayTheme();
            var chartW = refs.chartEl.clientWidth || 400;
            var narrow = chartW < 760;
            var compact = chartW < 420;
            var gridLeft = compact ? 46 : (narrow ? 50 : 56);
            var fontSize = compact ? '8px' : '9px';
            var hoverYmd = state.legendHoverYmd;
            legendEl.style.cssText = [
                'position:absolute',
                'top:8px',
                'left:' + (gridLeft + 6) + 'px',
                'display:flex',
                'flex-direction:column',
                'align-items:flex-start',
                'gap:1px',
                'padding:4px 6px',
                'font-size:' + fontSize,
                'line-height:1.4',
                "font-family:'Space Grotesk',system-ui,sans-serif",
                'color:' + t.ttText,
                'background:' + t.ttBg,
                'border:1px solid ' + t.ttBorder,
                'border-radius:4px',
                'z-index:5',
                'max-width:min(42%, 220px)',
                'max-height:calc(100% - 16px)',
                'overflow-x:hidden',
                'overflow-y:auto',
                '-webkit-overflow-scrolling:touch',
                'box-sizing:border-box',
                'pointer-events:auto',
                'cursor:default',
                'opacity:' + chartLegendOpacity(),
                '--ar-chart-legend-text-brightness:' + chartLegendTextBrightness()
            ].join(';');

            var rows = [];
            state.series.forEach(function (series, idx) {
                var res = resolvedNormalized(series, hoverYmd);
                if (!res) return;
                rows.push({
                    series: series,
                    color: palette[idx % palette.length],
                    value: res.value,
                });
            });
            rows.sort(function (a, b) { return b.value - a.value; });

            var parts = [];
            if (hoverYmd) {
                parts.push(
                    '<div class="economic-chart-legend-stack-date" style="font-size:' + (compact ? '7px' : '8px') + ';opacity:0.75;white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);letter-spacing:0.02em;filter:brightness(var(--ar-chart-legend-text-brightness,1));">' +
                    esc(formatDate(hoverYmd.indexOf('T') >= 0 ? hoverYmd : (hoverYmd + 'T12:00:00.000Z'))) +
                    '</div>'
                );
            }
            rows.forEach(function (row) {
                parts.push(
                    '<span class="economic-chart-legend-stack-row" style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;max-width:100%;">' +
                    '<span style="display:inline-block;width:14px;height:2px;background:' + esc(row.color) + ';flex-shrink:0;border-radius:1px;"></span>' +
                    '<span style="opacity:0.7;overflow:hidden;text-overflow:ellipsis;min-width:0;filter:brightness(var(--ar-chart-legend-text-brightness,1));">' + esc(row.series.short_label) + '</span>' +
                    '<span style="font-variant-numeric:tabular-nums;font-weight:600;flex-shrink:0;filter:brightness(var(--ar-chart-legend-text-brightness,1));">' + esc(formatIndex(row.value)) + '</span>' +
                    '</span>'
                );
            });
            legendEl.innerHTML = parts.join('');
        }

        return { ensureEl: ensureEl, sync: sync };
    }

    window.AR.economicLegendStack = { create: createLegendStack };
})();
