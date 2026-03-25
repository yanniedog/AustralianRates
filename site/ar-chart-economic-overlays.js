(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config || {};
    var network = window.AR.network || {};
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;
    var STORAGE_KEY_PREFIX = 'ar.economicOverlays.';
    var OVERLAY_VIEWS = {
        compare: true,
        economicReport: true,
        homeLoanReport: true,
        termDepositReport: true,
    };
    var SERIES_COLORS = {
        unemployment_rate: '#f97316',
        participation_rate: '#0ea5e9',
        trimmed_mean_cpi: '#14b8a6',
        inflation_expectations: '#a78bfa',
        neutral_rate: '#84cc16',
        bank_bill_90d: '#ec4899',
        household_consumption: '#f59e0b',
        wage_growth: '#ef4444',
        housing_credit_growth: '#22c55e',
        dwelling_approvals: '#38bdf8',
        rbnz_ocr: '#fb7185',
        major_bank_lending_rates: '#06b6d4',
        major_trading_partner_growth_proxy: '#8b5cf6',
        capacity_utilisation_proxy: '#f43f5e',
        aud_twi: '#10b981',
        business_conditions: '#64748b',
        consumer_sentiment: '#60a5fa',
        public_demand: '#eab308',
        commodity_prices: '#f97316',
        fed_funds_proxy: '#f472b6',
    };
    var FALLBACK_COLORS = ['#f97316', '#14b8a6', '#a78bfa', '#84cc16', '#ec4899', '#0ea5e9', '#eab308', '#ef4444'];

    var catalogPromise = null;
    var catalogSnapshot = null;
    var seriesCache = new Map();

    function sectionKey() {
        return (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    }

    function storageKey() {
        return STORAGE_KEY_PREFIX + sectionKey();
    }

    function originFromApiBase() {
        var base = String((config && config.apiBase) || '').trim();
        try {
            return new URL(base || window.location.origin, window.location.origin).origin;
        } catch (_err) {
            return window.location.origin;
        }
    }

    function apiBase() {
        return originFromApiBase() + '/api/economic-data';
    }

    function splitCsv(value) {
        return String(value || '')
            .split(',')
            .map(function (item) { return item.trim(); })
            .filter(Boolean);
    }

    function uniqueIds(ids) {
        var seen = {};
        return (Array.isArray(ids) ? ids : []).filter(function (id) {
            var key = String(id || '').trim();
            if (!key || seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function loadSelectedIds() {
        try {
            return uniqueIds(splitCsv(localStorage.getItem(storageKey()) || ''));
        } catch (_err) {
            return [];
        }
    }

    function saveSelectedIds(ids) {
        var next = uniqueIds(ids);
        try {
            localStorage.setItem(storageKey(), next.join(','));
        } catch (_err) { /* ignore */ }
        return next;
    }

    function isSupportedView(view) {
        return !!OVERLAY_VIEWS[String(view || '')];
    }

    function colorForSeries(id, index) {
        return SERIES_COLORS[id] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    }

    function fetchJson(url, label) {
        if (requestJson) {
            return requestJson(url, {
                requestLabel: label,
                timeoutMs: 15000,
                retryCount: 0,
            }).then(function (result) {
                return result && result.data ? result.data : result;
            });
        }
        var nextUrl = (window.AR.network && window.AR.network.appendCacheBust)
            ? window.AR.network.appendCacheBust(url)
            : url;
        return fetch(nextUrl, { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        });
    }

    function flattenCatalog(catalog) {
        var rows = [];
        (catalog && catalog.categories || []).forEach(function (category) {
            (category.series || []).forEach(function (series) {
                rows.push(Object.assign({ category_label: category.label || category.id || '' }, series));
            });
        });
        return rows;
    }

    function indexCatalog(catalog) {
        var byId = {};
        flattenCatalog(catalog).forEach(function (series) {
            byId[String(series.id || '')] = series;
        });
        return byId;
    }

    function fetchCatalog() {
        if (catalogSnapshot) return Promise.resolve(catalogSnapshot);
        if (catalogPromise) return catalogPromise;
        catalogPromise = fetchJson(apiBase() + '/catalog', 'Economic overlay catalog')
            .then(function (catalog) {
                catalogSnapshot = Object.assign({}, catalog || {}, {
                    byId: indexCatalog(catalog || {}),
                });
                return catalogSnapshot;
            })
            .finally(function () {
                catalogPromise = null;
            });
        return catalogPromise;
    }

    function getCatalogSnapshot() {
        return catalogSnapshot;
    }

    function seriesMeta(id) {
        var snapshot = getCatalogSnapshot();
        return snapshot && snapshot.byId ? snapshot.byId[id] || null : null;
    }

    function selectionSummary(ids) {
        var list = uniqueIds(ids);
        if (!list.length) return 'None';
        if (list.length === 1) {
            var meta = seriesMeta(list[0]);
            return meta && meta.short_label ? meta.short_label : list[0];
        }
        return list.length + ' selected';
    }

    function fetchSeries(ids, startDate, endDate) {
        var list = uniqueIds(ids);
        if (!list.length) return Promise.resolve([]);
        var cacheKey = list.join(',') + '|' + String(startDate || '') + '|' + String(endDate || '');
        if (seriesCache.has(cacheKey)) return seriesCache.get(cacheKey);
        var url = apiBase() + '/series?ids=' + encodeURIComponent(list.join(',')) +
            '&start_date=' + encodeURIComponent(startDate) +
            '&end_date=' + encodeURIComponent(endDate);
        var promise = fetchJson(url, 'Economic overlay series')
            .then(function (payload) {
                return Array.isArray(payload && payload.series) ? payload.series : [];
            })
            .catch(function (error) {
                seriesCache.delete(cacheKey);
                throw error;
            });
        seriesCache.set(cacheKey, promise);
        return promise;
    }

    function normalizeWindowPoints(points, startDate, endDate) {
        var baseline = null;
        var baselineDate = null;
        var rows = [];
        (Array.isArray(points) ? points : []).forEach(function (point) {
            var date = String(point && point.date || '');
            if (!date || (startDate && date < startDate) || (endDate && date > endDate)) return;
            var raw = Number(point && point.raw_value);
            if (!Number.isFinite(raw)) {
                rows.push({
                    date: date,
                    raw_value: null,
                    normalized_value: null,
                    observation_date: point && point.observation_date ? point.observation_date : null,
                    release_date: point && point.release_date ? point.release_date : null,
                });
                return;
            }
            if (baseline == null) {
                baseline = raw;
                baselineDate = date;
            }
            rows.push({
                date: date,
                raw_value: raw,
                normalized_value: baseline == null || baseline === 0 ? null : Number(((raw / baseline) * 100).toFixed(3)),
                observation_date: point && point.observation_date ? point.observation_date : null,
                release_date: point && point.release_date ? point.release_date : null,
            });
        });
        return {
            baselineDate: baselineDate,
            baselineValue: baseline,
            points: rows,
        };
    }

    function latestFinitePoint(points) {
        var latest = null;
        (Array.isArray(points) ? points : []).forEach(function (point) {
            if (!point || !Number.isFinite(Number(point.raw_value))) return;
            latest = point;
        });
        return latest;
    }

    function prepareWindowSeries(seriesRows, startDate, endDate) {
        return uniqueIds((seriesRows || []).map(function (series) { return series && series.id; }))
            .map(function (id, index) {
                var source = (seriesRows || []).find(function (series) { return series && series.id === id; });
                if (!source) return null;
                var normalized = normalizeWindowPoints(source.points || [], startDate, endDate);
                var meta = seriesMeta(id) || {};
                var latest = latestFinitePoint(normalized.points);
                return {
                    id: id,
                    label: source.label || meta.label || id,
                    shortLabel: source.short_label || meta.short_label || source.label || id,
                    unit: source.unit || meta.unit || '',
                    proxy: !!(source.proxy || meta.proxy),
                    color: colorForSeries(id, index),
                    baselineDate: normalized.baselineDate,
                    baselineValue: normalized.baselineValue,
                    latestPoint: latest,
                    points: normalized.points,
                };
            })
            .filter(function (series) {
                return !!series &&
                    Array.isArray(series.points) &&
                    series.points.some(function (point) { return Number.isFinite(Number(point.normalized_value)); });
            });
    }

    function overlayStatusNote(ids, view) {
        var list = uniqueIds(ids);
        if (!list.length) return '';
        if (isSupportedView(view)) return 'Economic overlays indexed to 100 in the visible history window.';
        return 'Economic overlays are available in Rate Report and Compare views.';
    }

    window.AR.chartEconomicOverlays = {
        apiBase: apiBase,
        colorForSeries: colorForSeries,
        fetchCatalog: fetchCatalog,
        fetchSeries: fetchSeries,
        getCatalogSnapshot: getCatalogSnapshot,
        getSelectedIds: loadSelectedIds,
        getSeriesMeta: seriesMeta,
        isSupportedView: isSupportedView,
        overlayStatusNote: overlayStatusNote,
        prepareWindowSeries: prepareWindowSeries,
        saveSelectedIds: saveSelectedIds,
        selectionSummary: selectionSummary,
    };
})();
