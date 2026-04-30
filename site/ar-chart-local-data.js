(function () {
    'use strict';
    window.AR = window.AR || {};

    var CHART_WINDOWS = ['30D', '90D', '180D', '1Y', 'ALL'];
    var WINDOW_DAYS = { '30D': 30, '90D': 90, '180D': 180, '1Y': 365 };
    var cache = {
        analytics: {},
        latest: {},
        report: {},
    };

    function sectionName() {
        return String((window.AR && window.AR.section) || 'home-loans');
    }

    function snapshotApi() {
        return window.AR && window.AR.snapshot ? window.AR.snapshot : null;
    }

    function normalizeText(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeLower(value) {
        return normalizeText(value).toLowerCase();
    }

    function normalizeChartWindow(value) {
        var next = normalizeText(value).toUpperCase();
        return CHART_WINDOWS.indexOf(next) >= 0 ? next : '';
    }

    function normalizePreset(value) {
        var next = normalizeLower(value);
        return next === 'consumer-default' ? next : '';
    }

    function chartWindowRank(value) {
        return CHART_WINDOWS.indexOf(normalizeChartWindow(value));
    }

    function stableQuery(params, ignoreKeys) {
        var ignored = {};
        (ignoreKeys || []).forEach(function (key) {
            ignored[String(key)] = true;
        });
        var entries = [];
        Object.keys(params || {}).forEach(function (key) {
            if (ignored[key]) return;
            var value = params[key];
            if (value == null) return;
            var text = normalizeText(value);
            if (!text) return;
            entries.push([String(key), text]);
        });
        entries.sort(function (left, right) {
            if (left[0] === right[0]) return left[1].localeCompare(right[1]);
            return left[0].localeCompare(right[0]);
        });
        return entries.map(function (entry) {
            return entry[0] + '=' + entry[1];
        }).join('&');
    }

    function cacheKey(kind, scope, params, extra) {
        return [kind, scope || 'none', extra || '', stableQuery(params)].join('::');
    }

    function isDefaultLikeParam(key, value) {
        var text = normalizeLower(value);
        if (!text) return true;
        if (key === 'min_rate' && Number(text) === 0.01) return true;
        if (key === 'mode' && text === 'all') return true;
        if (key === 'representation' && text === 'day') return true;
        if (key === 'sort' && text === 'collection_date') return true;
        if (key === 'dir' && text === 'asc') return true;
        if (key === 'include_removed' && text !== 'true') return true;
        if (key === 'include_manual' && text !== 'true') return true;
        if (key === 'exclude_compare_edge_cases' && text !== '0' && text !== 'false' && text !== 'no' && text !== 'off') return true;
        if (sectionName() === 'savings' && key === 'account_type' && text === 'savings') return true;
        return false;
    }

    function hasSelectiveFilters(params) {
        var selective = false;
        Object.keys(params || {}).forEach(function (key) {
            if (selective) return;
            if (key === 'chart_window' || key === 'preset' || key === 'mode') return;
            if (isDefaultLikeParam(key, params[key])) return;
            selective = true;
        });
        return selective;
    }

    function samePreset(bundle, preset) {
        return normalizePreset(bundle && bundle.preset) === normalizePreset(preset);
    }

    function listBundles() {
        var snap = snapshotApi();
        if (!snap || typeof snap.listBundles !== 'function') return [];
        return snap.listBundles();
    }

    function hasDataKey(bundle, key) {
        return !!(bundle && bundle.data && bundle.data[key] != null);
    }

    /** True when `analyticsSeries` would expand to at least one row (avoids treating empty snapshot stubs as a hit). */
    function bundleHasRenderableAnalytics(bundle) {
        if (!bundle || !bundle.data || bundle.data.analyticsSeries == null) return false;
        var payload = bundle.data.analyticsSeries;
        if (typeof payload !== 'object') return false;
        if (Array.isArray(payload.rows) && payload.rows.length > 0) return true;
        if (
            payload.rows_format === 'grouped_v1'
            && payload.grouped_rows
            && Array.isArray(payload.grouped_rows.groups)
            && payload.grouped_rows.groups.length > 0
        ) {
            return true;
        }
        return false;
    }

    function bundleHasRenderableLatestAll(bundle) {
        if (!bundle || !bundle.data || bundle.data.latestAll == null) return false;
        var block = bundle.data.latestAll;
        return !!(block && typeof block === 'object' && Array.isArray(block.rows) && block.rows.length > 0);
    }

    function exactBundle(chartWindow, preset, key) {
        var snap = snapshotApi();
        var bundle = snap && typeof snap.getBundle === 'function'
            ? snap.getBundle(chartWindow || null, preset || null)
            : null;
        return hasDataKey(bundle, key) ? bundle : null;
    }

    function coveringAnalyticsBundle(chartWindow, preset) {
        var targetRank = chartWindowRank(chartWindow);
        return listBundles().filter(function (bundle) {
            if (!samePreset(bundle, preset) || !bundleHasRenderableAnalytics(bundle)) return false;
            if (targetRank < 0) return true;
            return chartWindowRank(bundle.chartWindow) >= targetRank;
        }).sort(function (left, right) {
            var leftRank = chartWindowRank(left.chartWindow);
            var rightRank = chartWindowRank(right.chartWindow);
            if (leftRank !== rightRank) return leftRank - rightRank;
            if (!!left.full !== !!right.full) return left.full ? -1 : 1;
            return Number(right.loadedAt || 0) - Number(left.loadedAt || 0);
        })[0] || null;
    }

    function latestBundle(preset) {
        return listBundles().filter(function (bundle) {
            return samePreset(bundle, preset) && bundleHasRenderableLatestAll(bundle);
        }).sort(function (left, right) {
            if (!!left.full !== !!right.full) return left.full ? -1 : 1;
            return Number(right.loadedAt || 0) - Number(left.loadedAt || 0);
        })[0] || null;
    }

    function expandAnalyticsRows(bundle) {
        if (!bundle || !bundle.data || !bundle.data.analyticsSeries) return [];
        if (bundle.__expandedAnalyticsRows) return bundle.__expandedAnalyticsRows;
        var payload = bundle.data.analyticsSeries;
        var rows = Array.isArray(payload.rows) ? payload.rows.slice() : [];
        if (!rows.length && payload.rows_format === 'grouped_v1' && payload.grouped_rows && Array.isArray(payload.grouped_rows.groups)) {
            payload.grouped_rows.groups.forEach(function (group) {
                var meta = group && group.meta && typeof group.meta === 'object' ? group.meta : {};
                (group && Array.isArray(group.points) ? group.points : []).forEach(function (point) {
                    var row = {};
                    Object.keys(meta).forEach(function (key) { row[key] = meta[key]; });
                    Object.keys(point || {}).forEach(function (key) { row[key] = point[key]; });
                    rows.push(row);
                });
            });
        }
        bundle.__expandedAnalyticsRows = rows;
        return rows;
    }

    function shiftDate(dateText, dayDelta) {
        if (!normalizeText(dateText)) return '';
        var next = new Date(String(dateText) + 'T12:00:00Z');
        if (Number.isNaN(next.getTime())) return '';
        next.setUTCDate(next.getUTCDate() + Number(dayDelta || 0));
        return next.toISOString().slice(0, 10);
    }

    function maxDate(rows) {
        var latest = '';
        (rows || []).forEach(function (row) {
            var date = String(row && row.collection_date || '').slice(0, 10);
            if (date && (!latest || date > latest)) latest = date;
        });
        return latest;
    }

    function resolveDateBounds(rows, params) {
        var endDate = normalizeText(params && params.end_date) || maxDate(rows);
        var startDate = normalizeText(params && params.start_date);
        if (!startDate) {
            var chartWindow = normalizeChartWindow(params && params.chart_window);
            var days = WINDOW_DAYS[chartWindow] || 0;
            if (days > 0 && endDate) startDate = shiftDate(endDate, 1 - days);
        }
        return { startDate: startDate, endDate: endDate };
    }

    function csvSet(value) {
        var map = {};
        normalizeText(value).split(',').filter(Boolean).forEach(function (entry) {
            map[normalizeLower(entry)] = true;
        });
        return map;
    }

    function csvMatch(value, selected) {
        if (!selected || !Object.keys(selected).length) return true;
        return !!selected[normalizeLower(value)];
    }

    function numeric(value) {
        var next = Number(value);
        return Number.isFinite(next) ? next : null;
    }

    function rowMinBalance(row) {
        return numeric(row && (row.balance_min != null ? row.balance_min : row.min_deposit));
    }

    function rowMaxBalance(row) {
        return numeric(row && (row.balance_max != null ? row.balance_max : row.max_deposit));
    }

    function filterRows(rows, params, options) {
        var opts = options || {};
        var bounds = opts.ignoreDate ? { startDate: '', endDate: '' } : resolveDateBounds(rows, params || {});
        var filters = {
            banks: csvSet(params && (params.banks || params.bank)),
            security_purpose: csvSet(params && params.security_purpose),
            repayment_type: csvSet(params && params.repayment_type),
            rate_structure: csvSet(params && params.rate_structure),
            lvr_tier: csvSet(params && params.lvr_tier),
            feature_set: csvSet(params && params.feature_set),
            account_type: csvSet(params && params.account_type),
            rate_type: csvSet(params && params.rate_type),
            deposit_tier: csvSet(params && params.deposit_tier),
            interest_payment: csvSet(params && params.interest_payment),
            term_months: csvSet(params && params.term_months),
        };
        var minRate = numeric(params && params.min_rate);
        var maxRate = numeric(params && params.max_rate);
        var minCompare = numeric(params && params.min_comparison_rate);
        var maxCompare = numeric(params && params.max_comparison_rate);
        var balanceMin = numeric(params && params.balance_min);
        var balanceMax = numeric(params && params.balance_max);
        var includeRemoved = normalizeLower(params && params.include_removed) === 'true';

        return (rows || []).filter(function (row) {
            var rowDate = String(row && row.collection_date || '').slice(0, 10);
            if (!opts.ignoreDate) {
                if (bounds.startDate && rowDate && rowDate < bounds.startDate) return false;
                if (bounds.endDate && rowDate && rowDate > bounds.endDate) return false;
            }
            if (!includeRemoved && row && row.is_removed) return false;
            if (!csvMatch(row && row.bank_name, filters.banks)) return false;
            if (!csvMatch(row && row.security_purpose, filters.security_purpose)) return false;
            if (!csvMatch(row && row.repayment_type, filters.repayment_type)) return false;
            if (!csvMatch(row && row.rate_structure, filters.rate_structure)) return false;
            if (!csvMatch(row && row.lvr_tier, filters.lvr_tier)) return false;
            if (!csvMatch(row && row.feature_set, filters.feature_set)) return false;
            if (!csvMatch(row && row.account_type, filters.account_type)) return false;
            if (!csvMatch(row && row.rate_type, filters.rate_type)) return false;
            if (!csvMatch(row && row.deposit_tier, filters.deposit_tier)) return false;
            if (!csvMatch(row && row.interest_payment, filters.interest_payment)) return false;
            if (!csvMatch(row && row.term_months, filters.term_months)) return false;
            if (minRate != null && numeric(row && row.interest_rate) != null && Number(row.interest_rate) < minRate) return false;
            if (maxRate != null && numeric(row && row.interest_rate) != null && Number(row.interest_rate) > maxRate) return false;
            if (minCompare != null && numeric(row && row.comparison_rate) != null && Number(row.comparison_rate) < minCompare) return false;
            if (maxCompare != null && numeric(row && row.comparison_rate) != null && Number(row.comparison_rate) > maxCompare) return false;
            if (balanceMin != null || balanceMax != null) {
                var rowMin = rowMinBalance(row);
                var rowMax = rowMaxBalance(row);
                if (balanceMin != null && rowMax != null && rowMax < balanceMin) return false;
                if (balanceMax != null && rowMin != null && rowMin > balanceMax) return false;
            }
            return true;
        });
    }

    function buildBands(rows, params) {
        var byBank = {};
        rows.forEach(function (row) {
            var bank = normalizeText(row && row.bank_name) || 'Unknown';
            var date = String(row && row.collection_date || '').slice(0, 10);
            var rate = numeric(row && row.interest_rate);
            if (!date || rate == null) return;
            if (!byBank[bank]) byBank[bank] = {};
            if (!byBank[bank][date]) byBank[bank][date] = [];
            byBank[bank][date].push(rate);
        });
        return {
            mode: 'bands',
            meta: {
                section: sectionName().replace(/-/g, '_'),
                mode: 'bands',
                start_date: normalizeText(params && params.start_date) || '',
                end_date: normalizeText(params && params.end_date) || '',
                chart_window: normalizeChartWindow(params && params.chart_window) || null,
                resolved_term_months: normalizeText(params && params.term_months) || null,
            },
            series: Object.keys(byBank).sort(function (left, right) {
                return left.localeCompare(right);
            }).map(function (bankName) {
                return {
                    bank_name: bankName,
                    color_key: normalizeLower(bankName).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
                    points: Object.keys(byBank[bankName]).sort(function (left, right) {
                        return left.localeCompare(right);
                    }).map(function (date) {
                        var values = byBank[bankName][date].slice().sort(function (left, right) { return left - right; });
                        var sum = values.reduce(function (total, value) { return total + value; }, 0);
                        return {
                            date: date,
                            min_rate: values[0],
                            max_rate: values[values.length - 1],
                            mean_rate: values.length ? sum / values.length : null,
                        };
                    }),
                };
            }),
        };
    }

    function buildMoves(rows, params) {
        var totals = {};
        var groups = {};
        rows.forEach(function (row) {
            var key = normalizeText(row && (row.product_key || row.series_key || row.product_id || row.product_name));
            var date = String(row && row.collection_date || '').slice(0, 10);
            if (!key || !date) return;
            if (!groups[key]) groups[key] = [];
            groups[key].push(row);
        });
        Object.keys(groups).forEach(function (key) {
            var points = groups[key].slice().sort(function (left, right) {
                return String(left.collection_date || '').localeCompare(String(right.collection_date || ''));
            });
            var previous = null;
            points.forEach(function (row) {
                var date = String(row.collection_date || '').slice(0, 10);
                var rate = numeric(row.interest_rate);
                if (!date || rate == null) return;
                if (!totals[date]) totals[date] = { date: date, up_count: 0, flat_count: 0, down_count: 0 };
                if (previous == null) totals[date].flat_count += 1;
                else if (rate > previous) totals[date].up_count += 1;
                else if (rate < previous) totals[date].down_count += 1;
                else totals[date].flat_count += 1;
                previous = rate;
            });
        });
        return {
            mode: 'moves',
            meta: {
                section: sectionName().replace(/-/g, '_'),
                mode: 'moves',
                start_date: normalizeText(params && params.start_date) || '',
                end_date: normalizeText(params && params.end_date) || '',
                chart_window: normalizeChartWindow(params && params.chart_window) || null,
                resolved_term_months: normalizeText(params && params.term_months) || null,
            },
            points: Object.keys(totals).sort(function (left, right) {
                return left.localeCompare(right);
            }).map(function (date) {
                return totals[date];
            }),
        };
    }

    function ensureFullScope(chartWindow, preset) {
        var snap = snapshotApi();
        if (!snap || typeof snap.ensureFullScope !== 'function') return Promise.resolve(null);
        return snap.ensureFullScope({ chartWindow: chartWindow || null, preset: preset || null }).then(function () {
            return true;
        }).catch(function () {
            return null;
        });
    }

    function buildAnalyticsResponse(bundle, params) {
        var key = cacheKey('analytics', bundle && bundle.scope, params);
        if (!cache.analytics[key]) {
            cache.analytics[key] = {
                bundle: bundle,
                data: {
                    rows: filterRows(expandAnalyticsRows(bundle), params || {}, { ignoreDate: false }),
                    total: 0,
                    representation: 'day',
                    requested_representation: 'day',
                    fallback_reason: '',
                    rows_format: 'flat',
                },
            };
            cache.analytics[key].data.total = cache.analytics[key].data.rows.length;
        }
        return cache.analytics[key].data;
    }

    function canUseExactReportPayload(params) {
        return !hasSelectiveFilters(params || {});
    }

    function getAnalyticsRows(params) {
        if (params && params._bypassSnapshot) return Promise.resolve(null);
        var chartWindow = normalizeChartWindow(params && params.chart_window);
        var preset = normalizePreset(params && params.preset);
        var bundle = coveringAnalyticsBundle(chartWindow, preset);
        if (bundle) return Promise.resolve(buildAnalyticsResponse(bundle, params || {}));
        return ensureFullScope(chartWindow, preset).then(function () {
            var nextBundle = coveringAnalyticsBundle(chartWindow, preset);
            return nextBundle ? buildAnalyticsResponse(nextBundle, params || {}) : null;
        });
    }

    function getLatestPreviewRows(params) {
        var baseParams = {};
        Object.keys(params || {}).forEach(function (key) {
            if (key === 'chart_window' || key === 'start_date' || key === 'end_date' || key === 'representation' || key === 'sort' || key === 'dir' || key === 'limit') return;
            baseParams[key] = params[key];
        });
        var preset = normalizePreset(params && params.preset);
        var exact = latestBundle(preset);
        var readRows = function (bundle) {
            if (!bundle) return null;
            var key = cacheKey('latest', bundle.scope, baseParams, String(params && params.limit || ''));
            if (!cache.latest[key]) {
                var rows = bundle.data && bundle.data.latestAll && Array.isArray(bundle.data.latestAll.rows)
                    ? bundle.data.latestAll.rows
                    : filterRows(expandAnalyticsRows(bundle), baseParams, { ignoreDate: true }).reduce(function (map, row) {
                        var productKey = normalizeText(row && (row.product_key || row.series_key || row.product_id || row.product_name));
                        var current = productKey ? map[productKey] : null;
                        if (!productKey || !current || String(row.collection_date || '') > String(current.collection_date || '')) {
                            map[productKey] = row;
                        }
                        return map;
                    }, {});
                if (!Array.isArray(rows)) rows = Object.keys(rows).map(function (entry) { return rows[entry]; });
                rows = filterRows(rows, baseParams, { ignoreDate: true });
                rows.sort(function (left, right) {
                    var bankSort = String(left.bank_name || '').localeCompare(String(right.bank_name || ''));
                    if (bankSort !== 0) return bankSort;
                    return String(left.product_name || '').localeCompare(String(right.product_name || ''));
                });
                var limit = Math.max(0, Number(params && params.limit || 0));
                cache.latest[key] = limit > 0 ? rows.slice(0, limit) : rows;
            }
            return cache.latest[key];
        };
        if (exact) return Promise.resolve(readRows(exact));
        var chartWindow = normalizeChartWindow(params && params.chart_window);
        var covering = coveringAnalyticsBundle(chartWindow, preset);
        if (covering) return Promise.resolve(readRows(covering));
        return ensureFullScope(chartWindow, preset).then(function () {
            var nextExact = latestBundle(preset);
            if (nextExact) return readRows(nextExact);
            var nextCovering = coveringAnalyticsBundle(chartWindow, preset);
            return nextCovering ? readRows(nextCovering) : null;
        });
    }

    function getReportPlot(mode, params) {
        var chartWindow = normalizeChartWindow(params && params.chart_window);
        var preset = normalizePreset(params && params.preset);
        var exactKey = mode === 'bands' ? 'reportPlotBands' : 'reportPlotMoves';
        var exact = exactBundle(chartWindow, preset, exactKey);
        if (exact && canUseExactReportPayload(params)) {
            return Promise.resolve(exact.data[exactKey]);
        }
        return getAnalyticsRows(params || {}).then(function (analytics) {
            if (!analytics || !Array.isArray(analytics.rows)) return null;
            var bundle = coveringAnalyticsBundle(chartWindow, preset);
            var key = cacheKey('report', bundle && bundle.scope, params, mode);
            if (!cache.report[key]) {
                cache.report[key] = mode === 'bands'
                    ? buildBands(analytics.rows, params || {})
                    : buildMoves(analytics.rows, params || {});
            }
            return cache.report[key];
        });
    }

    /** Snapshot bundle `slicePairStats`; same scope rules as getReportPlot (exact bundle + no selective filters). */
    function getSlicePairStats(params) {
        var chartWindow = normalizeChartWindow(params && params.chart_window);
        var preset = normalizePreset(params && params.preset);
        var exact = exactBundle(chartWindow, preset, 'slicePairStats');
        if (exact && canUseExactReportPayload(params)) {
            return Promise.resolve(exact.data.slicePairStats || null);
        }
        return Promise.resolve(null);
    }

    function getReportProductHistory(params) {
        var chartWindow = normalizeChartWindow(params && params.chart_window);
        var preset = normalizePreset(params && params.preset);
        var exact = exactBundle(chartWindow, preset, 'reportProductHistory');
        if (exact) return Promise.resolve(exact.data.reportProductHistory || null);
        return ensureFullScope(chartWindow, preset).then(function () {
            var nextBundle = exactBundle(chartWindow, preset, 'reportProductHistory');
            return nextBundle ? (nextBundle.data.reportProductHistory || null) : null;
        });
    }

    window.AR.chartLocalData = {
        getAnalyticsRows: getAnalyticsRows,
        getLatestPreviewRows: getLatestPreviewRows,
        getReportPlot: getReportPlot,
        getSlicePairStats: getSlicePairStats,
        getReportProductHistory: getReportProductHistory,
    };
})();
