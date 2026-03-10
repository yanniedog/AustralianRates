(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    if (!root) return;

    var BASE_CHART_TYPES = [
        { value: 'scatter', label: 'Trend lines', selected: true },
        { value: 'bar', label: 'Ranking bars' },
        { value: 'box', label: 'Box summary' },
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
                { value: 'historical', label: 'Historical only' },
            ],
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
                { value: '120', label: '2 hours' },
            ],
        },
    ];
    var SECTION_UI = {
        'home-loans': {
            eyebrow: 'Home loans',
            title: 'Compare current mortgage rates.',
            subtitle: 'Daily CDR-backed rates from major Australian lenders, with fast comparison first and deeper analysis on demand.',
            statSecondaryLabel: 'Cash rate',
            statSecondaryValue: '...',
            statSecondaryTitle: 'Current RBA official cash rate',
            aboutText: 'Daily public CDR product data across variable and fixed home loans, owner-occupied and investment lending, and all major LVR tiers.',
            minRatePlaceholder: '5.20',
            maxRatePlaceholder: '7.00',
            primaryNote: 'These limits apply to the headline rate shown in the table. Comparison-rate filters live in Advanced analysis.',
            advancedFields: [
                { kind: 'select', id: 'filter-security', label: 'Purpose', title: 'Owner-occupied (live in) or investment (rent out)' },
                { kind: 'select', id: 'filter-repayment', label: 'Repayment', title: 'Principal & Interest (P&I) or Interest Only (IO)' },
                { kind: 'select', id: 'filter-structure', label: 'Structure', title: 'Variable rate or fixed term (1-5 years)' },
                { kind: 'select', id: 'filter-lvr', label: 'LVR', title: 'Loan-to-Value Ratio -- how much you borrow vs property value' },
                { kind: 'select', id: 'filter-feature', label: 'Feature', title: 'Basic (no offset/redraw) or Premium (with offset/redraw)' },
                { kind: 'number', id: 'filter-min-comparison-rate', label: 'Min comparison', placeholder: '5.40', title: 'Minimum comparison interest rate' },
                { kind: 'number', id: 'filter-max-comparison-rate', label: 'Max comparison', placeholder: '7.20', title: 'Maximum comparison interest rate' },
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'Interest rate', selected: true },
                { value: 'comparison_rate', label: 'Comparison rate' },
                { value: 'annual_fee', label: 'Annual fee' },
                { value: 'rba_cash_rate', label: 'Cash rate' },
            ],
            chartX: [
                { value: 'collection_date', label: 'Date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'rate_structure', label: 'Structure' },
                { value: 'lvr_tier', label: 'LVR' },
                { value: 'feature_set', label: 'Feature' },
            ],
            chartGroups: [
                { value: '', label: 'None' },
                { value: 'product_key', label: 'Product', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'security_purpose', label: 'Purpose' },
                { value: 'rate_structure', label: 'Structure' },
                { value: 'lvr_tier', label: 'LVR' },
                { value: 'feature_set', label: 'Feature' },
                { value: 'repayment_type', label: 'Repayment' },
            ],
            marketNotes: 'home-loans',
            comparisonText: 'Where lenders disclose them, comparison rates reflect the standard Australian benchmark of $150,000 over 25 years. Your own cost can differ materially.',
        },
        'savings': {
            eyebrow: 'Savings',
            title: 'Compare current savings rates.',
            subtitle: 'Daily CDR-backed deposit pricing from major banks, kept simple by default and deeper only when you need it.',
            statSecondaryLabel: 'Series',
            statSecondaryValue: 'product_key continuity',
            statSecondaryTitle: 'Series continuity',
            aboutText: 'Daily public CDR savings data covering base, bonus, and introductory rates across major institutions and deposit tiers.',
            minRatePlaceholder: '1.50',
            maxRatePlaceholder: '6.00',
            primaryNote: 'These limits apply to the headline rate shown in the table.',
            advancedFields: [
                { kind: 'select', id: 'filter-account-type', label: 'Account type', title: 'Savings, transaction, or at-call' },
                { kind: 'select', id: 'filter-rate-type', label: 'Rate type', title: 'Base, bonus, introductory, or bundle rate' },
                { kind: 'select', id: 'filter-deposit-tier', label: 'Deposit tier', title: 'Balance range tier' },
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'Interest rate', selected: true },
                { value: 'monthly_fee', label: 'Monthly fee' },
            ],
            chartX: [
                { value: 'collection_date', label: 'Date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'account_type', label: 'Account type' },
                { value: 'rate_type', label: 'Rate type' },
                { value: 'deposit_tier', label: 'Deposit tier' },
            ],
            chartGroups: [
                { value: '', label: 'None' },
                { value: 'product_key', label: 'Product', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'account_type', label: 'Account type' },
                { value: 'rate_type', label: 'Rate type' },
                { value: 'deposit_tier', label: 'Deposit tier' },
            ],
            marketNotes: 'series',
            comparisonText: 'Historical charts stay anchored to the canonical product_key so each line represents one tracked savings product over time.',
        },
        'term-deposits': {
            eyebrow: 'Term deposits',
            title: 'Compare current term deposit rates.',
            subtitle: 'Daily CDR-backed term pricing from major banks, presented simply first and with analysis tools tucked away.',
            statSecondaryLabel: 'Series',
            statSecondaryValue: 'product_key continuity',
            statSecondaryTitle: 'Series continuity',
            aboutText: 'Daily public CDR term-deposit data across major institutions, with rates covering terms from one month through five years.',
            minRatePlaceholder: '2.00',
            maxRatePlaceholder: '6.00',
            primaryNote: 'These limits apply to the headline rate shown in the table.',
            advancedFields: [
                { kind: 'select', id: 'filter-term-months', label: 'Term', title: 'Term length in months' },
                { kind: 'select', id: 'filter-deposit-tier', label: 'Deposit tier', title: 'Minimum deposit range' },
                { kind: 'select', id: 'filter-interest-payment', label: 'Payment', title: 'Interest payment frequency' },
            ],
            chartMetrics: [{ value: 'interest_rate', label: 'Interest rate', selected: true }],
            chartX: [
                { value: 'collection_date', label: 'Date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'term_months', label: 'Term (months)' },
                { value: 'deposit_tier', label: 'Deposit tier' },
                { value: 'interest_payment', label: 'Payment' },
            ],
            chartGroups: [
                { value: '', label: 'None' },
                { value: 'product_key', label: 'Product', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'term_months', label: 'Term' },
                { value: 'deposit_tier', label: 'Deposit tier' },
                { value: 'interest_payment', label: 'Payment' },
            ],
            marketNotes: 'series',
            comparisonText: 'Historical charts stay anchored to the canonical product_key so each line represents one tracked term-deposit product over time.',
        },
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

    function rateChangeMarkup() {
        return '<section class="market-notes-section rate-change-log" aria-label="Rate change log"><details id="rate-change-details" class="rate-change-details"><summary id="rate-change-summary" class="rate-change-summary"><span class="rate-change-summary-title">Recent changes</span><span id="rate-change-headline" class="rate-change-headline">Loading changes...</span></summary><p id="rate-change-warning" class="rate-change-warning" hidden></p><p id="rate-change-status" class="hint">Loading changes...</p><ul id="rate-change-list" class="rate-change-list"><li class="rate-change-item-empty">Loading...</li></ul></details></section>';
    }

    function marketNotesMarkup(ui) {
        var summary = '<section class="market-notes-section quick-compare" aria-label="Quick compare summary"><h2>Snapshot</h2><div id="quick-compare-cards" class="quick-compare-cards"></div></section>';
        if (ui.marketNotes === 'home-loans') {
            return summary
                + '<section class="market-notes-section executive-summary" id="executive-summary-panel" aria-label="Executive summary"><h2>30-day summary</h2><p id="executive-summary-status" class="hint">Loading summary...</p><div id="executive-summary-sections" class="executive-summary-sections"></div></section>'
                + rateChangeMarkup()
                + '<section class="market-notes-section" aria-label="Comparison rate disclosure"><h2>Comparison rates</h2><p id="comparison-rate-disclosure" class="comparison-rate-disclosure">' + ui.comparisonText + '</p></section>';
        }
        return summary
            + rateChangeMarkup()
            + '<section class="market-notes-section" aria-label="Series continuity"><h2>Series continuity</h2><p id="comparison-rate-disclosure" class="comparison-rate-disclosure">' + ui.comparisonText + '</p></section>';
    }

    function chartControlMarkup(ui) {
        return '<div class="chart-controls"><label>Metric<select id="chart-y">' + optionsMarkup(ui.chartMetrics) + '</select></label><label>Density<select id="chart-series-limit"><option value="compact">Compact</option><option value="standard" selected>Standard</option><option value="expanded">Expanded</option></select></label><div class="chart-actions"><button id="draw-chart" type="button" class="small">Draw chart</button></div></div>'
            + '<details class="chart-advanced"><summary>Advanced controls</summary><div class="chart-advanced-grid"><label>X axis<select id="chart-x">' + optionsMarkup(ui.chartX) + '</select></label><label>Group by<select id="chart-group">' + optionsMarkup(ui.chartGroups) + '</select></label><label>Chart type<select id="chart-type">' + optionsMarkup(BASE_CHART_TYPES) + '</select></label></div></details>';
    }

    function uiScaleMarkup() {
        return '<div class="ui-scale-control" role="group" aria-label="Resize the interface">'
            + '<span class="ui-scale-label">Screen size</span>'
            + '<div class="ui-scale-actions">'
            + '<button id="ui-scale-down" class="small secondary" type="button" aria-label="Make the interface smaller" title="Make the interface smaller">A-</button>'
            + '<input id="ui-scale-range" type="range" min="85" max="130" step="5" value="100" aria-label="Screen size">'
            + '<button id="ui-scale-up" class="small secondary" type="button" aria-label="Make the interface larger" title="Make the interface larger">A+</button>'
            + '</div>'
            + '<div class="ui-scale-meta"><output id="ui-scale-value" for="ui-scale-range" aria-live="polite">100%</output><button id="ui-scale-reset" class="small secondary" type="button">Reset</button></div>'
            + '</div>';
    }

    function render(ui) {
        root.innerHTML = ''
            + '<section class="page-intro"><header class="hero panel"><div class="hero-copy"><p class="eyebrow">' + ui.eyebrow + '</p><h1>' + ui.title + '</h1><p class="subtitle">' + ui.subtitle + '</p><div class="hero-actions" role="group" aria-label="Quick actions"><button id="hero-jump-rates" type="button">Explore rates</button><button id="hero-open-charts" class="secondary" type="button">Open charts</button><button id="hero-open-notes" class="secondary" type="button">Market notes</button></div><div class="hero-trust" aria-label="Why use this workspace"><span class="hero-trust-pill">Daily public CDR data</span><span class="hero-trust-pill">No signup required</span><span class="hero-trust-pill">CSV, XLS, and JSON exports</span></div></div><div class="hero-aside"><div class="hero-stats" id="hero-stats"><div class="hero-stat" id="stat-updated" title="When rates were last collected"><span class="hero-stat-label">Updated</span><strong class="hero-stat-value">...</strong></div><div class="hero-stat" id="stat-cash-rate" title="' + ui.statSecondaryTitle + '"><span class="hero-stat-label">' + ui.statSecondaryLabel + '</span><strong class="hero-stat-value">' + ui.statSecondaryValue + '</strong></div><div class="hero-stat" id="stat-records" title="Total rate records in database"><span class="hero-stat-label">Records</span><strong class="hero-stat-value">...</strong></div></div><aside class="hero-guide" aria-label="How to use the workspace"><p class="hero-guide-kicker">Start here</p><ol class="hero-guide-list"><li>Set a bank, rate band, or date range to define the slice you care about.</li><li>Stay in Overview when you only need a clean shortlist of current rates.</li><li>Switch to Analysis for pivots, trend charts, and deeper product metadata.</li></ol><p class="hero-guide-note">The same filters drive the table, charts, exports, and market notes.</p></aside></div></header><details class="panel seo-summary"><summary>About this data</summary><p>' + ui.aboutText + '</p></details></section>'
            + '<section class="workspace workspace-grid" aria-label="Interactive data workspace"><div class="workspace-rail"><section class="panel mode-panel" aria-label="Workspace mode"><div class="mode-switch" role="group" aria-label="Select view mode"><button id="mode-consumer" class="mode-btn active" type="button" aria-pressed="true">Overview</button><button id="mode-analyst" class="mode-btn" type="button" aria-pressed="false">Analysis</button></div><p class="mode-note">Overview keeps the main table simple. Analysis reveals pivoting, charts, and advanced controls.</p></section><nav class="tabs panel" role="tablist" aria-label="Data views"><button id="tab-explorer" class="tab-btn active" role="tab" aria-selected="true" aria-controls="panel-explorer" type="button">Rates</button><button id="tab-pivot" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-pivot" type="button">Pivot</button><button id="tab-charts" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-charts" type="button">Charts</button></nav><section class="panel panel-wide" aria-label="Primary filters"><div class="filter-primary-group"><label>Banks<span class="filter-bank-tools"><input id="filter-bank-search" type="search" placeholder="Search banks" aria-describedby="filter-bank-help"><button id="filter-bank-clear" class="small secondary filter-bank-clear" type="button">All banks</button></span><select id="filter-bank" multiple size="4" aria-describedby="filter-bank-help"></select><span id="filter-bank-help" class="filter-helper">Search to narrow the list or use All banks to clear your selection.</span></label><div class="filter-range"><label>Min headline rate<input id="filter-min-rate" type="number" step="0.001" min="0" placeholder="' + ui.minRatePlaceholder + '" aria-describedby="primary-rate-help"></label><label>Max headline rate<input id="filter-max-rate" type="number" step="0.001" min="0" placeholder="' + ui.maxRatePlaceholder + '" aria-describedby="primary-rate-help"></label></div><label>From<input id="filter-start-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD" aria-describedby="filter-date-status"></label><label>To<input id="filter-end-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD" aria-describedby="filter-date-status"></label></div><p id="primary-rate-help" class="filter-helper filter-primary-note">' + ui.primaryNote + '</p><div class="date-quick-actions" role="group" aria-label="Quick date ranges"><button class="small secondary date-quick-btn" type="button" data-date-range="7">Last 7 days</button><button class="small secondary date-quick-btn" type="button" data-date-range="30">Last 30 days</button><button class="small secondary date-quick-btn" type="button" data-date-range="all">All history</button></div><p id="filter-date-status" class="filter-helper input-helper" aria-live="polite">Enter dates in YYYY-MM-DD format.</p><div class="filter-primary-actions"><div class="filter-primary-actions-main"><button id="apply-filters" class="small" type="button">Apply</button><button id="reset-filters" class="small secondary" type="button">Reset</button></div><div class="filter-primary-actions-meta"><label for="download-format" class="download-label">Download</label><select id="download-format" class="small" title="Download current table as CSV, XLS or JSON" aria-label="Download table format"><option value="">Choose format</option><option value="csv">CSV</option><option value="xls">XLS</option><option value="json">JSON</option></select><span id="last-refreshed" class="hint"></span></div></div><div class="filter-state-row"><span id="filter-dirty-indicator" class="filter-dirty-indicator">Filters applied</span><div id="active-filter-chips" class="active-filter-chips" aria-live="polite"></div></div></section><details class="filters panel filters-collapsible" id="filter-bar"><summary class="filters-toggle" aria-label="Show or hide filter settings">Advanced analysis</summary><div class="filters-grid">' + ui.advancedFields.concat(SHARED_ADVANCED_FIELDS).map(advancedFieldMarkup).join('') + '</div></details></div>'
            + '<div class="workspace-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar"></div><div class="workspace-stage"><section class="panel workspace-summary" id="workspace-summary-panel" aria-live="polite"><div class="workspace-summary-top"><div class="workspace-summary-main"><p class="workspace-summary-kicker">Workspace snapshot</p><h2 id="workspace-summary-title" class="workspace-summary-title">Loading current view...</h2><p id="workspace-summary-text" class="workspace-summary-text">Preparing the active slice and result surfaces.</p></div><div class="workspace-summary-actions"><button id="workspace-focus-filters" class="small secondary" type="button">Focus filters</button><button id="workspace-copy-link" class="small secondary" type="button">Copy current view</button>' + uiScaleMarkup() + '</div></div><div id="workspace-summary-pills" class="workspace-summary-pills"></div></section><section id="panel-explorer" class="tab-panel active" role="tabpanel" aria-labelledby="tab-explorer"><div class="panel panel-wide"><div class="explorer-toolbar"><button id="table-settings-btn" class="table-settings-btn" type="button" title="Table settings" aria-label="Table settings" aria-expanded="false">&#9881;</button><div id="table-settings-popover" class="table-settings-popover" hidden></div></div><details class="panel rate-table-collapsible" id="rate-table-details" open><summary class="rate-table-toggle" aria-label="Show or hide rate table">Rate table</summary><div id="explorer-overview" class="explorer-overview" aria-live="polite"><div class="explorer-overview-copy"><p class="explorer-overview-kicker">Results</p><h2 id="explorer-overview-title" class="explorer-overview-title">Loading the current rate table...</h2><p id="explorer-overview-text" class="explorer-overview-text">Preparing the first slice.</p></div><div class="explorer-overview-meta"><span id="explorer-overview-status" class="explorer-overview-pill is-loading">Loading</span></div></div><div id="rate-table"></div></details></div></section><section id="panel-pivot" class="tab-panel" role="tabpanel" aria-labelledby="tab-pivot" hidden><div class="panel panel-wide"><div class="pivot-controls"><button id="load-pivot" type="button" class="small">Load pivot data</button><span id="pivot-status" class="hint">Select filters and date range, then load.</span></div><div id="pivot-output"></div></div></section><section id="panel-charts" class="tab-panel" role="tabpanel" aria-labelledby="tab-charts" hidden><div class="panel panel-wide"><div class="chart-shell"><div class="chart-hero"><div class="chart-hero-copy"><p class="chart-kicker">Analysis workspace</p><h2>Rate surface lab</h2><p class="chart-hero-note">Use Lenders to compare banks for the current configuration, then switch to Surface to inspect product histories and Compare to track the shortlist.</p></div><div class="chart-presets" role="group" aria-label="Chart views"><button class="chart-preset" data-chart-view="surface" type="button" aria-pressed="false">Surface</button><button class="chart-preset is-active" data-chart-view="lenders" type="button" aria-pressed="true">Lenders</button><button class="chart-preset" data-chart-view="compare" type="button" aria-pressed="false">Compare</button><button class="chart-preset" data-chart-view="distribution" type="button" aria-pressed="false">Distribution</button></div></div>' + chartControlMarkup(ui) + '<div class="chart-meta"><p id="chart-guidance" class="chart-guidance">Surface view maps collection date across the x-axis and canonical product_key series down the y-axis.</p><div id="chart-summary" class="chart-summary" aria-live="polite"><span class="chart-summary-pill">Awaiting first render</span></div></div><div class="chart-canvas-shell"><div class="chart-main-stage"><div id="chart-output" aria-label="Interactive chart"></div></div><aside class="chart-series-rail" aria-label="Visible chart series"><div class="chart-series-rail-header"><div><p class="chart-series-kicker">Series spotlight</p><h3>Spotlight &amp; shortlist</h3></div><p id="chart-series-note" class="chart-series-note">Draw a chart to activate the rate surface.</p></div><div id="chart-point-details" class="chart-point-details" aria-live="polite"></div><div id="chart-detail-output" class="chart-detail-output" aria-label="Focused detail trend"></div><div id="chart-series-list" class="chart-series-list"><p class="chart-series-empty">Visible products and selected comparison lines will appear here.</p></div></aside></div><div id="chart-data-summary" class="chart-data-summary" aria-live="polite"><p class="chart-data-summary-empty">Draw a chart to populate the summary table.</p></div></div><p id="chart-status" class="hint">Choose a view, adjust the metric or density, then draw.</p></div></section><details class="panel market-notes" id="market-notes"><summary class="market-notes-summary">Market notes</summary><div class="market-notes-content">' + marketNotesMarkup(ui) + '</div></details></div></section>';
    }

    /* Main vertical divider only. Horizontal resizers between .workspace-rail cards can be added later. */
    function setupWorkspaceResizer() {
        var grid = root.querySelector('.workspace-grid');
        var resizer = root.querySelector('.workspace-resizer');
        var rail = root.querySelector('.workspace-rail');
        if (!grid || !resizer || !rail) return;
        var media = window.matchMedia('(min-width: 1100px)');
        var onPointerMove = function (e) {
            var dx = e.clientX - startX;
            var w = Math.round(startRailWidth + dx);
            var minW = 320;
            var maxW = Math.floor(window.innerWidth * 0.6);
            w = Math.max(minW, Math.min(maxW, w));
            grid.style.setProperty('--workspace-rail-width', w + 'px');
            grid.style.setProperty('--workspace-stage-width', '1fr');
        };
        var onPointerUp = function () {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        var startX = 0;
        var startRailWidth = 0;
        resizer.addEventListener('pointerdown', function (e) {
            if (!media.matches || e.button !== 0) return;
            e.preventDefault();
            startX = e.clientX;
            startRailWidth = rail.getBoundingClientRect().width;
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            resizer.setPointerCapture(e.pointerId);
        });
    }

    render(SECTION_UI[section] || SECTION_UI['home-loans']);
    setupWorkspaceResizer();
})();
