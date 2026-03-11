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

    var BASE_CHART_TYPES = [
        { value: 'scatter', label: 'LINE', selected: true },
        { value: 'bar', label: 'BAR' },
        { value: 'box', label: 'BOX' }
    ];

    var SHARED_ADVANCED_FIELDS = [
        {
            kind: 'select',
            id: 'filter-mode',
            code: 'MODE',
            help: 'Show all rows, daily-only rows, or historical-only rows.',
            options: [
                { value: 'all', label: 'ALL', selected: true },
                { value: 'daily', label: 'DAY' },
                { value: 'historical', label: 'HIST' }
            ]
        },
        {
            kind: 'toggle',
            id: 'filter-include-manual',
            code: 'MAN',
            help: 'Include manually triggered runs in the result set.'
        },
        {
            kind: 'select',
            id: 'refresh-interval',
            code: 'AUTO',
            help: 'Auto-refresh interval in minutes. Off disables background refresh.',
            options: [
                { value: '0', label: 'OFF' },
                { value: '15', label: '15M' },
                { value: '30', label: '30M' },
                { value: '60', label: '60M', selected: true },
                { value: '120', label: '120M' }
            ]
        }
    ];

    var SECTION_UI = {
        'home-loans': {
            short: 'HL',
            title: 'Home Loans',
            ladderTitle: 'Leaders',
            statSecondaryCode: 'RBA',
            statSecondaryValue: '...',
            statSecondaryHelp: 'Current RBA cash rate.',
            notesHeading: 'HL Notes',
            notesText: 'Rates are sourced from public CDR product feeds and grouped for shortlist-first comparison. Comparison rates, when available, use the standard Australian benchmark of $150,000 over 25 years.',
            continuityText: 'Series and charts follow canonical product_key identity so one line maps to one tracked product over time.',
            minRatePlaceholder: '5.20',
            maxRatePlaceholder: '7.00',
            advancedFields: [
                { kind: 'select', id: 'filter-security', code: 'PURP', help: 'Owner-occupied or investment lending.' },
                { kind: 'select', id: 'filter-repayment', code: 'REP', help: 'Principal and interest or interest-only repayment.' },
                { kind: 'select', id: 'filter-structure', code: 'TYPE', help: 'Variable or fixed structure.' },
                { kind: 'select', id: 'filter-lvr', code: 'LVR', help: 'Loan-to-value ratio tier.' },
                { kind: 'select', id: 'filter-feature', code: 'FEAT', help: 'Feature set such as offset or redraw.' },
                { kind: 'number', id: 'filter-min-comparison-rate', code: 'CMIN', placeholder: '5.40', help: 'Minimum comparison rate.' },
                { kind: 'number', id: 'filter-max-comparison-rate', code: 'CMAX', placeholder: '7.20', help: 'Maximum comparison rate.' }
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'RATE', selected: true },
                { value: 'comparison_rate', label: 'COMP' },
                { value: 'annual_fee', label: 'FEE' },
                { value: 'rba_cash_rate', label: 'RBA' }
            ],
            chartX: [
                { value: 'collection_date', label: 'DATE', selected: true },
                { value: 'bank_name', label: 'BANK' },
                { value: 'rate_structure', label: 'TYPE' },
                { value: 'lvr_tier', label: 'LVR' },
                { value: 'feature_set', label: 'FEAT' }
            ],
            chartGroups: [
                { value: '', label: 'NONE' },
                { value: 'product_key', label: 'PK', selected: true },
                { value: 'bank_name', label: 'BANK' },
                { value: 'security_purpose', label: 'PURP' },
                { value: 'rate_structure', label: 'TYPE' },
                { value: 'lvr_tier', label: 'LVR' },
                { value: 'feature_set', label: 'FEAT' },
                { value: 'repayment_type', label: 'REP' }
            ]
        },
        'savings': {
            short: 'SAV',
            title: 'Savings',
            ladderTitle: 'Yield',
            statSecondaryCode: 'PK',
            statSecondaryValue: 'CONT',
            statSecondaryHelp: 'Series continuity by canonical product_key.',
            notesHeading: 'SAV Notes',
            notesText: 'Rates are sourced from public CDR savings feeds and grouped by account type, rate type, and deposit tier. Bonus and introductory conditions can materially change the observed rate.',
            continuityText: 'Series and charts follow canonical product_key identity so one line maps to one tracked savings product over time.',
            minRatePlaceholder: '1.50',
            maxRatePlaceholder: '6.00',
            advancedFields: [
                { kind: 'select', id: 'filter-account-type', code: 'ACCT', help: 'Savings, transaction, or at-call account type.' },
                { kind: 'select', id: 'filter-rate-type', code: 'RATE', help: 'Base, bonus, introductory, or bundle rate.' },
                { kind: 'select', id: 'filter-deposit-tier', code: 'TIER', help: 'Balance tier for the observed rate.' }
            ],
            chartMetrics: [
                { value: 'interest_rate', label: 'RATE', selected: true },
                { value: 'monthly_fee', label: 'FEE' }
            ],
            chartX: [
                { value: 'collection_date', label: 'DATE', selected: true },
                { value: 'bank_name', label: 'BANK' },
                { value: 'account_type', label: 'ACCT' },
                { value: 'rate_type', label: 'RATE' },
                { value: 'deposit_tier', label: 'TIER' }
            ],
            chartGroups: [
                { value: '', label: 'NONE' },
                { value: 'product_key', label: 'PK', selected: true },
                { value: 'bank_name', label: 'BANK' },
                { value: 'account_type', label: 'ACCT' },
                { value: 'rate_type', label: 'RATE' },
                { value: 'deposit_tier', label: 'TIER' }
            ]
        },
        'term-deposits': {
            short: 'TD',
            title: 'Term Deposits',
            ladderTitle: 'Yield',
            statSecondaryCode: 'PK',
            statSecondaryValue: 'CONT',
            statSecondaryHelp: 'Series continuity by canonical product_key.',
            notesHeading: 'TD Notes',
            notesText: 'Rates are sourced from public CDR term deposit feeds and grouped by term, deposit tier, and payment frequency. Maturity, rollover, and payment rules should be verified with the institution.',
            continuityText: 'Series and charts follow canonical product_key identity so one line maps to one tracked term-deposit product over time.',
            minRatePlaceholder: '2.00',
            maxRatePlaceholder: '6.00',
            advancedFields: [
                { kind: 'select', id: 'filter-term-months', code: 'TERM', help: 'Term length in months.' },
                { kind: 'select', id: 'filter-deposit-tier', code: 'TIER', help: 'Minimum deposit tier.' },
                { kind: 'select', id: 'filter-interest-payment', code: 'PAY', help: 'Interest payment frequency.' }
            ],
            chartMetrics: [{ value: 'interest_rate', label: 'RATE', selected: true }],
            chartX: [
                { value: 'collection_date', label: 'DATE', selected: true },
                { value: 'bank_name', label: 'BANK' },
                { value: 'term_months', label: 'TERM' },
                { value: 'deposit_tier', label: 'TIER' },
                { value: 'interest_payment', label: 'PAY' }
            ],
            chartGroups: [
                { value: '', label: 'NONE' },
                { value: 'product_key', label: 'PK', selected: true },
                { value: 'bank_name', label: 'BANK' },
                { value: 'term_months', label: 'TERM' },
                { value: 'deposit_tier', label: 'TIER' },
                { value: 'interest_payment', label: 'PAY' }
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

    function fieldMarkup(field) {
        var attrs = helpAttrs(field.code, field.help);
        if (field.kind === 'toggle') {
            return '' +
                '<label class="terminal-field terminal-field-toggle"' + attrs + '>' +
                    '<span class="field-code">' + field.code + '</span>' +
                    '<input id="' + field.id + '" type="checkbox">' +
                '</label>';
        }
        if (field.kind === 'number') {
            return '' +
                '<label class="terminal-field"' + attrs + '>' +
                    '<span class="field-code">' + field.code + '</span>' +
                    '<input id="' + field.id + '" type="number" step="0.001" min="0" placeholder="' + field.placeholder + '">' +
                '</label>';
        }
        return '' +
            '<label class="terminal-field"' + attrs + '>' +
                '<span class="field-code">' + field.code + '</span>' +
                '<select id="' + field.id + '">' + optionsMarkup(field.options || [{ value: '', label: 'ALL', selected: true }]) + '</select>' +
            '</label>';
    }

    function chartQuestionMarkup() {
        return '' +
            '<div class="chart-question-row" role="group" aria-label="Chart view">' +
                '<button class="chart-preset is-active" data-chart-view="lenders" type="button" aria-pressed="true" data-help="Best current product by lender for the active slice." data-help-label="NOW">NOW</button>' +
                '<button class="chart-preset" data-chart-view="surface" type="button" aria-pressed="false" data-help="Rate movement over time for the active slice." data-help-label="MOVE">MOVE</button>' +
                '<button class="chart-preset" data-chart-view="compare" type="button" aria-pressed="false" data-help="Track only the spotlight shortlist series." data-help-label="CMP">CMP</button>' +
                '<button class="chart-preset" data-chart-view="distribution" type="button" aria-pressed="false" data-help="Distribution summary for the current slice." data-help-label="BOX">BOX</button>' +
            '</div>';
    }

    function notesMarkup(ui) {
        return '' +
            '<details class="panel terminal-notes" id="notes">' +
                '<summary class="terminal-panel-head" data-help="Open methodology and disclosure notes." data-help-label="NTS">' +
                    '<span class="panel-code">NTS</span>' +
                    '<strong>' + esc(ui.notesHeading) + '</strong>' +
                '</summary>' +
                '<div class="terminal-notes-body">' +
                    '<p>' + esc(ui.notesText) + '</p>' +
                    '<p id="comparison-rate-disclosure">' + esc(ui.continuityText) + '</p>' +
                '</div>' +
            '</details>';
    }

    function render(ui) {
        root.innerHTML = [
            '<section class="market-terminal" aria-label="' + esc(ui.title) + ' workspace">',
                '<aside class="terminal-column terminal-column-left">',
                    '<section class="panel terminal-panel terminal-nav-panel">',
                        '<div class="terminal-panel-head">',
                            '<span class="panel-code">NAV</span>',
                            '<strong>' + esc(ui.short) + '</strong>',
                        '</div>',
                        '<div id="market-nav-tree" class="market-nav-tree" aria-label="Market navigation"></div>',
                    '</section>',
                    '<section id="scenario" class="panel terminal-panel terminal-filter-panel">',
                        '<div class="terminal-panel-head">',
                            '<span class="panel-code">SCN</span>',
                            '<strong>Slice</strong>',
                        '</div>',
                        '<div class="terminal-filter-grid terminal-filter-grid-primary">',
                            '<label class="terminal-field terminal-field-bank" data-help="Search and select one or more institutions." data-help-label="BANK">',
                                '<span class="field-code">BANK</span>',
                                '<div class="terminal-inline-inputs">',
                                    '<input id="filter-bank-search" type="search" placeholder="Bank">',
                                    '<button id="filter-bank-clear" class="chip-btn secondary" type="button">ALL</button>',
                                '</div>',
                                '<select id="filter-bank" multiple size="5"></select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Minimum visible headline rate." data-help-label="MIN">',
                                '<span class="field-code">MIN</span>',
                                '<input id="filter-min-rate" type="number" step="0.001" min="0" placeholder="' + ui.minRatePlaceholder + '">' +
                            '</label>',
                            '<label class="terminal-field" data-help="Maximum visible headline rate." data-help-label="MAX">',
                                '<span class="field-code">MAX</span>',
                                '<input id="filter-max-rate" type="number" step="0.001" min="0" placeholder="' + ui.maxRatePlaceholder + '">' +
                            '</label>',
                            '<label class="terminal-field" data-help="Start date in YYYY-MM-DD format." data-help-label="FROM">',
                                '<span class="field-code">FROM</span>',
                                '<input id="filter-start-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD">' +
                            '</label>',
                            '<label class="terminal-field" data-help="End date in YYYY-MM-DD format." data-help-label="TO">',
                                '<span class="field-code">TO</span>',
                                '<input id="filter-end-date" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD">' +
                            '</label>',
                        '</div>',
                        '<p id="filter-date-status" class="field-help">YYYY-MM-DD</p>',
                        '<div class="terminal-action-row">',
                            '<button id="apply-filters" class="primary" type="button" data-help="Refresh the current slice across the dashboard." data-help-label="APPLY">RUN</button>',
                            '<button id="reset-filters" class="secondary" type="button" data-help="Reset the current slice to defaults." data-help-label="RESET">RST</button>',
                            '<button id="workspace-copy-link" class="secondary" type="button" data-help="Copy the current route, filters, pane, and hash state." data-help-label="COPY">LINK</button>',
                        '</div>',
                        '<div class="terminal-filter-state-row">',
                            '<span id="filter-dirty-indicator" class="pill">0</span>',
                            '<div id="active-filter-chips" class="active-filter-chips" aria-live="polite"></div>',
                        '</div>',
                        '<details class="terminal-more-filters" id="filter-bar">',
                            '<summary class="terminal-more-summary" data-help="Open secondary filters and refresh controls." data-help-label="MORE">MORE</summary>',
                            '<div class="terminal-filter-grid terminal-filter-grid-advanced">',
                                ui.advancedFields.concat(SHARED_ADVANCED_FIELDS).map(fieldMarkup).join(''),
                            '</div>',
                        '</details>',
                        '<div id="export" class="terminal-export-row">',
                            '<label class="terminal-field" data-help="Export the current table view." data-help-label="DL">',
                                '<span class="field-code">DL</span>',
                                '<select id="download-format" class="small" aria-label="Download format">',
                                    '<option value="">-</option>',
                                    '<option value="csv">CSV</option>',
                                    '<option value="xls">XLS</option>',
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
                                '<span class="panel-code">CHT</span>',
                                '<strong>' + esc(ui.short) + '</strong>',
                            '</div>',
                            '<div class="chart-guidance-wrap">',
                                '<span id="chart-guidance" class="hint">READY</span>',
                                '<div id="chart-summary" class="chart-summary" aria-live="polite"><span class="pill">WAIT</span></div>',
                            '</div>',
                        '</div>',
                        chartQuestionMarkup(),
                        '<div class="terminal-chart-controls">',
                            '<label class="terminal-field" data-help="Metric shown on the Y axis." data-help-label="Y">',
                                '<span class="field-code">Y</span>',
                                '<select id="chart-y">' + optionsMarkup(ui.chartMetrics) + '</select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Axis or category shown on the X axis." data-help-label="X">',
                                '<span class="field-code">X</span>',
                                '<select id="chart-x">' + optionsMarkup(ui.chartX) + '</select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Series grouping field." data-help-label="BY">',
                                '<span class="field-code">BY</span>',
                                '<select id="chart-group">' + optionsMarkup(ui.chartGroups) + '</select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Visible series density." data-help-label="DENS">',
                                '<span class="field-code">DENS</span>',
                                '<select id="chart-series-limit"><option value="compact">CMP</option><option value="standard" selected>STD</option><option value="expanded">EXP</option></select>',
                            '</label>',
                            '<label class="terminal-field" data-help="Chart renderer type." data-help-label="TYPE">',
                                '<span class="field-code">TYPE</span>',
                                '<select id="chart-type">' + optionsMarkup(BASE_CHART_TYPES) + '</select>',
                            '</label>',
                            '<button id="draw-chart" type="button" class="primary" data-help="Render the chart for the current slice." data-help-label="DRAW">DRAW</button>',
                        '</div>',
                        '<div class="terminal-chart-surface">',
                            '<div id="chart-output" class="terminal-chart-output" aria-label="Interactive chart"></div>',
                        '</div>',
                        '<p id="chart-status" class="hint">IDLE</p>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-bottom-panel" id="table">',
                        '<nav class="terminal-bottom-tabs" role="tablist" aria-label="Data panes">',
                            '<button id="tab-explorer" class="tab-btn active" role="tab" aria-selected="true" aria-controls="panel-explorer" type="button" data-help="Live rates table." data-help-label="TBL">TBL</button>',
                            '<button id="tab-pivot" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-pivot" type="button" data-help="Pivot workspace for the active slice." data-help-label="PVT">PVT</button>',
                            '<button id="tab-history" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-history" type="button" data-help="Series detail, spotlight trend, and chart summary." data-help-label="HST">HST</button>',
                            '<button id="tab-changes" class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-changes" type="button" data-help="Summary metrics and recent rate changes." data-help-label="CHG">CHG</button>',
                        '</nav>',
                        '<section id="panel-explorer" class="tab-panel active shortlist-panel" role="tabpanel" aria-labelledby="tab-explorer">',
                            '<div class="terminal-data-head">',
                                '<div>',
                                    '<span class="panel-code">TBL</span>',
                                    '<h2 id="explorer-overview-title">LOAD</h2>',
                                '</div>',
                                '<div class="terminal-data-actions">',
                                    '<span id="explorer-overview-status" class="pill">WAIT</span>',
                                    '<button id="table-settings-btn" class="icon-btn secondary" type="button" aria-label="Table settings" data-help="Column visibility, removed rows, and move-column mode." data-help-label="CFG">&#9881;</button>',
                                    '<div id="table-settings-popover" class="table-settings-popover" hidden></div>',
                                '</div>',
                            '</div>',
                            '<p id="explorer-overview-text" class="hint">SYNC</p>',
                            '<div id="rate-table" class="terminal-rate-table"></div>',
                        '</section>',
                        '<section id="panel-pivot" class="tab-panel" role="tabpanel" aria-labelledby="tab-pivot" hidden>',
                            '<div id="pivot">',
                                '<div class="terminal-data-head">',
                                    '<div><span class="panel-code">PVT</span><h2>Pivot</h2></div>',
                                    '<div class="terminal-data-actions"><button id="load-pivot" type="button" class="secondary" data-help="Load rows into the pivot workspace." data-help-label="LOAD">LOAD</button></div>',
                                '</div>',
                                '<p id="pivot-status" class="hint">WAIT</p>',
                                '<div id="pivot-output"></div>',
                            '</div>',
                        '</section>',
                        '<section id="panel-history" class="tab-panel" role="tabpanel" aria-labelledby="tab-history" hidden>',
                            '<div class="terminal-history-grid" id="history">',
                                '<section class="panel terminal-subpanel"><div class="terminal-panel-head"><span class="panel-code">SPT</span><strong>Spotlight</strong></div><div id="chart-detail-output" class="chart-detail-output" aria-label="Focused detail trend"></div></section>',
                                '<section class="panel terminal-subpanel"><div class="terminal-panel-head"><span class="panel-code">SUM</span><strong>History</strong></div><div id="chart-data-summary" class="chart-data-summary" aria-live="polite"><p class="chart-data-summary-empty">WAIT</p></div></section>',
                            '</div>',
                        '</section>',
                        '<section id="panel-changes" class="tab-panel" role="tabpanel" aria-labelledby="tab-changes" hidden>',
                            '<div class="terminal-changes-grid" id="changes">',
                                '<section class="panel terminal-subpanel executive-summary" id="executive-summary-panel" aria-label="Executive summary">',
                                    '<div class="terminal-panel-head"><span class="panel-code">30D</span><strong>Summary</strong></div>',
                                    '<p id="executive-summary-status" class="hint">WAIT</p>',
                                    '<div id="executive-summary-sections" class="executive-summary-sections"></div>',
                                '</section>',
                                '<section class="panel terminal-subpanel rate-change-log" aria-label="Rate changes">',
                                    '<details id="rate-change-details" class="rate-change-details" open>',
                                        '<summary id="rate-change-summary" class="rate-change-summary"><span class="panel-code">CHG</span><span id="rate-change-headline" class="rate-change-headline">WAIT</span></summary>',
                                        '<p id="rate-change-warning" class="rate-change-warning" hidden></p>',
                                        '<p id="rate-change-status" class="hint">WAIT</p>',
                                        '<ul id="rate-change-list" class="rate-change-list"><li class="rate-change-item-empty">WAIT</li></ul>',
                                    '</details>',
                                '</section>',
                            '</div>',
                        '</section>',
                    '</section>',
                '</section>',
                '<aside id="ladder" class="terminal-column terminal-column-right">',
                    '<section class="panel terminal-panel terminal-stats-panel">',
                        '<div class="terminal-panel-head">',
                            '<span class="panel-code">TICK</span>',
                            '<strong>' + esc(ui.short) + '</strong>',
                        '</div>',
                        '<div class="terminal-stat-grid" id="hero-stats">',
                            '<div class="terminal-stat" id="stat-updated" data-help="Last collection date in the active slice." data-help-label="UPD"><span class="metric-code">UPD</span><strong>...</strong></div>',
                            '<div class="terminal-stat" id="stat-cash-rate" data-help="' + esc(ui.statSecondaryHelp) + '" data-help-label="' + esc(ui.statSecondaryCode) + '"><span class="metric-code">' + esc(ui.statSecondaryCode) + '</span><strong>' + esc(ui.statSecondaryValue) + '</strong></div>',
                            '<div class="terminal-stat" id="stat-records" data-help="Total rows available in the active slice." data-help-label="ROWS"><span class="metric-code">ROWS</span><strong>...</strong></div>',
                        '</div>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-ladder-panel">',
                        '<div class="terminal-panel-head">',
                            '<span class="panel-code">LDR</span>',
                            '<strong>' + esc(ui.ladderTitle) + '</strong>',
                        '</div>',
                        '<label class="terminal-field terminal-ladder-search" data-help="Filter the ladder by lender or product name." data-help-label="FIND">',
                            '<span class="field-code">FIND</span>',
                            '<input id="ladder-search" type="search" placeholder="Find">',
                        '</label>',
                        '<div id="quick-compare-cards" class="quick-compare-cards"></div>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-spotlight-panel">',
                        '<div class="terminal-panel-head"><span class="panel-code">SPT</span><strong>Focus</strong></div>',
                        '<div id="chart-point-details" class="chart-point-details" aria-live="polite"></div>',
                    '</section>',
                    '<section class="panel terminal-panel terminal-series-panel">',
                        '<div class="terminal-panel-head"><span class="panel-code">PK</span><strong>Series</strong></div>',
                        '<p id="chart-series-note" class="hint">WAIT</p>',
                        '<div id="chart-series-list" class="chart-series-list"><p class="chart-series-empty">WAIT</p></div>',
                    '</section>',
                '</aside>',
            '</section>'
        ].join('');
    }

    render(SECTION_UI[section] || SECTION_UI['home-loans']);
})();
