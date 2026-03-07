(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var filters = window.AR.filters;
    var sectionConfig = window.AR.sectionConfig || {};
    var state = window.AR.state;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var formatFilterValue = utils.formatFilterValue || function (_field, value) { return String(value == null ? '' : value); };
    var pct = utils.pct || function (value) { return String(value == null ? '' : value); };
    var money = utils.money || function (value) { return String(value == null ? '' : value); };
    var uiBound = false;
    var traceFocusHandler = null;

    function buildFieldLabels() {
        var labels = {};
        var seed = sectionConfig && sectionConfig.pivotFieldLabels ? sectionConfig.pivotFieldLabels : {};
        Object.keys(seed).forEach(function (key) {
            labels[key] = seed[key];
        });
        labels.collection_date = labels.collection_date || 'Date';
        labels.bank_name = labels.bank_name || 'Bank';
        labels.product_key = labels.product_key || 'Product';
        labels.product_name = labels.product_name || 'Product';
        labels.interest_rate = labels.interest_rate || 'Interest Rate (%)';
        labels.comparison_rate = labels.comparison_rate || 'Comparison Rate (%)';
        labels.annual_fee = labels.annual_fee || 'Annual Fee ($)';
        labels.monthly_fee = labels.monthly_fee || 'Monthly Fee ($)';
        labels.rba_cash_rate = labels.rba_cash_rate || 'Cash Rate (%)';
        return labels;
    }

    var fieldLabels = buildFieldLabels();

    function titleCase(value) {
        return String(value || '')
            .split('_')
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
    }

    function fieldLabel(field) {
        return fieldLabels[field] || titleCase(field);
    }

    function isDateField(field) {
        return /date|_at$/i.test(String(field || ''));
    }

    function isMoneyField(field) {
        return /fee|deposit/i.test(String(field || ''));
    }

    function isPercentField(field) {
        return /rate/i.test(String(field || ''));
    }

    function formatNumeric(field, value) {
        var num = Number(value);
        if (!Number.isFinite(num)) return String(value == null ? '' : value);
        if (isMoneyField(field)) return money(num);
        if (isPercentField(field)) return pct(num);
        return num.toLocaleString(undefined, { maximumFractionDigits: 3 });
    }

    function formatFieldValue(field, value) {
        if (value == null || value === '') return '-';
        if (typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(value))) {
            return formatNumeric(field, value);
        }
        if (isDateField(field)) return String(value);
        return formatFilterValue(field, value) || String(value);
    }

    function formatMetricValue(field, value) {
        return formatFieldValue(field, value);
    }

    function getDefaultMetricField() {
        if (!els.chartY || !els.chartY.options || !els.chartY.options.length) return 'interest_rate';
        for (var i = 0; i < els.chartY.options.length; i++) {
            var option = els.chartY.options[i];
            if (String(option.value || '') === 'interest_rate') return 'interest_rate';
        }
        return String(els.chartY.options[0].value || 'interest_rate');
    }

    function getPresetDefinitions() {
        var defaultMetric = getDefaultMetricField();
        return {
            trend: {
                xField: 'collection_date',
                yField: defaultMetric,
                groupField: 'product_key',
                chartType: 'scatter',
                seriesLimit: '12',
            },
            compare: {
                xField: 'bank_name',
                yField: defaultMetric,
                groupField: '',
                chartType: 'bar',
                seriesLimit: 'all',
            },
            distribution: {
                xField: 'bank_name',
                yField: defaultMetric,
                groupField: 'bank_name',
                chartType: 'box',
                seriesLimit: 'all',
            },
        };
    }

    function getChartFields() {
        return {
            xField: els.chartX ? els.chartX.value : 'collection_date',
            yField: els.chartY ? els.chartY.value : getDefaultMetricField(),
            groupField: els.chartGroup ? els.chartGroup.value : '',
            chartType: els.chartType ? els.chartType.value : 'scatter',
            seriesLimit: els.chartSeriesLimit ? els.chartSeriesLimit.value : '12',
        };
    }

    function parseSeriesLimit(value) {
        var raw = String(value || '').trim().toLowerCase();
        if (!raw || raw === 'all') return Number.POSITIVE_INFINITY;
        var count = Number(raw);
        return Number.isFinite(count) && count > 0 ? count : 12;
    }

    function setSelectValue(selectEl, value) {
        if (!selectEl) return;
        for (var i = 0; i < selectEl.options.length; i++) {
            if (String(selectEl.options[i].value) === String(value)) {
                selectEl.value = String(value);
                return;
            }
        }
    }

    function isPresetMatch(preset, fields) {
        return preset &&
            preset.xField === fields.xField &&
            preset.yField === fields.yField &&
            preset.groupField === fields.groupField &&
            preset.chartType === fields.chartType &&
            String(preset.seriesLimit) === String(fields.seriesLimit);
    }

    function getActivePresetName(fields) {
        var current = fields || getChartFields();
        var presets = getPresetDefinitions();
        var names = Object.keys(presets);
        for (var i = 0; i < names.length; i++) {
            if (isPresetMatch(presets[names[i]], current)) return names[i];
        }
        return '';
    }

    function syncPresetButtons(fields) {
        var active = getActivePresetName(fields);
        var buttons = document.querySelectorAll('[data-chart-preset]');
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            var isActive = String(button.getAttribute('data-chart-preset') || '') === active;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        }
        return active;
    }

    function applyPreset(name) {
        var presets = getPresetDefinitions();
        var preset = presets[name];
        if (!preset) return '';
        setSelectValue(els.chartX, preset.xField);
        setSelectValue(els.chartY, preset.yField);
        setSelectValue(els.chartGroup, preset.groupField);
        setSelectValue(els.chartType, preset.chartType);
        setSelectValue(els.chartSeriesLimit, preset.seriesLimit);
        return syncPresetButtons(preset);
    }

    function getSelectedBankCount() {
        var buildFilterParams = filters && typeof filters.buildFilterParams === 'function'
            ? filters.buildFilterParams
            : function () { return {}; };
        var params = buildFilterParams() || {};
        var raw = String(params.banks || '').trim();
        if (!raw) return 0;
        return raw.split(',').filter(Boolean).length;
    }

    function buildGuidance(fields, meta) {
        var notes = [];
        var defaultHint = sectionConfig && sectionConfig.chartHint ? sectionConfig.chartHint : '';
        if (defaultHint) notes.push(defaultHint);
        if (fields.groupField === 'product_key' && isDateField(fields.xField) && getSelectedBankCount() !== 1) {
            notes.push('Filter to one bank for the cleanest product-level trend lines.');
        }
        if (meta && meta.hiddenSeries > 0) {
            notes.push('Showing the most complete series first to keep the chart readable.');
        }
        if (meta && meta.sampled) {
            notes.push('Dense views are sampled only inside the visible series. Export remains full fidelity.');
        }
        return notes.filter(Boolean).join(' ');
    }

    function renderSummary(meta, fields) {
        if (els.chartGuidance) {
            els.chartGuidance.textContent = buildGuidance(fields || getChartFields(), meta || null);
        }

        if (!els.chartSummary) return;
        if (!meta) {
            els.chartSummary.innerHTML = '<span class="chart-summary-pill">Awaiting first render</span>';
            return;
        }

        var pills = [];
        var presetName = syncPresetButtons(fields);
        if (presetName) {
            pills.push('<span class="chart-summary-pill is-emphasis">' + esc(titleCase(presetName)) + ' preset</span>');
        }
        pills.push('<span class="chart-summary-pill">' + esc(meta.renderedPoints.toLocaleString()) + ' plotted points</span>');
        if (meta.totalSeries > 1) {
            pills.push('<span class="chart-summary-pill">' + esc(meta.visibleSeries.toLocaleString()) + ' of ' + esc(meta.totalSeries.toLocaleString()) + ' series visible</span>');
        }
        pills.push('<span class="chart-summary-pill">' + esc(fieldLabel(fields.yField)) + '</span>');
        if (meta.sampled) {
            pills.push('<span class="chart-summary-pill is-warning">Sampled from ' + esc(meta.sourcePoints.toLocaleString()) + ' visible points</span>');
        }
        if (meta.payloadTruncated) {
            pills.push('<span class="chart-summary-pill is-warning">10,000-row fetch cap reached</span>');
        }
        els.chartSummary.innerHTML = pills.join('');
    }

    function renderSeriesRail(meta, focusedTraceIndex) {
        if (!els.chartSeriesList || !els.chartSeriesNote) return;
        var summaries = meta && Array.isArray(meta.traceSummaries) ? meta.traceSummaries : [];
        if (!summaries.length) {
            els.chartSeriesNote.textContent = 'Draw a chart to inspect the series currently on screen.';
            els.chartSeriesList.innerHTML = '<p class="chart-series-empty">Preset-driven views and focused series cards will appear here after the first render.</p>';
            return;
        }

        els.chartSeriesNote.textContent = meta.hiddenSeries > 0
            ? 'Showing the most complete ' + meta.visibleSeries + ' series. Click a card to isolate it.'
            : 'Click a card to isolate a visible series.';

        var html = [];
        for (var i = 0; i < summaries.length; i++) {
            var summary = summaries[i];
            var isActive = Number(summary.traceIndex) === Number(focusedTraceIndex);
            var delta = Number(summary.delta);
            var deltaText = Number.isFinite(delta)
                ? ((delta > 0 ? '+' : '') + formatMetricValue(summary.metricField, delta))
                : 'No delta';
            html.push(
                '<button class="chart-series-card' + (isActive ? ' is-active' : '') + '" type="button" data-trace-index="' + esc(summary.traceIndex) + '">' +
                    '<span class="chart-series-topline">' +
                        '<span class="chart-series-name">' + esc(summary.name) + '</span>' +
                        '<span class="chart-series-value">' + esc(formatMetricValue(summary.metricField, summary.latestValue)) + '</span>' +
                    '</span>' +
                    '<span class="chart-series-meta">' +
                        '<span class="chart-series-delta">' + esc(deltaText) + '</span>' +
                        '<span class="chart-series-points">' + esc(summary.pointCount.toLocaleString()) + ' pts</span>' +
                    '</span>' +
                '</button>'
            );
        }
        els.chartSeriesList.innerHTML = html.join('');
    }

    function setFocusedSeries(index) {
        if (!els.chartSeriesList) return;
        var buttons = els.chartSeriesList.querySelectorAll('[data-trace-index]');
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            var isActive = Number(button.getAttribute('data-trace-index')) === Number(index);
            button.classList.toggle('is-active', isActive);
        }
    }

    function setIdleState() {
        syncPresetButtons();
        renderSummary(null, getChartFields());
        renderSeriesRail(null, -1);
    }

    function setPendingState(message) {
        if (els.chartStatus) els.chartStatus.textContent = String(message || 'Loading chart data...');
        if (els.chartSummary) {
            els.chartSummary.innerHTML = '<span class="chart-summary-pill is-emphasis">Loading chart data</span>';
        }
        if (els.chartGuidance) {
            els.chartGuidance.textContent = buildGuidance(getChartFields(), null);
        }
    }

    function markChartStale() {
        if (!tabState.chartDrawn || !els.chartStatus) return;
        els.chartStatus.textContent = 'Chart settings changed - redraw to apply.';
    }

    function bindUi(onDraw, onTraceFocus) {
        if (uiBound) return;
        uiBound = true;
        traceFocusHandler = typeof onTraceFocus === 'function' ? onTraceFocus : null;

        var buttons = document.querySelectorAll('[data-chart-preset]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function (event) {
                var button = event.currentTarget;
                var presetName = button ? button.getAttribute('data-chart-preset') : '';
                applyPreset(presetName);
                if (typeof onDraw === 'function') onDraw();
            });
        }

        [els.chartX, els.chartY, els.chartGroup, els.chartType, els.chartSeriesLimit].forEach(function (control) {
            if (!control) return;
            control.addEventListener('change', function () {
                syncPresetButtons();
                if (els.chartGuidance) {
                    els.chartGuidance.textContent = buildGuidance(getChartFields(), null);
                }
                if (els.chartSummary && tabState.chartDrawn) {
                    els.chartSummary.innerHTML = '<span class="chart-summary-pill is-warning">Settings changed - redraw to apply</span>';
                }
                markChartStale();
            });
        });

        if (els.chartSeriesList) {
            els.chartSeriesList.addEventListener('click', function (event) {
                if (!traceFocusHandler) return;
                var button = event.target && event.target.closest
                    ? event.target.closest('[data-trace-index]')
                    : null;
                if (!button) return;
                var traceIndex = Number(button.getAttribute('data-trace-index'));
                if (!Number.isFinite(traceIndex)) return;
                traceFocusHandler(traceIndex);
            });
        }
    }

    window.AR.chartUi = {
        applyPreset: applyPreset,
        bindUi: bindUi,
        fieldLabel: fieldLabel,
        formatFieldValue: formatFieldValue,
        formatMetricValue: formatMetricValue,
        getActivePresetName: getActivePresetName,
        getChartFields: getChartFields,
        isDateField: isDateField,
        isMoneyField: isMoneyField,
        isPercentField: isPercentField,
        parseSeriesLimit: parseSeriesLimit,
        renderSeriesRail: renderSeriesRail,
        renderSummary: renderSummary,
        setFocusedSeries: setFocusedSeries,
        setIdleState: setIdleState,
        setPendingState: setPendingState,
        syncPresetButtons: syncPresetButtons,
    };
})();
