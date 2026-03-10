(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    if (!root) return;

    var BASE_CHART_TYPES = [
        { value: 'scatter', label: 'Trend lines', selected: true },
        { value: 'bar', label: 'Ranking bars' },
        { value: 'box', label: 'Box summary' }
    ];
    var SHARED_ADVANCED_FIELDS = [
        {
            kind: 'select',
            id: 'filter-mode',
            label: 'Rate mode',
            title: 'Show all, daily-only, or historical-only rows',
            options: [
                { value: 'all', label: 'All', selected: true },
                { value: 'daily', label: 'Daily only' },
                { value: 'historical', label: 'Historical only' }
            ]
        },
        { kind: 'toggle', id: 'filter-include-manual', label: 'Include manual runs', title: 'Show data from manually triggered runs' },
        {
            kind: 'select',
            id: 'refresh-interval',
            label: 'Auto-refresh',
            title: 'How often to auto-refresh data (minutes, 0 = off)',
            options: [
                { value: '0', label: 'Off' },
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
                { value: '60', label: '1 hour', selected: true },
                { value: '120', label: '2 hours' }
            ]
        }
    ];
    var SECTION_UI = {
        'home-loans': {
            eyebrow: 'Home loans',
            title: 'Find the right mortgage rate for your scenario.',
            subtitle: 'Daily CDR-backed mortgage pricing arranged to help you narrow the field first, then inspect the evidence only when you need it.',
            statSecondaryLabel: 'Cash rate',
            statSecondaryValue: '...',
            statSecondaryTitle: 'Current RBA official cash rate',
            aboutText: 'Daily public CDR product data across variable and fixed home loans, owner-occupied and investment lending, and major LVR tiers.',
            scenarioTitle: 'Set your borrowing scenario',
            scenarioText: 'Describe the slice you care about once, then use the same scenario across the shortlist, exports, history, and notes.',
            studioTitle: 'Go deeper only when needed',
            studioText: 'Stay in the shortlist for quick decisions. Switch into deep analysis when you want pivots, metadata, or product history.',
            notesTitle: 'Methodology and context',
            minRatePlaceholder: '5.20',
            maxRatePlaceholder: '7.00',
            primaryNote: 'These limits apply to the headline rate shown in the shortlist. Comparison-rate filters live in Deep analysis.',
            advancedFields: [
                { kind: 'select', id: 'filter-security', label: 'Purpose', title: 'Owner-occupied (live in) or investment (rent out)' },
                { kind: 'select', id: 'filter-repayment', label: 'Repayment', title: 'Principal & Interest (P&I) or Interest Only (IO)' },
                { kind: 'select', id: 'filter-structure', label: 'Structure', title: 'Variable rate or fixed term (1-5 years)' },
                { kind: 'select', id: 'filter-lvr', label: 'LVR', title: 'Loan-to-Value Ratio -- how much you borrow vs property value' },
                { kind: 'select', id: 'filter-feature', label: 'Feature', title: 'Basic (no offset/redraw) or Premium (with offset/redraw)' },
                { kind: 'number', id: 'filter-min-comparison-rate', label: 'Min comparison', placeholder: '5.40', title: 'Minimum comparison interest rate' },
                { kind: 'number', id: 'filter-max-comparison-rate', label: 'Max comparison', placeholder: '7.20', title: 'Maximum comparison interest rate' }
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'Interest rate', selected: true },
                { value: 'comparison_rate', label: 'Comparison rate' },
                { value: 'annual_fee', label: 'Annual fee' },
                { value: 'rba_cash_rate', label: 'Cash rate' }
            ],
            chartX: [
                { value: 'collection_date', label: 'Date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'rate_structure', label: 'Structure' },
                { value: 'lvr_tier', label: 'LVR' },
                { value: 'feature_set', label: 'Feature' }
            ],
            chartGroups: [
                { value: '', label: 'None' },
                { value: 'product_key', label: 'Product', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'security_purpose', label: 'Purpose' },
                { value: 'rate_structure', label: 'Structure' },
                { value: 'lvr_tier', label: 'LVR' },
                { value: 'feature_set', label: 'Feature' },
                { value: 'repayment_type', label: 'Repayment' }
            ],
            comparisonText: 'Where lenders disclose them, comparison rates reflect the standard Australian benchmark of $150,000 over 25 years. Your own cost can differ materially.'
        },
        'savings': {
            eyebrow: 'Savings',
            title: 'Find the strongest savings rate for your rules.',
            subtitle: 'Daily CDR-backed deposit pricing arranged to surface the leaders quickly, then unpack rate conditions and history only when needed.',
            statSecondaryLabel: 'Series',
            statSecondaryValue: 'product_key continuity',
            statSecondaryTitle: 'Series continuity',
            aboutText: 'Daily public CDR savings data covering base, bonus, and introductory rates across major institutions and deposit tiers.',
            scenarioTitle: 'Set your saving scenario',
            scenarioText: 'Pick the account type, rate rules, and date window you care about. The shortlist and history views will stay anchored to that slice.',
            studioTitle: 'Inspect the conditions behind the rate',
            studioText: 'Use deep analysis when you want the full product metadata, pivots, and historical series behind the shortlist.',
            notesTitle: 'Context and continuity',
            minRatePlaceholder: '1.50',
            maxRatePlaceholder: '6.00',
            primaryNote: 'These limits apply to the headline rate shown in the shortlist.',
            advancedFields: [
                { kind: 'select', id: 'filter-account-type', label: 'Account type', title: 'Savings, transaction, or at-call' },
                { kind: 'select', id: 'filter-rate-type', label: 'Rate type', title: 'Base, bonus, introductory, or bundle rate' },
                { kind: 'select', id: 'filter-deposit-tier', label: 'Deposit tier', title: 'Balance range tier' }
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'Interest rate', selected: true },
                { value: 'monthly_fee', label: 'Monthly fee' }
            ],
            chartX: [
                { value: 'collection_date', label: 'Date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'account_type', label: 'Account type' },
                { value: 'rate_type', label: 'Rate type' },
                { value: 'deposit_tier', label: 'Deposit tier' }
            ],
            chartGroups: [
                { value: '', label: 'None' },
                { value: 'product_key', label: 'Product', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'account_type', label: 'Account type' },
                { value: 'rate_type', label: 'Rate type' },
                { value: 'deposit_tier', label: 'Deposit tier' }
            ],
            comparisonText: 'Historical charts stay anchored to the canonical product_key so each line represents one tracked savings product over time.'
        },
        'term-deposits': {
            eyebrow: 'Term deposits',
            title: 'Find the best term deposit for your term and balance.',
            subtitle: 'Daily CDR-backed term pricing arranged to help you narrow the choice first, then inspect terms, payments, and product history.',
            statSecondaryLabel: 'Series',
            statSecondaryValue: 'product_key continuity',
            statSecondaryTitle: 'Series continuity',
            aboutText: 'Daily public CDR term-deposit data across major institutions, with rates covering terms from one month through five years.',
            scenarioTitle: 'Set your deposit scenario',
            scenarioText: 'Choose the term, balance tier, and payment setup you care about, then compare current leaders before diving into detail.',
            studioTitle: 'Open the analysis studio when you need the detail',
            studioText: 'The shortlist stays simple. Deep analysis opens the full table, pivots, and product-level trend views for the same slice.',
            notesTitle: 'Context and continuity',
            minRatePlaceholder: '2.00',
            maxRatePlaceholder: '6.00',
            primaryNote: 'These limits apply to the headline rate shown in the shortlist.',
            advancedFields: [
                { kind: 'select', id: 'filter-term-months', label: 'Term', title: 'Term length in months' },
                { kind: 'select', id: 'filter-deposit-tier', label: 'Deposit tier', title: 'Minimum deposit range' },
                { kind: 'select', id: 'filter-interest-payment', label: 'Payment', title: 'Interest payment frequency' }
            ],
            chartMetrics: [{ value: 'interest_rate', label: 'Interest rate', selected: true }],
            chartX: [
                { value: 'collection_date', label: 'Date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'term_months', label: 'Term (months)' },
                { value: 'deposit_tier', label: 'Deposit tier' },
                { value: 'interest_payment', label: 'Payment' }
            ],
            chartGroups: [
                { value: '', label: 'None' },
                { value: 'product_key', label: 'Product', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'term_months', label: 'Term' },
                { value: 'deposit_tier', label: 'Deposit tier' },
                { value: 'interest_payment', label: 'Payment' }
            ],
            comparisonText: 'Historical charts stay anchored to the canonical product_key so each line represents one tracked term-deposit product over time.'
        }
    };

    function optionsMarkup(options) {
        return (options || []).map(function (option) {
            return '<option value="' + option.value + '"' + (option.selected ? ' selected' : '') + '>' + option.label + '</option>';
        }).join('');
    }

    function advancedFieldMarkup(field) {
        if (field.kind === 'toggle') {
            return '<label class="toggle-label" title="' + field.title + '"><input id="' + field.id + '" type="checkbox"> ' + field.label + '</label>';
        }
        if (field.kind === 'number') {
            return '<label title="' + field.title + '">' + field.label + '<input id="' + field.id + '" type="number" step="0.001" min="0" placeholder="' + field.placeholder + '"></label>';
        }
        return '<label title="' + field.title + '">' + field.label + '<select id="' + field.id + '">' + optionsMarkup(field.options || [{ value: '', label: 'All', selected: true }]) + '</select></label>';
    }

    function quickCompareMarkup() {
        return '<section class="panel insight-card quick-compare" aria-label="Current leaders"><div class="section-heading"><p class="section-kicker">Decision snapshot</p><h2>Start with the leaders</h2><p class="section-note">A compact view of the current slice before you open the full shortlist.</p></div><div id="quick-compare-cards" class="quick-compare-cards"></div></section>';
    }

    function executiveSummaryMarkup(ui) {
        if (section !== 'home-loans') {
            return '<section class="panel insight-card continuity-card" aria-label="Series continuity"><div class="section-heading"><p class="section-kicker">Series integrity</p><h2>Longitudinal continuity</h2><p class="comparison-rate-disclosure">' + ui.comparisonText + '</p></div></section>';
        }
        return '<section class="panel insight-card executive-summary" id="executive-summary-panel" aria-label="Executive summary"><div class="section-heading"><p class="section-kicker">What changed</p><h2>30-day market summary</h2><p class="section-note" id="executive-summary-status">Loading summary...</p></div><div id="executive-summary-sections" class="executive-summary-sections"></div></section>';
    }

    function rateChangeMarkup() {
        return '<section class="panel insight-card rate-change-log" aria-label="Rate change log"><details id="rate-change-details" class="rate-change-details"><summary id="rate-change-summary" class="rate-change-summary"><span class="rate-change-summary-title">Recent changes</span><span id="rate-change-headline" class="rate-change-headline">Loading changes...</span></summary><p id="rate-change-warning" class="rate-change-warning" hidden></p><p id="rate-change-status" class="hint">Loading changes...</p><ul id="rate-change-list" class="rate-change-list"><li class="rate-change-item-empty">Loading...</li></ul></details></section>';
    }

    function chartControlMarkup(ui) {
        return [
            '<div class="chart-question-row" role="group" aria-label="Chart questions">',
            '<button class="chart-preset" data-chart-view="lenders" type="button" aria-pressed="true">Who leads now</button>',
            '<button class="chart-preset" data-chart-view="surface" type="button" aria-pressed="false">What changed over time</button>',
            '<button class="chart-preset" data-chart-view="compare" type="button" aria-pressed="false">Track a shortlist</button>',
            '<button class="chart-preset" data-chart-view="distribution" type="button" aria-pressed="false">See the spread</button>',
            '</div>',
            '<div class="chart-controls">',
            '<label>Metric<select id="chart-y">' + optionsMarkup(ui.chartMetrics) + '</select></label>',
            '<label>Density<select id="chart-series-limit"><option value="compact">Compact</option><option value="standard" selected>Standard</option><option value="expanded">Expanded</option></select></label>',
            '<div class="chart-actions"><button id="draw-chart" type="button" class="small">Answer with chart</button></div>',
            '</div>',
            '<details class="chart-advanced"><summary>Custom analysis controls</summary><div class="chart-advanced-grid"><label>X axis<select id="chart-x">' + optionsMarkup(ui.chartX) + '</select></label><label>Group by<select id="chart-group">' + optionsMarkup(ui.chartGroups) + '</select></label><label>Chart type<select id="chart-type">' + optionsMarkup(BASE_CHART_TYPES) + '</select></label></div></details>'
        ].join('');
    }

    function uiScaleMarkup() {
        return '<div class="ui-scale-control" role="group" aria-label="Adjust reading comfort"><span class="ui-scale-label">Reading comfort</span><div class="ui-scale-actions"><button id="ui-scale-down" class="small secondary" type="button" aria-label="Reduce reading comfort">A-</button><input id="ui-scale-range" type="range" min="85" max="130" step="5" value="100" aria-label="Reading comfort"><button id="ui-scale-up" class="small secondary" type="button" aria-label="Increase reading comfort">A+</button></div><div class="ui-scale-meta"><output id="ui-scale-value" for="ui-scale-range" aria-live="polite">100%</output><button id="ui-scale-reset" class="small secondary" type="button">Reset</button></div></div>';
    }

    function marketNotesMarkup(ui) {
        return '<div class="market-notes-content-grid"><section class="market-notes-section" aria-label="How to use the workspace"><h2>' + ui.notesTitle + '</h2><p>The shortlist is designed for fast comparison first. Deep analysis reveals the full metadata table, pivots, and historical charts only when you want them.</p></section><section class="market-notes-section" aria-label="Disclosure"><h2>' + (section === 'home-loans' ? 'Comparison rates' : 'Series continuity') + '</h2><p id="comparison-rate-disclosure" class="comparison-rate-disclosure">' + ui.comparisonText + '</p></section></div>';
    }

    function render(ui) {
        root.innerHTML = [
            '<section class="page-intro">',
            '<header class="hero panel"><div class="hero-copy"><p class="eyebrow">' + ui.eyebrow + '</p><h1>' + ui.title + '</h1><p class="subtitle">' + ui.subtitle + '</p><div class="hero-actions" role="group" aria-label="Primary actions"><button id="hero-jump-rates" type="button">See the shortlist</button><button id="hero-open-charts" class="secondary" type="button">Open deep analysis</button><button id="hero-open-notes" class="secondary" type="button">Read the context</button></div><div class="hero-trust" aria-label="Why trust this workspace"><span class="hero-trust-pill">Daily public CDR data</span><span class="hero-trust-pill">No signup required</span><span class="hero-trust-pill">CSV, XLS, and JSON exports</span></div></div><div class="hero-aside"><div class="hero-stats" id="hero-stats"><div class="hero-stat" id="stat-updated" title="When rates were last collected"><span class="hero-stat-label">Updated</span><strong class="hero-stat-value">...</strong></div><div class="hero-stat" id="stat-cash-rate" title="' + ui.statSecondaryTitle + '"><span class="hero-stat-label">' + ui.statSecondaryLabel + '</span><strong class="hero-stat-value">' + ui.statSecondaryValue + '</strong></div><div class="hero-stat" id="stat-records" title="Total rate records in database"><span class="hero-stat-label">Records</span><strong class="hero-stat-value">...</strong></div></div><aside class="hero-guide" aria-label="How to use the workspace"><p class="hero-guide-kicker">Three-step flow</p><ol class="hero-guide-list"><li>Describe your scenario with a bank, rate band, date range, or product rules.</li><li>Read the shortlist first to compare live options without extra noise.</li><li>Open deep analysis only when you want pivots, chart evidence, or full metadata.</li></ol><p class="hero-guide-note">The same filters drive the shortlist, exports, charts, and notes.</p></aside></div></header>',
            '<details class="panel seo-summary"><summary>About this data</summary><p>' + ui.aboutText + '</p></details>',
            '</section>',
            '<section class="insight-band" aria-label="Market snapshot">',
            quickCompareMarkup(),
            executiveSummaryMarkup(ui),
            rateChangeMarkup(),
            '</section>',
            '<section class="workspace workspace-grid decision-flow" aria-label="Decision workspace">',
            '<section class="workspace-rail scenario-zone"><div class="section-heading section-heading-inline"><div><p class="section-kicker">Set the scenario</p><h2>' + ui.scenarioTitle + '</h2></div><p class="section-note">' + ui.scenarioText + '</p></div><section class="panel panel-wide scenario-builder" aria-label="Scenario builder"><div class="filter-primary-group"><label>Banks<span class="filter-bank-tools"><input id="filter-bank-search" type="search" placeholder="Search banks" aria-describedby="filter-bank-help"><button id="filter-bank-clear" class="small secondary filter-bank-clear" type="button">All banks</button></span><select id="filter-bank" multiple size="4" aria-describedby="filter-bank-help"></select><span id="filter-bank-help" class="filter-helper">Search to narrow the list or use All banks to clear your selection.</span></label><div class="filter-range"><label>Min headline rate<input id="filter-min-rate" type="number" step="0.001" min="0" placeholder="' + ui.minRatePlaceholder + '" aria-describedby="primary-rate-help"></label><label>Max headline rate<input id="filter-max-rate" type="number" step="0.001" min="0" placeholder="' + ui.maxRatePlaceholder + '" aria-describedby="primary-rate-help"></label></div><label>From<input id="filter-start-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD" aria-describedby="filter-date-status"></label><label>To<input id="filter-end-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD" aria-describedby="filter-date-status"></label></div><p id="primary-rate-help" class="filter-helper filter-primary-note">' + ui.primaryNote + '</p><div class="date-quick-actions" role="group" aria-label="Quick date ranges"><button class="small secondary date-quick-btn" type="button" data-date-range="7">Last 7 days</button><button class="small secondary date-quick-btn" type="button" data-date-range="30">Last 30 days</button><button class="small secondary date-quick-btn" type="button" data-date-range="all">All history</button></div><p id="filter-date-status" class="filter-helper input-helper" aria-live="polite">Enter dates in YYYY-MM-DD format.</p><div class="filter-primary-actions"><div class="filter-primary-actions-main"><button id="apply-filters" class="small" type="button">Refresh shortlist</button><button id="reset-filters" class="small secondary" type="button">Reset</button></div><div class="filter-primary-actions-meta"><label for="download-format" class="download-label">Download</label><select id="download-format" class="small" title="Download current table as CSV, XLS or JSON" aria-label="Download table format"><option value="">Choose format</option><option value="csv">CSV</option><option value="xls">XLS</option><option value="json">JSON</option></select><span id="last-refreshed" class="hint"></span></div></div><div class="filter-state-row"><span id="filter-dirty-indicator" class="filter-dirty-indicator">Filters applied</span><div id="active-filter-chips" class="active-filter-chips" aria-live="polite"></div></div><details class="filters panel filters-collapsible" id="filter-bar"><summary class="filters-toggle" aria-label="Show or hide deep analysis filters">Deep analysis filters</summary><div class="filters-grid">' + ui.advancedFields.concat(SHARED_ADVANCED_FIELDS).map(advancedFieldMarkup).join('') + '</div></details></section></section>',
            '<section class="decision-surface"><section class="panel workspace-summary" id="workspace-summary-panel" aria-live="polite"><div class="workspace-summary-top"><div class="workspace-summary-main"><p class="workspace-summary-kicker">Shortlist snapshot</p><h2 id="workspace-summary-title" class="workspace-summary-title">Loading the current shortlist...</h2><p id="workspace-summary-text" class="workspace-summary-text">Preparing the active slice and decision surfaces.</p></div><div class="workspace-summary-actions"><button id="workspace-focus-filters" class="small secondary" type="button">Focus scenario</button><button id="workspace-copy-link" class="small secondary" type="button">Copy current view</button>' + uiScaleMarkup() + '</div></div><div id="workspace-summary-pills" class="workspace-summary-pills"></div></section><section class="analysis-studio"><div class="section-heading section-heading-inline"><div><p class="section-kicker">Go deeper</p><h2>' + ui.studioTitle + '</h2></div><p class="section-note">' + ui.studioText + '</p></div><section class="panel mode-panel" aria-label="Depth toggle"><div class="mode-switch" role="group" aria-label="Select workspace depth"><button id="mode-consumer" class="mode-btn active" type="button" aria-pressed="true">Shortlist</button><button id="mode-analyst" class="mode-btn" type="button" aria-pressed="false">Deep analysis</button></div><p class="mode-note">Shortlist keeps the surface simple. Deep analysis unlocks pivots, charts, and full metadata.</p></section><nav class="tabs panel" role="tablist" aria-label="Analysis views"><button id="tab-explorer" class="tab-btn active" role="tab" aria-selected="true" aria-controls="panel-explorer" type="button">Rates</button><button id="tab-pivot" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-pivot" type="button">Pivot</button><button id="tab-charts" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-charts" type="button">Charts</button></nav><section id="panel-explorer" class="tab-panel active" role="tabpanel" aria-labelledby="tab-explorer"><div class="panel panel-wide results-panel"><div class="explorer-toolbar"><button id="table-settings-btn" class="table-settings-btn" type="button" title="Table settings" aria-label="Table settings" aria-expanded="false">&#9881;</button><div id="table-settings-popover" class="table-settings-popover" hidden></div></div><div class="results-intro"><div class="results-intro-copy"><p class="explorer-overview-kicker">Decision shortlist</p><h2 id="explorer-overview-title" class="explorer-overview-title">Loading the current rate table...</h2><p id="explorer-overview-text" class="explorer-overview-text">Preparing the first shortlist.</p></div><div class="explorer-overview-meta"><span id="explorer-overview-status" class="explorer-overview-pill is-loading">Loading</span></div></div><details class="panel rate-table-collapsible" id="rate-table-details" open><summary class="rate-table-toggle" aria-label="Show or hide rate table">Rate table</summary><div id="rate-table"></div></details></div></section><section id="panel-pivot" class="tab-panel" role="tabpanel" aria-labelledby="tab-pivot" hidden><div class="panel panel-wide"><div class="pivot-controls"><button id="load-pivot" type="button" class="small">Load pivot data</button><span id="pivot-status" class="hint">Define the scenario, then load the pivot view.</span></div><div id="pivot-output"></div></div></section><section id="panel-charts" class="tab-panel" role="tabpanel" aria-labelledby="tab-charts" hidden><div class="panel panel-wide"><div class="chart-shell"><div class="chart-hero"><div class="chart-hero-copy"><p class="chart-kicker">Chart answers</p><h2>See who leads, what moved, and which product is worth following.</h2><p class="chart-hero-note">Start with the question row, then open custom controls only if you need a different cut of the same scenario.</p></div><div class="chart-meta"><p id="chart-guidance" class="chart-guidance">Who leads now ranks the best current product for each lender in the current slice.</p><div id="chart-summary" class="chart-summary" aria-live="polite"><span class="chart-summary-pill">Awaiting first render</span></div></div></div>' + chartControlMarkup(ui) + '<div class="chart-canvas-shell"><div class="chart-main-stage"><div id="chart-output" aria-label="Interactive chart"></div><p id="chart-status" class="hint">Choose a question, then render the chart.</p></div><aside class="chart-series-rail" aria-label="Visible chart series"><div class="chart-series-rail-header"><div><p class="chart-series-kicker">Spotlight</p><h3>Shortlist and evidence</h3></div><p id="chart-series-note" class="chart-series-note">Draw a chart to activate the analysis surface.</p></div><div id="chart-point-details" class="chart-point-details" aria-live="polite"></div><div id="chart-detail-output" class="chart-detail-output" aria-label="Focused detail trend"></div><div id="chart-series-list" class="chart-series-list"><p class="chart-series-empty">Visible products and selected comparison lines will appear here.</p></div></aside></div><div id="chart-data-summary" class="chart-data-summary" aria-live="polite"><p class="chart-data-summary-empty">Draw a chart to populate the summary table.</p></div></div></div></section></section></section>',
            '</section>',
            '<section class="decision-notes"><details class="panel market-notes" id="market-notes"><summary class="market-notes-summary">Context and disclosures</summary>' + marketNotesMarkup(ui) + '</details></section>'
        ].join('');
    }

    render(SECTION_UI[section] || SECTION_UI['home-loans']);
})();
