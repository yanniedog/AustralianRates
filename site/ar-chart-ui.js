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

    function defaultViewFallback() {
        return chartConfig.defaultView ? chartConfig.defaultView() : 'lenders';
    }

    function activeViewButton() {
        return document.querySelector('[data-chart-view].is-active') || document.querySelector('[data-chart-view="' + defaultViewFallback() + '"]');
    }

    function activeView() {
        var button = activeViewButton();
        return button ? String(button.getAttribute('data-chart-view') || defaultViewFallback()) : defaultViewFallback();
    }

    function setActiveView(view) {
        var fallback = view || defaultViewFallback();
        var buttons = document.querySelectorAll('[data-chart-view]');
        for (var i = 0; i < buttons.length; i++) {
            var isActive = String(buttons[i].getAttribute('data-chart-view') || '') === String(fallback);
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
            representation: els.chartRepresentation ? els.chartRepresentation.value : 'change',
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

    function currentFilterParams() {
        var buildFilterParams = filters && typeof filters.buildFilterParams === 'function'
            ? filters.buildFilterParams
            : function () { return {}; };
        return buildFilterParams() || {};
    }

    function findFilterField(param) {
        var filterFields = sectionConfig.filterFields || [];
        for (var i = 0; i < filterFields.length; i++) {
            if (filterFields[i].param === param) return filterFields[i];
        }
        return null;
    }

    function formatSliceValue(param, value) {
        var formatFilterValue = utils.formatFilterValue || function (_field, next) { return String(next == null ? '' : next); };
        return formatFilterValue(param, value) || String(value == null ? '' : value);
    }

    function currentSlicePills(fields) {
        var params = currentFilterParams();
        var order = [
            'banks',
            'security_purpose',
            'repayment_type',
            'lvr_tier',
            'rate_structure',
            'feature_set',
            'account_type',
            'rate_type',
            'deposit_tier',
            'term_months',
            'interest_payment',
        ];
        var pills = [];

        order.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(params, key)) return;
            var raw = String(params[key] || '').trim();
            if (!raw) return;
            var field = findFilterField(key);
            var values = raw.split(',').filter(Boolean);
            var rendered = values.map(function (value) { return formatSliceValue(key, value); });
            if (key === 'banks' && values.length > 1) {
                rendered = [values.length + ' banks'];
            }
            pills.push(
                '<span class="chart-summary-pill is-config">' +
                    esc((field && field.label) || chartConfig.fieldLabel(key)) + ': ' +
                    esc(rendered.join(', ')) +
                '</span>'
            );
        });

        if (fields.view === 'lenders' && !String(params.banks || '').trim()) {
            pills.unshift('<span class="chart-summary-pill is-config">Banks: All lenders</span>');
        }

        return pills.slice(0, 5);
    }

    function guidance(fields, model, stale) {
        var tags = [];
        if (fields.view === 'surface') tags.push('Movement');
        if (fields.view === 'lenders') tags.push('Leaders');
        if (fields.view === 'market') tags.push('Curve');
        if (fields.view === 'compare') tags.push('Compare');
        if (fields.view === 'distribution') tags.push('Distribution');
        if (model && model.meta && fields.view === 'lenders' && model.meta.visibleLenders < model.meta.totalLenders) tags.push('Limited');
        else if (model && model.meta && model.meta.visibleSeries < model.meta.totalSeries) tags.push('Limited');
        if (stale) tags.push('Stale');
        return tags.filter(Boolean).join(' | ') || 'Ready';
    }

    function actualRepresentation(fields, payloadMeta) {
        if (payloadMeta && payloadMeta.representation) return String(payloadMeta.representation);
        return String(fields.representation || 'change');
    }

    function marketDimensionLabel(market) {
        var label = market && market.dimensionLabel ? String(market.dimensionLabel).trim() : '';
        if (!label && market && Array.isArray(market.categories) && market.categories.length) {
            label = String((market.categories[0] && market.categories[0].dimensionLabel) || '').trim();
        }
        return label || 'Market';
    }

    function summaryPills(model, fields, payloadMeta, stale) {
        if (!model) {
            return '' +
                '<span class="chart-summary-pill">Loading</span>' +
                (stale ? '<span class="chart-summary-pill is-warning">Stale</span>' : '');
        }
        var representation = actualRepresentation(fields, payloadMeta);
        var pills = [];
        pills.push('<span class="chart-summary-pill is-emphasis">' + esc(String(fields.view).charAt(0).toUpperCase() + String(fields.view).slice(1)) + ' view</span>');
        pills.push('<span class="chart-summary-pill">' + esc(chartConfig.fieldLabel(fields.yField)) + '</span>');
        pills.push('<span class="chart-summary-pill">' + esc(representation === 'day' ? 'Daily basis' : 'Change basis') + '</span>');
        if (fields.view === 'market' && model.market) {
            pills.push('<span class="chart-summary-pill">' + esc(model.market.categories.length + ' ' + marketDimensionLabel(model.market).toLowerCase() + ' points') + '</span>');
            pills.push('<span class="chart-summary-pill">' + esc('Snapshot ' + model.market.snapshotDateDisplay) + '</span>');
        } else {
            pills.push('<span class="chart-summary-pill">' + esc(fields.view === 'lenders' ? model.meta.visibleLenders + ' lenders' : model.meta.visibleSeries + ' visible series') + '</span>');
        }
        pills.push('<span class="chart-summary-pill">' + esc(model.meta.densityLabel) + ' density</span>');
        pills = pills.concat(currentSlicePills(fields));
        if (payloadMeta && Number.isFinite(Number(payloadMeta.totalRows))) {
            pills.push('<span class="chart-summary-pill">' + esc(Number(payloadMeta.totalRows).toLocaleString()) + ' rows loaded</span>');
        }
        if (stale) {
            pills.push('<span class="chart-summary-pill is-warning">Stale</span>');
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

    function railNote(fields, model) {
        if (!model) return 'Loading';
        if (fields.view === 'lenders') return 'Best lenders';
        if (fields.view === 'market' && model.market) return marketDimensionLabel(model.market) + ' curve';
        if (fields.view === 'compare') return 'Selected shortlist';
        if (fields.view === 'distribution') return 'Distribution view';
        return 'Product series';
    }

    function seriesCardMarkup(options) {
        return '' +
            '<button class="chart-series-card secondary' + (options.isSelected ? ' is-selected' : '') + (options.isSpotlight ? ' is-active' : '') + '"' +
                ' style="--series-accent:' + esc(options.color) + ';" type="button" data-series-key="' + esc(options.key) + '">' +
                '<span class="chart-series-topline">' +
                    '<span class="chart-series-name-wrap">' +
                        '<span class="chart-series-swatch" aria-hidden="true"></span>' +
                        '<span class="chart-series-name">' + esc(options.title) + '</span>' +
                    '</span>' +
                    '<span class="chart-series-value">' + esc(options.valueText) + '</span>' +
                '</span>' +
                (options.caption ? '<span class="chart-series-caption">' + esc(options.caption) + '</span>' : '') +
                '<span class="chart-series-meta">' +
                    '<span class="chart-series-delta">' + esc(options.metaLeft) + '</span>' +
                    '<span class="chart-series-points">' + esc(options.metaRight) + '</span>' +
                '</span>' +
            '</button>';
    }

    function renderSeriesRail(model, selectionState) {
        if (!els.chartSeriesList || !els.chartSeriesNote) return;
        var fields = getChartFields();
        if (!model || (fields.view === 'market' ? !(model.market && model.market.categories && model.market.categories.length) : !model.visibleSeries.length)) {
            els.chartSeriesNote.textContent = 'Loading';
            els.chartSeriesList.innerHTML = '<p class="chart-series-empty">No series</p>';
            return;
        }

        var selected = selectionState && Array.isArray(selectionState.selectedSeriesKeys)
            ? selectionState.selectedSeriesKeys
            : [];

        els.chartSeriesNote.textContent = railNote(fields, model);
        if (fields.view === 'market' && model.market) {
            els.chartSeriesList.innerHTML = model.market.categories.map(function (category, index) {
                var isSpotlight = selectionState && selectionState.marketFocusKey === category.key;
                return seriesCardMarkup({
                    key: category.key,
                    title: category.label,
                    valueText: chartConfig.formatMetricValue(fields.yField, category.bestValue),
                    caption: category.secondaryLabel || ('Median ' + chartConfig.formatMetricValue(fields.yField, category.median)),
                    metaLeft: 'Range ' + chartConfig.formatMetricValue(fields.yField, category.min) + ' to ' + chartConfig.formatMetricValue(fields.yField, category.max),
                    metaRight: category.bankCount.toLocaleString() + ' banks',
                    isSelected: isSpotlight,
                    isSpotlight: isSpotlight,
                    color: chartConfig.palette()[index % chartConfig.palette().length],
                });
            }).join('');
            return;
        }
        if (fields.view === 'lenders' && model.lenderRanking && model.lenderRanking.entries.length) {
            els.chartSeriesList.innerHTML = model.lenderRanking.entries.map(function (entry, index) {
                var isSelected = selected.indexOf(entry.seriesKey) >= 0;
                var isSpotlight = selectionState && selectionState.spotlightSeriesKey === entry.seriesKey;
                return seriesCardMarkup({
                    key: entry.seriesKey,
                    title: chartConfig.formatFieldValue('bank_name', entry.bankName, entry.row || null),
                    valueText: chartConfig.formatMetricValue(fields.yField, entry.value),
                    caption: entry.productName || 'Best matching product',
                    metaLeft: entry.latestDate ? chartConfig.formatFieldValue('collection_date', entry.latestDate, entry.row || null) : 'Latest',
                    metaRight: entry.pointCount.toLocaleString() + ' pts',
                    isSelected: isSelected,
                    isSpotlight: isSpotlight,
                    color: chartConfig.palette()[index % chartConfig.palette().length],
                });
            }).join('');
            return;
        }

        els.chartSeriesList.innerHTML = model.visibleSeries.map(function (series) {
            var isSelected = selected.indexOf(series.key) >= 0;
            var isSpotlight = selectionState && selectionState.spotlightSeriesKey === series.key;
            return seriesCardMarkup({
                key: series.key,
                title: series.name,
                valueText: chartConfig.formatMetricValue(fields.yField, series.latestValue),
                caption: series.subtitle || 'Canonical product_key trend',
                metaLeft: Number.isFinite(Number(series.delta)) ? chartConfig.formatMetricValue(fields.yField, series.delta) : 'No delta',
                metaRight: series.pointCount.toLocaleString() + ' pts',
                isSelected: isSelected,
                isSpotlight: isSpotlight,
                color: chartConfig.palette()[series.colorIndex % chartConfig.palette().length],
            });
        }).join('');
    }

    function productLink(row) {
        var href = row && /^https?:\/\//i.test(String(row.product_url || '')) ? String(row.product_url) : '';
        if (!href) return '<span class="chart-spotlight-link is-muted">No link</span>';
        return '<a class="chart-point-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Open</a>';
    }

    function spotlightField(label, value) {
        return '' +
            '<span class="chart-spotlight-field">' +
                '<strong>' + esc(label) + '</strong>' +
                '<span class="chart-spotlight-value">' + esc(value) + '</span>' +
            '</span>';
    }

    function renderSpotlight(model, fields) {
        if (!els.chartPointDetails) return;
        if (fields && fields.view === 'market') {
            var market = model && model.market ? model.market : null;
            var bucket = market && market.focusBucket ? market.focusBucket : null;
            if (!bucket) {
                els.chartPointDetails.hidden = false;
                els.chartPointDetails.innerHTML =
                    '<div class="chart-spotlight-empty">' +
                        '<strong>Waiting</strong>' +
                        '<span>No curve focus yet</span>' +
                    '</div>';
                return;
            }

            var bestRow = bucket.bestRow || {};
            els.chartPointDetails.hidden = false;
            els.chartPointDetails.innerHTML = '' +
                '<div class="chart-spotlight-card">' +
                    '<div class="chart-spotlight-copy">' +
                        '<p class="chart-series-kicker">Market spotlight</p>' +
                        '<strong>' + esc(bucket.label) + '</strong>' +
                        '<span class="chart-spotlight-subtitle">' + esc(bucket.secondaryLabel || market.snapshotDateDisplay) + '</span>' +
                    '</div>' +
                    '<div class="chart-spotlight-metrics">' +
                        '<span class="chart-summary-pill is-emphasis">' + esc(chartConfig.formatMetricValue(fields.yField, bucket.bestValue)) + '</span>' +
                        '<span class="chart-summary-pill">' + esc('Median ' + chartConfig.formatMetricValue(fields.yField, bucket.median)) + '</span>' +
                        '<span class="chart-summary-pill">' + esc(bucket.bankCount.toLocaleString()) + ' banks</span>' +
                    '</div>' +
                    '<div class="chart-spotlight-grid">' +
                        spotlightField('Leader', chartConfig.formatFieldValue('bank_name', bestRow.bank_name || '-', bestRow)) +
                        spotlightField('Product', bestRow.product_name || '-') +
                        spotlightField('Range', chartConfig.formatMetricValue(fields.yField, bucket.min) + ' to ' + chartConfig.formatMetricValue(fields.yField, bucket.max)) +
                        spotlightField('Snapshot', market.snapshotDateDisplay || '-') +
                    '</div>' +
                    '<div class="chart-spotlight-link-row">' + productLink(bestRow) + '</div>' +
                '</div>';
            return;
        }
        if (!model || !model.spotlight || !model.spotlight.series) {
            els.chartPointDetails.hidden = false;
            els.chartPointDetails.innerHTML =
                '<div class="chart-spotlight-empty">' +
                    '<strong>Waiting</strong>' +
                    '<span>No focus yet</span>' +
                '</div>';
            return;
        }

        var spotlight = model.spotlight;
        var lenderEntry = fields.view === 'lenders' && model.lenderRanking ? model.lenderRanking.activeEntry : null;
        var row = spotlight.row || {};
        var title = lenderEntry
            ? chartConfig.formatFieldValue('bank_name', lenderEntry.bankName, lenderEntry.row || null)
            : spotlight.series.name;
        var subtitle = lenderEntry
            ? 'Best current ' + chartConfig.fieldLabel(fields.yField).toLowerCase()
            : (spotlight.series.subtitle || 'product_key');
        els.chartPointDetails.hidden = false;
        els.chartPointDetails.innerHTML = '' +
            '<div class="chart-spotlight-card">' +
                '<div class="chart-spotlight-copy">' +
                    '<p class="chart-series-kicker">' + esc(lenderEntry ? 'Lender spotlight' : 'Series spotlight') + '</p>' +
                    '<strong>' + esc(title) + '</strong>' +
                    '<span class="chart-spotlight-subtitle">' + esc(subtitle) + '</span>' +
                '</div>' +
                '<div class="chart-spotlight-metrics">' +
                    '<span class="chart-summary-pill is-emphasis">' + esc(chartConfig.formatMetricValue(fields.yField, spotlight.value)) + '</span>' +
                    '<span class="chart-summary-pill">' + esc(chartConfig.formatFieldValue('collection_date', spotlight.date, row)) + '</span>' +
                    '<span class="chart-summary-pill">' + esc(spotlight.series.pointCount.toLocaleString()) + ' observations</span>' +
                    (lenderEntry ? '<span class="chart-summary-pill is-config">Best product by bank</span>' : '') +
                '</div>' +
                '<div class="chart-spotlight-grid">' +
                    spotlightField('Bank', chartConfig.formatFieldValue('bank_name', row.bank_name || '-', row)) +
                    spotlightField('Product', row.product_name || '-') +
                    spotlightField('Delta', Number.isFinite(Number(spotlight.series.delta)) ? chartConfig.formatMetricValue(fields.yField, spotlight.series.delta) : '-') +
                    spotlightField('product_key', String(row.product_key || spotlight.series.key || '-')) +
                '</div>' +
                '<div class="chart-spotlight-link-row">' + productLink(row) + '</div>' +
            '</div>';
    }

    function setStatus(message) {
        if (els.chartStatus) els.chartStatus.textContent = String(message || '');
    }

    function setErrorState(message) {
        var text = String(message || '').trim();
        if (!els.chartError) return;
        els.chartError.textContent = text;
        els.chartError.hidden = !text;
    }

    function clearErrorState() {
        setErrorState('');
    }

    function setCanvasPlaceholder(message) {
        if (els.chartOutput) {
            els.chartOutput.removeAttribute('data-chart-rendered');
            els.chartOutput.removeAttribute('data-chart-engine');
            els.chartOutput.removeAttribute('data-chart-render-view');
            els.chartOutput.innerHTML = '<div class="chart-output-empty">' + esc(message || 'Loading') + '</div>';
        }
        if (els.chartDetailOutput) {
            els.chartDetailOutput.innerHTML = '<div class="chart-detail-empty">' + esc(message || 'Loading') + '</div>';
        }
    }

    function setIdleState() {
        setActiveView(defaultViewFallback());
        clearErrorState();
        if (els.chartGuidance) els.chartGuidance.textContent = 'On demand';
        if (els.chartSummary) {
            els.chartSummary.innerHTML = '<span class="chart-summary-pill">Load chart when ready</span>';
        }
        renderSeriesRail(null, null);
        renderSpotlight(null, getChartFields());
        setCanvasPlaceholder('Choose a view and press Update chart.');
        setStatus('Idle');
    }

    function setPendingState(message) {
        clearErrorState();
        renderSummary(null, getChartFields(), null, false);
        setStatus(message || 'Loading');
        setCanvasPlaceholder('Loading');
    }

    function markStale(message) {
        if (!tabState.chartDrawn) return;
        clearErrorState();
        renderSummary(null, getChartFields(), null, true);
        setStatus(message || 'Stale');
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
                var view = button ? button.getAttribute('data-chart-view') : defaultViewFallback();
                setActiveView(view);
                if (handlers && typeof handlers.onViewChange === 'function') handlers.onViewChange(view);
            });
        }

        [els.chartX, els.chartY, els.chartGroup, els.chartType, els.chartSeriesLimit, els.chartRepresentation].forEach(function (control) {
            if (!control) return;
            control.addEventListener('change', function () {
                controlHandler(control === els.chartRepresentation ? 'representation' : 'advanced');
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
        clearErrorState: clearErrorState,
        setActiveView: setActiveView,
        setCanvasPlaceholder: setCanvasPlaceholder,
        setErrorState: setErrorState,
        setIdleState: setIdleState,
        setPendingState: setPendingState,
        setStatus: setStatus,
    };
})();
