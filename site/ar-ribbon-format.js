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

    function ribbonTierFieldsForSection(sec) {
        var s = String(sec || '');
        if (s === 'home-loans') {
            return ['security_purpose', 'repayment_type', 'rate_structure', 'lvr_tier', 'feature_set', 'product_name', 'product_id'];
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
            if (/^owner/i.test(v)) return 'Owner';
            if (/^investment/i.test(v)) return 'Investor';
        }
        if (f === 'repayment_type') {
            if (/interest\s*only/i.test(v)) return 'Interest only';
            if (/principal/i.test(v)) return 'P&I';
        }
        if (f === 'rate_structure') {
            if (/^variable$/i.test(v)) return 'Variable';
            var fixedYears = v.match(/fixed\s+(\d+)\s+year/i);
            if (fixedYears) return fixedYears[1] + 'Y fixed';
            if (/^fixed$/i.test(v)) return 'Fixed';
        }
        if (f === 'account_type') {
            if (/^transaction$/i.test(v)) return 'Transaction';
        }
        if (f === 'rate_type') {
            if (/^introductory$/i.test(v)) return 'Introductory';
        }
        if (f === 'term_months') {
            var months = Number(v);
            if (Number.isFinite(months) && months > 0) {
                var m = Math.round(months);
                if (m >= 12 && m % 12 === 0) {
                    var years = m / 12;
                    return years + (years === 1 ? ' year' : ' years');
                }
                return m + ' months';
            }
        }
        return v;
    }

    function ribbonCompactFieldLabel(field) {
        var f = String(field || '');
        if (f === 'security_purpose') return 'Purpose';
        if (f === 'repayment_type') return 'Repayment';
        if (f === 'rate_structure') return 'Structure';
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
    window.AR.ribbon.ribbonTierFieldsForSection = ribbonTierFieldsForSection;
    window.AR.ribbon.ribbonInitialTierFieldsForSection = ribbonInitialTierFieldsForSection;
    window.AR.ribbon.formatRibbonTierValue = formatRibbonTierValue;
    window.AR.ribbon.ribbonFieldLabel = ribbonFieldLabel;
    window.AR.ribbon.ribbonCompactTierValue = ribbonCompactTierValue;
    window.AR.ribbon.ribbonCompactFieldLabel = ribbonCompactFieldLabel;
    window.AR.ribbon.ribbonCompactBranchLabel = ribbonCompactBranchLabel;
})();
