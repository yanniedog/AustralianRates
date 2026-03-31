(function () {
    'use strict';

    window.AR = window.AR || {};

    var ar = window.AR;
    var config = ar.config || {};
    var utils = ar.utils || {};
    var network = ar.network || {};
    var apiBase = config.apiBase || (window.location.origin + '/api/economic-data');
    var clientLog = typeof utils.clientLog === 'function' ? utils.clientLog : function () {};
    var esc = typeof utils.esc === 'function'
        ? utils.esc
        : (window._arEsc || function (value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        });
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) {
            if (error && typeof error === 'object') {
                if (error.userMessage) return String(error.userMessage);
                if (error.message) return String(error.message);
            }
            return String(fallback || 'Request failed.');
        };
    var sessionKey = 'ar-economic-data-debug-session';
    var Y_SCALE_STORAGE_KEY = 'ar-economic-y-scale';
    var ECONOMIC_CHART_PALETTE = ['#d95f02', '#1b9e77', '#7570b3', '#66a61e', '#e7298a', '#1f78b4', '#b15928', '#6a3d9a'];

    function readStoredYScale() {
        try {
            var v = window.sessionStorage.getItem(Y_SCALE_STORAGE_KEY);
            if (v === 'log' || v === 'linear') return v;
        } catch (_e) {}
        return 'log';
    }

    function persistYScale(scale) {
        try {
            window.sessionStorage.setItem(Y_SCALE_STORAGE_KEY, scale);
        } catch (_e) {}
    }

    var state = {
        catalog: null,
        range: '5Y',
        yScale: readStoredYScale(),
        selectedPreset: 'rba_watchlist',
        selectedIds: [],
        series: [],
        chart: null,
        hoveredDate: null,
        legendHoverYmd: null,
        lastCatalogLoadedAt: '',
        lastSeriesLoadedAt: '',
        lastLoadReason: 'startup',
        requestCount: 0
    };

    var refs = {
        presetRow: document.getElementById('preset-row'),
        rangeRow: document.getElementById('range-row'),
        categoryGroups: document.getElementById('category-groups'),
        chartMeta: document.getElementById('chart-meta'),
        rangeNote: document.getElementById('economic-range-note'),
        chartEl: document.getElementById('economic-chart'),
        emptyEl: document.getElementById('economic-empty'),
        seriesList: document.getElementById('economic-series-list'),
        pointDetails: document.getElementById('economic-point-details'),
        sourceList: document.getElementById('economic-source-list'),
        activePreset: document.getElementById('economic-active-preset'),
        selectedCount: document.getElementById('economic-selected-count'),
        statusText: document.getElementById('economic-status-text'),
        yScaleBtn: document.getElementById('economic-y-scale')
    };

    function todayIso() { return new Date().toISOString().slice(0, 10); }

    function shiftYears(isoDate, years) {
        var date = new Date(isoDate + 'T00:00:00.000Z');
        date.setUTCFullYear(date.getUTCFullYear() + years);
        return date.toISOString().slice(0, 10);
    }

    function currentRange() {
        var endDate = todayIso();
        if (state.range === 'All') return { start_date: '1970-01-01', end_date: endDate };
        return { start_date: shiftYears(endDate, -Number(String(state.range).replace('Y', ''))), end_date: endDate };
    }

    function getDebugSessionId() {
        try {
            var existing = window.sessionStorage.getItem(sessionKey);
            if (existing) return existing;
            var created = 'economic-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
            window.sessionStorage.setItem(sessionKey, created);
            return created;
        } catch (_error) {
            return 'economic-anon';
        }
    }

    function toRemotePayload(level, message, detail) {
        return {
            sessionId: getDebugSessionId(),
            level: String(level || 'info'),
            message: String(message || ''),
            location: 'economic-data.js',
            section: 'economic-data',
            url: window.location.href,
            timestamp: Date.now(),
            data: detail && typeof detail === 'object' ? detail : { detail: detail }
        };
    }

    function postDebugLog(level, message, detail) {
        if (!apiBase) return;
        fetch(apiBase + '/debug-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toRemotePayload(level, message, detail)),
        }).catch(function () {});
    }

    function logEvent(level, message, detail, options) {
        clientLog(level, message, detail);
        var opts = options || {};
        if (opts.remote || level === 'warn' || level === 'error') {
            postDebugLog(level, message, detail);
        }
    }

    function fetchJson(path, params) {
        var url = new URL(apiBase + path, window.location.origin);
        Object.keys(params || {}).forEach(function (key) {
            if (params[key] != null && params[key] !== '') url.searchParams.set(key, params[key]);
        });
        return fetch(url.toString(), { headers: { 'Accept': 'application/json' } }).then(function (response) {
            return response.json().then(function (json) {
                if (!response.ok || !json || json.ok === false) {
                    var error = new Error((json && json.error && json.error.message) || ('Request failed: ' + response.status));
                    error.status = response.status;
                    error.url = url.toString();
                    throw error;
                }
                return json;
            });
        });
    }

    function formatNumber(value) {
        if (value == null || !isFinite(value)) return 'n/a';
        return Number(value).toLocaleString('en-AU', { maximumFractionDigits: 2 });
    }

    function formatDate(value) {
        if (!value) return 'n/a';
        var date = (typeof value === 'number')
            ? new Date(value)
            : new Date(String(value).indexOf('T') >= 0 ? value : (value + 'T00:00:00.000Z'));
        if (!isFinite(date.getTime())) return value;
        return new Intl.DateTimeFormat('en-AU', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(date);
    }

    function badge(label, className) {
        return '<span class="economic-badge' + (className ? (' ' + className) : '') + '">' + esc(label) + '</span>';
    }

    function setStatus(text) {
        if (refs.statusText) refs.statusText.textContent = text;
    }

    function pointCount(seriesList) {
        return (seriesList || []).reduce(function (sum, series) {
            return sum + ((series && series.points) ? series.points.length : 0);
        }, 0);
    }

    function hasRenderablePoints(seriesList) {
        return (seriesList || []).some(function (series) {
            return (series.points || []).some(function (point) {
                return point && point.normalized_value != null;
            });
        });
    }

    /** Smallest strictly positive normalized_value across series (for log y-axis domain). */
    function minPositiveNormalized(seriesList) {
        var min = Infinity;
        (seriesList || []).forEach(function (series) {
            (series.points || []).forEach(function (point) {
                var v = point && point.normalized_value;
                if (v != null && isFinite(v) && v > 0 && v < min) min = v;
            });
        });
        return min === Infinity ? null : min;
    }

    function normalizedSeriesHasNonPositive(seriesList) {
        return (seriesList || []).some(function (series) {
            return (series.points || []).some(function (point) {
                var v = point && point.normalized_value;
                return v != null && isFinite(v) && v <= 0;
            });
        });
    }

    function normalizedExtent(seriesList) {
        var min = Infinity;
        var max = -Infinity;
        (seriesList || []).forEach(function (series) {
            (series.points || []).forEach(function (point) {
                var v = Number(point && point.normalized_value);
                if (!Number.isFinite(v)) return;
                if (v < min) min = v;
                if (v > max) max = v;
            });
        });
        if (min === Infinity || max === -Infinity) return null;
        return { min: min, max: max };
    }

    function buildAutoFitYAxis(type, extent, minPositive) {
        if (!extent) return null;
        var min = Number(extent.min);
        var max = Number(extent.max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

        if (type === 'log') {
            var safeMin = Number.isFinite(minPositive) && minPositive > 0 ? minPositive : min;
            var safeMax = max > 0 ? max : safeMin;
            if (!Number.isFinite(safeMin) || !Number.isFinite(safeMax) || safeMin <= 0 || safeMax <= 0) return null;
            if (safeMax < safeMin) safeMax = safeMin;
            if (safeMax === safeMin) {
                return {
                    min: safeMin / 1.35,
                    max: safeMax * 1.35,
                };
            }
            return {
                min: safeMin / 1.12,
                max: safeMax * 1.12,
            };
        }

        var span = max - min;
        if (!(span > 0)) {
            var center = min;
            var delta = Math.max(Math.abs(center) * 0.04, 1);
            return {
                min: center - delta,
                max: center + delta,
            };
        }
        var pad = span * 0.08;
        return {
            min: min - pad,
            max: max + pad,
        };
    }

    /**
     * @param {object} [opt]
     * @param {'log'|'value'} [opt.effectiveYAxis] y-axis type actually used by ECharts (after log fallback).
     */
    function syncYScaleButton(opt) {
        if (!refs.yScaleBtn) return;
        var effective = opt && opt.effectiveYAxis;
        var isLog = state.yScale === 'log';
        refs.yScaleBtn.textContent = isLog ? 'log' : 'lin';
        refs.yScaleBtn.setAttribute('aria-pressed', isLog ? 'true' : 'false');
        var forcedLinear = isLog && effective === 'value';
        if (forcedLinear) {
            refs.yScaleBtn.title = 'Log scale is selected, but the chart uses linear because some series have zero or negative index values in this range.';
        } else if (isLog) {
            refs.yScaleBtn.title = 'Y-axis: logarithmic (base 10). Click for linear scale.';
        } else {
            refs.yScaleBtn.title = 'Y-axis: linear. Click for logarithmic scale.';
        }
        refs.yScaleBtn.setAttribute(
            'aria-label',
            forcedLinear
                ? 'Chart uses a linear Y-axis; log scale is unavailable for the current data. Click to confirm linear preference.'
                : (isLog ? 'Y-axis logarithmic. Click for linear.' : 'Y-axis linear. Click for logarithmic.')
        );
    }

    function syncDebugSurface() {
        ar.economicData = {
            reloadCatalog: loadCatalog,
            reloadSeries: loadSeries,
            getState: function () {
                return {
                    range: state.range,
                    yScale: state.yScale,
                    selectedPreset: state.selectedPreset,
                    selectedIds: state.selectedIds.slice(),
                    seriesCount: state.series.length,
                    requestCount: state.requestCount,
                    hoveredDate: state.hoveredDate,
                    lastCatalogLoadedAt: state.lastCatalogLoadedAt,
                    lastSeriesLoadedAt: state.lastSeriesLoadedAt,
                    lastLoadReason: state.lastLoadReason,
                    debugSessionId: getDebugSessionId(),
                };
            },
            getCatalog: function () { return state.catalog; },
            getSeries: function () { return state.series.slice(); },
            getHoveredDate: function () { return state.hoveredDate; },
            downloadClientLog: typeof window.getSessionLogEntries === 'function' ? window.getSessionLogEntries : null,
        };
    }

    function renderPresets() {
        refs.presetRow.innerHTML = state.catalog.presets.map(function (preset) {
            var active = preset.id === state.selectedPreset;
            return '<button type="button" class="chip-btn secondary' + (active ? ' active' : '') + '" data-preset-id="' + esc(preset.id) + '">' + esc(preset.label) + '</button>';
        }).join('');
    }

    function renderCategories() {
        refs.categoryGroups.innerHTML = state.catalog.categories.map(function (category) {
            return '<section class="economic-group">' +
                '<h3>' + esc(category.label) + '</h3>' +
                category.series.map(function (series) {
                    var checked = state.selectedIds.indexOf(series.id) >= 0;
                    return '<label class="economic-option">' +
                        '<input type="checkbox" data-series-id="' + esc(series.id) + '"' + (checked ? ' checked' : '') + '>' +
                        '<span class="economic-option-label">' + esc(series.short_label || series.label) + '</span>' +
                        (series.proxy ? badge('Proxy', 'is-proxy') : '') +
                    '</label>';
                }).join('') +
            '</section>';
        }).join('');
    }

    function findPreset(id) {
        return (state.catalog && state.catalog.presets || []).find(function (preset) { return preset.id === id; }) || null;
    }

    function renderSeriesCards() {
        refs.seriesList.innerHTML = state.series.map(function (series) {
            var lastPoint = (series.points || []).filter(function (point) { return point.raw_value != null; }).slice(-1)[0] || null;
            var valueStr = lastPoint
                ? esc(formatNumber(lastPoint.raw_value) + '\u00a0' + series.unit) + ' \u00b7 ' + esc(formatDate(lastPoint.observation_date))
                : 'No data';
            var sourceLink = series.source_url
                ? ' \u00b7 <a class="economic-source-link" href="' + esc(series.source_url) + '" target="_blank" rel="noopener">Source\u00a0\u2197</a>'
                : '';
            return '<article class="economic-series-card">' +
                '<div class="economic-series-header"><h3>' + esc(series.label) + '</h3>' + (series.proxy ? badge('Proxy', 'is-proxy') : '') + '</div>' +
                '<div class="economic-series-meta">' + valueStr + sourceLink + '</div>' +
            '</article>';
        }).join('');
    }

    function renderPointDetails(targetDate) {
        var date = targetDate;
        if (!date) {
            var series0 = state.series[0];
            var lastPoint = series0 && (series0.points || []).filter(function (point) { return point.raw_value != null; }).slice(-1)[0];
            date = lastPoint ? lastPoint.date : null;
        }
        state.hoveredDate = date || null;
        if (!date) {
            refs.pointDetails.innerHTML = '<p class="hint">Hover the chart to inspect raw values for a specific day.</p>';
            return;
        }
        refs.pointDetails.innerHTML = '<div class="economic-point-row"><strong>' + esc(formatDate(date)) + '</strong>' +
            '<span class="economic-point-meta">Raw values at the hovered date; normalized chart lines stay rebased to 100.</span></div>' +
            state.series.map(function (series) {
                var point = (series.points || []).find(function (candidate) { return candidate.date === date; }) || null;
                return '<div class="economic-point-row">' +
                    '<strong>' + esc(series.short_label) + '</strong>' +
                    '<span class="economic-point-meta">' + esc((point && point.raw_value != null ? formatNumber(point.raw_value) + ' ' + series.unit : 'n/a') + ' | obs ' + formatDate(point && point.observation_date)) + '</span>' +
                '</div>';
            }).join('');
    }

    function chartHelpers() {
        return window.AR && window.AR.chartEchartsHelpers;
    }

    /** Mirrors ar-chart-echarts-helpers chartTheme when that script is not loaded. */
    function economicThemeFallback() {
        var light = document.documentElement.getAttribute('data-theme') === 'light';
        return {
            emphasisText: light ? '#0c1220' : '#f0f6ff',
            mutedText: light ? '#4a5c72' : '#94a3b8',
            softText: light ? '#1e3a52' : '#b8c5d6',
            splitLine: light ? 'rgba(59, 78, 104, 0.08)' : 'rgba(226, 232, 240, 0.06)',
            text: light ? '#0f172a' : '#e2e8f0',
            tooltipBackground: light ? '#ffffff' : '#0f1419',
            tooltipBorder: light ? 'rgba(37, 99, 235, 0.35)' : 'rgba(79, 141, 253, 0.35)',
            tooltipShadow: light
                ? 'box-shadow: 0 24px 48px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(15, 23, 42, 0.06); border-radius: 10px;'
                : 'box-shadow: 0 32px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.08); border-radius: 10px;',
            tooltipText: light ? '#0f172a' : '#e2e8f0',
            axisLine: light ? 'rgba(59, 78, 104, 0.35)' : 'rgba(226, 232, 240, 0.18)',
            crosshairLine: light ? 'rgba(37, 99, 235, 0.55)' : 'rgba(99, 179, 237, 0.6)',
            crosshairLabelBg: light ? 'rgba(255,255,255,0.98)' : 'rgba(15, 20, 25, 0.96)',
            dataFont: '"JetBrains Mono", "SF Mono", "Consolas", "Monaco", "ui-monospace", monospace',
            stackBg: light ? 'rgba(255,255,255,0.97)' : 'rgba(15,23,42,0.96)',
            stackBorder: light ? 'rgba(100,116,139,0.20)' : 'rgba(100,116,139,0.30)',
            stackText: light ? '#1e293b' : '#e2e8f0',
        };
    }

    function stackOverlayTheme() {
        var theme = getEconomicChartTheme();
        return {
            ttBg: theme.stackBg != null ? theme.stackBg : (document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(255,255,255,0.97)' : 'rgba(15,23,42,0.96)'),
            ttBorder: theme.stackBorder != null ? theme.stackBorder : (document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(100,116,139,0.20)' : 'rgba(100,116,139,0.30)'),
            ttText: theme.stackText != null ? theme.stackText : theme.text,
        };
    }

    /** Matches admin Settings chart_legend_opacity (see ar-chart-site-ui.js). */
    function chartLegendOpacityForStack() {
        if (window.AR && window.AR.chartSiteUi && typeof window.AR.chartSiteUi.getChartLegendOpacity === 'function') {
            return String(window.AR.chartSiteUi.getChartLegendOpacity());
        }
        return '0.75';
    }

    function ensureLegendStackEl() {
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

    /** Latest normalized observation on or before ymd (ISO); if ymd null, use last point per series. */
    function resolvedNormalizedForLegend(series, ymd) {
        var pts = (series.points || []).filter(function (p) { return p != null && p.normalized_value != null && isFinite(Number(p.normalized_value)); });
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
        if (!best) return null;
        return { value: Number(best.normalized_value), atYmd: best.date };
    }

    function formatLegendIndex(value) {
        if (value == null || !isFinite(value)) return 'n/a';
        return Number(value).toLocaleString('en-AU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
    }

    function syncEconomicLegendStack() {
        var legendEl = ensureLegendStackEl();
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
            'opacity:' + chartLegendOpacityForStack()
        ].join(';');

        var rows = [];
        state.series.forEach(function (series, idx) {
            var res = resolvedNormalizedForLegend(series, hoverYmd);
            if (!res) return;
            rows.push({
                series: series,
                color: ECONOMIC_CHART_PALETTE[idx % ECONOMIC_CHART_PALETTE.length],
                value: res.value,
                atYmd: res.atYmd,
            });
        });
        rows.sort(function (a, b) { return b.value - a.value; });

        var parts = [];
        if (hoverYmd) {
            parts.push(
                '<div class="economic-chart-legend-stack-date" style="font-size:' + (compact ? '7px' : '8px') + ';opacity:0.75;white-space:nowrap;padding-bottom:2px;margin-bottom:1px;border-bottom:1px solid rgba(148,163,184,0.15);letter-spacing:0.02em;">' +
                esc(formatDate(hoverYmd.indexOf('T') >= 0 ? hoverYmd : (hoverYmd + 'T12:00:00.000Z'))) +
                '</div>'
            );
        }
        rows.forEach(function (row) {
            parts.push(
                '<span class="economic-chart-legend-stack-row" style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;max-width:100%;">' +
                '<span style="display:inline-block;width:14px;height:2px;background:' + esc(row.color) + ';flex-shrink:0;border-radius:1px;"></span>' +
                '<span style="opacity:0.7;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + esc(row.series.short_label) + '</span>' +
                '<span style="font-variant-numeric:tabular-nums;font-weight:600;flex-shrink:0;">' + esc(formatLegendIndex(row.value)) + '</span>' +
                '</span>'
            );
        });
        legendEl.innerHTML = parts.join('');
    }

    function getEconomicChartTheme() {
        var h = chartHelpers();
        if (h && typeof h.chartTheme === 'function') return h.chartTheme();
        return economicThemeFallback();
    }

    function renderSources() {
        refs.sourceList.innerHTML = state.series.map(function (series) {
            var freshness = series.freshness || {};
            return '<article class="economic-source-card">' +
                '<div class="economic-source-head"><h3>' + esc(series.label) + '</h3>' + (series.proxy ? badge('Proxy', 'is-proxy') : badge('Official')) + '</div>' +
                '<div class="economic-source-meta">' + esc(series.source_label + ' | ' + series.frequency + ' | last obs ' + formatDate(freshness.last_observation_date)) + '</div>' +
                '<p class="economic-group-copy">' + esc(freshness.message || series.description) + '</p>' +
                '<a class="economic-source-link" href="' + esc(series.source_url) + '" target="_blank" rel="noopener">Open source</a>' +
            '</article>';
        }).join('');
    }

    function renderChart() {
        if (!window.echarts || !refs.chartEl) throw new Error('Chart library unavailable.');
        if (!state.chart) {
            state.chart = window.echarts.init(refs.chartEl);
            logEvent('info', 'Economic chart initialized', { renderer: 'echarts' });
        }
        logEvent('info', 'Economic chart render started', {
            seriesCount: state.series.length,
            pointCount: pointCount(state.series),
            range: state.range,
            reason: state.lastLoadReason,
        });
        var h = chartHelpers();
        var theme = getEconomicChartTheme();
        var styles = h && typeof h.gridStyles === 'function' ? h.gridStyles() : {
            axisLine: { lineStyle: { color: theme.axisLine, width: 1 } },
            splitLine: { lineStyle: { color: theme.splitLine, width: 1, type: 'solid' } },
        };
        var axisPointer = h && typeof h.axisPointerConfig === 'function' ? h.axisPointerConfig(theme) : {
            type: 'cross',
            lineStyle: { color: theme.crosshairLine, width: 1.5, type: 'dashed' },
            crossStyle: { color: theme.crosshairLine, width: 1 },
            label: {
                backgroundColor: theme.crosshairLabelBg != null ? theme.crosshairLabelBg : theme.tooltipBackground,
                borderColor: theme.tooltipBorder,
                borderWidth: 1,
                color: theme.tooltipText,
                fontSize: 11,
                fontFamily: theme.dataFont || undefined,
                padding: [4, 8],
            },
        };
        var chartW = refs.chartEl.clientWidth || 400;
        var narrow = chartW < 760;
        var compact = chartW < 420;
        var gridLeft = compact ? 46 : (narrow ? 50 : 56);
        var gridBottom = compact ? 36 : (narrow ? 40 : 44);
        var wantLog = state.yScale === 'log';
        var canLog = wantLog && !normalizedSeriesHasNonPositive(state.series);
        var minPos = canLog ? minPositiveNormalized(state.series) : null;
        var extent = normalizedExtent(state.series);
        if (wantLog && !canLog) {
            logEvent('warn', 'Economic chart: log y-axis disabled (non-positive index values); using linear', {
                range: state.range,
                seriesCount: state.series.length,
            });
        }
        var yAxisType = canLog && minPos != null ? 'log' : 'value';
        var yAxisFit = buildAutoFitYAxis(yAxisType, extent, minPos);
        var yAxis = {
            type: yAxisType,
            scale: true,
            name: 'Index (start = 100)',
            nameTextStyle: { color: theme.softText, fontSize: 11 },
            axisLine: styles.axisLine,
            axisLabel: { color: theme.mutedText, fontSize: narrow ? 10 : 11 },
            splitLine: { show: true, lineStyle: styles.splitLine.lineStyle },
        };
        if (yAxisType === 'log') {
            yAxis.logBase = 10;
        }
        if (yAxisFit) {
            yAxis.min = yAxisFit.min;
            yAxis.max = yAxisFit.max;
        }
        state.chart.setOption({
            animation: false,
            textStyle: { color: theme.text, fontFamily: '"Space Grotesk", "Segoe UI", system-ui, sans-serif' },
            backgroundColor: 'transparent',
            color: ECONOMIC_CHART_PALETTE,
            axisPointer: axisPointer,
            // showContent:false hides the tooltip panel only; show:false would disable axis tracking and crosshairs.
            tooltip: {
                trigger: 'axis',
                transitionDuration: 0,
                confine: true,
                showContent: false,
                hideDelay: 220,
            },
            legend: { show: false },
            grid: { left: gridLeft, right: narrow ? 10 : 18, top: 20, bottom: gridBottom, containLabel: true },
            xAxis: {
                type: 'time',
                axisLine: styles.axisLine,
                axisLabel: { color: theme.mutedText, fontSize: narrow ? 10 : 11, hideOverlap: true },
                splitLine: { show: false },
            },
            yAxis: yAxis,
            series: state.series.map(function (series) {
                return {
                    id: series.id,
                    name: series.short_label,
                    type: 'line',
                    smooth: false,
                    showSymbol: false,
                    emphasis: { focus: 'series' },
                    data: (series.points || []).filter(function (point) { return point.normalized_value != null; }).map(function (point) {
                        return [point.date, point.normalized_value];
                    })
                };
            })
        }, true);
        state.chart.off('updateAxisPointer');
        state.chart.off('globalout');
        state.chart.on('updateAxisPointer', function (event) {
            var info = event && event.axesInfo && event.axesInfo[0];
            var ymd = info && info.value != null ? new Date(info.value).toISOString().slice(0, 10) : null;
            state.legendHoverYmd = ymd;
            syncEconomicLegendStack();
            renderPointDetails(ymd);
        });
        state.chart.on('globalout', function () {
            state.legendHoverYmd = null;
            syncEconomicLegendStack();
            renderPointDetails(null);
        });
        state.chart.resize();
        syncEconomicLegendStack();
        syncYScaleButton({ effectiveYAxis: yAxisType });
        logEvent('info', 'Economic chart render completed', {
            seriesCount: state.series.length,
            pointCount: pointCount(state.series),
            hoveredDate: state.hoveredDate,
            yAxisType: yAxisType,
        });
    }

    function updateSummary() {
        var preset = findPreset(state.selectedPreset);
        refs.activePreset.textContent = preset ? preset.label : 'Custom';
        refs.selectedCount.textContent = state.selectedIds.length + ' selected';
        refs.rangeNote.textContent = state.range === 'All' ? 'Visible window: full available history.' : ('Visible window: last ' + state.range + ' to ' + todayIso() + '.');
    }

    function loadSeries(reason) {
        state.lastLoadReason = reason || state.lastLoadReason || 'manual';
        state.requestCount += 1;
        updateSummary();
        setStatus('Loading...');
        refs.emptyEl.hidden = true;
        var range = currentRange();
        logEvent('info', 'Economic series load started', {
            requestCount: state.requestCount,
            reason: state.lastLoadReason,
            range: state.range,
            startDate: range.start_date,
            endDate: range.end_date,
            selectedIds: state.selectedIds.slice(),
        });
        return fetchJson('/series', {
            ids: state.selectedIds.join(','),
            start_date: range.start_date,
            end_date: range.end_date
        }).then(function (payload) {
            state.series = payload.series || [];
            state.lastSeriesLoadedAt = new Date().toISOString();
            syncDebugSurface();
            if (!state.series.length) {
                logEvent('warn', 'Economic series load returned no rows', {
                    reason: state.lastLoadReason,
                    range: state.range,
                    selectedIds: state.selectedIds.slice(),
                });
                throw new Error('No data returned for the selected indicators.');
            }
            if (!hasRenderablePoints(state.series)) {
                logEvent('warn', 'Economic series load returned no usable chart points', {
                    reason: state.lastLoadReason,
                    range: state.range,
                    selectedIds: state.selectedIds.slice(),
                }, { remote: true });
                throw new Error('Economic data has not been populated yet for the selected indicators.');
            }
            refs.chartMeta.textContent = 'Index = 100 at ' + formatDate(payload.start_date) + ' for each visible series.';
            renderSeriesCards();
            renderSources();
            renderChart();
            renderPointDetails(null);
            setStatus('Ready');
            logEvent('info', 'Economic series load completed', {
                count: state.series.length,
                pointCount: pointCount(state.series),
                range: state.range,
                reason: state.lastLoadReason,
            });
        }).catch(function (error) {
            state.series = [];
            syncDebugSurface();
            refs.seriesList.innerHTML = '';
            refs.sourceList.innerHTML = '';
            refs.pointDetails.innerHTML = '<p class="hint">No point details available.</p>';
            refs.emptyEl.hidden = false;
            refs.emptyEl.textContent = describeError(error, 'Failed to load economic data.');
            setStatus('Error');
            logEvent('error', 'Economic series load failed', {
                reason: state.lastLoadReason,
                range: state.range,
                selectedIds: state.selectedIds.slice(),
                message: describeError(error, 'Failed to load economic data.'),
                status: error && error.status,
                url: error && error.url,
            }, { remote: true });
        });
    }

    function loadCatalog() {
        state.requestCount += 1;
        setStatus('Loading...');
        logEvent('info', 'Economic catalog load started', {
            requestCount: state.requestCount,
            apiBase: apiBase,
        });
        return fetchJson('/catalog').then(function (payload) {
            state.catalog = payload;
            state.lastCatalogLoadedAt = new Date().toISOString();
            state.selectedIds = (findPreset('rba_watchlist') || { seriesIds: [] }).seriesIds.slice();
            renderPresets();
            renderCategories();
            syncDebugSurface();
            logEvent('info', 'Economic catalog load completed', {
                presets: (payload.presets || []).length,
                categories: (payload.categories || []).length,
                selectedIds: state.selectedIds.slice(),
            });
            bindControls();
            return loadSeries('catalog-loaded');
        }).catch(function (error) {
            refs.emptyEl.hidden = false;
            refs.emptyEl.textContent = describeError(error, 'Failed to load economic catalog.');
            setStatus('Error');
            logEvent('error', 'Economic catalog load failed', {
                message: describeError(error, 'Failed to load economic catalog.'),
                status: error && error.status,
                url: error && error.url,
            }, { remote: true });
            throw error;
        });
    }

    function bindControls() {
        if (bindControls.bound) return;
        bindControls.bound = true;
        refs.presetRow.addEventListener('click', function (event) {
            var button = event.target.closest('[data-preset-id]');
            if (!button) return;
            var preset = findPreset(button.getAttribute('data-preset-id'));
            if (!preset) return;
            state.selectedPreset = preset.id;
            state.selectedIds = preset.seriesIds.slice();
            renderPresets();
            renderCategories();
            logEvent('info', 'Economic preset changed', {
                presetId: preset.id,
                selectedIds: state.selectedIds.slice(),
            });
            loadSeries('preset-change');
        });
        refs.rangeRow.addEventListener('click', function (event) {
            var button = event.target.closest('[data-range]');
            if (!button) return;
            state.range = button.getAttribute('data-range');
            Array.from(refs.rangeRow.querySelectorAll('[data-range]')).forEach(function (node) { node.classList.toggle('active', node === button); });
            logEvent('info', 'Economic range changed', {
                range: state.range,
                selectedIds: state.selectedIds.slice(),
            });
            loadSeries('range-change');
        });
        if (refs.yScaleBtn) {
            syncYScaleButton();
            refs.yScaleBtn.addEventListener('click', function () {
                state.yScale = state.yScale === 'log' ? 'linear' : 'log';
                persistYScale(state.yScale);
                logEvent('info', 'Economic chart y-scale toggled', { yScale: state.yScale });
                if (state.series.length && hasRenderablePoints(state.series)) {
                    renderChart();
                } else {
                    syncYScaleButton();
                }
            });
        }
        refs.categoryGroups.addEventListener('change', function (event) {
            var input = event.target.closest('input[data-series-id]');
            if (!input) return;
            var next = Array.from(refs.categoryGroups.querySelectorAll('input[data-series-id]:checked')).map(function (node) { return node.getAttribute('data-series-id'); });
            if (!next.length) {
                input.checked = true;
                logEvent('warn', 'Economic selection prevented empty state', {
                    attemptedSeriesId: input.getAttribute('data-series-id'),
                });
                return;
            }
            state.selectedPreset = 'custom';
            state.selectedIds = next;
            renderPresets();
            logEvent('info', 'Economic selection changed', {
                selectedIds: state.selectedIds.slice(),
                count: state.selectedIds.length,
            });
            loadSeries('selection-change');
        });
        window.addEventListener('resize', function () {
            if (!state.chart) return;
            state.chart.resize();
            syncEconomicLegendStack();
            logEvent('info', 'Economic chart resized', {
                width: window.innerWidth,
                height: window.innerHeight,
            });
        });
        window.addEventListener('ar:theme-changed', function () {
            if (!state.chart || !state.series.length) return;
            renderChart();
        });
    }

    function bindGlobalDebugHooks() {
        if (window.__arEconomicDebugHooksBound) return;
        window.__arEconomicDebugHooksBound = true;
        window.addEventListener('error', function (event) {
            var target = event && event.target;
            if (target && target !== window && target.tagName) {
                logEvent('warn', 'Economic page resource load error', {
                    tagName: String(target.tagName || ''),
                    source: target.src || target.href || '',
                }, { remote: true });
                return;
            }
            logEvent('error', 'Economic page unhandled error', {
                message: event && event.message ? String(event.message) : 'Unhandled client error',
                filename: event && event.filename ? String(event.filename) : '',
                line: event && event.lineno,
                column: event && event.colno,
            }, { remote: true });
        });
        window.addEventListener('unhandledrejection', function (event) {
            var reason = event && event.reason;
            logEvent('error', 'Economic page unhandled rejection', {
                message: describeError(reason, 'Unhandled promise rejection'),
            }, { remote: true });
        });
    }

    bindGlobalDebugHooks();
    if (!window.__arEconomicSiteUiListener) {
        window.__arEconomicSiteUiListener = true;
        window.addEventListener('ar:site-ui-settings', function () {
            syncEconomicLegendStack();
        });
    }
    syncDebugSurface();
    logEvent('info', 'Economic data init start', {
        apiBase: apiBase,
        debugSessionId: getDebugSessionId(),
    });
    loadCatalog().then(function () {
        syncDebugSurface();
        logEvent('info', 'Economic data init complete', {
            selectedPreset: state.selectedPreset,
            selectedCount: state.selectedIds.length,
        });
    }).catch(function () {});
})();
