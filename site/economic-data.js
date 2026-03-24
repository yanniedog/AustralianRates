(function () {
    'use strict';

    var config = (window.AR && window.AR.config) ? window.AR.config : {};
    var apiBase = config.apiBase || (window.location.origin + '/api/economic-data');
    var log = typeof window.addSessionLog === 'function' ? window.addSessionLog : function () {};
    var state = {
        catalog: null,
        range: '5Y',
        selectedPreset: 'rba_watchlist',
        selectedIds: [],
        series: [],
        chart: null,
        hoveredDate: null
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

    function fetchJson(path, params) {
        var url = new URL(apiBase + path, window.location.origin);
        Object.keys(params || {}).forEach(function (key) {
            if (params[key] != null && params[key] !== '') url.searchParams.set(key, params[key]);
        });
        return fetch(url.toString(), { headers: { 'Accept': 'application/json' } }).then(function (response) {
            return response.json().then(function (json) {
                if (!response.ok || !json || json.ok === false) throw new Error((json && json.error && json.error.message) || ('Request failed: ' + response.status));
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
        if (!state.chart) state.chart = window.echarts.init(refs.chartEl);
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
        });
        state.chart.off('updateAxisPointer');
        state.chart.on('updateAxisPointer', function (event) {
            var info = event && event.axesInfo && event.axesInfo[0];
            renderPointDetails(info && info.value ? new Date(info.value).toISOString().slice(0, 10) : null);
        });
        state.chart.resize();
    }

    function updateSummary() {
        var preset = findPreset(state.selectedPreset);
        refs.activePreset.textContent = preset ? preset.label : 'Custom';
        refs.selectedCount.textContent = state.selectedIds.length + ' selected';
        refs.rangeNote.textContent = state.range === 'All' ? 'Visible window: full available history.' : ('Visible window: last ' + state.range + ' to ' + todayIso() + '.');
    }

    function loadSeries() {
        updateSummary();
        setStatus('Loading...');
        refs.emptyEl.hidden = true;
        var range = currentRange();
        return fetchJson('/series', {
            ids: state.selectedIds.join(','),
            start_date: range.start_date,
            end_date: range.end_date
        }).then(function (payload) {
            state.series = payload.series || [];
            if (!state.series.length) throw new Error('No data returned for the selected indicators.');
            refs.chartMeta.textContent = 'Index = 100 at ' + formatDate(payload.start_date) + ' for each visible series.';
            renderSeriesCards();
            renderSources();
            renderChart();
            renderPointDetails(null);
            setStatus('Ready');
            log('info', 'Economic series loaded', { count: state.series.length, range: state.range });
        }).catch(function (error) {
            state.series = [];
            refs.seriesList.innerHTML = '';
            refs.sourceList.innerHTML = '';
            refs.pointDetails.innerHTML = '<p class="hint">No point details available.</p>';
            refs.emptyEl.hidden = false;
            refs.emptyEl.textContent = error.message || 'Failed to load economic data.';
            setStatus('Error');
            log('error', 'Economic series load failed', { message: error.message || String(error) });
        });
    }

    function bindControls() {
        refs.presetRow.addEventListener('click', function (event) {
            var button = event.target.closest('[data-preset-id]');
            if (!button) return;
            var preset = findPreset(button.getAttribute('data-preset-id'));
            if (!preset) return;
            state.selectedPreset = preset.id;
            state.selectedIds = preset.seriesIds.slice();
            renderPresets();
            renderCategories();
            loadSeries();
        });
        refs.rangeRow.addEventListener('click', function (event) {
            var button = event.target.closest('[data-range]');
            if (!button) return;
            state.range = button.getAttribute('data-range');
            Array.from(refs.rangeRow.querySelectorAll('[data-range]')).forEach(function (node) { node.classList.toggle('active', node === button); });
            loadSeries();
        });
        refs.categoryGroups.addEventListener('change', function (event) {
            var input = event.target.closest('input[data-series-id]');
            if (!input) return;
            var next = Array.from(refs.categoryGroups.querySelectorAll('input[data-series-id]:checked')).map(function (node) { return node.getAttribute('data-series-id'); });
            if (!next.length) {
                input.checked = true;
                return;
            }
            state.selectedPreset = 'custom';
            state.selectedIds = next;
            renderPresets();
            loadSeries();
        });
        window.addEventListener('resize', function () {
            if (state.chart) state.chart.resize();
        });
    }

    fetchJson('/catalog').then(function (payload) {
        state.catalog = payload;
        state.selectedIds = (findPreset('rba_watchlist') || { seriesIds: [] }).seriesIds.slice();
        renderPresets();
        renderCategories();
        bindControls();
        return loadSeries();
    }).catch(function (error) {
        refs.emptyEl.hidden = false;
        refs.emptyEl.textContent = error.message || 'Failed to load economic catalog.';
        setStatus('Error');
        log('error', 'Economic catalog load failed', { message: error.message || String(error) });
    });
})();
