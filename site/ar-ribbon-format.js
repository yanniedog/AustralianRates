(function () {
    'use strict';
    window.AR = window.AR || {};
    window.AR.ribbon = window.AR.ribbon || {};

    function ribbonBankShortName(bankName) {
        var shared = window.AR && window.AR.chartMacroLwcShared;
        if (shared && typeof shared.bankAcronym === 'function') return shared.bankAcronym(bankName);
        return String(bankName || '').trim();
    }

    function ribbonRangeText(lo, hi) {
        if (lo == null && hi == null) return '';
        if (lo != null && hi != null) {
            return lo !== hi ? lo.toFixed(2) + '\u2013' + hi.toFixed(2) + '%' : lo.toFixed(2) + '%';
        }
        var one = lo != null ? lo : hi;
        return one != null ? one.toFixed(2) + '%' : '';
    }

    function ribbonSpreadBpText(lo, hi) {
        if (lo == null || hi == null || hi < lo) return '';
        return Math.round((hi - lo) * 100) + 'bp spread';
    }

    function ribbonFixedRateTermValue(raw) {
        var value = String(raw || '').trim().toLowerCase();
        if (!value || value === 'variable') return '';
        var fixedYears = value.match(/^fixed_(\d+)yr$/) || value.match(/fixed[^0-9]*(\d+)/);
        return fixedYears ? String(Number(fixedYears[1])) : '';
    }

    function ribbonRateStructureGroupValue(raw) {
        var value = String(raw || '').trim().toLowerCase();
        if (!value) return '';
        if (value === 'variable') return 'variable';
        if (value === 'fixed' || ribbonFixedRateTermValue(value)) return 'fixed';
        return value;
    }

    function ribbonTierFieldsForSection(sec) {
        var s = String(sec || '');
        if (s === 'home-loans') {
            return ['security_purpose', 'repayment_type', 'rate_structure', 'fixed_rate_term', 'lvr_tier', 'feature_set', 'product_name', 'product_id'];
        }
        if (s === 'savings') {
            return ['account_type', 'rate_type', 'deposit_tier', 'feature_set', 'product_name', 'product_id'];
        }
        if (s === 'term-deposits') {
            return ['term_months', 'deposit_tier', 'interest_payment', 'rate_structure', 'feature_set', 'product_name', 'product_id'];
        }
        return ['security_purpose', 'repayment_type', 'rate_structure', 'product_name', 'product_id'];
    }

    function ribbonInitialTierFieldsForSection(sec) {
        var fields = ribbonTierFieldsForSection(sec).slice();
        var insertAt = fields.indexOf('feature_set');
        if (insertAt < 0) insertAt = Math.max(1, fields.length - 2);
        if (fields.indexOf('bank_name') < 0) fields.splice(insertAt, 0, 'bank_name');
        return fields;
    }

    function formatRibbonTierValue(row, field) {
        if (!row || typeof row !== 'object') return '';
        if (field === 'rate_structure') return ribbonRateStructureGroupValue(row.rate_structure);
        if (field === 'fixed_rate_term') return ribbonFixedRateTermValue(row.rate_structure);
        if (field === 'term_months') {
            var months = Number(row.term_months);
            return Number.isFinite(months) && months > 0 ? String(Math.round(months)) : '';
        }
        var cfg = window.AR && window.AR.chartConfig;
        if (cfg && typeof cfg.formatFieldValue === 'function') {
            var out = cfg.formatFieldValue(field, row[field], row);
            if (out != null && String(out).trim() !== '' && String(out) !== '-') return String(out).trim();
        }
        if (row[field] != null && String(row[field]).trim() !== '') return String(row[field]).trim();
        return '';
    }

    function ribbonFieldLabel(field) {
        var cfg = window.AR && window.AR.chartConfig;
        if (cfg && typeof cfg.fieldLabel === 'function') return cfg.fieldLabel(field);
        return String(field || '').replace(/_/g, ' ');
    }

    function ribbonCompactTierValue(field, value) {
        var f = String(field || '');
        var v = String(value || '').trim();
        if (!v) return '';
        if (f === 'security_purpose') {
            if (/^owner/i.test(v)) return 'Owner Occupier';
            if (/^investment/i.test(v)) return 'Investor';
        }
        if (f === 'repayment_type') {
            if (/interest\s*only/i.test(v)) return 'Interest only';
            if (/principal/i.test(v)) return 'P&I';
        }
        if (f === 'rate_structure') {
            if (/^variable$/i.test(v)) return 'Variable';
            if (/^fixed$/i.test(v)) return 'Fixed';
            var fixedYears = v.match(/^fixed_(\d+)yr$/i) || v.match(/fixed[^0-9]*(\d+)/i);
            if (fixedYears) return fixedYears[1] + 'Y';
        }
        if (f === 'fixed_rate_term') {
            var years = Number(v);
            if (Number.isFinite(years) && years > 0) return Math.round(years) + 'Y';
            if (/^fixed$/i.test(v)) return 'Fixed';
        }
        if (f === 'account_type') {
            if (/^transaction$/i.test(v)) return 'Transaction';
        }
        if (f === 'rate_type') {
            if (/^introductory$/i.test(v)) return 'Introductory';
        }
        if (f === 'term_months') {
            var t = String(v || '').trim();
            if (/^[0-9]+$/.test(t)) {
                var months = Number(t);
                if (Number.isFinite(months) && months > 0) return Math.round(months) + 'm';
            }
            if (t && /month/i.test(t)) {
                return t.replace(/\s+months?/gi, 'm').replace(/\s+/g, ' ').trim();
            }
            if (t) return t;
        }
        if (f === 'product_name') {
            return ribbonTrimProductName(v);
        }
        return v;
    }

    /**
     * Strip redundant descriptors that appear higher in the hierarchy
     * (e.g. "(Owner Occupied)", trailing bank suffix) from product names
     * so the tree reads compactly.
     */
    function ribbonTrimProductName(raw) {
        var s = String(raw || '').trim();
        if (!s) return s;
        s = s.replace(/\s*\((?:owner\s*occupied|owner\s*occupier|investor|investment)\s*\)\s*/gi, ' ');
        s = s.replace(/\s*-\s*(?:owner\s*occupied|owner\s*occupier|investor|investment)\s*/gi, ' ');
        s = s.replace(/\s*\((?:P\s*&\s*I|principal\s*&\s*interest|interest\s*only|IO)\s*\)\s*/gi, ' ');
        s = s.replace(/\s*\((?:variable|fixed(?:\s+\d+\s*y(?:ear|rs)?)?)\s*\)\s*/gi, ' ');
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    function ribbonCompactFieldLabel(field) {
        var f = String(field || '');
        if (f === 'security_purpose') return 'Purpose';
        if (f === 'repayment_type') return 'Repayment';
        if (f === 'rate_structure') return 'Structure';
        if (f === 'fixed_rate_term') return 'Fixed term';
        if (f === 'account_type') return 'Account';
        if (f === 'rate_type') return 'Rate type';
        if (f === 'deposit_tier') return 'Deposit';
        if (f === 'term_months') return 'Term';
        if (f === 'interest_payment') return 'Interest';
        if (f === 'feature_set') return 'Features';
        if (f === 'lvr_tier') return 'LVR';
        if (f === 'bank_name') return 'Lender';
        if (f === 'product_name') return 'Product';
        return ribbonFieldLabel(field);
    }

    function ribbonCompactBranchLabel(field, value, mode) {
        var compactValue = ribbonCompactTierValue(field, value);
        if (mode === 'crumb') return compactValue || ribbonCompactFieldLabel(field);
        return compactValue || (ribbonCompactFieldLabel(field) + ': ' + String(value || ''));
    }

    window.AR.ribbon.ribbonBankShortName = ribbonBankShortName;
    window.AR.ribbon.ribbonRangeText = ribbonRangeText;
    window.AR.ribbon.ribbonSpreadBpText = ribbonSpreadBpText;
    window.AR.ribbon.ribbonFixedRateTermValue = ribbonFixedRateTermValue;
    window.AR.ribbon.ribbonRateStructureGroupValue = ribbonRateStructureGroupValue;
    window.AR.ribbon.ribbonTierFieldsForSection = ribbonTierFieldsForSection;
    window.AR.ribbon.ribbonInitialTierFieldsForSection = ribbonInitialTierFieldsForSection;
    window.AR.ribbon.formatRibbonTierValue = formatRibbonTierValue;
    window.AR.ribbon.ribbonFieldLabel = ribbonFieldLabel;
    window.AR.ribbon.ribbonCompactTierValue = ribbonCompactTierValue;
    window.AR.ribbon.ribbonCompactFieldLabel = ribbonCompactFieldLabel;
    window.AR.ribbon.ribbonCompactBranchLabel = ribbonCompactBranchLabel;
    window.AR.ribbon.ribbonTrimProductName = ribbonTrimProductName;
})();
