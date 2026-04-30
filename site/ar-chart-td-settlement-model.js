(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartConfig = window.AR.chartConfig || {};
    var MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function numericValue(row, field) {
        var num = Number(row && row[field]);
        return Number.isFinite(num) ? num : null;
    }

    function compareDates(left, right) {
        if (left === right) return 0;
        return String(left || '').localeCompare(String(right || ''));
    }

    function latestSnapshot(rows) {
        var latest = '';
        (rows || []).forEach(function (row) {
            var date = String(row && row.collection_date || '');
            if (date && (!latest || compareDates(date, latest) > 0)) latest = date;
        });
        return {
            snapshotDate: latest,
            rows: (rows || []).filter(function (row) { return String(row && row.collection_date || '') === latest; }),
        };
    }

    function addMonthsYmd(dateText, months) {
        var match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return '';
        var y = Number(match[1]);
        var m0 = Number(match[2]) - 1;
        var d = Number(match[3]);
        var add = Number(months || 0);
        var total = m0 + add;
        var ty = y + Math.floor(total / 12);
        var tm = ((total % 12) + 12) % 12;
        var lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
        var dd = Math.min(d, lastDay);
        var mm = tm + 1;
        return ty + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
    }

    function addMonthsLabel(dateText, months) {
        var match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return '';
        var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
        date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
        return MONTH_LABELS[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
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

    function compareBucketValues(direction, left, right) {
        var leftValue = Number(left);
        var rightValue = Number(right);
        if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
            return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
        }
        if (Number.isFinite(leftValue)) return -1;
        if (Number.isFinite(rightValue)) return 1;
        return 0;
    }

    function chooseVisibleBanks(categories, direction) {
        var stats = {};
        categories.forEach(function (category) {
            category.bankEntries.forEach(function (entry) {
                if (!stats[entry.bankName]) stats[entry.bankName] = { bankName: entry.bankName, coverage: 0, values: [] };
                stats[entry.bankName].coverage += 1;
                stats[entry.bankName].values.push(entry.value);
            });
        });
        return Object.keys(stats).map(function (bankName) {
            var entry = stats[bankName];
            var total = entry.values.reduce(function (sum, value) { return sum + value; }, 0);
            entry.average = entry.values.length ? total / entry.values.length : null;
            return entry;
        }).sort(function (left, right) {
            if (right.coverage !== left.coverage) return right.coverage - left.coverage;
            var metricSort = compareBucketValues(direction, left.average, right.average);
            if (metricSort !== 0) return metricSort;
            return String(left.bankName).localeCompare(String(right.bankName));
        }).slice(0, 8).map(function (entry) { return entry.bankName; });
    }

    function buildTdSettlementExpectationsModel(rows, fields) {
        if ((window.AR.section || '') !== 'term-deposits') return null;
        var snapshot = latestSnapshot(rows || []);
        if (!snapshot.snapshotDate || !snapshot.rows.length) return null;
        var direction = chartConfig.rankDirection ? chartConfig.rankDirection(fields.yField) : 'desc';
        var byTerm = {};
        snapshot.rows.forEach(function (row) {
            var term = Number(row && row.term_months);
            var value = numericValue(row, fields.yField);
            if (!Number.isFinite(term) || term <= 0 || !Number.isFinite(value)) return;
            var termKey = String(term);
            var maturityDate = addMonthsYmd(snapshot.snapshotDate, term);
            if (!maturityDate) return;
            if (!byTerm[termKey]) {
                byTerm[termKey] = { key: maturityDate, maturityDate: maturityDate, maturityLabel: addMonthsLabel(snapshot.snapshotDate, term), termMonths: term, termLabel: term + 'm', rows: [], bankMap: {} };
            }
            var bucket = byTerm[termKey];
            bucket.rows.push({ row: row, value: value });
            var bankName = String(row.bank_name || 'Unknown bank');
            var existing = bucket.bankMap[bankName];
            if (!existing || compareBucketValues(direction, value, existing.value) < 0) {
                bucket.bankMap[bankName] = { bankName: bankName, value: value, row: row };
            }
        });
        var categories = Object.keys(byTerm).map(function (termKey) {
            var bucket = byTerm[termKey];
            var values = bucket.rows.map(function (entry) { return entry.value; }).sort(function (a, b) { return a - b; });
            var bankEntries = Object.keys(bucket.bankMap).map(function (bankName) { return bucket.bankMap[bankName]; }).sort(function (left, right) {
                var metricSort = compareBucketValues(direction, left.value, right.value);
                return metricSort || String(left.bankName).localeCompare(String(right.bankName));
            });
            var total = values.reduce(function (sum, value) { return sum + value; }, 0);
            return {
                key: bucket.key,
                maturityDate: bucket.maturityDate,
                maturityLabel: bucket.maturityLabel,
                termMonths: bucket.termMonths,
                termLabel: bucket.termLabel,
                min: values[0],
                q1: quantile(values, 0.25),
                median: quantile(values, 0.5),
                q3: quantile(values, 0.75),
                max: values[values.length - 1],
                mean: values.length ? total / values.length : null,
                bankCount: bankEntries.length,
                rowCount: bucket.rows.length,
                bestValue: bankEntries.length ? bankEntries[0].value : null,
                bestRow: bankEntries.length ? bankEntries[0].row : null,
                bankEntries: bankEntries,
            };
        }).filter(function (category) {
            return Number.isFinite(category.median);
        }).sort(function (left, right) {
            return left.termMonths - right.termMonths || compareDates(left.maturityDate, right.maturityDate);
        });
        if (!categories.length) return null;
        var visibleBanks = chooseVisibleBanks(categories, direction);
        var byKey = {};
        categories.forEach(function (category) { byKey[category.key] = category; });
        return {
            type: 'tdSettlementExpectations',
            snapshotDate: snapshot.snapshotDate,
            snapshotDateDisplay: chartConfig.formatFieldValue ? chartConfig.formatFieldValue('collection_date', snapshot.snapshotDate, null) : snapshot.snapshotDate,
            dimensionLabel: 'Settlement date',
            direction: direction,
            categories: categories,
            bucketByKey: byKey,
            bankCurves: visibleBanks.map(function (bankName, index) {
                return {
                    bankName: bankName,
                    colorIndex: index,
                    points: categories.map(function (category) {
                        var entry = category.bankEntries.find(function (e) { return e.bankName === bankName; });
                        return entry ? { maturityDate: category.maturityDate, value: entry.value, row: entry.row } : null;
                    }),
                };
            }),
        };
    }

    window.AR.chartMarket = window.AR.chartMarket || {};
    window.AR.chartMarket.buildTdSettlementExpectationsModel = buildTdSettlementExpectationsModel;
})();
