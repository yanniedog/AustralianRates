(function () {
    'use strict';

    window.AR = window.AR || {};

    var ar = window.AR;
    var config = ar.config || {};
    var utils = ar.utils || {};
    var apiBase = config.apiBase || (window.location.origin + '/api/economic-data');
    var clientLog = typeof utils.clientLog === 'function' ? utils.clientLog : function () {};
    var sessionKey = 'ar-economic-data-debug-session';
    var state = {
        catalog: null,
        range: '5Y',
        selectedPreset: 'rba_watchlist',
        selectedIds: [],
        series: [],
        chart: null,
        hoveredDate: null,
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
        statusText: document.getElementById('economic-status-text')
    };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function describeError(error, fallback) {
        if (error && typeof error === 'object') {
            if (error.userMessage) return String(error.userMessage);
            if (error.message) return String(error.message);
        }
        return String(fallback || 'Request failed.');
    }

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

    function syncDebugSurface() {
        ar.economicData = {
            reloadCatalog: loadCatalog,
            reloadSeries: loadSeries,
            getState: function () {
                return {
                    range: state.range,
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
                '<div class="economic-group-header"><h3>' + esc(category.label) + '</h3><span class="economic-option-meta">' + esc(category.series.length + ' indicators') + '</span></div>' +
                category.series.map(function (series) {
                    var checked = state.selectedIds.indexOf(series.id) >= 0;
                    var freshness = series.freshness && series.freshness.status ? badge(series.freshness.status, series.freshness.status === 'ok' ? 'is-fresh' : ('is-' + series.freshness.status)) : '';
                    return '<label class="economic-option">' +
                        '<input type="checkbox" data-series-id="' + esc(series.id) + '"' + (checked ? ' checked' : '') + '>' +
                        '<span class="economic-option-copy">' +
                            '<span class="economic-option-head"><span class="economic-option-label">' + esc(series.label) + '</span><span>' + (series.proxy ? badge('Proxy', 'is-proxy') : badge('Official')) + ' ' + freshness + '</span></span>' +
                            '<span class="economic-option-meta">' + esc(series.unit + ' | ' + series.frequency + ' | ' + series.source_label) + '</span>' +
                            '<span class="economic-group-copy">' + esc(series.description) + '</span>' +
                        '</span>' +
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
            return '<article class="economic-series-card">' +
                '<div class="economic-series-header"><h3>' + esc(series.label) + '</h3>' + (series.proxy ? badge('Proxy', 'is-proxy') : badge('Official')) + '</div>' +
                '<div class="economic-series-meta">' + esc(series.unit + ' | ' + series.frequency + ' | baseline ' + formatNumber(series.baseline_value)) + '</div>' +
                '<p class="economic-group-copy">' + esc(series.description) + '</p>' +
                '<div class="economic-series-meta">Latest raw value: ' + esc(lastPoint ? formatNumber(lastPoint.raw_value) + ' on ' + formatDate(lastPoint.observation_date) : 'n/a') + '</div>' +
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
        var palette = ['#d95f02', '#1b9e77', '#7570b3', '#66a61e', '#e7298a', '#1f78b4', '#b15928', '#6a3d9a'];
        state.chart.setOption({
            animation: false,
            color: palette,
            tooltip: {
                trigger: 'axis',
                formatter: function (items) {
                    var rows = ['<strong>' + esc(formatDate(items[0] && items[0].axisValue)) + '</strong>'];
                    items.forEach(function (item) {
                        var series = state.series.find(function (candidate) { return candidate.id === item.seriesId; });
                        var point = series && (series.points || []).find(function (candidate) { return candidate.date === item.axisValue; });
                        rows.push(esc(series.short_label + ': index ' + formatNumber(item.data[1]) + ' | raw ' + (point && point.raw_value != null ? formatNumber(point.raw_value) + ' ' + series.unit : 'n/a') + ' | ' + series.source_label + (series.proxy ? ' | proxy' : '')));
                    });
                    return rows.join('<br>');
                }
            },
            legend: { type: 'scroll', top: 8 },
            grid: { left: 52, right: 18, top: 56, bottom: 44 },
            xAxis: { type: 'time' },
            yAxis: { type: 'value', name: 'Index (start = 100)' },
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
        state.chart.on('updateAxisPointer', function (event) {
            var info = event && event.axesInfo && event.axesInfo[0];
            renderPointDetails(info && info.value ? new Date(info.value).toISOString().slice(0, 10) : null);
        });
        state.chart.resize();
        logEvent('info', 'Economic chart render completed', {
            seriesCount: state.series.length,
            pointCount: pointCount(state.series),
            hoveredDate: state.hoveredDate,
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
            logEvent('info', 'Economic chart resized', {
                width: window.innerWidth,
                height: window.innerHeight,
            });
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
