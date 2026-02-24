(function () {
    'use strict';
    window.AR = window.AR || {};

    var path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    var sectionFromPath = (path.indexOf('/savings') !== -1) ? 'savings' : (path.indexOf('/term-deposits') !== -1) ? 'term-deposits' : null;
    var section = window.AR_SECTION || sectionFromPath || 'home-loans';

    var sections = {
        'home-loans': {
            apiPath: '/api/home-loan-rates',
            heroEyebrow: 'Australian Home Loan Rate Tracker',
            heroHeading: 'Compare mortgage rates from major banks',
            heroSubtitle: 'Updated daily from official Consumer Data Right (CDR) feeds. Explore, pivot, and chart rates across all collection dates.',
            filterFields: [
                { id: 'filter-bank', param: 'bank', label: 'Bank', url: 'bank' },
                { id: 'filter-security', param: 'security_purpose', label: 'Purpose', url: 'purpose', title: 'Owner-occupied (live in) or investment (rent out)' },
                { id: 'filter-repayment', param: 'repayment_type', label: 'Repayment', url: 'repayment', title: 'Principal & Interest (P&I) or Interest Only (IO)' },
                { id: 'filter-structure', param: 'rate_structure', label: 'Structure', url: 'structure', title: 'Variable rate or fixed term (1-5 years)' },
                { id: 'filter-lvr', param: 'lvr_tier', label: 'LVR', url: 'lvr', title: 'Loan-to-Value Ratio' },
                { id: 'filter-feature', param: 'feature_set', label: 'Feature', url: 'feature', title: 'Basic or Premium (with offset/redraw)' }
            ],
            filterApiMap: {
                'filter-bank': 'banks',
                'filter-security': 'security_purposes',
                'filter-repayment': 'repayment_types',
                'filter-structure': 'rate_structures',
                'filter-lvr': 'lvr_tiers',
                'filter-feature': 'feature_sets'
            },
            pivotDefaults: { rows: ['Bank'], cols: ['Structure'], vals: ['Interest Rate (%)'], aggregator: 'Average (as %)' },
            pivotFieldLabels: {
                collection_date: 'Date', bank_name: 'Bank', interest_rate: 'Interest Rate (%)',
                comparison_rate: 'Comparison Rate (%)', rate_structure: 'Structure', security_purpose: 'Purpose',
                repayment_type: 'Repayment', lvr_tier: 'LVR', feature_set: 'Feature', product_name: 'Product',
                annual_fee: 'Annual Fee ($)', rba_cash_rate: 'Cash Rate (%)', run_source: 'Source',
                parsed_at: 'Checked At', source_url: 'Source URL', data_quality_flag: 'Quality'
            },
            chartHint: 'For rate over time per product: X = Date, Group by = Product, filter by one bank.'
        },
        'savings': {
            apiPath: '/api/savings-rates',
            heroEyebrow: 'Australian Savings Rate Tracker',
            heroHeading: 'Compare savings rates from major banks',
            heroSubtitle: 'Updated daily from official Consumer Data Right (CDR) feeds. Explore, pivot, and chart savings rates across all banks.',
            filterFields: [
                { id: 'filter-bank', param: 'bank', label: 'Bank', url: 'bank' },
                { id: 'filter-account-type', param: 'account_type', label: 'Account Type', url: 'account_type', title: 'Savings, transaction, or at-call' },
                { id: 'filter-rate-type', param: 'rate_type', label: 'Rate Type', url: 'rate_type', title: 'Base, bonus, introductory, or bundle rate' },
                { id: 'filter-deposit-tier', param: 'deposit_tier', label: 'Deposit Tier', url: 'deposit_tier', title: 'Balance range tier' }
            ],
            filterApiMap: {
                'filter-bank': 'banks',
                'filter-account-type': 'account_types',
                'filter-rate-type': 'rate_types',
                'filter-deposit-tier': 'deposit_tiers'
            },
            pivotDefaults: { rows: ['Bank'], cols: ['Rate Type'], vals: ['Interest Rate (%)'], aggregator: 'Average (as %)' },
            pivotFieldLabels: {
                collection_date: 'Date', bank_name: 'Bank', interest_rate: 'Interest Rate (%)',
                account_type: 'Account Type', rate_type: 'Rate Type', deposit_tier: 'Deposit Tier',
                product_name: 'Product', conditions: 'Conditions', monthly_fee: 'Monthly Fee ($)',
                run_source: 'Source', parsed_at: 'Checked At', source_url: 'Source URL',
                data_quality_flag: 'Quality'
            },
            chartHint: 'For rate over time per product: X = Date, Group by = Product, filter by one bank.'
        },
        'term-deposits': {
            apiPath: '/api/term-deposit-rates',
            heroEyebrow: 'Australian Term Deposit Rate Tracker',
            heroHeading: 'Compare term deposit rates from major banks',
            heroSubtitle: 'Updated daily from official Consumer Data Right (CDR) feeds. Explore, pivot, and chart term deposit rates.',
            filterFields: [
                { id: 'filter-bank', param: 'bank', label: 'Bank', url: 'bank' },
                { id: 'filter-term-months', param: 'term_months', label: 'Term', url: 'term_months', title: 'Term length in months' },
                { id: 'filter-deposit-tier', param: 'deposit_tier', label: 'Deposit Tier', url: 'deposit_tier', title: 'Minimum deposit range' },
                { id: 'filter-interest-payment', param: 'interest_payment', label: 'Payment', url: 'interest_payment', title: 'Interest payment frequency' }
            ],
            filterApiMap: {
                'filter-bank': 'banks',
                'filter-term-months': 'term_months',
                'filter-deposit-tier': 'deposit_tiers',
                'filter-interest-payment': 'interest_payments'
            },
            pivotDefaults: { rows: ['Bank'], cols: ['Term (months)'], vals: ['Interest Rate (%)'], aggregator: 'Average (as %)' },
            pivotFieldLabels: {
                collection_date: 'Date', bank_name: 'Bank', interest_rate: 'Interest Rate (%)',
                term_months: 'Term (months)', deposit_tier: 'Deposit Tier', interest_payment: 'Payment Frequency',
                product_name: 'Product', min_deposit: 'Min Deposit ($)', max_deposit: 'Max Deposit ($)',
                run_source: 'Source', parsed_at: 'Checked At', source_url: 'Source URL',
                data_quality_flag: 'Quality'
            },
            chartHint: 'For rate over time per product: X = Date, Group by = Product, filter by one bank.'
        }
    };

    window.AR.section = section;
    window.AR.sectionConfig = sections[section] || sections['home-loans'];
    window.AR.allSections = sections;
})();
