(function () {
    'use strict';
    window.AR = window.AR || {};

    var config = window.AR.config || {};
    var chartConfig = window.AR.chartConfig || {};
    var apiBase = config.apiBase || '';
    var MAX_FETCH_ROWS = 10000;

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
            displayValue('rate_structure', row),
            displayValue('security_purpose', row),
            displayValue('repayment_type', row),
            displayValue('lvr_tier', row),
            displayValue('feature_set', row),
            displayValue('account_type', row),
            displayValue('rate_type', row),
            displayValue('deposit_tier', row),
            displayValue('term_months', row),
            displayValue('interest_payment', row),
        ].filter(function (value) {
            return value && value !== '-';
        }).slice(0, 3);
    }

    function seriesName(row) {
        return [
            row && row.bank_name ? String(row.bank_name) : '',
            row && row.product_name ? String(row.product_name) : 'Unknown product',
        ].filter(Boolean).join(' | ');
    }

    function finalizeSeries(entry) {
        var points = sortPoints(entry.points);
        var first = points[0] || null;
        var last = points[points.length - 1] || null;
        return {
            key: entry.key,
            name: seriesName(entry.firstRow),
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

    function uniqueDates(seriesList) {
        var seen = {};
        seriesList.forEach(function (series) {
            series.points.forEach(function (point) {
                seen[point.date] = true;
            });
        });
        return Object.keys(seen).sort(compareDates);
    }

    function buildSurfaceModel(seriesList) {
        var xLabels = uniqueDates(seriesList);
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
            yLabels: seriesList.map(function (series) { return series.name; }),
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
            if (Number(right.mean) !== Number(left.mean)) return Number(right.mean) - Number(left.mean);
            return right.count - left.count;
        }).slice(0, 10);

        return {
            categories: categories.map(function (entry) { return entry.name; }),
            boxes: categories.map(function (entry) { return entry.box; }),
            means: categories.map(function (entry) { return entry.mean; }),
            counts: categories.map(function (entry) { return entry.count; }),
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
        var density = chartConfig.parseDensity(fields.density);
        var allSeries = buildSeriesCollection(rows, fields.yField);
        var visibleSeries = allSeries.slice(0, density.rowLimit).map(function (series, index) {
            series.colorIndex = index;
            return series;
        });
        var selectedKeys = effectiveSelection(visibleSeries, selectionState && selectionState.selectedSeriesKeys, density.compareLimit);
        var spotlight = spotlightEntry(visibleSeries, selectionState, selectedKeys);

        return {
            meta: {
                totalRows: rows.length,
                totalSeries: allSeries.length,
                visibleSeries: visibleSeries.length,
                densityLabel: density.label,
                renderedCells: visibleSeries.reduce(function (sum, series) { return sum + series.pointCount; }, 0),
                selectedCount: selectedKeys.length,
            },
            surface: buildSurfaceModel(visibleSeries),
            distribution: buildDistributionModel(rows, fields),
            visibleSeries: visibleSeries,
            selectedKeys: selectedKeys,
            compareSeries: visibleSeries.filter(function (series) {
                return selectedKeys.indexOf(series.key) >= 0;
            }),
            spotlight: spotlight,
        };
    }

    function fetchRatesPage(params) {
        var query = new URLSearchParams(params || {});
        return fetch(apiBase + '/rates?' + query.toString()).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for /rates');
            return response.json();
        });
    }

    async function fetchAllRateRows(baseParams, onProgress) {
        var page = 1;
        var lastPage = 1;
        var total = 0;
        var rows = [];
        var truncated = false;

        do {
            var params = {};
            Object.keys(baseParams || {}).forEach(function (key) {
                params[key] = baseParams[key];
            });
            params.page = String(page);
            params.size = '1000';

            var response = await fetchRatesPage(params);
            var chunk = Array.isArray(response.data) ? response.data : [];
            total = Number(response.total || total || chunk.length || 0);
            lastPage = Math.max(1, Number(response.last_page || 1));
            rows = rows.concat(chunk);

            if (rows.length >= MAX_FETCH_ROWS) {
                rows = rows.slice(0, MAX_FETCH_ROWS);
                truncated = true;
            }

            if (typeof onProgress === 'function') {
                onProgress({
                    page: page,
                    lastPage: lastPage,
                    loaded: rows.length,
                    total: total,
                    truncated: truncated,
                });
            }

            if (truncated) break;
            page += 1;
        } while (page <= lastPage);

        return {
            rows: rows,
            total: total || rows.length,
            truncated: truncated,
        };
    }

    window.AR.chartData = {
        buildChartModel: buildChartModel,
        fetchAllRateRows: fetchAllRateRows,
    };
})();
