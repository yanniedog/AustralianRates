(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var filters = window.AR.filters;
    var sectionConfig = window.AR.sectionConfig || {};
    var state = window.AR.state;
    var utils = window.AR.utils || {};
    var chartConfig = window.AR.chartConfig || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var uiBound = false;

    function activeViewButton() {
        return document.querySelector('[data-chart-view].is-active') || document.querySelector('[data-chart-view="surface"]');
    }

    function activeView() {
        var button = activeViewButton();
        return button ? String(button.getAttribute('data-chart-view') || 'surface') : 'surface';
    }

    function setActiveView(view) {
        var buttons = document.querySelectorAll('[data-chart-view]');
        for (var i = 0; i < buttons.length; i++) {
            var isActive = String(buttons[i].getAttribute('data-chart-view') || '') === String(view || 'surface');
            buttons[i].classList.toggle('is-active', isActive);
            buttons[i].setAttribute('aria-pressed', String(isActive));
        }
    }

    function getChartFields() {
        var defaults = chartConfig.defaultFields ? chartConfig.defaultFields() : {};
        return {
            view: activeView(),
            xField: els.chartX ? els.chartX.value : defaults.xField || 'collection_date',
            yField: els.chartY ? els.chartY.value : defaults.yField || 'interest_rate',
            groupField: els.chartGroup ? els.chartGroup.value : defaults.groupField || 'product_key',
            chartType: els.chartType ? els.chartType.value : defaults.chartType || 'scatter',
            density: els.chartSeriesLimit ? els.chartSeriesLimit.value : defaults.density || 'standard',
        };
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

    function guidance(fields, model, stale) {
        var notes = [];
        if (sectionConfig.chartHint) notes.push(sectionConfig.chartHint);
        if (fields.view === 'surface') {
            notes.push('Surface view maps collection date across the x-axis and product_key series down the y-axis.');
            if (getSelectedBankCount() !== 1) notes.push('Filter to one bank for the cleanest longitudinal surface.');
        }
        if (fields.view === 'compare') notes.push('Compare view animates only the selected spotlight series.');
        if (fields.view === 'distribution') notes.push('Distribution groups the current filter set into category-level boxplots.');
        if (model && model.meta && model.meta.visibleSeries < model.meta.totalSeries) {
            notes.push('Visible rows are limited by the chosen density preset.');
        }
        if (stale) notes.push('Filters changed. Redraw to fetch fresh rows.');
        return notes.filter(Boolean).join(' ');
    }

    function summaryPills(model, fields, payloadMeta, stale) {
        if (!model) {
            return '' +
                '<span class="chart-summary-pill">Awaiting first render</span>' +
                (stale ? '<span class="chart-summary-pill is-warning">Stale after filter change</span>' : '');
        }
        var pills = [];
        pills.push('<span class="chart-summary-pill is-emphasis">' + esc(String(fields.view).charAt(0).toUpperCase() + String(fields.view).slice(1)) + ' view</span>');
        pills.push('<span class="chart-summary-pill">' + esc(chartConfig.fieldLabel(fields.yField)) + '</span>');
        pills.push('<span class="chart-summary-pill">' + esc(model.meta.visibleSeries) + ' visible series</span>');
        pills.push('<span class="chart-summary-pill">' + esc(model.meta.densityLabel) + ' density</span>');
        if (payloadMeta && Number.isFinite(Number(payloadMeta.totalRows))) {
            pills.push('<span class="chart-summary-pill">' + esc(Number(payloadMeta.totalRows).toLocaleString()) + ' rows loaded</span>');
        }
        if (payloadMeta && payloadMeta.truncated) {
            pills.push('<span class="chart-summary-pill is-warning">10,000-row fetch cap reached</span>');
        }
        if (stale) {
            pills.push('<span class="chart-summary-pill is-warning">Stale after filter change</span>');
        }
        return pills.join('');
    }

    function renderSummary(model, fields, payloadMeta, stale) {
        if (els.chartGuidance) {
            els.chartGuidance.textContent = guidance(fields || getChartFields(), model || null, !!stale);
        }
        if (els.chartSummary) {
            els.chartSummary.innerHTML = summaryPills(model || null, fields || getChartFields(), payloadMeta || null, !!stale);
        }
    }

    function surfaceSeriesNote(model) {
        if (!model || !model.visibleSeries.length) return 'Draw a chart to activate the rate surface.';
        return 'Click cards to include series in Compare. Click the surface to move the spotlight.';
    }

    function renderSeriesRail(model, selectionState) {
        if (!els.chartSeriesList || !els.chartSeriesNote) return;
        if (!model || !model.visibleSeries.length) {
            els.chartSeriesNote.textContent = 'Draw a chart to activate the rate surface.';
            els.chartSeriesList.innerHTML = '<p class="chart-series-empty">Visible products and selected comparison lines will appear here.</p>';
            return;
        }

        var selected = selectionState && Array.isArray(selectionState.selectedSeriesKeys)
            ? selectionState.selectedSeriesKeys
            : [];

        els.chartSeriesNote.textContent = surfaceSeriesNote(model);
        els.chartSeriesList.innerHTML = model.visibleSeries.map(function (series) {
            var isSelected = selected.indexOf(series.key) >= 0;
            var isSpotlight = selectionState && selectionState.spotlightSeriesKey === series.key;
            var color = chartConfig.palette()[series.colorIndex % chartConfig.palette().length];
            return '' +
                '<button class="chart-series-card' + (isSelected ? ' is-selected' : '') + (isSpotlight ? ' is-active' : '') + '"' +
                    ' style="--series-accent:' + esc(color) + ';" type="button" data-series-key="' + esc(series.key) + '">' +
                    '<span class="chart-series-topline">' +
                        '<span class="chart-series-name-wrap">' +
                            '<span class="chart-series-swatch" aria-hidden="true"></span>' +
                            '<span class="chart-series-name">' + esc(series.name) + '</span>' +
                        '</span>' +
                        '<span class="chart-series-value">' + esc(chartConfig.formatMetricValue(getChartFields().yField, series.latestValue)) + '</span>' +
                    '</span>' +
                    '<span class="chart-series-meta">' +
                        '<span class="chart-series-delta">' + esc(Number.isFinite(Number(series.delta)) ? chartConfig.formatMetricValue(getChartFields().yField, series.delta) : 'No delta') + '</span>' +
                        '<span class="chart-series-points">' + esc(series.pointCount.toLocaleString()) + ' pts</span>' +
                    '</span>' +
                '</button>';
        }).join('');
    }

    function productLink(row) {
        var href = row && /^https?:\/\//i.test(String(row.product_url || '')) ? String(row.product_url) : '';
        if (!href) return '<span class="chart-spotlight-link is-muted">No product page available for this series.</span>';
        return '<a class="chart-point-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Open product page</a>';
    }

    function renderSpotlight(model, fields) {
        if (!els.chartPointDetails) return;
        if (!model || !model.spotlight || !model.spotlight.series) {
            els.chartPointDetails.hidden = false;
            els.chartPointDetails.innerHTML =
                '<div class="chart-spotlight-empty">' +
                    '<strong>Spotlight inactive</strong>' +
                    '<span>Select a visible product from the surface or side rail to inspect its detail trend.</span>' +
                '</div>';
            return;
        }

        var spotlight = model.spotlight;
        var row = spotlight.row || {};
        els.chartPointDetails.hidden = false;
        els.chartPointDetails.innerHTML = '' +
            '<div class="chart-spotlight-card">' +
                '<div class="chart-spotlight-copy">' +
                    '<p class="chart-series-kicker">Series spotlight</p>' +
                    '<strong>' + esc(spotlight.series.name) + '</strong>' +
                    '<span class="chart-spotlight-subtitle">' + esc(spotlight.series.subtitle || 'Canonical product_key trend') + '</span>' +
                '</div>' +
                '<div class="chart-spotlight-metrics">' +
                    '<span class="chart-summary-pill is-emphasis">' + esc(chartConfig.formatMetricValue(fields.yField, spotlight.value)) + '</span>' +
                    '<span class="chart-summary-pill">' + esc(chartConfig.formatFieldValue('collection_date', spotlight.date, row)) + '</span>' +
                    '<span class="chart-summary-pill">' + esc(spotlight.series.pointCount.toLocaleString()) + ' observations</span>' +
                '</div>' +
                '<div class="chart-spotlight-grid">' +
                    '<span><strong>Bank</strong> ' + esc(row.bank_name || '-') + '</span>' +
                    '<span><strong>Product</strong> ' + esc(row.product_name || '-') + '</span>' +
                    '<span><strong>Delta</strong> ' + esc(Number.isFinite(Number(spotlight.series.delta)) ? chartConfig.formatMetricValue(fields.yField, spotlight.series.delta) : '-') + '</span>' +
                    '<span><strong>product_key</strong> ' + esc(String(row.product_key || spotlight.series.key || '-')) + '</span>' +
                '</div>' +
                '<div class="chart-spotlight-link-row">' + productLink(row) + '</div>' +
            '</div>';
    }

    function setStatus(message) {
        if (els.chartStatus) els.chartStatus.textContent = String(message || '');
    }

    function setCanvasPlaceholder(message) {
        if (els.chartOutput) {
            els.chartOutput.removeAttribute('data-chart-rendered');
            els.chartOutput.removeAttribute('data-chart-engine');
            els.chartOutput.removeAttribute('data-chart-view');
            els.chartOutput.innerHTML = '<div class="chart-output-empty">' + esc(message || 'Draw a chart to render the rate surface.') + '</div>';
        }
        if (els.chartDetailOutput) {
            els.chartDetailOutput.innerHTML = '<div class="chart-detail-empty">' + esc(message || 'Select a series to inspect its detail trend.') + '</div>';
        }
    }

    function setIdleState() {
        setActiveView('surface');
        renderSummary(null, getChartFields(), null, false);
        renderSeriesRail(null, null);
        renderSpotlight(null, getChartFields());
        setCanvasPlaceholder('Draw a chart to render the rate surface.');
        setStatus('Choose a view, adjust the metric or density, then draw.');
    }

    function setPendingState(message) {
        renderSummary(null, getChartFields(), null, false);
        setStatus(message || 'Loading chart data...');
        setCanvasPlaceholder('Loading chart data...');
    }

    function markStale(message) {
        if (!tabState.chartDrawn) return;
        renderSummary(null, getChartFields(), null, true);
        setStatus(message || 'Filters changed. Redraw to fetch fresh chart rows.');
    }

    function bindUi(handlers) {
        if (uiBound) return;
        uiBound = true;

        var controlHandler = function (reason) {
            if (!handlers || typeof handlers.onControlChange !== 'function') return;
            handlers.onControlChange(reason || 'controls');
        };

        var buttons = document.querySelectorAll('[data-chart-view]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function (event) {
                var button = event.currentTarget;
                var view = button ? button.getAttribute('data-chart-view') : 'surface';
                setActiveView(view);
                if (handlers && typeof handlers.onViewChange === 'function') handlers.onViewChange(view);
            });
        }

        [els.chartX, els.chartY, els.chartGroup, els.chartType, els.chartSeriesLimit].forEach(function (control) {
            if (!control) return;
            control.addEventListener('change', function () {
                controlHandler('advanced');
            });
        });

        if (els.chartSeriesList) {
            els.chartSeriesList.addEventListener('click', function (event) {
                var button = event.target && event.target.closest ? event.target.closest('[data-series-key]') : null;
                if (!button) return;
                if (handlers && typeof handlers.onSeriesToggle === 'function') {
                    handlers.onSeriesToggle(String(button.getAttribute('data-series-key') || ''));
                }
            });
        }
    }

    window.AR.chartUi = {
        bindUi: bindUi,
        getChartFields: getChartFields,
        markStale: markStale,
        renderSeriesRail: renderSeriesRail,
        renderSpotlight: renderSpotlight,
        renderSummary: renderSummary,
        setActiveView: setActiveView,
        setCanvasPlaceholder: setCanvasPlaceholder,
        setIdleState: setIdleState,
        setPendingState: setPendingState,
        setStatus: setStatus,
    };
})();
