(function () {
    'use strict';
    window.AR = window.AR || {};

    var section = window.AR.section || 'home-loans';
    var sectionConfig = window.AR.sectionConfig || {};
    var utils = window.AR.utils || {};
    var formatFilterValue = utils.formatFilterValue || function (_field, value) { return String(value == null ? '' : value); };
    var pct = utils.pct || function (value) { return String(value == null ? '' : value); };
    var money = utils.money || function (value) { return String(value == null ? '' : value); };

    var DEFAULT_LABELS = {
        collection_date: 'Date',
        bank_name: 'Bank',
        product_key: 'Product',
        product_name: 'Product',
        interest_rate: 'Interest rate',
        comparison_rate: 'Comparison rate',
        annual_fee: 'Annual fee',
        monthly_fee: 'Monthly fee',
        rba_cash_rate: 'Cash rate',
        account_type: 'Account type',
        rate_type: 'Rate type',
        deposit_tier: 'Deposit tier',
        term_months: 'Term (months)',
        interest_payment: 'Payment frequency',
        feature_set: 'Feature',
        rate_structure: 'Structure',
        repayment_type: 'Repayment',
        security_purpose: 'Purpose',
        lvr_tier: 'LVR',
    };

    var SECTION_PALETTES = {
        'home-loans': ['#4f8dff', '#4fd2ff', '#8ed0ff', '#1b4da5'],
        'savings': ['#4ecb92', '#7de6b3', '#71b4ff', '#1d7155'],
        'term-deposits': ['#ecb36b', '#ffd29c', '#7ab7ff', '#8e5a16'],
    };

    var DENSITIES = {
        compact: { key: 'compact', label: 'Compact', rowLimit: 12, compareLimit: 4 },
        standard: { key: 'standard', label: 'Standard', rowLimit: 24, compareLimit: 6 },
        expanded: { key: 'expanded', label: 'Expanded', rowLimit: 40, compareLimit: 8 },
    };

    function titleCase(value) {
        return String(value || '')
            .split('_')
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
    }

    function buildFieldLabels() {
        var labels = {};
        Object.keys(DEFAULT_LABELS).forEach(function (key) {
            labels[key] = DEFAULT_LABELS[key];
        });
        Object.keys(sectionConfig.pivotFieldLabels || {}).forEach(function (key) {
            labels[key] = sectionConfig.pivotFieldLabels[key];
        });
        return labels;
    }

    var FIELD_LABELS = buildFieldLabels();

    function fieldLabel(field) {
        return FIELD_LABELS[field] || titleCase(field);
    }

    function isDateField(field) {
        return /date|_at$/i.test(String(field || ''));
    }

    function isMoneyField(field) {
        return /fee|deposit|balance/i.test(String(field || ''));
    }

    function isPercentField(field) {
        return /rate/i.test(String(field || ''));
    }

    function formatNumber(field, value) {
        var num = Number(value);
        if (!Number.isFinite(num)) return String(value == null ? '-' : value);
        if (isMoneyField(field)) return money(num);
        if (isPercentField(field)) return pct(num);
        return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function formatFieldValue(field, value, row) {
        if (value == null || value === '') return '-';
        var displayKey = String(field || '') + '_display';
        if (row && row[displayKey]) return String(row[displayKey]);
        if (typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(value))) {
            return formatNumber(field, value);
        }
        if (isDateField(field)) return String(value);
        return formatFilterValue(field, value) || String(value);
    }

    function formatMetricValue(field, value) {
        return formatFieldValue(field, value, null);
    }

    function palette() {
        return SECTION_PALETTES[section] || SECTION_PALETTES['home-loans'];
    }

    function parseDensity(value) {
        var key = String(value || 'standard').trim().toLowerCase();
        return DENSITIES[key] || DENSITIES.standard;
    }

    function defaultView() {
        return 'surface';
    }

    function defaultMetric() {
        return 'interest_rate';
    }

    function defaultFields() {
        return {
            xField: 'collection_date',
            yField: defaultMetric(),
            groupField: 'product_key',
            chartType: 'scatter',
            density: 'standard',
            view: defaultView(),
        };
    }

    window.AR.chartConfig = {
        defaultFields: defaultFields,
        defaultView: defaultView,
        defaultMetric: defaultMetric,
        densities: DENSITIES,
        fieldLabel: fieldLabel,
        formatFieldValue: formatFieldValue,
        formatMetricValue: formatMetricValue,
        isDateField: isDateField,
        isMoneyField: isMoneyField,
        isPercentField: isPercentField,
        palette: palette,
        parseDensity: parseDensity,
    };
})();
