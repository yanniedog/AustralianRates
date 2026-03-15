(function () {
    'use strict';
    window.AR = window.AR || {};

    var section = window.AR.section || 'home-loans';
    var chartConfig = window.AR.chartConfig || {};
    var helpers = window.AR.chartEchartsHelpers || {};
    var utils = window.AR.utils || {};
    var paletteColor = helpers.paletteColor || function () { return '#2563eb'; };
    var baseTextStyles = helpers.baseTextStyles || function () { return { textStyle: {}, animationDuration: 320, animationDurationUpdate: 240, animationEasing: 'cubicOut' }; };
    var gridStyles = helpers.gridStyles || function () { return {}; };
    var tooltipStyles = helpers.tooltipStyles || function () { return { backgroundColor: '#11161d', borderColor: '#2f3e4f', textStyle: { color: '#edf3f9' }, extraCssText: '' }; };
    var chartTheme = helpers.chartTheme || function () {
        return {
            emphasisText: '#f8fbff',
            mutedText: '#9aa9b9',
            softText: '#c5ced8',
            splitLine: 'rgba(237, 243, 249, 0.1)',
            axisLine: 'rgba(237, 243, 249, 0.2)',
            shadowAccent: 'rgba(79, 141, 253, 0.24)',
        };
    };
    var trimAxisLabel = helpers.trimAxisLabel || function (value) { return String(value || ''); };
    var metricAxisLabel = helpers.metricAxisLabel || function (_field, value) { return String(value == null ? '' : value); };
    var categoryInterval = helpers.categoryInterval || function () { return 0; };
    var ymdDate = utils.ymdDate || function (value) { return String(value || ''); };

    var MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var SAVINGS_RATE_TYPE_ORDER = { base: 0, bonus: 1, introductory: 2, intro: 2, bundle: 3 };
    var SAVINGS_ACCOUNT_ORDER = { transaction: 0, at_call: 1, savings: 2 };

    function numericValue(row, field) {
        var num = Number(row && row[field]);
        return Number.isFinite(num) ? num : null;
    }

    function compareDates(left, right) {
        if (left === right) return 0;
        return String(left || '').localeCompare(String(right || ''));
    }

    function latestSnapshotDate(rows) {
        var latest = '';
        rows.forEach(function (row) {
            var date = String(row && row.collection_date || '');
            if (date && (!latest || compareDates(date, latest) > 0)) latest = date;
        });
        return latest;
    }

    function snapshotRows(rows) {
        var snapshotDate = latestSnapshotDate(rows);
        return {
            snapshotDate: snapshotDate,
            rows: rows.filter(function (row) { return String(row && row.collection_date || '') === snapshotDate; }),
        };
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

    function addMonthsLabel(dateText, months) {
        var match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return '';
        var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
        date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
        return MONTH_LABELS[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
    }

    function humanField(field, value, row) {
        if (!chartConfig.formatFieldValue) return String(value == null ? '' : value);
        return chartConfig.formatFieldValue(field, value, row || null);
    }

    function axisLabel(shortLabel, secondaryLabel, narrow) {
        var secondary = secondaryLabel ? trimAxisLabel(secondaryLabel, narrow ? 11 : 15) : '';
        return secondary ? (shortLabel + '\n' + secondary) : shortLabel;
    }

    function parseAmountToken(value) {
        var raw = String(value || '').toLowerCase().replace(/\s+/g, '');
        if (!raw) return Number.POSITIVE_INFINITY;
        if (raw === 'all' || raw === 'allbalances') return 0;
        var match = raw.match(/\$?(\d+(?:\.\d+)?)([km]?)/);
        if (!match) return Number.POSITIVE_INFINITY;
        var amount = Number(match[1]);
        var scale = match[2] === 'm' ? 1000000 : (match[2] === 'k' ? 1000 : 1);
        return Number.isFinite(amount) ? amount * scale : Number.POSITIVE_INFINITY;
    }

    function marketDirection(field) {
        return chartConfig.rankDirection ? chartConfig.rankDirection(field) : 'desc';
    }

    function betterValue(direction, left, right) {
        if (!Number.isFinite(left)) return right;
        if (!Number.isFinite(right)) return left;
        return direction === 'asc' ? Math.min(left, right) : Math.max(left, right);
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

    function homeLoanBucket(row, snapshotDate) {
        var structure = String(row && row.rate_structure || '');
        if (!structure) return null;
        if (structure === 'variable') {
            return { key: structure, label: humanField('rate_structure', structure, row), shortLabel: 'Variable', secondaryLabel: 'Rolling', sortValue: 0, dimensionLabel: 'Rate structure' };
        }
        var fixedMatch = structure.match(/^fixed_(\d+)yr$/);
        if (fixedMatch) {
            var years = Number(fixedMatch[1]);
            return { key: structure, label: humanField('rate_structure', structure, row), shortLabel: years + 'y', secondaryLabel: addMonthsLabel(snapshotDate, years * 12), sortValue: years * 12, dimensionLabel: 'Rate structure' };
        }
        return { key: structure, label: humanField('rate_structure', structure, row), shortLabel: trimAxisLabel(humanField('rate_structure', structure, row), 14), secondaryLabel: '', sortValue: 999, dimensionLabel: 'Rate structure' };
    }

    function termDepositBucket(row, snapshotDate) {
        var months = Number(row && row.term_months);
        if (!Number.isFinite(months)) return null;
        return { key: String(months), label: humanField('term_months', months, row), shortLabel: months + 'm', secondaryLabel: addMonthsLabel(snapshotDate, months), sortValue: months, dimensionLabel: 'Term length' };
    }

    function chooseSavingsField(rows) {
        var depositTiers = {};
        var rateTypes = {};
        var accountTypes = {};
        rows.forEach(function (row) {
            var depositTier = String(row && row.deposit_tier || '').trim();
            var rateType = String(row && row.rate_type || '').trim();
            var accountType = String(row && row.account_type || '').trim();
            if (depositTier) depositTiers[depositTier] = true;
            if (rateType) rateTypes[rateType] = true;
            if (accountType) accountTypes[accountType] = true;
        });
        if (Object.keys(depositTiers).length > 1) return 'deposit_tier';
        if (Object.keys(rateTypes).length > 1) return 'rate_type';
        return 'account_type';
    }

    function savingsBucket(row, _snapshotDate, chosenField) {
        var field = chosenField || 'rate_type';
        var value = row ? row[field] : '';
        if (value == null || value === '') return null;
        if (field === 'deposit_tier') {
            var minBalance = Number(row && row.min_balance);
            return { key: String(value), label: humanField('deposit_tier', value, row), shortLabel: trimAxisLabel(humanField('deposit_tier', value, row), 14), secondaryLabel: '', sortValue: Number.isFinite(minBalance) ? minBalance : parseAmountToken(value), dimensionLabel: 'Deposit tier' };
        }
        if (field === 'rate_type') {
            return { key: String(value), label: humanField('rate_type', value, row), shortLabel: humanField('rate_type', value, row), secondaryLabel: '', sortValue: Object.prototype.hasOwnProperty.call(SAVINGS_RATE_TYPE_ORDER, String(value)) ? SAVINGS_RATE_TYPE_ORDER[String(value)] : 99, dimensionLabel: 'Rate type' };
        }
        return { key: String(value), label: humanField('account_type', value, row), shortLabel: humanField('account_type', value, row), secondaryLabel: '', sortValue: Object.prototype.hasOwnProperty.call(SAVINGS_ACCOUNT_ORDER, String(value)) ? SAVINGS_ACCOUNT_ORDER[String(value)] : 99, dimensionLabel: 'Account type' };
    }

    function bucketDescriptor(row, snapshotDate, chosenSavingsField) {
        if (section === 'term-deposits') return termDepositBucket(row, snapshotDate);
        if (section === 'savings') return savingsBucket(row, snapshotDate, chosenSavingsField);
        return homeLoanBucket(row, snapshotDate);
    }

    function chooseVisibleBanks(categories, direction) {
        var bankStats = {};
        categories.forEach(function (category) {
            category.bankEntries.forEach(function (entry) {
                if (!bankStats[entry.bankName]) {
                    bankStats[entry.bankName] = { bankName: entry.bankName, coverage: 0, values: [] };
                }
                bankStats[entry.bankName].coverage += 1;
                bankStats[entry.bankName].values.push(entry.value);
            });
        });

        return Object.keys(bankStats).map(function (bankName) {
            var stats = bankStats[bankName];
            var total = stats.values.reduce(function (sum, value) { return sum + value; }, 0);
            return { bankName: bankName, coverage: stats.coverage, average: stats.values.length ? total / stats.values.length : null };
        }).sort(function (left, right) {
            if (right.coverage !== left.coverage) return right.coverage - left.coverage;
            var metricSort = compareBucketValues(direction, left.average, right.average);
            if (metricSort !== 0) return metricSort;
            return String(left.bankName).localeCompare(String(right.bankName));
        }).slice(0, 4).map(function (entry) { return entry.bankName; });
    }

    function focusBucket(categories, selectionState) {
        var selectedKey = selectionState && selectionState.marketFocusKey ? String(selectionState.marketFocusKey) : '';
        if (selectedKey) {
            var selected = categories.find(function (category) { return category.key === selectedKey; });
            if (selected) return selected;
        }
        return categories.slice().sort(function (left, right) {
            if (right.bankCount !== left.bankCount) return right.bankCount - left.bankCount;
            if (right.rowCount !== left.rowCount) return right.rowCount - left.rowCount;
            return left.sortValue - right.sortValue;
        })[0] || null;
    }

    function curveStyle(chartType) {
        if (chartType === 'box') return 'box';
        if (chartType === 'bar') return 'ribbon';
        return 'line';
    }

    function buildMarketModel(rows, fields, selectionState) {
        var snapshot = snapshotRows(rows || []);
        var latestRows = snapshot.rows || [];
        if (!latestRows.length) return null;

        var chosenSavingsField = section === 'savings' ? chooseSavingsField(latestRows) : '';
        var direction = marketDirection(fields.yField);
        var categoriesByKey = {};

        latestRows.forEach(function (row) {
            var bucket = bucketDescriptor(row, snapshot.snapshotDate, chosenSavingsField);
            var value = numericValue(row, fields.yField);
            if (!bucket || !Number.isFinite(value)) return;
            if (!categoriesByKey[bucket.key]) {
                categoriesByKey[bucket.key] = {
                    key: bucket.key,
                    label: bucket.label,
                    shortLabel: bucket.shortLabel,
                    secondaryLabel: bucket.secondaryLabel,
                    sortValue: bucket.sortValue,
                    dimensionLabel: bucket.dimensionLabel,
                    rows: [],
                    bankMap: {},
                };
            }
            var category = categoriesByKey[bucket.key];
            category.rows.push({ row: row, value: value });

            var bankName = String(row.bank_name || 'Unknown bank');
            var existingBank = category.bankMap[bankName];
            if (!existingBank) {
                category.bankMap[bankName] = { bankName: bankName, value: value, row: row };
            } else {
                var better = betterValue(direction, existingBank.value, value);
                if (better === value) category.bankMap[bankName] = { bankName: bankName, value: value, row: row };
            }
        });

        var categories = Object.keys(categoriesByKey).map(function (key) {
            var category = categoriesByKey[key];
            var values = category.rows.map(function (entry) { return entry.value; }).sort(function (left, right) { return left - right; });
            var bankEntries = Object.keys(category.bankMap).map(function (bankName) {
                return category.bankMap[bankName];
            }).sort(function (left, right) {
                var metricSort = compareBucketValues(direction, left.value, right.value);
                if (metricSort !== 0) return metricSort;
                return String(left.bankName).localeCompare(String(right.bankName));
            });
            var total = values.reduce(function (sum, value) { return sum + value; }, 0);
            return {
                key: category.key,
                label: category.label,
                shortLabel: category.shortLabel,
                secondaryLabel: category.secondaryLabel,
                sortValue: category.sortValue,
                rowCount: category.rows.length,
                bankCount: bankEntries.length,
                min: values[0],
                q1: quantile(values, 0.25),
                median: quantile(values, 0.5),
                q3: quantile(values, 0.75),
                max: values[values.length - 1],
                mean: values.length ? total / values.length : null,
                bestValue: bankEntries.length ? bankEntries[0].value : null,
                bestRow: bankEntries.length ? bankEntries[0].row : null,
                bankEntries: bankEntries,
                box: [values[0], quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75), values[values.length - 1]],
            };
        }).sort(function (left, right) {
            if (left.sortValue !== right.sortValue) return left.sortValue - right.sortValue;
            return String(left.label).localeCompare(String(right.label));
        });

        if (!categories.length) return null;

        var visibleBanks = chooseVisibleBanks(categories, direction);
        var byKey = {};
        categories.forEach(function (category) { byKey[category.key] = category; });

        var bankCurves = visibleBanks.map(function (bankName, index) {
            return {
                bankName: bankName,
                colorIndex: index,
                points: categories.map(function (category) {
                    var bankEntry = category.bankEntries.find(function (entry) { return entry.bankName === bankName; });
                    if (!bankEntry) return null;
                    return { bucketKey: category.key, value: bankEntry.value, row: bankEntry.row };
                }),
            };
        });

        var curveTitle = section === 'home-loans' ? 'Borrowing cost by structure' : section === 'term-deposits' ? 'Yield by term' : (chosenSavingsField === 'deposit_tier' ? 'Rate by balance tier' : 'Rate by tier or type');
        return {
            snapshotDate: snapshot.snapshotDate,
            snapshotDateDisplay: humanField('collection_date', snapshot.snapshotDate, null),
            dimensionLabel: categories[0].dimensionLabel,
            dimensionField: section === 'savings' ? chosenSavingsField : (section === 'term-deposits' ? 'term_months' : 'rate_structure'),
            curveTitle: curveTitle,
            style: curveStyle(fields.chartType),
            direction: direction,
            bestLabel: direction === 'asc' ? 'Lowest' : 'Highest',
            categories: categories,
            bucketByKey: byKey,
            bankCurves: bankCurves,
            focusBucket: focusBucket(categories, selectionState),
        };
    }

    window.AR.chartMarket = window.AR.chartMarket || {};
    window.AR.chartMarket.buildModel = buildMarketModel;
})();
