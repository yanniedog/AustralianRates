(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var filters = window.AR.filters;
    var sectionConfig = window.AR.sectionConfig || {};
    var state = window.AR.state;
    var utils = window.AR.utils || {};
    var chartConfig = window.AR.chartConfig || {};
    var economicOverlays = window.AR.chartEconomicOverlays || {};
    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var uiBound = false;

    function defaultViewFallback() {
        if (chartConfig.defaultView) return chartConfig.defaultView();
        var sec = (window.AR && window.AR.section) || (document.body && document.body.getAttribute('data-ar-section')) || 'home-loans';
        if (sec === 'savings') return 'economicReport';
        if (sec === 'term-deposits') return 'termDepositReport';
        return 'homeLoanReport';
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
        syncControlAvailability(fallback);
    }

    function viewCapabilities(view) {
        var key = String(view || defaultViewFallback());
        var caps = {
            xField: false,
            groupField: false,
            chartType: false,
            representation: true,
            economicOverlays: false,
        };
        if (key === 'market') {
            caps.chartType = true;
            caps.representation = false;
            return caps;
        }
        if (key === 'distribution') {
            caps.groupField = true;
            return caps;
        }
        if (key === 'slope' || key === 'timeRibbon' || key === 'tdTermTime') {
            caps.representation = false;
            return caps;
        }
        if (key === 'economicReport' || key === 'homeLoanReport' || key === 'termDepositReport') {
            caps.representation = false;
            caps.xField = false;
            caps.groupField = false;
            caps.economicOverlays = true;
            return caps;
        }
        if (key === 'compare') caps.economicOverlays = true;
        return caps;
    }

    function controlField(control) {
        return control && control.closest ? control.closest('.terminal-field') : null;
    }

    function setControlVisibility(control, enabled, disabledTitle) {
        var field = controlField(control);
        if (!field || !control) return;
        field.hidden = !enabled;
        control.disabled = !enabled;
        if (enabled) {
            field.removeAttribute('title');
            field.removeAttribute('aria-hidden');
            control.removeAttribute('aria-disabled');
            return;
        }
        field.setAttribute('title', disabledTitle || 'Not available for this chart view');
        field.setAttribute('aria-hidden', 'true');
        control.setAttribute('aria-disabled', 'true');
    }

    function syncControlAvailability(view) {
        var caps = viewCapabilities(view);
        setControlVisibility(els.chartX, !!caps.xField, 'X-axis choices are not yet available for this view.');
        setControlVisibility(els.chartGroup, !!caps.groupField, 'Grouping is only available where implemented for this view.');
        setControlVisibility(els.chartType, !!caps.chartType, 'Curve style only applies to the Curve view.');
        setControlVisibility(els.chartRepresentation, !!caps.representation, 'This view always uses daily snapshots.');
        syncEconomicOverlayAvailability(view, !!caps.economicOverlays);
        var engineRow = document.querySelector('.chart-engine-row');
        var v = String(view || '');
        var engineForced = v === 'economicReport' || v === 'homeLoanReport' || v === 'termDepositReport';
        if (engineRow) engineRow.hidden = engineForced;
    }

    function selectedEconomicOverlayIds() {
        if (!els.chartEconomicOverlayOptions) {
            return economicOverlays.getSelectedIds ? economicOverlays.getSelectedIds() : [];
        }
        var inputs = els.chartEconomicOverlayOptions.querySelectorAll('input[type="checkbox"][data-economic-series-id]');
        if (!inputs.length) {
            return economicOverlays.getSelectedIds ? economicOverlays.getSelectedIds() : [];
        }
        var checked = els.chartEconomicOverlayOptions.querySelectorAll('input[type="checkbox"][data-economic-series-id]:checked');
        var ids = [];
        checked.forEach(function (input) {
            var value = String(input.getAttribute('data-economic-series-id') || '').trim();
            if (value) ids.push(value);
        });
        return ids;
    }

    function updateEconomicOverlaySummary() {
        if (!els.chartEconomicOverlaySummary) return;
        var ids = selectedEconomicOverlayIds();
        els.chartEconomicOverlaySummary.textContent = economicOverlays.selectionSummary
            ? economicOverlays.selectionSummary(ids)
            : (ids.length ? ids.length + ' selected' : 'None');
    }

    function syncEconomicOverlayAvailability(view, enabled) {
        if (!els.chartEconomicOverlayPicker) return;
        els.chartEconomicOverlayPicker.classList.toggle('is-disabled', !enabled);
        if (!els.chartEconomicOverlayHint) return;
        if (enabled) {
            els.chartEconomicOverlayHint.textContent = 'Plot indexed economic metrics alongside bank rates in this view.';
            return;
        }
        els.chartEconomicOverlayHint.textContent = 'Economic overlays appear in Rate Report and Compare views.';
    }

    function economicOverlayOptionMarkup(series, checked, lineColor) {
        var id = String(series && series.id || '');
        var label = String((series && (series.short_label || series.shortLabel || series.label)) || id);
        var caption = String(series && series.category_label || '');
        var titleText = caption ? (label + ' — ' + caption) : label;
        var swatch = String(lineColor || '#64748b').replace(/[<>"'&;]/g, '');
        return '' +
            '<label class="chart-overlay-option" title="' + esc(titleText) + '">' +
                '<input type="checkbox" data-economic-series-id="' + esc(id) + '"' + (checked ? ' checked' : '') + '>' +
                '<span class="chart-overlay-option-swatch" style="--chart-overlay-swatch:' + swatch + '" aria-hidden="true"></span>' +
                '<span class="chart-overlay-option-body">' +
                    '<span class="chart-overlay-option-label">' + esc(label) + '</span>' +
                    (caption ? '<span class="chart-overlay-option-caption">' + esc(caption) + '</span>' : '') +
                '</span>' +
            '</label>';
    }

    function renderEconomicOverlayPicker() {
        if (!els.chartEconomicOverlayOptions || !economicOverlays.fetchCatalog) return Promise.resolve();
        els.chartEconomicOverlayOptions.innerHTML = '<p class="chart-overlay-picker-empty">Loading overlays…</p>';
        return economicOverlays.fetchCatalog().then(function (catalog) {
            var selected = {};
            (economicOverlays.getSelectedIds ? economicOverlays.getSelectedIds() : []).forEach(function (id) {
                selected[String(id)] = true;
            });
            var rows = [];
            var colorIdx = 0;
            (catalog && catalog.categories || []).forEach(function (category) {
                var seriesMarkup = (category.series || []).map(function (series) {
                    var col = economicOverlays.colorForSeries
                        ? economicOverlays.colorForSeries(series.id, colorIdx)
                        : '#64748b';
                    colorIdx += 1;
                    return economicOverlayOptionMarkup(
                        Object.assign({ category_label: category.label || category.id || '' }, series),
                        !!selected[String(series.id || '')],
                        col
                    );
                }).join('');
                if (!seriesMarkup) return;
                rows.push(
                    '<section class="chart-overlay-group">' +
                        '<p class="chart-overlay-group-title">' + esc(category.label || category.id || '') + '</p>' +
                        '<div class="chart-overlay-group-options">' + seriesMarkup + '</div>' +
                    '</section>'
                );
            });
            els.chartEconomicOverlayOptions.innerHTML = rows.join('') || '<p class="chart-overlay-picker-empty">No overlays available.</p>';
            updateEconomicOverlaySummary();
            syncEconomicOverlayAvailability(activeView(), viewCapabilities(activeView()).economicOverlays);
        }).catch(function () {
            els.chartEconomicOverlayOptions.innerHTML = '<p class="chart-overlay-picker-empty">Overlay list unavailable.</p>';
            if (els.chartEconomicOverlayHint) {
                els.chartEconomicOverlayHint.textContent = 'Economic overlay catalog could not be loaded.';
            }
            updateEconomicOverlaySummary();
        });
    }

    function chartEngineStorageKey() {
        return (window.AR.chartLightweight && window.AR.chartLightweight.CHART_ENGINE_STORAGE) || 'ar.chartEngine';
    }

    function activeChartEngine() {
        var btn = document.querySelector('[data-chart-engine].is-active');
        if (btn) return String(btn.getAttribute('data-chart-engine') || 'echarts');
        return 'echarts';
    }

    function setActiveChartEngine(engine) {
        var v = String(engine || 'echarts') === 'lightweight' ? 'lightweight' : 'echarts';
        var buttons = document.querySelectorAll('[data-chart-engine]');
        for (var i = 0; i < buttons.length; i++) {
            var b = buttons[i];
            var isActive = String(b.getAttribute('data-chart-engine') || '') === v;
            b.classList.toggle('is-active', isActive);
            b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
        try {
            localStorage.setItem(chartEngineStorageKey(), v);
        } catch (_e) { /* ignore */ }
    }

    function initChartEngineFromStorage() {
        var saved = 'echarts';
        try {
            saved = localStorage.getItem(chartEngineStorageKey()) || 'echarts';
        } catch (_e) { /* ignore */ }
        if (saved !== 'lightweight') saved = 'echarts';
        setActiveChartEngine(saved);
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
            chartEngine: activeChartEngine(),
            economicOverlayIds: selectedEconomicOverlayIds(),
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

        if ((fields.view === 'lenders' || fields.view === 'homeLoanReport') && !String(params.banks || '').trim()) {
            pills.unshift('<span class="chart-summary-pill is-config">Banks: All lenders</span>');
        }

        return pills.slice(0, 5);
    }

    function guidance(fields, model, stale) {
        var tags = [];
        if (fields.view === 'surface') tags.push('Movement');
        if (fields.view === 'lenders') tags.push('Leaders');
        if (fields.view === 'market') tags.push('Curve');
        if (fields.view === 'slope') tags.push('Slope');
        if (fields.view === 'ladder') tags.push('Ladder');
        if (fields.view === 'timeRibbon') tags.push('Ribbon (time)');
        if (fields.view === 'tdTermTime') tags.push('Term vs time');
        if (fields.view === 'compare') tags.push('Compare');
        if (fields.view === 'distribution') tags.push('Distribution');
        if (fields.view === 'homeLoanReport') tags.push('Like-for-like');
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
        } else if (fields.view === 'timeRibbon' && model.timeRibbon) {
            pills.push('<span class="chart-summary-pill">' + esc(model.timeRibbon.termLabel + ' term') + '</span>');
            pills.push('<span class="chart-summary-pill">' + esc(model.timeRibbon.categories.length + ' dates') + '</span>');
        } else if (fields.view === 'tdTermTime' && model.tdTermTime) {
            pills.push('<span class="chart-summary-pill">' + esc(model.tdTermTime.terms.length + ' terms') + '</span>');
        } else if (fields.view === 'slope' && model.slope && model.slope.lines) {
            pills.push('<span class="chart-summary-pill">' + esc(model.slope.lines.length + ' slopes') + '</span>');
            pills.push('<span class="chart-summary-pill">' + esc(model.slope.dateLeftLabel + ' \u2192 ' + model.slope.dateRightLabel) + '</span>');
        } else if (fields.view === 'ladder' || fields.view === 'lenders' || fields.view === 'homeLoanReport') {
            pills.push('<span class="chart-summary-pill">' + esc(model.meta.visibleLenders + ' lenders') + '</span>');
        } else {
            pills.push('<span class="chart-summary-pill">' + esc(model.meta.visibleSeries + ' visible series') + '</span>');
        }
        pills.push('<span class="chart-summary-pill">' + esc(model.meta.densityLabel) + ' density</span>');
        pills = pills.concat(currentSlicePills(fields));
        if (payloadMeta && Number.isFinite(Number(payloadMeta.totalRows))) {
            pills.push('<span class="chart-summary-pill">' + esc(Number(payloadMeta.totalRows).toLocaleString()) + ' rows loaded</span>');
        }
        if (fields.economicOverlayIds && fields.economicOverlayIds.length) {
            pills.push('<span class="chart-summary-pill is-config">' + esc('Economic overlays: ' + (economicOverlays.selectionSummary ? economicOverlays.selectionSummary(fields.economicOverlayIds) : fields.economicOverlayIds.length + ' selected')) + '</span>');
        }
        if (stale) {
            pills.push('<span class="chart-summary-pill is-warning">Stale</span>');
        }
        return pills.join('');
    }

    function economicOverlayReferenceCards(selectionState) {
        var rows = Array.isArray(selectionState && selectionState.economicOverlaySeries)
            ? selectionState.economicOverlaySeries
            : [];
        if (!rows.length) return '';
        return rows.map(function (series) {
            var latest = series.latestPoint || null;
            var valueText = latest && Number.isFinite(Number(latest.raw_value))
                ? chartConfig.formatMetricValue('', latest.raw_value) + (series.unit ? ' ' + series.unit : '')
                : 'Indexed';
            var caption = series.proxy
                ? 'Economic overlay proxy · indexed to window'
                : 'Economic overlay · indexed to window';
            return '' +
                '<div class="chart-series-card secondary is-reference" style="--series-accent:' + esc(series.color || '#94a3b8') + ';" role="listitem">' +
                    '<span class="chart-series-topline">' +
                        '<span class="chart-series-name-wrap">' +
                            '<span class="chart-series-swatch" aria-hidden="true"></span>' +
                            '<span class="chart-series-name">' + esc(series.shortLabel || series.label || series.id || 'Overlay') + '</span>' +
                        '</span>' +
                        '<span class="chart-series-value">' + esc(valueText) + '</span>' +
                    '</span>' +
                    '<span class="chart-series-caption">' + esc(caption) + '</span>' +
                '</div>';
        }).join('');
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
        if (fields.view === 'homeLoanReport') return 'One product per bank';
        if (fields.view === 'market' && model.market) return marketDimensionLabel(model.market) + ' curve';
        if (fields.view === 'slope' && model.slope) return 'Who moved';
        if (fields.view === 'ladder') return 'Rate ladder';
        if (fields.view === 'timeRibbon' && model.timeRibbon) return 'Rate over time · ' + (model.timeRibbon.termLabel || '');
        if (fields.view === 'tdTermTime' && model.tdTermTime) return 'Term vs time';
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
        var pal = chartConfig.palette();
        var marketOk = model && model.market && model.market.categories && model.market.categories.length;
        var timeRibbonOk = model && model.timeRibbon && model.timeRibbon.categories && model.timeRibbon.categories.length;
        var tdTermTimeOk = model && model.tdTermTime && model.tdTermTime.terms && model.tdTermTime.terms.length;
        var slopeOk = model && model.slope && model.slope.lines && model.slope.lines.length;
        var ladderOk = model && model.lenderRanking && model.lenderRanking.entries && model.lenderRanking.entries.length;
        var distOk = model && model.distribution && model.distribution.categories && model.distribution.categories.length;
        var visibleOk = model && model.visibleSeries && model.visibleSeries.length;
        var excludedFromVisibleGate = fields.view === 'market' || fields.view === 'timeRibbon' || fields.view === 'tdTermTime' || fields.view === 'slope' || fields.view === 'ladder' || fields.view === 'distribution';
        if (!model || (fields.view === 'market' && !marketOk) || (fields.view === 'timeRibbon' && !timeRibbonOk) || (fields.view === 'tdTermTime' && !tdTermTimeOk) || (fields.view === 'slope' && !slopeOk) || (fields.view === 'ladder' && !ladderOk) || (fields.view === 'distribution' && !distOk) || (!excludedFromVisibleGate && !visibleOk)) {
            els.chartSeriesNote.textContent = 'Loading';
            els.chartSeriesList.innerHTML = '<p class="chart-series-empty">No series</p>';
            return;
        }

        var selected = selectionState && Array.isArray(selectionState.selectedSeriesKeys)
            ? selectionState.selectedSeriesKeys
            : [];

        els.chartSeriesNote.textContent = railNote(fields, model);
        if (fields.view === 'timeRibbon' && model.timeRibbon && model.timeRibbon.bankCurves && model.timeRibbon.bankCurves.length) {
            els.chartSeriesList.innerHTML = model.timeRibbon.bankCurves.map(function (curve, index) {
                var lastPoint = curve.points && curve.points.length ? curve.points[curve.points.length - 1] : null;
                var valueText = lastPoint && Number.isFinite(lastPoint.value) ? chartConfig.formatMetricValue(fields.yField, lastPoint.value) : '-';
                return seriesCardMarkup({
                    key: curve.bankName,
                    title: curve.bankName,
                    valueText: valueText,
                    caption: model.timeRibbon.termLabel + ' term',
                    metaLeft: (curve.points && curve.points.length) + ' dates',
                    metaRight: '',
                    isSelected: false,
                    isSpotlight: false,
                    color: pal[index % pal.length],
                });
            }).join('');
            return;
        }
        if (fields.view === 'tdTermTime' && model.tdTermTime) {
            els.chartSeriesList.innerHTML = model.tdTermTime.terms.map(function (t, index) {
                return seriesCardMarkup({
                    key: t.termKey,
                    title: t.termLabel,
                    valueText: (t.timeRibbon && t.timeRibbon.categories && t.timeRibbon.categories.length) ? (t.timeRibbon.categories.length + ' dates') : '-',
                    caption: 'Ribbon over time',
                    metaLeft: '',
                    metaRight: '',
                    isSelected: false,
                    isSpotlight: false,
                    color: pal[index % pal.length],
                });
            }).join('');
            return;
        }
        if (fields.view === 'slope' && model.slope && model.slope.lines.length) {
            els.chartSeriesList.innerHTML = model.slope.lines.map(function (line, index) {
                var deltaStr = Number.isFinite(line.delta) ? (line.delta >= 0 ? '+' : '') + chartConfig.formatMetricValue(fields.yField, line.delta) : '';
                return seriesCardMarkup({
                    key: line.key,
                    title: line.name,
                    valueText: chartConfig.formatMetricValue(fields.yField, line.valueRight),
                    caption: model.slope.dateLeftLabel + ' \u2192 ' + model.slope.dateRightLabel,
                    metaLeft: deltaStr,
                    metaRight: '',
                    isSelected: false,
                    isSpotlight: false,
                    color: pal[index % pal.length],
                });
            }).join('');
            return;
        }
        if (fields.view === 'ladder' && model.lenderRanking && model.lenderRanking.entries.length) {
            els.chartSeriesList.innerHTML = model.lenderRanking.entries.map(function (entry, index) {
                var isSelected = selected.indexOf(entry.seriesKey) >= 0;
                var isSpotlight = selectionState && selectionState.spotlightSeriesKey === entry.seriesKey;
                return seriesCardMarkup({
                    key: entry.seriesKey,
                    title: (entry.rank != null ? entry.rank + '. ' : '') + chartConfig.formatFieldValue('bank_name', entry.bankName, entry.row || null),
                    valueText: chartConfig.formatMetricValue(fields.yField, entry.value),
                    caption: entry.productName || 'Best matching product',
                    metaLeft: entry.latestDate ? chartConfig.formatFieldValue('collection_date', entry.latestDate, entry.row || null) : 'Latest',
                    metaRight: entry.pointCount.toLocaleString() + ' pts',
                    isSelected: isSelected,
                    isSpotlight: isSpotlight,
                    color: pal[index % pal.length],
                });
            }).join('');
            return;
        }
        if (fields.view === 'homeLoanReport' && model.lenderRanking && model.lenderRanking.entries.length) {
            els.chartSeriesList.innerHTML = model.lenderRanking.entries.map(function (entry, index) {
                var isSelected = selected.indexOf(entry.seriesKey) >= 0;
                var isSpotlight = selectionState && selectionState.spotlightSeriesKey === entry.seriesKey;
                return seriesCardMarkup({
                    key: entry.seriesKey,
                    title: chartConfig.formatFieldValue('bank_name', entry.bankName, entry.row || null),
                    valueText: chartConfig.formatMetricValue(fields.yField, entry.value),
                    caption: entry.productName || 'Selected comparison product',
                    metaLeft: entry.latestDate ? chartConfig.formatFieldValue('collection_date', entry.latestDate, entry.row || null) : 'Latest',
                    metaRight: entry.pointCount.toLocaleString() + ' pts',
                    isSelected: isSelected,
                    isSpotlight: isSpotlight,
                    color: pal[index % pal.length],
                });
            }).join('') +
            '<div class="chart-series-card secondary is-reference" style="--series-accent:#f59e0b;" role="listitem">' +
                '<span class="chart-series-topline">' +
                    '<span class="chart-series-name-wrap">' +
                        '<span class="chart-series-swatch" aria-hidden="true"></span>' +
                        '<span class="chart-series-name">RBA</span>' +
                    '</span>' +
                    '<span class="chart-series-value">Reference</span>' +
                '</span>' +
                '<span class="chart-series-caption">Cash rate is always shown</span>' +
            '</div>' +
            '<div class="chart-series-card secondary is-reference" style="--series-accent:#dc2626;" role="listitem">' +
                '<span class="chart-series-topline">' +
                    '<span class="chart-series-name-wrap">' +
                        '<span class="chart-series-swatch" aria-hidden="true"></span>' +
                        '<span class="chart-series-name">CPI</span>' +
                    '</span>' +
                    '<span class="chart-series-value">Reference</span>' +
                '</span>' +
                '<span class="chart-series-caption">Annual inflation is always shown</span>' +
            '</div>' +
            economicOverlayReferenceCards(selectionState);
            return;
        }
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
                    color: pal[index % pal.length],
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
                    color: pal[index % pal.length],
                });
            }).join('');
            return;
        }
        if (fields.view === 'distribution' && model.distribution && model.distribution.categories && model.distribution.categories.length) {
            els.chartSeriesList.innerHTML = model.distribution.categories.map(function (cat, index) {
                var meanV = model.distribution.means && model.distribution.means[index];
                var cnt = model.distribution.counts && model.distribution.counts[index];
                var valueText = Number.isFinite(meanV) ? chartConfig.formatMetricValue(fields.yField, meanV) : '-';
                var metaLeft = cnt != null ? Number(cnt).toLocaleString() + ' observations' : '';
                return '' +
                    '<div class="chart-series-card secondary" style="--series-accent:' + esc(pal[index % pal.length]) + ';" role="listitem">' +
                        '<span class="chart-series-topline">' +
                            '<span class="chart-series-name-wrap">' +
                                '<span class="chart-series-swatch" aria-hidden="true"></span>' +
                                '<span class="chart-series-name">' + esc(cat || '-') + '</span>' +
                            '</span>' +
                            '<span class="chart-series-value">' + esc(valueText) + '</span>' +
                        '</span>' +
                        '<span class="chart-series-caption">' + esc(chartConfig.fieldLabel(fields.groupField || 'bank_name')) + ' group</span>' +
                        '<span class="chart-series-meta">' +
                            '<span class="chart-series-delta"></span>' +
                            '<span class="chart-series-points">' + esc(metaLeft) + '</span>' +
                        '</span>' +
                    '</div>';
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
                color: pal[series.colorIndex % pal.length],
            });
        }).join('') + economicOverlayReferenceCards(selectionState);
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
        var lenderEntry = (fields.view === 'lenders' || fields.view === 'homeLoanReport') && model.lenderRanking ? model.lenderRanking.activeEntry : null;
        var row = spotlight.row || {};
        var title = lenderEntry
            ? chartConfig.formatFieldValue('bank_name', lenderEntry.bankName, lenderEntry.row || null)
            : spotlight.series.name;
        var subtitle = lenderEntry
            ? (fields.view === 'homeLoanReport' ? 'Selected comparison product' : 'Best current ' + chartConfig.fieldLabel(fields.yField).toLowerCase())
            : (spotlight.series.subtitle || 'product_key');
        els.chartPointDetails.hidden = false;
        els.chartPointDetails.innerHTML = '' +
            '<div class="chart-spotlight-card">' +
                '<div class="chart-spotlight-copy">' +
                    '<p class="chart-series-kicker">' + esc(lenderEntry ? (fields.view === 'homeLoanReport' ? 'Comparison spotlight' : 'Lender spotlight') : 'Series spotlight') + '</p>' +
                    '<strong>' + esc(title) + '</strong>' +
                    '<span class="chart-spotlight-subtitle">' + esc(subtitle) + '</span>' +
                '</div>' +
                '<div class="chart-spotlight-metrics">' +
                    '<span class="chart-summary-pill is-emphasis">' + esc(chartConfig.formatMetricValue(fields.yField, spotlight.value)) + '</span>' +
                    '<span class="chart-summary-pill">' + esc(chartConfig.formatFieldValue('collection_date', spotlight.date, row)) + '</span>' +
                    '<span class="chart-summary-pill">' + esc(spotlight.series.pointCount.toLocaleString()) + ' observations</span>' +
                    (lenderEntry ? '<span class="chart-summary-pill is-config">' + esc(fields.view === 'homeLoanReport' ? 'Product tracked for this bank' : 'Best product by bank') + '</span>' : '') +
                '</div>' +
                '<div class="chart-spotlight-grid">' +
                    spotlightField('Bank', chartConfig.formatFieldValue('bank_name', row.bank_name || '-', row)) +
                    spotlightField('Product', row.product_name || '-') +
                    spotlightField('Delta', Number.isFinite(Number(spotlight.series.delta)) ? chartConfig.formatMetricValue(fields.yField, spotlight.series.delta) : '-') +
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
        setCanvasPlaceholder('Chart syncs with filters and options.');
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

        initChartEngineFromStorage();
        renderEconomicOverlayPicker();

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
        syncControlAvailability(activeView());

        document.querySelectorAll('[data-chart-engine]').forEach(function (btn) {
            btn.addEventListener('click', function (event) {
                var b = event.currentTarget;
                var next = b ? String(b.getAttribute('data-chart-engine') || 'echarts') : 'echarts';
                setActiveChartEngine(next);
                controlHandler('chart-engine');
            });
        });

        [els.chartX, els.chartY, els.chartGroup, els.chartType, els.chartSeriesLimit, els.chartRepresentation].forEach(function (control) {
            if (!control) return;
            control.addEventListener('change', function () {
                controlHandler(control === els.chartRepresentation ? 'representation' : 'advanced');
            });
        });

        if (els.chartEconomicOverlayOptions) {
            els.chartEconomicOverlayOptions.addEventListener('change', function (event) {
                var input = event.target;
                if (!input || !input.matches || !input.matches('input[type="checkbox"][data-economic-series-id]')) return;
                var ids = selectedEconomicOverlayIds();
                if (economicOverlays.saveSelectedIds) economicOverlays.saveSelectedIds(ids);
                updateEconomicOverlaySummary();
                controlHandler('economic-overlay');
            });
        }

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
        initChartEngineFromStorage: initChartEngineFromStorage,
        setActiveChartEngine: setActiveChartEngine,
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
