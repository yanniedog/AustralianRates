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
    var SAVINGS_ACCOUNT_ORDER = { savings: 0, transaction: 1, at_call: 2 };
    /** LVR tier order: lowest to highest (for ribbon low/high edge). */
    var LVR_TIER_ORDER = ['lvr_=60%', 'lvr_60-70%', 'lvr_70-80%', 'lvr_80-85%', 'lvr_85-90%', 'lvr_90-95%', 'lvr_standard_reference', 'lvr_unspecified'];

    function lvrTierSortIndex(lvrTier) {
        var idx = LVR_TIER_ORDER.indexOf(String(lvrTier || ''));
        return idx >= 0 ? idx : 999;
    }

    function lvrTierSortKey(lvrTier) {
        return lvrTierSortIndex(lvrTier);
    }

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

    function snapshotRowsForDate(rows, date) {
        var d = String(date || '');
        return rows.filter(function (row) { return String(row && row.collection_date || '') === d; });
    }

    /**
     * For HL ribbon: LVR tiers that each bank offers in every snapshot (variable rows only).
     * Returns { bankName: { lowLvr, highLvr } } using LVR_TIER_ORDER. Fallback: one snapshot -> use that snapshot's set.
     */
    function computeConsistentLvrPerBank(rows) {
        var allRows = rows || [];
        if (!allRows.length) return {};
        var variableOnly = section === 'home-loans';
        var byDateBank = {};
        allRows.forEach(function (row) {
            if (variableOnly && String(row && row.rate_structure || '') !== 'variable') return;
            var date = String(row && row.collection_date || '');
            var bankName = String(row && row.bank_name || 'Unknown bank');
            var lvr = String(row && row.lvr_tier || '').trim();
            if (!date || !lvr) return;
            var key = date + '\t' + bankName;
            if (!byDateBank[key]) byDateBank[key] = Object.create(null);
            byDateBank[key][lvr] = true;
        });
        var banksByDate = {};
        Object.keys(byDateBank).forEach(function (key) {
            var parts = key.split('\t');
            var date = parts[0];
            var bankName = parts[1];
            if (!banksByDate[bankName]) banksByDate[bankName] = [];
            if (banksByDate[bankName].indexOf(date) < 0) banksByDate[bankName].push(date);
        });
        var latestDate = latestSnapshotDate(allRows);
        var result = {};
        Object.keys(banksByDate).forEach(function (bankName) {
            var dates = banksByDate[bankName].sort(compareDates);
            var intersection = null;
            dates.forEach(function (date) {
                var set = byDateBank[date + '\t' + bankName];
                var tiers = Object.keys(set).filter(Boolean);
                if (intersection === null) intersection = tiers.slice();
                else intersection = intersection.filter(function (t) { return set[t]; });
            });
            if (!intersection || !intersection.length) {
                var fallbackDate = dates.length ? dates[dates.length - 1] : latestDate;
                var latestSet = byDateBank[fallbackDate + '\t' + bankName];
                intersection = latestSet ? Object.keys(latestSet).filter(Boolean) : [];
            }
            if (!intersection.length) { result[bankName] = { lowLvr: '', highLvr: '' }; return; }
            var sorted = intersection.slice().sort(function (a, b) { return lvrTierSortIndex(a) - lvrTierSortIndex(b); });
            result[bankName] = { lowLvr: sorted[0], highLvr: sorted[sorted.length - 1] };
        });
        return result;
    }

    function computeConsistentLvrTiersPerBank(rows) {
        var allRows = rows || [];
        if (!allRows.length) return {};
        var variableOnly = section === 'home-loans';
        var byDateBank = {};
        allRows.forEach(function (row) {
            if (variableOnly && String(row && row.rate_structure || '') !== 'variable') return;
            var date = String(row && row.collection_date || '');
            var bankName = String(row && row.bank_name || 'Unknown bank');
            var lvr = String(row && row.lvr_tier || '').trim();
            if (!date || !lvr) return;
            var key = date + '\t' + bankName;
            if (!byDateBank[key]) byDateBank[key] = Object.create(null);
            byDateBank[key][lvr] = true;
        });
        var banksByDate = {};
        Object.keys(byDateBank).forEach(function (key) {
            var parts = key.split('\t');
            var date = parts[0];
            var bankName = parts[1];
            if (!banksByDate[bankName]) banksByDate[bankName] = [];
            if (banksByDate[bankName].indexOf(date) < 0) banksByDate[bankName].push(date);
        });
        var latestDate = latestSnapshotDate(allRows);
        var result = {};
        Object.keys(banksByDate).forEach(function (bankName) {
            var dates = banksByDate[bankName].sort(compareDates);
            var intersection = null;
            dates.forEach(function (date) {
                var set = byDateBank[date + '\t' + bankName];
                var tiers = Object.keys(set).filter(Boolean);
                if (intersection === null) intersection = tiers.slice();
                else intersection = intersection.filter(function (t) { return set[t]; });
            });
            if (!intersection || !intersection.length) {
                var fallbackDate = dates.length ? dates[dates.length - 1] : latestDate;
                var latestSet = byDateBank[fallbackDate + '\t' + bankName];
                intersection = latestSet ? Object.keys(latestSet).filter(Boolean) : [];
            }
            result[bankName] = intersection.slice().sort(function (a, b) { return lvrTierSortKey(a) - lvrTierSortKey(b); });
        });
        return result;
    }

    function buildTdCurveFrames(rows, fields) {
        if (section !== 'term-deposits') return null;
        var allRows = rows || [];
        if (!allRows.length) return null;
        var byDate = {};
        allRows.forEach(function (row) {
            var date = String(row && row.collection_date || '');
            if (date) byDate[date] = true;
        });
        var dates = Object.keys(byDate).sort(compareDates);
        if (!dates.length) return null;
        var frames = [];
        for (var i = 0; i < dates.length; i++) {
            var snapshotRows = snapshotRowsForDate(allRows, dates[i]);
            var market = buildMarketModel(snapshotRows, fields, {});
            if (market && market.categories && market.categories.length) frames.push(market);
        }
        if (!frames.length) return null;
        return { dates: dates, frames: frames };
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

    /** For Savings deposit_tier: sort by upper bound of range so axis reads low balance to high balance. */
    function depositTierSortValue(value, row) {
        var maxB = row && row.max_balance != null ? Number(row.max_balance) : NaN;
        var minB = row && row.min_balance != null ? Number(row.min_balance) : NaN;
        if (Number.isFinite(maxB)) return maxB;
        if (Number.isFinite(minB)) return minB;
        var raw = String(value || '').replace(/\s+/g, ' ');
        var re = /\$?(\d+(?:\.\d+)?)\s*([km])?/gi;
        var max = 0;
        var match;
        while ((match = re.exec(raw)) !== null) {
            var amount = Number(match[1]);
            var scale = (match[2] || '').toLowerCase() === 'm' ? 1000000 : ((match[2] || '').toLowerCase() === 'k' ? 1000 : 1);
            if (Number.isFinite(amount)) max = Math.max(max, amount * scale);
        }
        return max || Number.POSITIVE_INFINITY;
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
            return { key: String(value), label: humanField('deposit_tier', value, row), shortLabel: trimAxisLabel(humanField('deposit_tier', value, row), 14), secondaryLabel: '', sortValue: depositTierSortValue(value, row), dimensionLabel: 'Balance tier' };
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

    function chooseVisibleBanks(categories, direction, maxBanks) {
        var limit = maxBanks != null && maxBanks > 0 ? maxBanks : 4;
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
        }).slice(0, limit).map(function (entry) { return entry.bankName; });
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

    function buildTimeRibbonModel(rows, fields, selectionState) {
        var section = window.AR.section || 'home-loans';
        if (section !== 'term-deposits') return null;
        var allRows = rows || [];
        if (!allRows.length) return null;
        var direction = marketDirection(fields.yField);
        var termFilter = (selectionState && selectionState.termMonthsFilter) ? String(selectionState.termMonthsFilter).trim() : '';
        var byDateTerm = {};
        allRows.forEach(function (row) {
            var date = String(row && row.collection_date || '');
            var term = row && row.term_months != null ? String(row.term_months) : '';
            var value = numericValue(row, fields.yField);
            if (!date || !Number.isFinite(value)) return;
            var key = date + '|' + term;
            if (!byDateTerm[key]) byDateTerm[key] = { date: date, term: term, bankMap: {}, rows: [] };
            var cat = byDateTerm[key];
            cat.rows.push({ row: row, value: value });
            var bankName = String(row.bank_name || 'Unknown bank');
            var existing = cat.bankMap[bankName];
            if (!existing || betterValue(direction, existing.value, value) === value) {
                cat.bankMap[bankName] = { bankName: bankName, value: value, row: row };
            }
        });
        var termsWithData = {};
        Object.keys(byDateTerm).forEach(function (key) {
            var t = byDateTerm[key].term;
            if (t) termsWithData[t] = (termsWithData[t] || 0) + 1;
        });
        var chosenTerm = termFilter && termsWithData[termFilter]
            ? termFilter
            : Object.keys(termsWithData).sort(function (a, b) { return termsWithData[b] - termsWithData[a] || Number(a) - Number(b); })[0] || '';
        var dateKeys = Object.keys(byDateTerm)
            .filter(function (key) { return byDateTerm[key].term === chosenTerm; })
            .map(function (key) { return byDateTerm[key].date; })
            .sort(compareDates);
        if (!dateKeys.length) return null;
        var categories = dateKeys.map(function (date) {
            var key = date + '|' + chosenTerm;
            var cat = byDateTerm[key];
            var bankEntries = Object.keys(cat.bankMap).map(function (bankName) { return cat.bankMap[bankName]; }).sort(function (a, b) {
                var metricSort = compareBucketValues(direction, a.value, b.value);
                if (metricSort !== 0) return metricSort;
                return String(a.bankName).localeCompare(String(b.bankName));
            });
            var values = cat.rows.map(function (e) { return e.value; }).sort(function (a, b) { return a - b; });
            var total = values.reduce(function (sum, v) { return sum + v; }, 0);
            return {
                key: date,
                date: date,
                label: humanField('collection_date', date, null),
                shortLabel: date,
                secondaryLabel: chosenTerm ? chosenTerm + 'm' : '',
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
            };
        });
        var bankNames = [];
        categories.forEach(function (cat) {
            cat.bankEntries.forEach(function (entry) {
                if (bankNames.indexOf(entry.bankName) < 0) bankNames.push(entry.bankName);
            });
        });
        var bankCurves = bankNames.slice(0, 8).map(function (bankName) {
            return {
                bankName: bankName,
                points: categories.map(function (cat) {
                    var entry = cat.bankEntries.find(function (e) { return e.bankName === bankName; });
                    return entry ? { date: cat.date, value: entry.value, row: entry.row } : null;
                }),
            };
        });
        return {
            type: 'timeRibbon',
            termMonths: chosenTerm,
            termLabel: chosenTerm ? chosenTerm + 'm' : 'All terms',
            snapshotDateDisplay: categories.length ? humanField('collection_date', categories[categories.length - 1].date, null) : '',
            categories: categories,
            bankCurves: bankCurves,
            dimensionLabel: 'Date',
        };
    }

    function buildTdTermTimeModel(rows, fields) {
        var section = window.AR.section || 'home-loans';
        if (section !== 'term-deposits') return null;
        var tr = buildTimeRibbonModel(rows, fields, {});
        if (!tr || !tr.categories) return null;
        var termsWithData = {};
        (rows || []).forEach(function (row) {
            var t = row && row.term_months != null ? String(row.term_months) : '';
            if (t) termsWithData[t] = true;
        });
        var termKeys = Object.keys(termsWithData).sort(function (a, b) { return Number(a) - Number(b); }).slice(0, 6);
        var terms = termKeys.map(function (term) {
            var sel = { termMonthsFilter: term };
            var ribbon = buildTimeRibbonModel(rows, fields, sel);
            return { termKey: term, termLabel: term + 'm', timeRibbon: ribbon };
        }).filter(function (t) { return t.timeRibbon && t.timeRibbon.categories && t.timeRibbon.categories.length; });
        if (!terms.length) return null;
        return { type: 'tdTermTime', terms: terms, dimensionLabel: 'Term vs time' };
    }

    function buildMarketModel(rows, fields, selectionState) {
        var allRows = rows || [];
        var style = curveStyle(fields.chartType);

        if (section === 'home-loans' && style === 'ribbon') {
            var variableRows = allRows.filter(function (row) { return String(row && row.rate_structure || '') === 'variable'; });
            if (!variableRows.length) return null;
            var dateKeys = [];
            var dateSet = {};
            variableRows.forEach(function (row) {
                var d = String(row && row.collection_date || '');
                if (d && !dateSet[d]) { dateSet[d] = true; dateKeys.push(d); }
            });
            dateKeys.sort(compareDates);
            if (!dateKeys.length) return null;
            var direction = marketDirection(fields.yField);
            var categoriesByKey = {};
            dateKeys.forEach(function (date) {
                categoriesByKey[date] = {
                    key: date,
                    label: humanField('collection_date', date, null),
                    shortLabel: date,
                    secondaryLabel: '',
                    sortValue: date,
                    dimensionLabel: 'Date',
                    rows: [],
                    bankMap: {},
                };
            });
            variableRows.forEach(function (row) {
                var date = String(row && row.collection_date || '');
                var category = categoriesByKey[date];
                if (!category) return;
                var value = numericValue(row, fields.yField);
                if (!Number.isFinite(value)) return;
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
            var categories = dateKeys.map(function (key) {
                var category = categoriesByKey[key];
                var values = category.rows.map(function (entry) { return entry.value; }).sort(function (a, b) { return a - b; });
                var bankEntries = Object.keys(category.bankMap).map(function (bankName) { return category.bankMap[bankName]; }).sort(function (left, right) {
                    var metricSort = compareBucketValues(direction, left.value, right.value);
                    if (metricSort !== 0) return metricSort;
                    return String(left.bankName).localeCompare(String(right.bankName));
                });
                var total = values.reduce(function (sum, v) { return sum + v; }, 0);
                return {
                    key: category.key,
                    label: category.label,
                    shortLabel: category.shortLabel,
                    secondaryLabel: category.secondaryLabel,
                    dimensionLabel: category.dimensionLabel,
                    sortValue: category.sortValue,
                    rows: category.rows,
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
                    box: values.length ? [values[0], quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75), values[values.length - 1]] : [],
                };
            });
            if (!categories.length) return null;
            var visibleBanks = chooseVisibleBanks(categories, direction, 8);
            var byKey = {};
            categories.forEach(function (c) { byKey[c.key] = c; });
            var consistentTiers = computeConsistentLvrTiersPerBank(allRows);
            var bankLvrCurves = [];
            visibleBanks.forEach(function (bankName, bankIndex) {
                var tiers = (consistentTiers[bankName] && consistentTiers[bankName].length) ? consistentTiers[bankName] : null;
                if (!tiers || !tiers.length) {
                    var tierSet = Object.create(null);
                    variableRows.forEach(function (row) {
                        if (String(row && row.bank_name || '') !== bankName) return;
                        var t = String(row && row.lvr_tier || '').trim();
                        if (t) tierSet[t] = true;
                    });
                    tiers = Object.keys(tierSet).sort(function (a, b) { return lvrTierSortKey(a) - lvrTierSortKey(b); });
                }
                tiers.forEach(function (tier) {
                    var points = categories.map(function (category) {
                        var bankRows = category.rows.filter(function (entry) {
                            return String(entry.row && entry.row.bank_name || '') === bankName
                                && String(entry.row && entry.row.lvr_tier || '').trim() === String(tier || '').trim();
                        });
                        if (!bankRows.length) return null;
                        var best = bankRows[0];
                        for (var i = 1; i < bankRows.length; i++) {
                            var candidate = bankRows[i];
                            var better = betterValue(direction, best.value, candidate.value);
                            if (better === candidate.value) best = candidate;
                        }
                        return best && Number.isFinite(best.value)
                            ? { bucketKey: category.key, value: best.value, row: best.row, lvrTier: tier }
                            : null;
                    });
                    bankLvrCurves.push({
                        bankName: bankName,
                        lvrTier: tier,
                        lvrLabel: humanField('lvr_tier', tier, null),
                        colorIndex: bankIndex,
                        points: points,
                    });
                });
            });

            var lastCategory = categories[categories.length - 1];
            return {
                snapshotDate: lastCategory ? lastCategory.key : '',
                snapshotDateDisplay: lastCategory ? humanField('collection_date', lastCategory.key, null) : '',
                dimensionLabel: 'Date',
                dimensionField: 'collection_date',
                curveTitle: 'Variable rate over time by LVR tier (one colour per bank)',
                style: 'ribbon',
                direction: direction,
                bestLabel: direction === 'asc' ? 'Lowest' : 'Highest',
                categories: categories,
                bucketByKey: byKey,
                bankCurves: visibleBanks.map(function (bankName, index) {
                    var points = categories.map(function (category) {
                        var bankEntry = category.bankEntries.find(function (e) { return e.bankName === bankName; });
                        if (!bankEntry) return null;
                        return { bucketKey: category.key, value: bankEntry.value, row: bankEntry.row };
                    });
                    return { bankName: bankName, colorIndex: index, points: points, rateType: '', lineDashed: false };
                }),
                bankRibbons: null,
                bankLvrCurves: bankLvrCurves,
                focusBucket: focusBucket(categories, selectionState),
            };
        }

        var snapshot = snapshotRows(allRows);
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
                dimensionLabel: category.dimensionLabel,
                sortValue: category.sortValue,
                rows: category.rows,
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
            var points = categories.map(function (category) {
                var bankEntry = category.bankEntries.find(function (entry) { return entry.bankName === bankName; });
                if (!bankEntry) return null;
                return { bucketKey: category.key, value: bankEntry.value, row: bankEntry.row };
            });
            var firstRow = points.filter(Boolean)[0] && points.filter(Boolean)[0].row;
            var rateType = (section === 'savings' && firstRow && firstRow.rate_type) ? String(firstRow.rate_type).toLowerCase() : '';
            var isConditional = rateType === 'bonus' || rateType === 'introductory' || rateType === 'intro' || rateType === 'bundle';
            return {
                bankName: bankName,
                colorIndex: index,
                points: points,
                rateType: rateType,
                lineDashed: isConditional,
            };
        });

        var curveTitle = section === 'home-loans' ? 'Borrowing cost by structure' : section === 'term-deposits' ? 'Yield by term' : (chosenSavingsField === 'deposit_tier' ? 'Rate by balance tier' : 'Rate by tier or type');
        var style = curveStyle(fields.chartType);
        var bankRibbons = null;
        if (section === 'home-loans' && style === 'ribbon') {
            var consistentLvr = computeConsistentLvrPerBank(rows || []);
            bankRibbons = visibleBanks.map(function (bankName, index) {
                var bankRange = consistentLvr[bankName] || { lowLvr: '', highLvr: '' };
                var lowLvrTier = bankRange.lowLvr;
                var highLvrTier = bankRange.highLvr;
                var points = categories.map(function (category) {
                    var bankRows = category.rows.filter(function (entry) {
                        if (String(entry.row && entry.row.bank_name || '') !== bankName) return false;
                        if (section === 'home-loans' && String(entry.row && entry.row.rate_structure || '') !== 'variable') return false;
                        return true;
                    });
                    if (!bankRows.length) return null;
                    var lowEntry = lowLvrTier ? bankRows.find(function (e) { return String(e.row && e.row.lvr_tier || '') === lowLvrTier; }) : null;
                    var highEntry = highLvrTier ? bankRows.find(function (e) { return String(e.row && e.row.lvr_tier || '') === highLvrTier; }) : null;
                    if (!lowEntry && bankRows.length) {
                        bankRows.sort(function (a, b) { return lvrTierSortIndex(a.row && a.row.lvr_tier) - lvrTierSortIndex(b.row && b.row.lvr_tier); });
                        lowEntry = bankRows[0];
                    }
                    if (!highEntry && bankRows.length) {
                        if (!lowEntry) bankRows.sort(function (a, b) { return lvrTierSortIndex(a.row && a.row.lvr_tier) - lvrTierSortIndex(b.row && b.row.lvr_tier); });
                        highEntry = bankRows[bankRows.length - 1];
                    }
                    var lowRate = lowEntry && Number.isFinite(lowEntry.value) ? lowEntry.value : null;
                    var highRate = highEntry && Number.isFinite(highEntry.value) ? highEntry.value : null;
                    var lowLvrLabel = humanField('lvr_tier', lowLvrTier || (lowEntry && lowEntry.row ? String(lowEntry.row.lvr_tier || '') : ''), lowEntry && lowEntry.row);
                    var highLvrLabel = humanField('lvr_tier', highLvrTier || (highEntry && highEntry.row ? String(highEntry.row.lvr_tier || '') : ''), highEntry && highEntry.row);
                    return {
                        bucketKey: category.key,
                        lowRate: lowRate,
                        highRate: highRate,
                        lowLvrLabel: lowLvrLabel,
                        highLvrLabel: highLvrLabel,
                    };
                });
                return { bankName: bankName, colorIndex: index, points: points };
            });
        }
        return {
            snapshotDate: snapshot.snapshotDate,
            snapshotDateDisplay: humanField('collection_date', snapshot.snapshotDate, null),
            dimensionLabel: categories[0].dimensionLabel,
            dimensionField: section === 'savings' ? chosenSavingsField : (section === 'term-deposits' ? 'term_months' : 'rate_structure'),
            curveTitle: curveTitle,
            style: style,
            direction: direction,
            bestLabel: direction === 'asc' ? 'Lowest' : 'Highest',
            categories: categories,
            bucketByKey: byKey,
            bankCurves: bankCurves,
            bankRibbons: bankRibbons,
            focusBucket: focusBucket(categories, selectionState),
        };
    }

    window.AR.chartMarket = window.AR.chartMarket || {};
    window.AR.chartMarket.buildModel = buildMarketModel;
    window.AR.chartMarket.buildTimeRibbonModel = buildTimeRibbonModel;
    window.AR.chartMarket.buildTdTermTimeModel = buildTdTermTimeModel;
    window.AR.chartMarket.buildTdCurveFrames = buildTdCurveFrames;
})();
