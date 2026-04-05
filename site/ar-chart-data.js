(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config || {};
    var chartConfig = window.AR.chartConfig || {};
    var network = window.AR.network || {};
    var apiBase = config.apiBase || '';
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;

    function numericValue(row, field) {
        var num = Number(row && row[field]);
        return Number.isFinite(num) ? num : null;
    }

    function compareDates(left, right) {
        if (left === right) return 0;
        return String(left || '').localeCompare(String(right || ''));
    }

    function sortPoints(points) {
        return points.sort(function (left, right) {
            return compareDates(left.date, right.date);
        });
    }

    function productIdentity(row) {
        if (!row || typeof row !== 'object') return '';
        return String(row.product_key || row.series_key || row.product_id || row.product_name || 'unknown');
    }

    function displayValue(field, row) {
        if (!row) return '';
        return chartConfig.formatFieldValue(field, row[field], row);
    }

    function subtitleParts(row) {
        if (!row) return [];
        return [
            displayValue('term_months', row),
            displayValue('rate_structure', row),
            displayValue('deposit_tier', row),
            displayValue('security_purpose', row),
            displayValue('repayment_type', row),
            displayValue('account_type', row),
            displayValue('rate_type', row),
            displayValue('interest_payment', row),
            displayValue('lvr_tier', row),
            displayValue('feature_set', row),
        ].filter(function (value) {
            return value && value !== '-';
        }).slice(0, 4);
    }

    function seriesName(row) {
        if (!row) return 'Unknown';
        var parts = [row.bank_name ? String(row.bank_name) : ''];
        if (row.product_name) parts.push(String(row.product_name));
        else if (row.term_months != null) parts.push(row.term_months + 'm');
        else parts.push('Unknown product');
        return parts.filter(Boolean).join(' | ');
    }

    function shortText(value, maxLength) {
        var text = String(value || '').trim();
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.slice(0, Math.max(0, maxLength - 1)).trim() + '...';
    }

    function axisLabel(row) {
        return [
            row && row.bank_name ? String(row.bank_name) : '',
            shortText(row && row.product_name ? row.product_name : 'Unknown product', 34),
        ].filter(Boolean).join(' | ');
    }

    function finalizeSeries(entry) {
        var points = sortPoints(entry.points);
        var first = points[0] || null;
        var last = points[points.length - 1] || null;
        return {
            key: entry.key,
            name: seriesName(entry.firstRow),
            axisLabel: axisLabel(entry.firstRow),
            subtitle: subtitleParts(entry.firstRow).join(' | '),
            bankName: entry.firstRow.bank_name || '',
            productName: entry.firstRow.product_name || '',
            latestRow: last ? last.row : entry.firstRow,
            latestDate: last ? last.date : '',
            latestValue: last ? last.value : null,
            delta: first && last ? last.value - first.value : null,
            pointCount: points.length,
            points: points,
        };
    }

    function compareSeries(left, right) {
        var leftValue = Number(left.latestValue);
        var rightValue = Number(right.latestValue);
        if (Number.isFinite(rightValue) && Number.isFinite(leftValue) && rightValue !== leftValue) {
            return rightValue - leftValue;
        }
        if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount;
        return String(left.name).localeCompare(String(right.name));
    }

    function buildSeriesCollection(rows, metricField) {
        var groups = {};
        rows.forEach(function (row) {
            var value = numericValue(row, metricField);
            if (!Number.isFinite(value)) return;
            var key = productIdentity(row);
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    firstRow: row,
                    points: [],
                };
            }
            groups[key].points.push({
                date: String(row.collection_date || ''),
                value: value,
                row: row,
            });
        });

        return Object.keys(groups).map(function (key) {
            return finalizeSeries(groups[key]);
        }).filter(function (entry) {
            return entry.pointCount > 0;
        }).sort(compareSeries);
    }

    function metricDirection(field) {
        return chartConfig.rankDirection ? chartConfig.rankDirection(field) : 'desc';
    }

    function compareMetricValues(left, right, direction) {
        var leftValue = Number(left);
        var rightValue = Number(right);
        if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
            return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
        }
        if (Number.isFinite(leftValue)) return -1;
        if (Number.isFinite(rightValue)) return 1;
        return 0;
    }

    function buildVisibleSeries(allSeries, density, selectionState) {
        var visible = allSeries.slice(0, density.rowLimit);
        var requiredKeys = [];
        if (selectionState && selectionState.spotlightSeriesKey) {
            requiredKeys.push(String(selectionState.spotlightSeriesKey));
        }
        if (selectionState && Array.isArray(selectionState.selectedSeriesKeys)) {
            selectionState.selectedSeriesKeys.forEach(function (key) {
                if (key != null) requiredKeys.push(String(key));
            });
        }

        var requiredMap = {};
        requiredKeys.forEach(function (key) {
            if (!key || requiredMap[key]) return;
            requiredMap[key] = true;
            var present = visible.some(function (series) { return series.key === key; });
            if (present) return;
            var match = allSeries.find(function (series) { return series.key === key; });
            if (match) visible.push(match);
        });

        while (visible.length > density.rowLimit) {
            var removableIndex = visible.length - 1;
            while (removableIndex >= 0 && requiredMap[visible[removableIndex].key]) removableIndex -= 1;
            if (removableIndex < 0) break;
            visible.splice(removableIndex, 1);
        }

        return visible.sort(compareSeries).map(function (series, index) {
            series.colorIndex = index;
            return series;
        });
    }

    function uniqueDates(seriesList) {
        var seen = {};
        seriesList.forEach(function (series) {
            series.points.forEach(function (point) {
                seen[point.date] = true;
            });
        });
        return Object.keys(seen).sort(compareDates);
    }

    /** Return today as YYYY-MM-DD. */
    function todayYmd() {
        return new Date().toISOString().slice(0, 10);
    }

    /** List every day from start (inclusive) to end (inclusive). Dates are YYYY-MM-DD. */
    function allDaysInRange(startDate, endDate) {
        var out = [];
        var d = new Date(startDate + 'T12:00:00Z');
        var end = new Date(endDate + 'T12:00:00Z');
        while (d <= end) {
            out.push(d.toISOString().slice(0, 10));
            d.setUTCDate(d.getUTCDate() + 1);
        }
        return out;
    }

    /** Min and max date from all series points (no extension to today; axis span = first to last snapshot). */
    function dateRangeFromSeries(seriesList) {
        var minDate = null;
        var maxDate = null;
        var today = todayYmd();
        seriesList.forEach(function (series) {
            series.points.forEach(function (point) {
                var d = String(point.date || '');
                if (!d) return;
                if (!minDate || d < minDate) minDate = d;
                if (!maxDate || d > maxDate) maxDate = d;
            });
        });
        if (!minDate || !maxDate) return { minDate: today, maxDate: today };
        return { minDate: minDate, maxDate: maxDate };
    }

    /** X-axis labels = sorted unique snapshot dates so first tick = first snapshot and all snapshots spread over full span. */
    function buildSurfaceModel(seriesList) {
        var xLabels = uniqueDates(seriesList);
        if (!xLabels.length) xLabels = [todayYmd()];
        var indexByDate = {};
        var min = null;
        var max = null;
        var cells = [];

        xLabels.forEach(function (label, index) {
            indexByDate[label] = index;
        });

        seriesList.forEach(function (series, rowIndex) {
            var byDate = {};
            series.points.forEach(function (point) {
                byDate[point.date] = point;
            });

            Object.keys(byDate).forEach(function (dateKey) {
                var point = byDate[dateKey];
                if (!Number.isFinite(point.value)) return;
                if (min == null || point.value < min) min = point.value;
                if (max == null || point.value > max) max = point.value;
                cells.push({
                    value: [indexByDate[dateKey], rowIndex, point.value],
                    seriesKey: series.key,
                    row: point.row,
                    date: dateKey,
                });
            });
        });

        if (min != null && max != null && min === max) max = min + 1;

        return {
            xLabels: xLabels,
            yLabels: seriesList.map(function (series) { return series.axisLabel || series.name; }),
            cells: cells,
            min: min,
            max: max,
        };
    }

    function preferredGroupField(fields) {
        if (fields.groupField && fields.groupField !== 'product_key') return fields.groupField;
        return 'bank_name';
    }

    function quantile(sorted, q) {
        if (!sorted.length) return null;
        if (sorted.length === 1) return sorted[0];
        var position = (sorted.length - 1) * q;
        var base = Math.floor(position);
        var remainder = position - base;
        var lower = sorted[base];
        var upper = sorted[Math.min(sorted.length - 1, base + 1)];
        return lower + (upper - lower) * remainder;
    }

    function buildDistributionModel(rows, fields) {
        var grouped = {};
        var direction = metricDirection(fields.yField);
        rows.forEach(function (row) {
            var value = numericValue(row, fields.yField);
            if (!Number.isFinite(value)) return;
            var keyField = preferredGroupField(fields);
            var key = row[keyField] == null || row[keyField] === ''
                ? 'Unknown'
                : chartConfig.formatFieldValue(keyField, row[keyField], row);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(value);
        });

        var categories = Object.keys(grouped).map(function (name) {
            var values = grouped[name].slice().sort(function (left, right) { return left - right; });
            var total = values.reduce(function (sum, value) { return sum + value; }, 0);
            return {
                name: name,
                count: values.length,
                mean: values.length ? total / values.length : null,
                box: [
                    values[0],
                    quantile(values, 0.25),
                    quantile(values, 0.5),
                    quantile(values, 0.75),
                    values[values.length - 1],
                ],
            };
        }).sort(function (left, right) {
            var metricSort = compareMetricValues(left.mean, right.mean, direction);
            if (metricSort !== 0) return metricSort;
            return right.count - left.count;
        }).slice(0, 10);

        return {
            categories: categories.map(function (entry) { return entry.name; }),
            boxes: categories.map(function (entry) { return entry.box; }),
            means: categories.map(function (entry) { return entry.mean; }),
            counts: categories.map(function (entry) { return entry.count; }),
        };
    }

    function buildLenderRanking(allSeries, fields, density) {
        var direction = metricDirection(fields.yField);
        var grouped = {};

        allSeries.forEach(function (series) {
            var bankName = String(series.bankName || '').trim() || 'Unknown bank';
            if (!grouped[bankName]) grouped[bankName] = [];
            grouped[bankName].push(series);
        });

        var entries = Object.keys(grouped).map(function (bankName) {
            var ranked = grouped[bankName].slice().sort(function (left, right) {
                var metricSort = compareMetricValues(left.latestValue, right.latestValue, direction);
                if (metricSort !== 0) return metricSort;
                if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount;
                return String(left.productName).localeCompare(String(right.productName));
            });
            var bestSeries = ranked[0];
            return {
                key: bankName,
                bankName: bankName,
                seriesKey: bestSeries.key,
                series: bestSeries,
                row: bestSeries.latestRow,
                productName: bestSeries.productName,
                subtitle: bestSeries.subtitle,
                latestDate: bestSeries.latestDate,
                value: bestSeries.latestValue,
                delta: bestSeries.delta,
                pointCount: bestSeries.pointCount,
            };
        }).sort(function (left, right) {
            var metricSort = compareMetricValues(left.value, right.value, direction);
            if (metricSort !== 0) return metricSort;
            if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount;
            return String(left.bankName).localeCompare(String(right.bankName));
        });

        var visibleEntries = entries.slice(0, density.rowLimit).map(function (entry, index) {
            entry.rank = index + 1;
            return entry;
        });
        var min = null;
        var max = null;
        visibleEntries.forEach(function (entry) {
            if (!Number.isFinite(Number(entry.value))) return;
            if (min == null || entry.value < min) min = entry.value;
            if (max == null || entry.value > max) max = entry.value;
        });
        if (min != null && max != null && min === max) max = min + 1;

        return {
            direction: direction,
            totalBanks: entries.length,
            entries: visibleEntries,
            min: min,
            max: max,
        };
    }

    /** Slope graph: two dates (then / now), one line per product showing rate change. Award-winning "who moved" view. */
    function buildSlopeModel(rows, fields, density) {
        var allSeries = buildSeriesCollection(rows, fields.yField);
        var direction = metricDirection(fields.yField);
        var dates = uniqueDates(allSeries);
        if (dates.length < 2) return null;
        var dateNow = dates[dates.length - 1];
        var idxThen = Math.max(0, Math.floor(dates.length * 0.4));
        var dateThen = dates[idxThen];
        if (dateThen === dateNow) return null;

        var byKey = {};
        allSeries.forEach(function (series) {
            var ptThen = series.points.find(function (p) { return p.date === dateThen; });
            var ptNow = series.points.find(function (p) { return p.date === dateNow; });
            if (!ptThen || !ptNow || !Number.isFinite(ptThen.value) || !Number.isFinite(ptNow.value)) return;
            byKey[series.key] = {
                key: series.key,
                name: series.name,
                valueLeft: ptThen.value,
                valueRight: ptNow.value,
                delta: ptNow.value - ptThen.value,
                rowLeft: ptThen.row,
                rowRight: ptNow.row,
            };
        });
        var lines = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) {
            var d = (b.delta || 0) - (a.delta || 0);
            if (d !== 0) return d;
            return String(a.name).localeCompare(String(b.name));
        }).slice(0, density.rowLimit);

        if (!lines.length) return null;
        var minY = null;
        var maxY = null;
        lines.forEach(function (line) {
            [line.valueLeft, line.valueRight].forEach(function (v) {
                if (!Number.isFinite(v)) return;
                if (minY == null || v < minY) minY = v;
                if (maxY == null || v > maxY) maxY = v;
            });
        });
        if (minY != null && maxY != null && minY === maxY) maxY = minY + 1;

        return {
            type: 'slope',
            dateLeft: dateThen,
            dateRight: dateNow,
            dateLeftLabel: chartConfig.formatFieldValue ? chartConfig.formatFieldValue('collection_date', dateThen, null) : dateThen,
            dateRightLabel: chartConfig.formatFieldValue ? chartConfig.formatFieldValue('collection_date', dateNow, null) : dateNow,
            lines: lines,
            min: minY,
            max: maxY,
            metricLabel: chartConfig.fieldLabel ? chartConfig.fieldLabel(fields.yField) : fields.yField,
        };
    }

    function effectiveSelection(visibleSeries, selectedSeriesKeys, compareLimit) {
        var requested = Array.isArray(selectedSeriesKeys) ? selectedSeriesKeys.slice() : [];
        var visibleMap = {};
        visibleSeries.forEach(function (series) {
            visibleMap[series.key] = series;
        });

        var filtered = requested.filter(function (key) {
            return !!visibleMap[key];
        });

        if (!filtered.length) {
            filtered = visibleSeries.slice(0, compareLimit).map(function (series) { return series.key; });
        }

        return filtered.slice(0, compareLimit);
    }

    function spotlightEntry(visibleSeries, selectionState, selectedKeys) {
        var spotlightKey = selectionState && selectionState.spotlightSeriesKey
            ? selectionState.spotlightSeriesKey
            : selectedKeys[0];
        var series = visibleSeries.find(function (entry) { return entry.key === spotlightKey; }) || visibleSeries[0] || null;
        if (!series) return null;

        var explicitDate = selectionState && selectionState.spotlightDate ? String(selectionState.spotlightDate) : '';
        var spotlightPoint = explicitDate
            ? series.points.find(function (point) { return point.date === explicitDate; })
            : null;

        if (!spotlightPoint) spotlightPoint = series.points[series.points.length - 1] || null;

        return {
            series: series,
            row: spotlightPoint ? spotlightPoint.row : series.latestRow,
            date: spotlightPoint ? spotlightPoint.date : series.latestDate,
            value: spotlightPoint ? spotlightPoint.value : series.latestValue,
        };
    }

    function buildChartModel(rows, fields, selectionState) {
        rows = Array.isArray(rows) ? rows : [];
        var today = todayYmd();
        rows = rows.filter(function (row) {
            var date = String(row && row.collection_date || '').slice(0, 10);
            return !date || date <= today;
        });
        var included = selectionState && selectionState.includedRateStructures;
        if (included && Array.isArray(included) && included.length) {
            rows = rows.filter(function (r) {
                return included.indexOf(String(r.rate_structure || '')) >= 0;
            });
        }
        var density = chartConfig.parseDensity(fields.density);
        var allSeries = buildSeriesCollection(rows, fields.yField);
        var visibleSeries = buildVisibleSeries(allSeries, density, selectionState);
        var lenderRanking = buildLenderRanking(allSeries, fields, density);
        var selectedKeys = effectiveSelection(visibleSeries, selectionState && selectionState.selectedSeriesKeys, density.compareLimit);
        var spotlight = spotlightEntry(visibleSeries, selectionState, selectedKeys);
        var marketModule = window.AR.chartMarket || {};
        var market = typeof marketModule.buildModel === 'function'
            ? marketModule.buildModel(rows, fields, selectionState)
            : null;
        var tdCurveFrames = null;
        var tdCurveDates = null;
        if (market && typeof marketModule.buildTdCurveFrames === 'function') {
            var tdFrames = marketModule.buildTdCurveFrames(rows, fields);
            if (tdFrames && tdFrames.frames && tdFrames.frames.length) {
                tdCurveFrames = tdFrames.frames;
                tdCurveDates = tdFrames.dates || [];
            }
        }
        var timeRibbon = null;
        var tdTermTime = null;
        if (fields.view === 'timeRibbon' && marketModule.buildTimeRibbonModel) {
            timeRibbon = marketModule.buildTimeRibbonModel(rows, fields, selectionState);
        }
        if (fields.view === 'tdTermTime' && marketModule.buildTdTermTimeModel) {
            tdTermTime = marketModule.buildTdTermTimeModel(rows, fields);
        }
        var slope = (fields.view === 'slope') ? buildSlopeModel(rows, fields, density) : null;
        lenderRanking.activeEntry = lenderRanking.entries.find(function (entry) {
            return spotlight && spotlight.series && entry.seriesKey === spotlight.series.key;
        }) || lenderRanking.entries[0] || null;

        return {
            meta: {
                totalRows: rows.length,
                totalSeries: allSeries.length,
                visibleSeries: visibleSeries.length,
                visibleLenders: lenderRanking.entries.length,
                totalLenders: lenderRanking.totalBanks,
                densityLabel: density.label,
                renderedCells: visibleSeries.reduce(function (sum, series) { return sum + series.pointCount; }, 0),
                selectedCount: selectedKeys.length,
            },
            lenderRanking: lenderRanking,
            allSeries: allSeries,
            surface: buildSurfaceModel(visibleSeries),
            distribution: buildDistributionModel(rows, fields),
            visibleSeries: visibleSeries,
            selectedKeys: selectedKeys,
            compareSeries: visibleSeries.filter(function (series) {
                return selectedKeys.indexOf(series.key) >= 0;
            }),
            market: market,
            tdCurveFrames: tdCurveFrames,
            tdCurveDates: tdCurveDates,
            timeRibbon: timeRibbon,
            tdTermTime: tdTermTime,
            slope: slope,
            spotlight: spotlight,
        };
    }

    function fetchAnalyticsRows(params) {
        var query = new URLSearchParams(params || {});
        query.set('compact', '1');
        var url = apiBase + '/analytics/series?' + query.toString();
        if (requestJson) {
            return requestJson(url, {
                requestLabel: 'Chart history',
                timeoutMs: 40000,
                retryCount: 0,
            }).then(function (result) {
                return result.data;
            }).catch(function (err) {
                throw err;
            });
        }
        var fetchUrl = (window.AR.network && window.AR.network.appendCacheBust) ? window.AR.network.appendCacheBust(url) : url;
        return fetch(fetchUrl, { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for /analytics/series');
            return response.json();
        });
    }

    function expandGroupedRows(payload) {
        if (!payload || !Array.isArray(payload.groups)) return [];
        var rows = [];
        payload.groups.forEach(function (group) {
            var meta = group && group.meta && typeof group.meta === 'object' ? group.meta : {};
            var points = group && Array.isArray(group.points) ? group.points : [];
            points.forEach(function (point) {
                var row = {};
                Object.keys(meta).forEach(function (key) {
                    row[key] = meta[key];
                });
                Object.keys(point || {}).forEach(function (key) {
                    row[key] = point[key];
                });
                rows.push(row);
            });
        });
        return rows;
    }

    async function fetchAllRateRows(baseParams, onProgress) {
        var response = await fetchAnalyticsRows(baseParams);
        var rows = response && response.rows_format === 'grouped_v1'
            ? expandGroupedRows(response.grouped_rows)
            : (Array.isArray(response.rows) ? response.rows : []);
        var total = Number(response.total || rows.length || 0);
        var representation = String(response.representation || (baseParams && baseParams.representation) || 'day');
        var fallbackReason = response.fallback_reason ? String(response.fallback_reason) : '';

        if (typeof onProgress === 'function') {
            onProgress({
                page: 1,
                lastPage: 1,
                loaded: rows.length,
                total: total,
                truncated: false,
            });
        }

        return {
            rows: rows,
            total: total || rows.length,
            truncated: false,
            representation: representation,
            fallbackReason: fallbackReason,
        };
    }

    function getApiBase() {
        return (typeof config !== 'undefined' && config.apiBase) ? String(config.apiBase) : '';
    }

    var rbaHistoryCache = null;
    var cpiHistoryCache = null;

    function fetchRbaHistory() {
        if (rbaHistoryCache && Array.isArray(rbaHistoryCache)) return Promise.resolve(rbaHistoryCache);
        var base = getApiBase();
        if (!base) return Promise.resolve([]);
        var url = base + '/rba/history';
        if (requestJson) {
            return requestJson(url, { requestLabel: 'RBA history', timeoutMs: 10000, retryCount: 0 })
                .then(function (res) {
                    var body = res && res.data ? res.data : res;
                    var rows = (body && body.rows) ? body.rows : [];
                    rbaHistoryCache = Array.isArray(rows) ? rows : [];
                    return rbaHistoryCache;
                })
                .catch(function () { return []; });
        }
        var fetchUrl = (window.AR.network && window.AR.network.appendCacheBust) ? window.AR.network.appendCacheBust(url) : url;
        return fetch(fetchUrl, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { rows: [] }; })
            .then(function (res) {
                var rows = (res && res.rows) ? res.rows : [];
                rbaHistoryCache = Array.isArray(rows) ? rows : [];
                return rbaHistoryCache;
            })
            .catch(function () { return []; });
    }

    function fetchCpiHistory() {
        if (cpiHistoryCache && Array.isArray(cpiHistoryCache)) return Promise.resolve(cpiHistoryCache);
        var base = getApiBase();
        if (!base) return Promise.resolve([]);
        var url = base + '/cpi/history';
        if (requestJson) {
            return requestJson(url, { requestLabel: 'CPI history', timeoutMs: 10000, retryCount: 0 })
                .then(function (res) {
                    var body = res && res.data ? res.data : res;
                    var rows = (body && body.rows) ? body.rows : [];
                    cpiHistoryCache = Array.isArray(rows) ? rows : [];
                    return cpiHistoryCache;
                })
                .catch(function () { return []; });
        }
        var fetchUrl = (window.AR.network && window.AR.network.appendCacheBust) ? window.AR.network.appendCacheBust(url) : url;
        return fetch(fetchUrl, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { rows: [] }; })
            .then(function (res) {
                var rows = (res && res.rows) ? res.rows : [];
                cpiHistoryCache = Array.isArray(rows) ? rows : [];
                return cpiHistoryCache;
            })
            .catch(function () { return []; });
    }

    window.AR.chartData = {
        buildChartModel: buildChartModel,
        buildSlopeModel: buildSlopeModel,
        fetchAllRateRows: fetchAllRateRows,
        fetchRbaHistory: fetchRbaHistory,
        fetchCpiHistory: fetchCpiHistory,
    };
})();
