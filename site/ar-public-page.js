(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    if (!root) return;

    var esc = window._arEsc || function (value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    var uiIcons = (window.AR && window.AR.uiIcons) || {};

    function fallbackText(_icon, label, className, textClassName) {
        var classes = ['ar-icon-label'];
        if (className) classes.push(className);
        return '' +
            '<span class="' + classes.join(' ') + '">' +
                '<span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span>' +
            '</span>';
    }

    function fallbackPanel(_icon, label, className) {
        var classes = ['panel-code'];
        if (className) classes.push(className);
        return '<span class="' + classes.join(' ') + '" aria-hidden="true">' + esc(String(label || '').charAt(0) || '*') + '</span>';
    }

    function fallbackIcon(_icon, label, className) {
        var classes = ['ar-icon'];
        if (className) classes.push(className);
        return '<span class="' + classes.join(' ') + '" aria-hidden="true">' + esc(String(label || '').charAt(0) || '*') + '</span>';
    }

    var iconText = typeof uiIcons.text === 'function' ? uiIcons.text : fallbackText;
    var panelIcon = typeof uiIcons.panel === 'function' ? uiIcons.panel : fallbackPanel;
    var iconOnly = typeof uiIcons.icon === 'function' ? uiIcons.icon : fallbackIcon;

    var BASE_CHART_TYPES = [
        { value: 'scatter', label: 'Line chart', selected: true },
        { value: 'bar', label: 'Bar chart' },
        { value: 'box', label: 'Box plot' }
    ];

    var CHART_VIEWS = [
        { value: 'lenders', label: 'Leaders', icon: 'snapshot', help: 'Best current product by lender for the active slice.', selected: true },
        { value: 'surface', label: 'Movement', icon: 'movement', help: 'Rate movement over time for the active slice.' },
        { value: 'compare', label: 'Compare', icon: 'compare', help: 'Track only the spotlight shortlist series.' },
        { value: 'distribution', label: 'Distribution', icon: 'distribution', help: 'Distribution summary for the current slice.' }
    ];

    var WORKSPACE_TABS = [
        { id: 'explorer', label: 'Table', icon: 'table', help: 'Live rates table.' },
        { id: 'pivot', label: 'Pivot', icon: 'pivot', help: 'Pivot workspace for the active slice.' },
        { id: 'history', label: 'History', icon: 'history', help: 'Series detail, spotlight trend, and chart summary.' },
        { id: 'changes', label: 'Changes', icon: 'changes', help: 'Summary metrics and recent rate changes.' }
    ];

    var SHARED_ADVANCED_FIELDS = [
        {
            kind: 'select',
            id: 'filter-mode',
            label: 'Data scope',
            icon: 'filter',
            help: 'Show all rows, daily-only rows, or historical-only rows.',
            options: [
                { value: 'all', label: 'All rows', selected: true },
                { value: 'daily', label: 'Daily only' },
                { value: 'historical', label: 'Historical only' }
            ]
        },
        {
            kind: 'toggle',
            id: 'filter-include-manual',
            label: 'Include manual runs',
            icon: 'admin',
            help: 'Include manually triggered runs in the result set.'
        },
        {
            kind: 'select',
            id: 'refresh-interval',
            label: 'Auto refresh',
            icon: 'refresh',
            help: 'Auto-refresh interval in minutes. Off disables background refresh.',
            options: [
                { value: '0', label: 'Off' },
                { value: '15', label: 'Every 15 minutes' },
                { value: '30', label: 'Every 30 minutes' },
                { value: '60', label: 'Every hour', selected: true },
                { value: '120', label: 'Every 2 hours' }
            ]
        }
    ];

    var SECTION_UI = {
        'home-loans': {
            title: 'Home Loans',
            ladderTitle: 'Leading rates',
            statSecondaryLabel: 'Cash rate',
            statSecondaryIcon: 'stats',
            statSecondaryValue: '...',
            statSecondaryHelp: 'Current RBA cash rate.',
            notesHeading: 'Home loan notes',
            notesText: 'Rates are sourced from public CDR product feeds and grouped for shortlist-first comparison. Comparison rates, when available, use the standard Australian benchmark of $150,000 over 25 years.',
            continuityText: 'Series and charts follow canonical product_key identity so one line maps to one tracked product over time.',
            minRatePlaceholder: '5.20',
            maxRatePlaceholder: '7.00',
            advancedFields: [
                { kind: 'select', id: 'filter-security', label: 'Purpose', icon: 'home', help: 'Owner-occupied or investment lending.' },
                { kind: 'select', id: 'filter-repayment', label: 'Repayment', icon: 'changes', help: 'Principal and interest or interest-only repayment.' },
                { kind: 'select', id: 'filter-structure', label: 'Structure', icon: 'summary', help: 'Variable or fixed structure.' },
                { kind: 'select', id: 'filter-lvr', label: 'LVR band', icon: 'compare', help: 'Loan-to-value ratio tier.' },
                { kind: 'select', id: 'filter-feature', label: 'Features', icon: 'focus', help: 'Feature set such as offset or redraw.' },
                { kind: 'number', id: 'filter-min-comparison-rate', label: 'Min comparison rate', icon: 'summary', placeholder: '5.40', help: 'Minimum comparison rate.' },
                { kind: 'number', id: 'filter-max-comparison-rate', label: 'Max comparison rate', icon: 'summary', placeholder: '7.20', help: 'Maximum comparison rate.' }
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'Interest rate', selected: true },
                { value: 'comparison_rate', label: 'Comparison rate' },
                { value: 'annual_fee', label: 'Annual fee' },
                { value: 'rba_cash_rate', label: 'Cash rate' }
            ],
            chartX: [
                { value: 'collection_date', label: 'Collection date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'rate_structure', label: 'Structure' },
                { value: 'lvr_tier', label: 'LVR band' },
                { value: 'feature_set', label: 'Features' }
            ],
            chartGroups: [
                { value: '', label: 'No grouping' },
                { value: 'product_key', label: 'Product series', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'security_purpose', label: 'Purpose' },
                { value: 'rate_structure', label: 'Structure' },
                { value: 'lvr_tier', label: 'LVR band' },
                { value: 'feature_set', label: 'Features' },
                { value: 'repayment_type', label: 'Repayment' }
            ]
        },
        'savings': {
            title: 'Savings',
            ladderTitle: 'Yield leaders',
            statSecondaryLabel: 'Series continuity',
            statSecondaryIcon: 'continuity',
            statSecondaryValue: '...',
            statSecondaryHelp: 'Series continuity by canonical product_key.',
            notesHeading: 'Savings notes',
            notesText: 'Rates are sourced from public CDR savings feeds and grouped by account type, rate type, and deposit tier. Bonus and introductory conditions can materially change the observed rate.',
            continuityText: 'Series and charts follow canonical product_key identity so one line maps to one tracked savings product over time.',
            minRatePlaceholder: '1.50',
            maxRatePlaceholder: '6.00',
            advancedFields: [
                { kind: 'select', id: 'filter-account-type', label: 'Account type', icon: 'bank', help: 'Savings, transaction, or at-call account type.' },
                { kind: 'select', id: 'filter-rate-type', label: 'Rate type', icon: 'stats', help: 'Base, bonus, introductory, or bundle rate.' },
                { kind: 'select', id: 'filter-deposit-tier', label: 'Deposit tier', icon: 'summary', help: 'Balance tier for the observed rate.' }
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'Interest rate', selected: true },
                { value: 'monthly_fee', label: 'Monthly fee' }
            ],
            chartX: [
                { value: 'collection_date', label: 'Collection date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'account_type', label: 'Account type' },
                { value: 'rate_type', label: 'Rate type' },
                { value: 'deposit_tier', label: 'Deposit tier' }
            ],
            chartGroups: [
                { value: '', label: 'No grouping' },
                { value: 'product_key', label: 'Product series', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'account_type', label: 'Account type' },
                { value: 'rate_type', label: 'Rate type' },
                { value: 'deposit_tier', label: 'Deposit tier' }
            ]
        },
        'term-deposits': {
            title: 'Term Deposits',
            ladderTitle: 'Yield leaders',
            statSecondaryLabel: 'Series continuity',
            statSecondaryIcon: 'continuity',
            statSecondaryValue: '...',
            statSecondaryHelp: 'Series continuity by canonical product_key.',
            notesHeading: 'Term deposit notes',
            notesText: 'Rates are sourced from public CDR term deposit feeds and grouped by term, deposit tier, and payment frequency. Maturity, rollover, and payment rules should be verified with the institution.',
            continuityText: 'Series and charts follow canonical product_key identity so one line maps to one tracked term-deposit product over time.',
            minRatePlaceholder: '2.00',
            maxRatePlaceholder: '6.00',
            advancedFields: [
                { kind: 'select', id: 'filter-term-months', label: 'Term length', icon: 'history', help: 'Term length in months.' },
                { kind: 'select', id: 'filter-deposit-tier', label: 'Deposit tier', icon: 'summary', help: 'Minimum deposit tier.' },
                { kind: 'select', id: 'filter-interest-payment', label: 'Payment frequency', icon: 'stats', help: 'Interest payment frequency.' }
            ],
            chartMetrics: [{ value: 'interest_rate', label: 'Interest rate', selected: true }],
            chartX: [
                { value: 'collection_date', label: 'Collection date', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'term_months', label: 'Term length' },
                { value: 'deposit_tier', label: 'Deposit tier' },
                { value: 'interest_payment', label: 'Payment frequency' }
            ],
            chartGroups: [
                { value: '', label: 'No grouping' },
                { value: 'product_key', label: 'Product series', selected: true },
                { value: 'bank_name', label: 'Bank' },
                { value: 'term_months', label: 'Term length' },
                { value: 'deposit_tier', label: 'Deposit tier' },
                { value: 'interest_payment', label: 'Payment frequency' }
            ]
        }
    };

    function helpAttrs(label, help) {
        if (!help) return '';
        return ' data-help="' + esc(help) + '" data-help-label="' + esc(label) + '"';
    }

    function optionsMarkup(options) {
        return (options || []).map(function (option) {
            return '<option value="' + option.value + '"' + (option.selected ? ' selected' : '') + '>' + option.label + '</option>';
        }).join('');
    }

    function fieldLabelMarkup(field) {
        return iconText(field.icon || 'filter', field.label || field.code || 'Field', 'field-code');
    }

    function fieldMarkup(field) {
        var label = field.label || field.code || 'Field';
        var attrs = helpAttrs(label, field.help);
        if (field.kind === 'toggle') {
            return '' +
                '<label class="terminal-field terminal-field-toggle"' + attrs + '>' +
                    fieldLabelMarkup(field) +
                    '<input id="' + field.id + '" type="checkbox">' +
                '</label>';
        }
        if (field.kind === 'number') {
            return '' +
                '<label class="terminal-field"' + attrs + '>' +
                    fieldLabelMarkup(field) +
                    '<input id="' + field.id + '" type="number" step="0.001" min="0" placeholder="' + field.placeholder + '">' +
                '</label>';
        }
        return '' +
            '<label class="terminal-field"' + attrs + '>' +
                fieldLabelMarkup(field) +
                '<select id="' + field.id + '">' + optionsMarkup(field.options || [{ value: '', label: 'All', selected: true }]) + '</select>' +
            '</label>';
    }

    function chartQuestionMarkup() {
        return '' +
            '<div class="chart-question-row" role="group" aria-label="Chart view">' +
                CHART_VIEWS.map(function (view) {
                    return '' +
                        '<button class="chart-preset chip-btn secondary' + (view.selected ? ' is-active' : '') + '"' +
                            ' data-chart-view="' + esc(view.value) + '"' +
                            ' data-ui-label="' + esc(view.label) + '"' +
                            ' type="button"' +
                            ' aria-label="' + esc(view.label) + '"' +
                            ' aria-pressed="' + (view.selected ? 'true' : 'false') + '"' +
                            helpAttrs(view.label, view.help) +
                        '>' +
                            iconText(view.icon, view.label, 'control-chip-label') +
                        '</button>';
                }).join('') +
            '</div>';
    }

    function notesMarkup(ui) {
        return '' +
            '<details class="panel terminal-notes" id="market-notes">' +
                '<summary class="terminal-panel-head" data-help="Open methodology and disclosure notes." data-help-label="Notes">' +
                    panelIcon('notes', 'Notes') +
                    '<strong>' + esc(ui.notesHeading) + '</strong>' +
                '</summary>' +
                '<div class="terminal-notes-body">' +
                    '<p>' + esc(ui.notesText) + '</p>' +
                    '<p id="comparison-rate-disclosure">' + esc(ui.continuityText) + '</p>' +
                '</div>' +
            '</details>';
    }

    function tabButtonMarkup(tab, active) {
        return '' +
            '<button id="tab-' + esc(tab.id) + '" class="tab-btn chip-btn secondary' + (active ? ' active' : '') + '"' +
                ' role="tab"' +
                ' aria-selected="' + (active ? 'true' : 'false') + '"' +
                ' aria-controls="panel-' + esc(tab.id) + '"' +
                ' aria-label="' + esc(tab.label) + '"' +
                ' type="button"' +
                ' data-ui-label="' + esc(tab.label) + '"' +
                helpAttrs(tab.label, tab.help) +
            '>' +
                iconText(tab.icon, tab.label, 'control-chip-label') +
            '</button>';
    }

    function render(ui) {
        root.innerHTML = [
            '<section class="market-terminal" aria-label="' + esc(ui.title) + ' workspace">',
                '<aside class="terminal-column terminal-column-left">',
                    '<section class="panel terminal-panel terminal-nav-panel">',
                        '<div class="terminal-panel-head">',
                            panelIcon('nav', 'Navigation'),
                            '<strong>' + esc(ui.title) + '</strong>',
                        '</div>',
                        '<div id="market-nav-tree" class="market-nav-tree" aria-label="Market navigation"></div>',
                    '</section>',
                    '<section id="scenario" class="panel terminal-panel terminal-filter-panel">',
                        '<div class="terminal-panel-head">',
                            panelIcon('filter', 'Filters'),
                            '<strong>Slice filters</strong>',
                        '</div>',
                        '<div class="terminal-filter-grid terminal-filter-grid-primary">',
                            '<label class="terminal-field terminal-field-bank" data-help="Search and select one or more institutions." data-help-label="Banks">',
                                iconText('bank', 'Banks', 'field-code'),
                                '<div class="terminal-inline-inputs terminal-inline-inputs-bank">',
                                    '<input id="filter-bank-search" type="search" placeholder="Search banks or codes">',
                                    '<button id="filter-bank-clear" class="chip-btn secondary" type="button">All</button>',
                                    '<span id="filter-bank-count" class="pill filter-bank-count">All</span>',
                                '</div>',
                                '<div id="filter-bank-options" class="bank-picker-grid" role="listbox" aria-label="Banks"></div>',
                                '<select id="filter-bank" class="bank-native-select" multiple size="5" hidden aria-hidden="true"></select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Minimum visible headline rate." data-help-label="Minimum rate">',
                                iconText('summary', 'Minimum rate', 'field-code'),
                                '<input id="filter-min-rate" type="number" step="0.001" min="0" placeholder="' + ui.minRatePlaceholder + '">' +
                            '</label>',
                            '<label class="terminal-field" data-help="Maximum visible headline rate." data-help-label="Maximum rate">',
                                iconText('summary', 'Maximum rate', 'field-code'),
                                '<input id="filter-max-rate" type="number" step="0.001" min="0" placeholder="' + ui.maxRatePlaceholder + '">' +
                            '</label>',
                            '<label class="terminal-field" data-help="Start date in YYYY-MM-DD format." data-help-label="From date">',
                                iconText('calendar', 'From date', 'field-code'),
                                '<input id="filter-start-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD">' +
                            '</label>',
                            '<label class="terminal-field" data-help="End date in YYYY-MM-DD format." data-help-label="To date">',
                                iconText('calendar', 'To date', 'field-code'),
                                '<input id="filter-end-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD">' +
                            '</label>',
                        '</div>',
                        '<p id="filter-date-status" class="field-help">Use YYYY-MM-DD</p>',
                        '<div class="terminal-action-row">',
                            '<button id="apply-filters" class="primary" type="button" data-help="Refresh the current slice across the dashboard." data-help-label="Apply filters">' + iconText('apply', 'Apply', 'control-chip-label') + '</button>',
                            '<button id="reset-filters" class="secondary" type="button" data-help="Reset the current slice to defaults." data-help-label="Reset filters">' + iconText('reset', 'Reset', 'control-chip-label') + '</button>',
                            '<button id="workspace-copy-link" class="secondary" type="button" data-help="Copy the current route, filters, pane, and hash state." data-help-label="Copy link">' + iconText('link', 'Link', 'control-chip-label') + '</button>',
                        '</div>',
                        '<div class="terminal-filter-state-row">',
                            '<span id="filter-dirty-indicator" class="pill">0</span>',
                            '<div id="active-filter-chips" class="active-filter-chips" aria-live="polite"></div>',
                        '</div>',
                        '<details class="terminal-more-filters" id="filter-bar">',
                            '<summary class="terminal-more-summary" data-help="Open secondary filters and refresh controls." data-help-label="More filters">' + iconText('filter', 'More filters', 'control-chip-label') + '</summary>',
                            '<div class="terminal-filter-grid terminal-filter-grid-advanced">',
                                ui.advancedFields.concat(SHARED_ADVANCED_FIELDS).map(fieldMarkup).join(''),
                            '</div>',
                        '</details>',
                        '<div id="export" class="terminal-export-row">',
                            '<label class="terminal-field" data-help="Export the current table view." data-help-label="Download">',
                                iconText('download', 'Download', 'field-code'),
                                '<select id="download-format" class="small" aria-label="Download format">',
                                    '<option value="">Choose format</option>',
                                    '<option value="csv">CSV</option>',
                                    '<option value="xls">Excel</option>',
                                    '<option value="json">JSON</option>',
                                '</select>',
                            '</label>',
                            '<span id="last-refreshed" class="hint"></span>',
                        '</div>',
                    '</section>',
                    notesMarkup(ui),
                '</aside>',
                '<section class="terminal-column terminal-column-center">',
                    '<section id="chart" class="panel terminal-panel terminal-stage-panel">',
                        '<div class="terminal-stage-top">',
                            '<div class="terminal-panel-head">',
                                panelIcon('chart', 'Charts'),
                                '<strong>' + esc(ui.title) + '</strong>',
                            '</div>',
                            '<div class="chart-guidance-wrap">',
                                '<span id="chart-guidance" class="hint">Ready</span>',
                                '<div id="chart-summary" class="chart-summary" aria-live="polite"><span class="pill">Loading</span></div>',
                            '</div>',
                        '</div>',
                        chartQuestionMarkup(),
                        '<div class="terminal-chart-controls">',
                            '<label class="terminal-field" data-help="Metric shown on the Y axis." data-help-label="Y axis">',
                                iconText('stats', 'Y axis', 'field-code'),
                                '<select id="chart-y">' + optionsMarkup(ui.chartMetrics) + '</select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Axis or category shown on the X axis." data-help-label="X axis">',
                                iconText('history', 'X axis', 'field-code'),
                                '<select id="chart-x">' + optionsMarkup(ui.chartX) + '</select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Series grouping field." data-help-label="Group by">',
                                iconText('series', 'Group by', 'field-code'),
                                '<select id="chart-group">' + optionsMarkup(ui.chartGroups) + '</select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Visible series density." data-help-label="Density">',
                                iconText('summary', 'Density', 'field-code'),
                                '<select id="chart-series-limit"><option value="compact">Compact</option><option value="standard" selected>Standard</option><option value="expanded">Expanded</option></select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Use daily rows or optimized change events." data-help-label="History basis">',
                                iconText('history', 'History basis', 'field-code'),
                                '<select id="chart-representation"><option value="change" selected>Change basis</option><option value="day">Daily basis</option></select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Chart renderer type." data-help-label="Chart type">',
                                iconText('chart', 'Chart type', 'field-code'),
                                '<select id="chart-type">' + optionsMarkup(BASE_CHART_TYPES) + '</select>',
                            '</label>',
                            '<button id="draw-chart" type="button" class="primary" data-help="Render the chart for the current slice." data-help-label="Update chart">' + iconText('chart', 'Update chart', 'control-chip-label') + '</button>',
                        '</div>',
                        '<div class="terminal-chart-surface">',
                            '<div id="chart-output" class="terminal-chart-output" aria-label="Interactive chart"></div>',
                        '</div>',
                        '<p id="chart-status" class="hint">Idle</p>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-bottom-panel" id="table">',
                        '<nav class="terminal-bottom-tabs" role="tablist" aria-label="Data panes">',
                            tabButtonMarkup(WORKSPACE_TABS[0], true),
                            tabButtonMarkup(WORKSPACE_TABS[1], false),
                            tabButtonMarkup(WORKSPACE_TABS[2], false),
                            tabButtonMarkup(WORKSPACE_TABS[3], false),
                        '</nav>',
                        '<section id="panel-explorer" class="tab-panel active shortlist-panel" role="tabpanel" aria-labelledby="tab-explorer">',
                            '<div class="terminal-data-head">',
                                '<div>',
                                    panelIcon('table', 'Table'),
                                    '<h2 id="explorer-overview-title">Loading table</h2>',
                                '</div>',
                                '<div class="terminal-data-actions">',
                                    '<span id="explorer-overview-status" class="pill">Loading</span>',
                                    '<button id="table-settings-btn" class="icon-btn secondary" type="button" aria-label="Table settings" data-help="Column visibility, removed rows, and move-column mode." data-help-label="Table settings">' + iconOnly('settings', 'Table settings') + '</button>',
                                    '<div id="table-settings-popover" class="table-settings-popover" hidden></div>',
                                '</div>',
                            '</div>',
                            '<p id="explorer-overview-text" class="hint">Waiting for live rates</p>',
                            '<div id="rate-table" class="terminal-rate-table"></div>',
                        '</section>',
                        '<section id="panel-pivot" class="tab-panel" role="tabpanel" aria-labelledby="tab-pivot" hidden>',
                            '<div id="pivot" class="pivot-panel">',
                                '<div class="pivot-controls">',
                                    '<label class="terminal-field" data-help="Use daily rows or optimized change events." data-help-label="Pivot basis">',
                                        iconText('history', 'Pivot basis', 'field-code'),
                                        '<select id="pivot-representation"><option value="change" selected>Change basis</option><option value="day">Daily basis</option></select>',
                                    '</label>',
                                    '<button id="load-pivot" type="button" class="secondary" data-help="Reload rows into the pivot workspace." data-help-label="Refresh pivot">' + iconText('refresh', 'Refresh pivot', 'control-chip-label') + '</button>',
                                    '<span id="pivot-status" class="hint">Preparing default pivot grid...</span>',
                                '</div>',
                                '<div id="pivot-output"></div>',
                            '</div>',
                        '</section>',
                        '<section id="panel-history" class="tab-panel" role="tabpanel" aria-labelledby="tab-history" hidden>',
                            '<div class="terminal-history-grid" id="history">',
                                '<section class="panel terminal-subpanel"><div class="terminal-panel-head">' + panelIcon('focus', 'Spotlight') + '<strong>Spotlight</strong></div><div id="chart-detail-output" class="chart-detail-output" aria-label="Focused detail trend"></div></section>',
                                '<section class="panel terminal-subpanel"><div class="terminal-panel-head">' + panelIcon('history', 'History') + '<strong>History summary</strong></div><div id="chart-data-summary" class="chart-data-summary" aria-live="polite"><p class="chart-data-summary-empty">Loading history</p></div></section>',
                            '</div>',
                        '</section>',
                        '<section id="panel-changes" class="tab-panel" role="tabpanel" aria-labelledby="tab-changes" hidden>',
                            '<div class="terminal-changes-grid" id="changes">',
                                '<section class="panel terminal-subpanel executive-summary" id="executive-summary-panel" aria-label="Executive summary">',
                                    '<div class="terminal-panel-head">' + panelIcon('summary', 'Summary') + '<strong>Summary</strong></div>',
                                    '<p id="executive-summary-status" class="hint">Loading summary</p>',
                                    '<div id="executive-summary-sections" class="executive-summary-sections"></div>',
                                '</section>',
                                '<section class="panel terminal-subpanel rate-change-log" aria-label="Rate changes">',
                                    '<details id="rate-change-details" class="rate-change-details" open>',
                                        '<summary id="rate-change-summary" class="rate-change-summary">' + panelIcon('changes', 'Changes') + '<span id="rate-change-headline" class="rate-change-headline">Loading recent changes</span></summary>',
                                        '<p id="rate-change-warning" class="rate-change-warning" hidden></p>',
                                        '<p id="rate-change-status" class="hint">Loading changes</p>',
                                        '<ul id="rate-change-list" class="rate-change-list"><li class="rate-change-item-empty">Loading changes</li></ul>',
                                    '</details>',
                                '</section>',
                            '</div>',
                        '</section>',
                    '</section>',
                '</section>',
                '<aside id="ladder" class="terminal-column terminal-column-right">',
                    '<section class="panel terminal-panel terminal-stats-panel">',
                        '<div class="terminal-panel-head">',
                            panelIcon('stats', 'Overview'),
                            '<strong>Overview</strong>',
                        '</div>',
                        '<div class="terminal-stat-grid" id="hero-stats">',
                            '<div class="terminal-stat" id="stat-updated" data-help="Last collection date in the active slice." data-help-label="Updated"><span class="metric-code">' + iconText('calendar', 'Updated') + '</span><strong>...</strong></div>',
                            '<div class="terminal-stat" id="stat-cash-rate" data-help="' + esc(ui.statSecondaryHelp) + '" data-help-label="' + esc(ui.statSecondaryLabel) + '"><span class="metric-code">' + iconText(ui.statSecondaryIcon, ui.statSecondaryLabel) + '</span><strong>' + esc(ui.statSecondaryValue) + '</strong></div>',
                            '<div class="terminal-stat" id="stat-records" data-help="Total rows available in the active slice." data-help-label="Rows"><span class="metric-code">' + iconText('rows', 'Rows') + '</span><strong>...</strong></div>',
                        '</div>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-ladder-panel">',
                        '<div class="terminal-panel-head">',
                            panelIcon('ladder', 'Leaders'),
                            '<strong>' + esc(ui.ladderTitle) + '</strong>',
                        '</div>',
                        '<label class="terminal-field terminal-ladder-search" data-help="Filter the ladder by lender or product name." data-help-label="Search shortlist">',
                            iconText('search', 'Search shortlist', 'field-code'),
                            '<input id="ladder-search" type="search" placeholder="Search lenders or products">',
                        '</label>',
                        '<div id="quick-compare-cards" class="quick-compare-cards"></div>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-spotlight-panel">',
                        '<div class="terminal-panel-head">' + panelIcon('focus', 'Focus') + '<strong>Focus</strong></div>',
                        '<div id="chart-point-details" class="chart-point-details" aria-live="polite"></div>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-series-panel">',
                        '<div class="terminal-panel-head">' + panelIcon('series', 'Product series') + '<strong>Product series</strong></div>',
                        '<p id="chart-series-note" class="hint">Choose a series</p>',
                        '<div id="chart-series-list" class="chart-series-list"><p class="chart-series-empty">No series yet</p></div>',
                    '</section>',
                '</aside>',
            '</section>'
        ].join('');
    }

    render(SECTION_UI[section] || SECTION_UI['home-loans']);
})();
