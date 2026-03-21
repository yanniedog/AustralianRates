(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var routeState = (window.AR && window.AR.routeState) || {};
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

    function panelHeadingMarkup(tagName, title) {
        var tag = String(tagName || 'h2').toLowerCase();
        if (!/^h[1-6]$/.test(tag)) tag = 'h2';
        return '<' + tag + ' class="terminal-panel-title">' + esc(title) + '</' + tag + '>';
    }

    var iconText = typeof uiIcons.text === 'function' ? uiIcons.text : fallbackText;
    var panelIcon = typeof uiIcons.panel === 'function' ? uiIcons.panel : fallbackPanel;
    var iconOnly = typeof uiIcons.icon === 'function' ? uiIcons.icon : fallbackIcon;
    var compactViewport = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);

    function setMeta(selector, attr, value) {
        var el = document.querySelector(selector);
        if (!el || value == null) return;
        el.setAttribute(attr, String(value));
    }

    function ensureMeta(name) {
        var el = document.querySelector('meta[name="' + name + '"]');
        if (el) return el;
        el = document.createElement('meta');
        el.setAttribute('name', name);
        document.head.appendChild(el);
        return el;
    }

    function applyNotFoundDocumentState() {
        document.title = 'Page not found | AustralianRates';
        document.body.classList.add('ar-not-found');
        ensureMeta('description').setAttribute('content', 'The requested AustralianRates page could not be found.');
        ensureMeta('robots').setAttribute('content', 'noindex');
        setMeta('link[rel="canonical"]', 'href', window.location.href);
        setMeta('meta[property="og:title"]', 'content', 'Page not found | AustralianRates');
        setMeta('meta[property="og:description"]', 'content', 'The requested AustralianRates page could not be found.');
        setMeta('meta[property="og:url"]', 'content', window.location.href);
    }

    function renderNotFound() {
        var requestedPath = routeState.normalizedPath || window.location.pathname || '/';
        root.innerHTML = '' +
            '<section class="panel legal-hero missing-route-panel" aria-label="Page not found">' +
                '<div class="legal-hero-copy">' +
                    '<p class="eyebrow">404</p>' +
                    '<h1>Page not found.</h1>' +
                    '<p class="subtitle">The page you requested is not available on AustralianRates.</p>' +
                    '<p class="missing-route-note">If you followed an outdated link, jump back into one of the live rate boards below and continue from the current official data pages.</p>' +
                    '<div class="legal-badge-row">' +
                        '<span class="legal-badge">Requested path: ' + esc(requestedPath) + '</span>' +
                        '<span class="legal-badge">Use the links below to keep exploring</span>' +
                    '</div>' +
                    '<div class="market-intro-actions">' +
                        '<a class="buttonish primary" href="/">Home loans</a>' +
                        '<a class="buttonish secondary" href="/savings/">Savings</a>' +
                        '<a class="buttonish secondary" href="/term-deposits/">Term deposits</a>' +
                        '<a class="buttonish secondary" href="/about/">About</a>' +
                    '</div>' +
                '</div>' +
            '</section>';
    }

    if (routeState.notFound) {
        applyNotFoundDocumentState();
        renderNotFound();
        return;
    }

    var BASE_CHART_TYPES = [
        { value: 'scatter', label: 'Line', selected: true },
        { value: 'bar', label: 'Ribbon' },
        { value: 'box', label: 'Box-whisker' }
    ];

    var DATE_SHORTCUTS = [
        { value: 'all', label: 'All time' },
        { value: '7', label: '7D' },
        { value: '30', label: '30D' },
        { value: '90', label: '90D' }
    ];

    var BASE_CHART_VIEWS = [
        { value: 'lenders', label: 'Leaders', icon: 'snapshot', help: 'Best rate now per lender.' },
        { value: 'ladder', label: 'Ladder', icon: 'chart', help: 'Rank and value: who is first and by how much.' },
        { value: 'market', label: 'Curve', icon: 'history', help: 'Market shape by structure, term, or tier.', selected: section !== 'home-loans' },
        { value: 'slope', label: 'Slope', icon: 'compare', help: 'Who moved? Rate change between two dates.', selected: section === 'home-loans' },
        { value: 'surface', label: 'Movement', icon: 'movement', help: 'Rate over time (heatmap).' },
        { value: 'compare', label: 'Compare', icon: 'compare', help: 'Selected products over time.' },
        { value: 'distribution', label: 'Distribution', icon: 'distribution', help: 'Spread by group.' }
    ];
    var TD_EXTRA_VIEWS = [
        { value: 'timeRibbon', label: 'Ribbon (time)', icon: 'history', help: 'Rate range and mean over time, all banks.' },
        { value: 'tdTermTime', label: 'Term vs time', icon: 'chart', help: 'Yield by term over time: how banks price across terms.' }
    ];
    var CHART_VIEWS;
    if (section === 'home-loans') {
        var hlReportView = { value: 'homeLoanReport', label: 'Rate Report', icon: 'history', help: 'Variable home loan rates vs RBA cash rate over time.', selected: true };
        var curveFirst = { value: 'market', label: 'Curve', icon: 'history', help: 'Market shape by structure, term, or tier.', selected: false };
        var restViews = BASE_CHART_VIEWS.filter(function (v) { return v.value !== 'market'; }).map(function (v) { return Object.assign({}, v, { selected: false }); });
        CHART_VIEWS = [hlReportView, curveFirst].concat(restViews);
    } else if (section === 'savings') {
        // Economic report is the headline view for savings — tells the rate-vs-RBA-vs-inflation story.
        var savingsEconomicView = { value: 'economicReport', label: 'Economic Report', icon: 'history', help: 'Savings rates vs RBA cash rate and CPI inflation over time.', selected: true };
        var savingsOtherViews = BASE_CHART_VIEWS.map(function (v) { return Object.assign({}, v, { selected: false }); });
        CHART_VIEWS = [savingsEconomicView].concat(savingsOtherViews);
    } else if (section === 'term-deposits') {
        var tdReportView = { value: 'termDepositReport', label: 'Rate Report', icon: 'history', help: 'Term deposit rates vs RBA cash rate and CPI over time.' };
        CHART_VIEWS = [Object.assign({}, tdReportView, { selected: true })].concat(BASE_CHART_VIEWS.map(function (v) { return Object.assign({}, v, { selected: false }); })).concat(TD_EXTRA_VIEWS);
    } else {
        CHART_VIEWS = BASE_CHART_VIEWS;
    }

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
            padGrid: false,
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
            padGrid: false,
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
                { value: 'interest_rate', label: 'Interest rate (headline)', selected: true },
                { value: 'comparison_rate', label: 'Comparison rate (like-for-like)' },
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
            ],
            chartTypes: [
                { value: 'scatter', label: 'Line', selected: false },
                { value: 'bar', label: 'Ribbon', selected: true },
                { value: 'box', label: 'Box-whisker' }
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
            ],
            chartTypes: [
                { value: 'scatter', label: 'Line', selected: true },
                { value: 'bar', label: 'Ribbon' },
                { value: 'box', label: 'Box-whisker' }
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
            ],
            chartTypes: [
                { value: 'scatter', label: 'Line' },
                { value: 'bar', label: 'Ribbon' },
                { value: 'box', label: 'Box-whisker', selected: true }
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

    function fieldLabelId(field) {
        return String(field && field.id || 'field') + '-label';
    }

    function fieldLabelBlock(field, opts) {
        var tag = opts && opts.tagName === 'div' ? 'div' : 'label';
        var attrs = [
            'class="terminal-field-label"',
            'id="' + esc(fieldLabelId(field)) + '"'
        ];
        if (tag === 'label' && opts && opts.forId) attrs.push('for="' + esc(opts.forId) + '"');
        return '<' + tag + ' ' + attrs.join(' ') + '>' + fieldLabelMarkup(field) + '</' + tag + '>';
    }

    function filterPadMarkup(field, labelId) {
        return '' +
            '<div class="filter-pad-shell">' +
                '<div id="' + field.id + '-pads" class="filter-pad-grid" data-filter-pads-for="' + field.id + '" role="group" aria-labelledby="' + esc(labelId) + '"></div>' +
                '<select id="' + field.id + '" class="filter-native-select" aria-labelledby="' + esc(labelId) + '">' + optionsMarkup(field.options || [{ value: '', label: 'All', selected: true }]) + '</select>' +
            '</div>';
    }

    function fieldMarkup(field) {
        var label = field.label || field.code || 'Field';
        var attrs = helpAttrs(label, field.help);
        if (field.kind === 'toggle') {
            return '' +
                '<div class="terminal-field terminal-field-toggle"' + attrs + '>' +
                    fieldLabelBlock(field, { forId: field.id }) +
                    '<input id="' + field.id + '" type="checkbox" aria-labelledby="' + esc(fieldLabelId(field)) + '">' +
                '</div>';
        }
        if (field.kind === 'number') {
            return '' +
                '<div class="terminal-field"' + attrs + '>' +
                    fieldLabelBlock(field, { forId: field.id }) +
                    '<input id="' + field.id + '" type="number" step="0.001" min="0" placeholder="' + field.placeholder + '" aria-labelledby="' + esc(fieldLabelId(field)) + '">' +
                '</div>';
        }
        if (field.padGrid !== false) {
            return '' +
                '<div class="terminal-field terminal-field-pad"' + attrs + '>' +
                    fieldLabelBlock(field, { tagName: 'div' }) +
                    filterPadMarkup(field, fieldLabelId(field)) +
                '</div>';
        }
        return '' +
            '<div class="terminal-field"' + attrs + '>' +
                fieldLabelBlock(field, { forId: field.id }) +
                '<select id="' + field.id + '" aria-labelledby="' + esc(fieldLabelId(field)) + '">' + optionsMarkup(field.options || [{ value: '', label: 'All', selected: true }]) + '</select>' +
            '</div>';
    }

    function dateShortcutMarkup() {
        return '' +
            '<div class="terminal-date-shortcuts" role="group" aria-label="Quick date ranges">' +
                DATE_SHORTCUTS.map(function (shortcut) {
                    return '' +
                        '<button class="chip-btn secondary" type="button" data-date-range="' + esc(shortcut.value) + '">' +
                            esc(shortcut.label) +
                        '</button>';
                }).join('') +
            '</div>';
    }

    function filterGroupMarkup(title, note, fields) {
        if (!fields || !fields.length) return '';
        return '' +
            '<section class="terminal-filter-group">' +
                '<div class="terminal-filter-group-head">' +
                    '<strong>' + esc(title) + '</strong>' +
                    (note ? '<span class="hint">' + esc(note) + '</span>' : '') +
                '</div>' +
                '<div class="terminal-filter-grid terminal-filter-grid-advanced terminal-filter-grid-secondary">' +
                    fields.map(fieldMarkup).join('') +
                '</div>' +
            '</section>';
    }

    function findUiField(ui, id) {
        var fields = (ui && ui.advancedFields) || [];
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].id === id) return fields[i];
        }
        return null;
    }

    function compactSelectFieldMarkup(field) {
        if (!field) return '';
        var labelId = fieldLabelId(field);
        return '' +
            '<label class="terminal-field chart-filter-field"' + helpAttrs(field.label, field.help) + '>' +
                fieldLabelBlock(field, { forId: field.id }) +
                '<select id="' + field.id + '" class="small" aria-labelledby="' + esc(labelId) + '">' +
                    optionsMarkup(field.options || [{ value: '', label: 'All', selected: true }]) +
                '</select>' +
            '</label>';
    }

    function compactNumberFieldMarkup(field) {
        if (!field) return '';
        return '' +
            '<label class="terminal-field chart-filter-field"' + helpAttrs(field.label, field.help) + '>' +
                fieldLabelBlock(field, { forId: field.id }) +
                '<input id="' + field.id + '" class="small" type="number" step="0.001" min="0" placeholder="' + esc(field.placeholder || '') + '">' +
            '</label>';
    }

    function compactDateFieldMarkup(id, label, icon, help) {
        var field = { id: id, label: label, icon: icon };
        return '' +
            '<label class="terminal-field chart-filter-field"' + helpAttrs(label, help) + '>' +
                fieldLabelBlock(field, { forId: id }) +
                '<input id="' + id + '" class="small" type="date" autocomplete="off">' +
            '</label>';
    }

    function compactHomeLoanScenarioMarkup(ui) {
        return [
            compactSelectFieldMarkup(findUiField(ui, 'filter-security')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-repayment')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-structure')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-lvr')),
        ].join('');
    }

    function compactSavingsScenarioMarkup(ui) {
        return [
            compactSelectFieldMarkup(findUiField(ui, 'filter-account-type')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-rate-type')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-deposit-tier')),
        ].join('');
    }

    function compactTermDepositScenarioMarkup(ui) {
        return [
            compactSelectFieldMarkup(findUiField(ui, 'filter-term-months')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-deposit-tier')),
            compactSelectFieldMarkup(findUiField(ui, 'filter-interest-payment')),
        ].join('');
    }

    function compactScenarioMarkup(ui) {
        if (section === 'home-loans') return compactHomeLoanScenarioMarkup(ui);
        if (section === 'savings') return compactSavingsScenarioMarkup(ui);
        if (section === 'term-deposits') return compactTermDepositScenarioMarkup(ui);
        return '';
    }

    function compactChartFilterBarMarkup(ui) {
        return '' +
            '<section class="chart-filter-bar" aria-label="Chart filters">' +
                '<div class="chart-filter-bar-head">' +
                    '<div class="chart-filter-bar-copy">' +
                        '<strong>Comparison filter</strong>' +
                        '<p>Choose one product slice and the chart redraws immediately.</p>' +
                    '</div>' +
                    '<div class="chart-filter-bar-actions">' +
                        '<span id="filter-live-status" class="pill filter-live-pill is-live">Live sync on</span>' +
                        '<button id="reset-filters" class="secondary small" type="button" data-help="Reset the current slice to defaults." data-help-label="Reset filters">' + iconText('reset', 'Reset', 'control-chip-label') + '</button>' +
                        '<button id="workspace-copy-link" class="secondary small" type="button" data-help="Copy the current route, filters, pane, and hash state." data-help-label="Copy link">' + iconText('link', 'Link', 'control-chip-label') + '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="chart-filter-grid chart-filter-grid-primary">' +
                    compactScenarioMarkup(ui) +
                '</div>' +
                '<div id="workspace-status" class="terminal-inline-feedback workspace-status is-warning" role="status" aria-live="polite" hidden>' +
                    '<div class="workspace-status-copy">' +
                        '<strong id="workspace-status-title">Startup degraded</strong>' +
                        '<span id="workspace-status-message">Some controls are taking longer than expected.</span>' +
                    '</div>' +
                    '<div class="workspace-status-actions">' +
                        '<button id="workspace-status-retry" class="secondary small" type="button">Retry startup</button>' +
                    '</div>' +
                '</div>' +
                '<p id="workspace-copy-status" class="terminal-inline-feedback terminal-copy-status" role="status" aria-live="polite" hidden></p>' +
                '<details class="chart-filter-more" id="filter-bar">' +
                    '<summary class="terminal-more-summary" data-help="Open banks, dates, exports, and workspace controls." data-help-label="More filters">' + iconText('filter', 'More filters', 'control-chip-label') + '</summary>' +
                    '<div class="chart-filter-more-grid">' +
                        '<section class="chart-filter-more-section chart-filter-more-section-bank">' +
                            '<div class="terminal-filter-group-head">' +
                                '<strong>Banks</strong>' +
                                '<span class="hint">Optional shortlist</span>' +
                            '</div>' +
                            '<div class="terminal-field terminal-field-bank" data-help="Search and select one or more institutions." data-help-label="Banks">' +
                                '<div id="filter-bank-label" class="terminal-field-label">' + iconText('bank', 'Banks', 'field-code') + '</div>' +
                                '<div class="terminal-inline-inputs terminal-inline-inputs-bank">' +
                                    '<input id="filter-bank-search" type="search" placeholder="Search banks or codes" aria-labelledby="filter-bank-label">' +
                                    '<button id="filter-bank-clear" class="chip-btn secondary" type="button" aria-label="Clear selected banks">All</button>' +
                                    '<span id="filter-bank-count" class="pill filter-bank-count" aria-live="polite">All</span>' +
                                '</div>' +
                                '<div id="filter-bank-options" class="bank-picker-grid bank-picker-grid-compact" role="group" aria-labelledby="filter-bank-label"></div>' +
                                '<select id="filter-bank" class="bank-native-select" multiple size="5" hidden aria-hidden="true" aria-labelledby="filter-bank-label"></select>' +
                            '</div>' +
                        '</section>' +
                        '<section class="chart-filter-more-section">' +
                            '<div class="terminal-filter-group-head">' +
                                '<strong>Dates and limits</strong>' +
                                '<span class="hint">Optional narrowing</span>' +
                            '</div>' +
                            '<div class="chart-filter-grid chart-filter-grid-secondary">' +
                                compactNumberFieldMarkup({ id: 'filter-min-rate', label: 'Min rate', icon: 'summary', placeholder: ui.minRatePlaceholder, help: 'Minimum visible headline rate.' }) +
                                compactNumberFieldMarkup({ id: 'filter-max-rate', label: 'Max rate', icon: 'summary', placeholder: ui.maxRatePlaceholder, help: 'Maximum visible headline rate.' }) +
                                compactDateFieldMarkup('filter-start-date', 'From date', 'calendar', 'Choose a start date or type YYYY-MM-DD.') +
                                compactDateFieldMarkup('filter-end-date', 'To date', 'calendar', 'Choose an end date or type YYYY-MM-DD.') +
                            '</div>' +
                            '<div class="chart-filter-shortcuts-wrap">' +
                                dateShortcutMarkup() +
                                '<p id="filter-date-status" class="field-help">Choose a date or type YYYY-MM-DD</p>' +
                            '</div>' +
                        '</section>' +
                        '<section class="chart-filter-more-section">' +
                            '<div class="terminal-filter-group-head">' +
                                '<strong>Additional slice controls</strong>' +
                                '<span class="hint">Less common filters</span>' +
                            '</div>' +
                            '<div class="chart-filter-grid chart-filter-grid-secondary">' +
                                (ui.advancedFields || []).map(function (field) {
                                    if (section === 'home-loans' && ['filter-security', 'filter-repayment', 'filter-structure', 'filter-lvr'].indexOf(field.id) >= 0) return '';
                                    if (section === 'savings' && ['filter-account-type', 'filter-rate-type', 'filter-deposit-tier'].indexOf(field.id) >= 0) return '';
                                    if (section === 'term-deposits' && ['filter-term-months', 'filter-deposit-tier', 'filter-interest-payment'].indexOf(field.id) >= 0) return '';
                                    return fieldMarkup(Object.assign({}, field, { padGrid: false }));
                                }).join('') +
                            '</div>' +
                        '</section>' +
                        '<section class="chart-filter-more-section">' +
                            '<div class="terminal-filter-group-head">' +
                                '<strong>Workspace</strong>' +
                                '<span class="hint">Export and refresh</span>' +
                            '</div>' +
                            '<div class="chart-filter-grid chart-filter-grid-secondary">' +
                                SHARED_ADVANCED_FIELDS.map(fieldMarkup).join('') +
                                '<div id="export" class="chart-filter-export">' +
                                    '<div class="terminal-field" data-help="Export the current table view." data-help-label="Download">' +
                                        '<label id="download-format-label" class="terminal-field-label" for="download-format">' + iconText('download', 'Download', 'field-code') + '</label>' +
                                        '<select id="download-format" class="small" aria-labelledby="download-format-label">' +
                                            '<option value="">Format</option>' +
                                            '<option value="csv">CSV</option>' +
                                            '<option value="xls">Excel</option>' +
                                            '<option value="json">JSON</option>' +
                                        '</select>' +
                                    '</div>' +
                                    '<p id="download-status" class="terminal-inline-feedback terminal-export-status" role="status" aria-live="polite" hidden></p>' +
                                    '<button type="button" id="refresh-page-btn" class="buttonish secondary small" aria-label="Refresh page and data to load latest site and bypass cache">Refresh</button>' +
                                    '<span id="last-refreshed" class="hint"></span>' +
                                '</div>' +
                            '</div>' +
                        '</section>' +
                    '</div>' +
                '</details>' +
            '</section>';
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

    function chartEngineMarkup() {
        return '' +
            '<div class="chart-engine-row" role="group" aria-label="Chart rendering engine">' +
                '<span class="chart-engine-label hint">Engine</span>' +
                '<button type="button" class="chart-engine-btn chip-btn secondary is-active" data-chart-engine="echarts"' +
                    ' aria-pressed="true" title="Apache ECharts"' +
                    ' aria-label="Classic charts using Apache ECharts">Classic</button>' +
                '<button type="button" class="chart-engine-btn chip-btn secondary" data-chart-engine="lightweight"' +
                    ' aria-pressed="false" title="TradingView Lightweight Charts"' +
                    ' aria-label="TradingView Lightweight Charts">Lightweight</button>' +
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
                '<section class="terminal-column terminal-column-center">',
                    '<section id="chart" class="panel terminal-panel terminal-stage-panel">',
                        '<div class="chart-block">',
                            '<div class="chart-block-head">',
                                '<div class="terminal-panel-head">',
                                    panelIcon('chart', 'Charts'),
                                    panelHeadingMarkup('h2', ui.title),
                                '</div>',
                            '</div>',
                            compactChartFilterBarMarkup(ui),
                            '<div class="chart-figure">',
                                '<div class="chart-toolbar">',
                                    '<div class="chart-toolbar-stack">',
                                        chartQuestionMarkup(),
                                        chartEngineMarkup(),
                                    '</div>',
                                '</div>',
                                '<div class="terminal-chart-surface">',
                                    '<div id="chart-output" class="terminal-chart-output" aria-label="Interactive chart"></div>',
                                    '<div id="chart-time-slider-wrap" class="chart-time-slider-wrap" hidden aria-label="Chart time scrubber">',
                                        '<label class="chart-time-slider-label" for="chart-time-slider">Sampling date</label>',
                                        '<input type="range" id="chart-time-slider" class="chart-time-slider" min="0" max="0" value="0" step="1" aria-valuetext="">',
                                        '<span id="chart-time-slider-date" class="chart-time-slider-date"></span>',
                                        '<button type="button" id="chart-time-play" class="buttonish secondary chart-time-play" aria-label="Play animation">Play</button>',
                                    '</div>',
                                    '<div class="chart-selection-rail" aria-label="Series and selection">',
                                        '<p id="chart-series-note" class="chart-series-note hint" aria-live="polite"></p>',
                                        '<div id="chart-series-list" class="chart-series-list" role="list"></div>',
                                        '<div id="chart-point-details" class="chart-point-details" aria-live="polite"></div>',
                                    '</div>',
                                '</div>',
                            '</div>',
                            '<footer class="chart-footer" aria-label="Chart overview">',
                                '<span id="chart-guidance" class="chart-footer-guidance hint">On demand</span>',
                                '<div class="terminal-stat-grid chart-footer-stats" id="hero-stats">',
                                    '<div class="terminal-stat" id="stat-updated" data-help="Last collection date in the active slice." data-help-label="Updated"><span class="metric-code">' + iconText('calendar', 'Updated') + '</span><strong>...</strong></div>',
                                    '<div class="terminal-stat" id="stat-cash-rate" data-help="' + esc(ui.statSecondaryHelp) + '" data-help-label="' + esc(ui.statSecondaryLabel) + '"><span class="metric-code">' + iconText(ui.statSecondaryIcon, ui.statSecondaryLabel) + '</span><strong>' + esc(ui.statSecondaryValue) + '</strong></div>',
                                    '<div class="terminal-stat" id="stat-records" data-help="Total rows available in the active slice." data-help-label="Rows"><span class="metric-code">' + iconText('rows', 'Rows') + '</span><strong>...</strong></div>',
                                    '<div class="terminal-stat terminal-stat-small" id="stat-feeds" data-help="Last time bank feeds were collected and stored; latest bank and product with data." data-help-label="Bank feeds"><span class="metric-code">' + iconText('calendar', 'Bank feeds') + '</span><strong>...</strong></div>',
                                '</div>',
                                '<div id="chart-summary" class="chart-summary chart-footer-summary" aria-live="polite"><span class="pill">Load chart when ready</span></div>',
                            '</footer>',
                            '<p id="hero-error" class="terminal-inline-feedback is-error" role="alert" hidden></p>',
                            '<details class="chart-options-details" id="chart-options-details">',
                                '<summary class="chart-options-summary">Options</summary>',
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
                                        '<select id="chart-representation">' +
                                        (section === 'home-loans'
                                            ? '<option value="change">Change basis</option><option value="day" selected>Daily basis</option>'
                                            : '<option value="change" selected>Change basis</option><option value="day">Daily basis</option>') +
                                        '</select>',
                                    '</label>',
                                    '<label class="terminal-field" data-help="Line, ribbon, or box-whisker. Applies to Curve view only." data-help-label="Curve style">',
                                        iconText('chart', 'Curve style (Curve only)', 'field-code'),
                                        '<select id="chart-type">' + optionsMarkup(ui.chartTypes || BASE_CHART_TYPES) + '</select>',
                                    '</label>' +
                                    (section === 'home-loans'
                                        ? '<div class="terminal-field chart-structure-filters-wrap" id="chart-structure-filters-wrap" data-help="Include or exclude rate structures in slope and curve charts. Variable only by default." data-help-label="Show structures">' +
                                            '<span class="field-code">' + (typeof iconText === 'function' ? iconText('compare', 'Show structures', 'field-code') : 'Show structures') + '</span>' +
                                            '<div id="chart-structure-filters" class="chart-structure-filters" role="group" aria-label="Rate structures to show"></div>' +
                                            '</div>'
                                        : ''),
                                '</div>',
                            '</details>',
                            '<p id="chart-error" class="terminal-inline-feedback is-error" role="alert" hidden></p>',
                            '<p id="chart-status" class="hint">Idle</p>',
                        '</div>',
                    '</section>',
                    notesMarkup(ui),
                    '<details class="terminal-mobile-fold terminal-table-fold" id="table-details">',
                        '<summary class="terminal-more-summary" data-help="Expand to see the data table, pivot grid, history, and rate changes." data-help-label="Data table">' +
                            panelIcon('table', 'Table') +
                            panelHeadingMarkup('h3', 'Table, pivot, history, changes') +
                            '<span class="pill">Expand for data</span>' +
                        '</summary>',
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
                                    '<span id="pivot-status" class="hint">Open Pivot or press Refresh pivot to load rows.</span>',
                                '</div>',
                                '<div id="pivot-output"></div>',
                            '</div>',
                        '</section>',
                        '<section id="panel-history" class="tab-panel" role="tabpanel" aria-labelledby="tab-history" hidden>',
                            '<div class="terminal-history-grid" id="history">',
                                '<section class="panel terminal-subpanel"><div class="terminal-panel-head">' + panelIcon('focus', 'Spotlight') + panelHeadingMarkup('h3', 'Spotlight') + '</div><div id="chart-detail-output" class="chart-detail-output" aria-label="Focused detail trend"></div></section>',
                                '<section class="panel terminal-subpanel"><div class="terminal-panel-head">' + panelIcon('history', 'History') + panelHeadingMarkup('h3', 'History summary') + '</div><div id="chart-data-summary" class="chart-data-summary" aria-live="polite"><p class="chart-data-summary-empty">History populates after chart load.</p></div></section>',
                            '</div>',
                        '</section>',
                        '<section id="panel-changes" class="tab-panel" role="tabpanel" aria-labelledby="tab-changes" hidden>',
                            '<div class="terminal-changes-grid" id="changes">',
                                '<section class="panel terminal-subpanel executive-summary" id="executive-summary-panel" aria-label="Executive summary">',
                                    '<div class="terminal-panel-head">' + panelIcon('summary', 'Summary') + panelHeadingMarkup('h3', 'Summary') + '</div>',
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
                    '</details>',
                '</section>',
            '</section>'
        ].join('');
    }

    render(SECTION_UI[section] || SECTION_UI['home-loans']);
})();
