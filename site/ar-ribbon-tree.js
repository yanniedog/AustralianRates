(function () {
    'use strict';
    window.AR = window.AR || {};
    window.AR.ribbon = window.AR.ribbon || {};

    var R = window.AR.ribbon || {};
    var formatRibbonTierValue = R.formatRibbonTierValue || function (row, field) {
        return row && row[field] != null ? String(row[field]) : '';
    };

    var RIBBON_DEPOSIT_TIER_BANDS = [
        { min: 0, max: 10000, label: '$0 to $10k' },
        { min: 10000, max: 50000, label: '$10k to $50k' },
        { min: 50000, max: 250000, label: '$50k to $250k' },
        { min: 250000, max: 1000000, label: '$250k to $1m' },
        { min: 1000000, max: 10000000, label: '$1m to $10m' },
        { min: 10000000, max: null, label: '$10m+' },
    ];

    /** Term deposit ribbon tree: collapse per-month rows into readable ranges (chronological order). */
    var RIBBON_TERM_MONTH_BANDS = [
        { min: 1, max: 3, label: '1\u20133 months' },
        { min: 4, max: 6, label: '4\u20136 months' },
        { min: 7, max: 9, label: '7\u20139 months' },
        { min: 10, max: 11, label: '10\u201311 months' },
        { min: 12, max: 12, label: '12 months (1 year)' },
        { min: 13, max: 23, label: '13\u201323 months' },
        { min: 24, max: 24, label: '24 months (2 years)' },
        { min: 25, max: 35, label: '25\u201335 months' },
        { min: 36, max: 36, label: '36 months (3 years)' },
        { min: 37, max: 47, label: '37\u201347 months' },
        { min: 48, max: 59, label: '48\u201359 months' },
        { min: 60, max: null, label: '60+ months (5+ years)' },
    ];

    function formatTierValue(row, field) {
        return typeof formatRibbonTierValue === 'function' ? formatRibbonTierValue(row, field) : '';
    }

    function ribbonGroupSortIndex(field, label) {
        if (field === 'rate_structure') {
            if (label === 'variable') return 0;
            if (label === 'fixed') return 1;
            return Number.MAX_SAFE_INTEGER;
        }
        if (field === 'term_months' || field === 'fixed_rate_term') {
            var num = Number(label);
            return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    function ribbonFiniteNumberOrNull(value) {
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function ribbonMoneyAmountFromText(value, suffix) {
        var n = Number(value);
        if (!Number.isFinite(n)) return null;
        var mult = 1;
        var s = String(suffix || '').trim().toLowerCase();
        if (s === 'k') mult = 1000;
        else if (s === 'm') mult = 1000000;
        else if (s === 'b') mult = 1000000000;
        return n * mult;
    }

    function ribbonDepositTierBoundsFromLabel(label) {
        var raw = String(label || '').trim().replace(/,/g, '');
        if (!raw) return null;
        var openMatch = raw.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([kmb])?\s*\+$/i);
        if (openMatch) {
            return {
                min: ribbonMoneyAmountFromText(openMatch[1], openMatch[2]),
                max: null,
            };
        }
        var rangeMatch = raw.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([kmb])?\s*(?:to|-|\u2013|\u2014)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([kmb])?$/i);
        if (rangeMatch) {
            return {
                min: ribbonMoneyAmountFromText(rangeMatch[1], rangeMatch[2]),
                max: ribbonMoneyAmountFromText(rangeMatch[3], rangeMatch[4]),
            };
        }
        return null;
    }

    function ribbonDepositTierBoundsFromRow(row) {
        if (!row || typeof row !== 'object') return null;
        var min = ribbonFiniteNumberOrNull(row.min_balance);
        var max = row.max_balance == null ? null : ribbonFiniteNumberOrNull(row.max_balance);
        if (min == null && max == null) {
            min = ribbonFiniteNumberOrNull(row.min_deposit);
            max = row.max_deposit == null ? null : ribbonFiniteNumberOrNull(row.max_deposit);
        }
        if (min == null && max == null) {
            var parsed = ribbonDepositTierBoundsFromLabel(row.deposit_tier);
            if (parsed) {
                min = parsed.min;
                max = parsed.max;
            }
        }
        if (min == null && max == null) return null;
        if (min == null) min = 0;
        if (max != null && max < min) {
            var swap = min;
            min = max;
            max = swap;
        }
        if (max != null && max <= min) max = min + 0.01;
        return { min: Math.max(0, min), max: max };
    }

    function ribbonDepositTierBandEntriesForProduct(product) {
        var row = product && product.row && typeof product.row === 'object' ? product.row : {};
        var bounds = ribbonDepositTierBoundsFromRow(row);
        if (!bounds) {
            var raw = formatTierValue(row, 'deposit_tier') || '\u2014';
            return [{ label: raw, sortIndex: RIBBON_DEPOSIT_TIER_BANDS.length, products: [product] }];
        }
        var lo = Number(bounds.min);
        var hi = bounds.max == null ? Infinity : Number(bounds.max);
        if (!Number.isFinite(lo) || !(hi > lo)) hi = lo + 0.01;
        var hits = [];
        RIBBON_DEPOSIT_TIER_BANDS.forEach(function (band, idx) {
            var bandHi = band.max == null ? Infinity : band.max;
            if (lo < bandHi && hi > band.min) {
                hits.push({ label: band.label, sortIndex: idx, products: [product] });
            }
        });
        if (hits.length) return hits;
        var fallback = formatTierValue(row, 'deposit_tier') || '\u2014';
        return [{ label: fallback, sortIndex: RIBBON_DEPOSIT_TIER_BANDS.length, products: [product] }];
    }

    function ribbonTermMonthsRoundedFromRow(row) {
        if (!row || typeof row !== 'object') return null;
        var m = ribbonFiniteNumberOrNull(row.term_months);
        if (m == null) return null;
        var rounded = Math.round(Number(m));
        if (!Number.isFinite(rounded) || rounded < 1) return null;
        return rounded;
    }

    function ribbonTermMonthBandEntriesForProduct(product) {
        var row = product && product.row && typeof product.row === 'object' ? product.row : {};
        var months = ribbonTermMonthsRoundedFromRow(row);
        if (months == null) {
            var rawUnknown = formatTierValue(row, 'term_months') || '\u2014';
            return [{ label: rawUnknown, sortIndex: 1e15, products: [product] }];
        }
        for (var i = 0; i < RIBBON_TERM_MONTH_BANDS.length; i += 1) {
            var band = RIBBON_TERM_MONTH_BANDS[i];
            var hi = band.max == null ? Infinity : band.max;
            if (months >= band.min && months <= hi) {
                return [{ label: band.label, sortIndex: band.min, products: [product] }];
            }
        }
        var tail = formatTierValue(row, 'term_months') || String(months);
        return [{ label: tail + ' months', sortIndex: months, products: [product] }];
    }

    function buildRibbonFieldGroups(prods, field) {
        var groups = {};
        if (String(field || '') === 'deposit_tier') {
            prods.forEach(function (product) {
                ribbonDepositTierBandEntriesForProduct(product).forEach(function (entry) {
                    if (!groups[entry.label]) {
                        groups[entry.label] = { label: entry.label, sortIndex: entry.sortIndex, products: [] };
                    }
                    groups[entry.label].products.push(product);
                });
            });
            return Object.keys(groups).map(function (label) { return groups[label]; }).sort(function (a, b) {
                if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
                return a.label.localeCompare(b.label);
            });
        }
        if (String(field || '') === 'term_months') {
            prods.forEach(function (product) {
                ribbonTermMonthBandEntriesForProduct(product).forEach(function (entry) {
                    if (!groups[entry.label]) {
                        groups[entry.label] = { label: entry.label, sortIndex: entry.sortIndex, products: [] };
                    }
                    groups[entry.label].sortIndex = Math.min(groups[entry.label].sortIndex, entry.sortIndex);
                    groups[entry.label].products.push(product);
                });
            });
            return Object.keys(groups).map(function (label) { return groups[label]; }).sort(function (a, b) {
                if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
                return a.label.localeCompare(b.label);
            });
        }
        prods.forEach(function (p) {
            var raw = formatTierValue(p.row || {}, field);
            var key = raw || '\u2014';
            if (!groups[key]) groups[key] = { label: key, sortIndex: Number.MAX_SAFE_INTEGER, products: [] };
            groups[key].sortIndex = Math.min(groups[key].sortIndex, ribbonGroupSortIndex(String(field || ''), key));
            groups[key].products.push(p);
        });
        return Object.keys(groups).map(function (label) { return groups[label]; }).sort(function (a, b) {
            if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
            return a.label.localeCompare(b.label);
        });
    }

    function buildRibbonTierTree(prods, tierFields, fieldIdx) {
        if (!prods || prods.length === 0) return { kind: 'empty' };
        if (prods.length === 1 || fieldIdx >= (tierFields || []).length) {
            return { kind: 'leaves', products: prods.slice() };
        }
        var field = tierFields[fieldIdx];
        var groups = buildRibbonFieldGroups(prods, field);
        if (groups.length === 1) {
            return buildRibbonTierTree(groups[0].products, tierFields, fieldIdx + 1);
        }
        return {
            kind: 'branch',
            field: field,
            groups: groups.map(function (group) {
                return { label: group.label, child: buildRibbonTierTree(group.products, tierFields, fieldIdx + 1) };
            }),
        };
    }

    function ribbonRateAtAnchorForHierarchy(p, anchorYmd, secStr) {
        var v = p.byDate[anchorYmd];
        if (v == null || !Number.isFinite(v) || v <= 0) return null;
        if (secStr === 'savings' && v < 1.0) return null;
        return v;
    }

    function minMaxRibbonNodeRates(node, anchorYmd, secStr) {
        if (!node || node.kind === 'empty') return null;
        if (node.kind === 'leaves') {
            var minV = Infinity;
            var maxV = -Infinity;
            node.products.forEach(function (p) {
                var v = ribbonRateAtAnchorForHierarchy(p, anchorYmd, secStr);
                if (v == null) return;
                if (v < minV) minV = v;
                if (v > maxV) maxV = v;
            });
            if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return null;
            return { min: minV, max: maxV };
        }
        var minA = Infinity;
        var maxA = -Infinity;
        (node.groups || []).forEach(function (g) {
            var mm = minMaxRibbonNodeRates(g.child, anchorYmd, secStr);
            if (!mm) return;
            if (mm.min < minA) minA = mm.min;
            if (mm.max > maxA) maxA = mm.max;
        });
        if (!Number.isFinite(minA) || !Number.isFinite(maxA)) return null;
        return { min: minA, max: maxA };
    }

    function formatRibbonTierRateRange(mm) {
        if (!mm || !Number.isFinite(mm.min) || !Number.isFinite(mm.max)) return '';
        var a = mm.min.toFixed(2);
        var b = mm.max.toFixed(2);
        return a === b ? a + '%' : a + '%\u2013' + b + '%';
    }

    function collectRibbonNodeKeysInto(node, out, seen) {
        if (!node || node.kind === 'empty') return;
        if (node.kind === 'leaves') {
            node.products.forEach(function (p) {
                if (!p || !p.key || seen[p.key]) return;
                seen[p.key] = true;
                out.push(p.key);
            });
            return;
        }
        (node.groups || []).forEach(function (g) {
            collectRibbonNodeKeysInto(g.child, out, seen);
        });
    }

    function collectRibbonNodeKeys(node) {
        var out = [];
        collectRibbonNodeKeysInto(node, out, {});
        return out;
    }

    function ribbonProductSeriesKey(series, bankName, productName, row) {
        var latestRow = row;
        if ((!latestRow || typeof latestRow !== 'object' || Object.keys(latestRow).length === 0) && series && typeof series === 'object') {
            latestRow = (series.latestRow && typeof series.latestRow === 'object') ? series.latestRow : null;
            if ((!latestRow || Object.keys(latestRow).length === 0) && Array.isArray(series.points) && series.points.length) {
                var lastPoint = series.points[series.points.length - 1];
                if (lastPoint && lastPoint.row && typeof lastPoint.row === 'object') latestRow = lastPoint.row;
            }
        }
        var rawKey = latestRow && (
            latestRow.product_key ||
            latestRow.series_key ||
            latestRow.product_id
        );
        if (rawKey != null && String(rawKey).trim() !== '') return '[P]' + String(rawKey).trim();
        if (series && series.key != null && String(series.key).trim() !== '') return '[P]' + String(series.key).trim();
        return '[P]' + String(bankName || '').trim() + '|' + String(productName || 'Unknown').trim();
    }

    window.AR.ribbon.RIBBON_DEPOSIT_TIER_BANDS = RIBBON_DEPOSIT_TIER_BANDS;
    window.AR.ribbon.RIBBON_TERM_MONTH_BANDS = RIBBON_TERM_MONTH_BANDS;
    window.AR.ribbon.ribbonFiniteNumberOrNull = ribbonFiniteNumberOrNull;
    window.AR.ribbon.ribbonMoneyAmountFromText = ribbonMoneyAmountFromText;
    window.AR.ribbon.ribbonDepositTierBoundsFromLabel = ribbonDepositTierBoundsFromLabel;
    window.AR.ribbon.ribbonDepositTierBoundsFromRow = ribbonDepositTierBoundsFromRow;
    window.AR.ribbon.ribbonDepositTierBandEntriesForProduct = ribbonDepositTierBandEntriesForProduct;
    window.AR.ribbon.ribbonTermMonthsRoundedFromRow = ribbonTermMonthsRoundedFromRow;
    window.AR.ribbon.ribbonTermMonthBandEntriesForProduct = ribbonTermMonthBandEntriesForProduct;
    window.AR.ribbon.buildRibbonFieldGroups = buildRibbonFieldGroups;
    window.AR.ribbon.buildRibbonTierTree = buildRibbonTierTree;
    window.AR.ribbon.ribbonRateAtAnchorForHierarchy = ribbonRateAtAnchorForHierarchy;
    window.AR.ribbon.minMaxRibbonNodeRates = minMaxRibbonNodeRates;
    window.AR.ribbon.formatRibbonTierRateRange = formatRibbonTierRateRange;
    window.AR.ribbon.collectRibbonNodeKeys = collectRibbonNodeKeys;
    window.AR.ribbon.collectRibbonNodeKeysInto = collectRibbonNodeKeysInto;
    window.AR.ribbon.ribbonProductSeriesKey = ribbonProductSeriesKey;
})();
