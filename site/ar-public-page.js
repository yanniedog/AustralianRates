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
    var compactViewport = !!(window.matchMedia && (
        window.matchMedia('(max-width: 760px)').matches ||
        window.matchMedia('(max-height: 760px) and (orientation: landscape)').matches
    ));

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
                        '<a class="buttonish secondary" href="/economic-data/">Economic data</a>' +
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

    var TD_EXTRA_VIEWS = [
        { value: 'timeRibbon', label: 'Ribbon (time)', icon: 'history', help: 'Rate range and mean over time, all banks.', selected: false },
        { value: 'tdTermTime', label: 'Term vs time', icon: 'chart', help: 'Yield by term over time: how banks price across terms.', selected: false }
    ];
    var CHART_VIEWS;
    if (section === 'home-loans') {
        CHART_VIEWS = [
            { value: 'homeLoanReport', label: 'Rate Report', icon: 'history', help: 'Variable home loan rates vs RBA cash rate over time.', selected: true }
        ];
    } else if (section === 'savings') {
        CHART_VIEWS = [
            { value: 'economicReport', label: 'Economic Report', icon: 'history', help: 'Savings rates vs RBA cash rate and CPI inflation over time.', selected: true }
        ];
    } else if (section === 'term-deposits') {
        var tdReportView = { value: 'termDepositReport', label: 'Rate Report', icon: 'history', help: 'Term deposit rates vs RBA cash rate and CPI over time.', selected: true };
        CHART_VIEWS = [tdReportView].concat(TD_EXTRA_VIEWS);
    } else {
        CHART_VIEWS = [];
    }

    var WORKSPACE_TABS = [
        { id: 'chart', label: 'Chart', icon: 'chart', help: 'Interactive chart view.' },
        { id: 'explorer', label: 'Table', icon: 'table', help: 'Live rates table.' },
        { id: 'pivot', label: 'Pivot', icon: 'pivot', help: 'Pivot workspace for the active slice.' }
    ];

    var SHARED_ADVANCED_FIELDS = [
        {
            kind: 'toggle',
            id: 'filter-exclude-compare-edge-cases',
            label: 'Exclude compare edge cases',
            icon: 'compare',
            checked: true,
            help: 'Exclude niche or mis-filed outlier products from compare views and report charts.'
        },
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

    function depositBalanceFilterMarkup(field, labelId) {
        var groupAccName = (field.label || field.code || 'Filter') + ' options';
        return '' +
            '<div class="filter-pad-shell filter-deposit-balance-shell">' +
                '<div id="filter-deposit-balance-range" class="deposit-balance-range" role="group" aria-labelledby="' + esc(labelId) + '" aria-label="' + esc(groupAccName) + '">' +
                    '<p id="filter-deposit-balance-readout" class="deposit-balance-readout hint" aria-live="polite">All balances</p>' +
                    '<div class="deposit-balance-track-wrap">' +
                        '<div class="deposit-balance-ruler" aria-hidden="true" title="Linear scale: zero to ten million dollars">' +
                            '<span class="deposit-balance-ruler-tick deposit-balance-ruler-tick-start" style="left:0%">$0</span>' +
                            '<span class="deposit-balance-ruler-tick" style="left:20%">$2m</span>' +
                            '<span class="deposit-balance-ruler-tick" style="left:40%">$4m</span>' +
                            '<span class="deposit-balance-ruler-tick" style="left:60%">$6m</span>' +
                            '<span class="deposit-balance-ruler-tick" style="left:80%">$8m</span>' +
                            '<span class="deposit-balance-ruler-tick deposit-balance-ruler-tick-end" style="left:100%">$10m</span>' +
                        '</div>' +
                        '<div class="deposit-balance-dual">' +
                            '<div class="deposit-balance-track-bg" aria-hidden="true">' +
                                '<div id="filter-deposit-balance-fill" class="deposit-balance-track-fill"></div>' +
                            '</div>' +
                            '<input type="range" id="filter-balance-range-min" class="deposit-balance-range-input deposit-balance-range-min" min="0" max="1000" value="0" step="1" aria-valuemin="0" aria-valuemax="10000000" aria-valuenow="0" aria-label="Minimum balance for deposit band">' +
                            '<input type="range" id="filter-balance-range-max" class="deposit-balance-range-input deposit-balance-range-max" min="0" max="1000" value="1000" step="1" aria-valuemin="0" aria-valuemax="10000000" aria-valuenow="10000000" aria-label="Maximum balance for deposit band">' +
                        '</div>' +
                        '<p class="deposit-balance-scale-note hint">Scale is linear; exact band is shown above.</p>' +
                    '</div>' +
                    '<input type="hidden" id="filter-balance-min" value="">' +
                    '<input type="hidden" id="filter-balance-max" value="">' +
                '</div>' +
                '<select id="' + field.id + '" class="filter-native-select" aria-labelledby="' + esc(labelId) + '">' + optionsMarkup(field.options || [{ value: '', label: 'All', selected: true }]) + '</select>' +
            '</div>';
    }

    function filterPadMarkup(field, labelId) {
        var groupAccName = (field.label || field.code || 'Filter') + ' options';
        if (field.id === 'filter-deposit-tier' && (section === 'savings' || section === 'term-deposits')) {
            return depositBalanceFilterMarkup(field, labelId);
        }
        return '' +
            '<div class="filter-pad-shell">' +
                '<div id="' + field.id + '-pads" class="filter-pad-grid" data-filter-pads-for="' + field.id + '" role="group" aria-label="' + esc(groupAccName) + '"></div>' +
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
                    '<input id="' + field.id + '" type="checkbox"' + (field.checked ? ' checked' : '') + ' aria-labelledby="' + esc(fieldLabelId(field)) + '">' +
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
                fieldLabelBlock(field, { tagName: 'div' }) +
                filterPadMarkup(field, labelId) +
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

    function drawerScenarioMarkup(ui) {
        var ids;
        if (section === 'home-loans') ids = ['filter-security', 'filter-repayment', 'filter-structure', 'filter-lvr', 'filter-feature'];
        else if (section === 'savings') ids = ['filter-account-type', 'filter-rate-type', 'filter-deposit-tier'];
        else if (section === 'term-deposits') ids = ['filter-term-months', 'filter-deposit-tier', 'filter-interest-payment'];
        else return '';
        return ids.map(function (id) {
            var f = findUiField(ui, id);
            // Use pad grids (filter-*-pads) so filters stay keyboard/touch friendly and E2E can assert on pad buttons.
            return f ? fieldMarkup(f) : '';
        }).join('');
    }

    function filterDrawerMarkup(ui) {
        var scenarioSection = section !== 'economic-data' ? (
            '<div class="filters-drawer-section filters-scenarios">' +
                '<div class="terminal-filter-group-head"><strong>Scenario</strong></div>' +
                '<div class="filters-scenarios-grid">' + drawerScenarioMarkup(ui) + '</div>' +
            '</div>'
        ) : '';

        var extraAdvancedFields = (ui.advancedFields || []).filter(function (f) {
            if (section === 'home-loans' && ['filter-security', 'filter-repayment', 'filter-structure', 'filter-lvr', 'filter-feature'].indexOf(f.id) >= 0) return false;
            if (section === 'savings' && ['filter-account-type', 'filter-rate-type', 'filter-deposit-tier'].indexOf(f.id) >= 0) return false;
            if (section === 'term-deposits' && ['filter-term-months', 'filter-deposit-tier', 'filter-interest-payment'].indexOf(f.id) >= 0) return false;
            return true;
        });

        return '' +
            '<details class="filters-drawer" id="scenario">' +
                '<summary class="filters-drawer-summary">' +
                    iconText('filter', 'Filters', 'control-chip-label') +
                    '<span id="filter-dirty-indicator" class="filter-dirty-dot" hidden></span>' +
                '</summary>' +
                '<div class="filters-drawer-body">' +
                    '<div class="filters-drawer-section">' +
                        '<div class="terminal-field terminal-field-bank" data-help="Search and select one or more institutions." data-help-label="Banks">' +
                            '<div id="filter-bank-label" class="terminal-field-label">' + iconText('bank', 'Banks', 'field-code') + '</div>' +
                            '<div class="terminal-inline-inputs terminal-inline-inputs-bank">' +
                                '<input id="filter-bank-search" type="search" placeholder="Search banks…" aria-label="Search banks">' +
                                '<button id="filter-bank-clear" class="chip-btn secondary" type="button" aria-label="Clear bank selection">All</button>' +
                                '<span id="filter-bank-count" class="pill filter-bank-count" aria-live="polite">All</span>' +
                            '</div>' +
                            '<div id="filter-bank-options" class="bank-picker-grid bank-picker-compact" role="group" aria-labelledby="filter-bank-label"></div>' +
                            '<select id="filter-bank" class="bank-native-select" multiple size="5" hidden aria-hidden="true" aria-labelledby="filter-bank-label"></select>' +
                        '</div>' +
                    '</div>' +
                    scenarioSection +
                    '<details class="filters-more">' +
                        '<summary class="filters-more-summary">' + iconText('filter', 'More filters', 'control-chip-label') + '</summary>' +
                        '<div class="filters-more-body">' +
                            '<div class="filters-drawer-section">' +
                                '<div class="terminal-filter-group-head"><strong>Dates and limits</strong></div>' +
                                '<div class="filters-more-grid">' +
                                    compactNumberFieldMarkup({ id: 'filter-min-rate', label: 'Min rate', icon: 'summary', placeholder: ui.minRatePlaceholder || '', help: 'Minimum visible headline rate.' }) +
                                    compactNumberFieldMarkup({ id: 'filter-max-rate', label: 'Max rate', icon: 'summary', placeholder: ui.maxRatePlaceholder || '', help: 'Maximum visible headline rate.' }) +
                                    compactDateFieldMarkup('filter-start-date', 'From date', 'calendar', 'Choose a start date or type YYYY-MM-DD.') +
                                    compactDateFieldMarkup('filter-end-date', 'To date', 'calendar', 'Choose an end date or type YYYY-MM-DD.') +
                                '</div>' +
                                '<div class="chart-filter-shortcuts-wrap">' +
                                    dateShortcutMarkup() +
                                    '<p id="filter-date-status" class="field-help">Choose a date or type YYYY-MM-DD</p>' +
                                '</div>' +
                            '</div>' +
                            (extraAdvancedFields.length ? (
                                '<div class="filters-drawer-section">' +
                                    '<div class="terminal-filter-group-head"><strong>Advanced</strong></div>' +
                                    '<div class="filters-more-grid">' +
                                        extraAdvancedFields.map(function (f) { return fieldMarkup(Object.assign({}, f, { padGrid: false })); }).join('') +
                                    '</div>' +
                                '</div>'
                            ) : '') +
                            '<div class="filters-drawer-section">' +
                                '<div class="terminal-filter-group-head"><strong>Workspace</strong></div>' +
                                '<div class="filters-more-grid">' +
                                    SHARED_ADVANCED_FIELDS.map(function (f) { return fieldMarkup(Object.assign({}, f, { padGrid: false })); }).join('') +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                    '</details>' +
                '</div>' +
            '</details>';
    }

    function chartQuestionMarkup() {
        if (!CHART_VIEWS.length || CHART_VIEWS.length <= 1) {
            return '';
        }
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

    function chartEconomicOverlayMarkup() {
        return '' +
            '<details class="chart-overlay-picker" id="chart-economic-overlay-picker">' +
                '<summary class="chart-overlay-picker-summary">' +
                    '<span class="chart-overlay-picker-title">Economic overlays</span>' +
                    '<span id="chart-economic-overlay-summary" class="chart-overlay-picker-count">None</span>' +
                '</summary>' +
                '<div class="chart-overlay-picker-panel">' +
                    '<p id="chart-economic-overlay-hint" class="hint">Plot indexed economic metrics alongside bank rates in Rate Report and Compare views.</p>' +
                    '<div id="chart-economic-overlay-options" class="chart-overlay-picker-options">' +
                        '<p class="chart-overlay-picker-empty">Loading overlays…</p>' +
                    '</div>' +
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
        var statSecondaryHelp = ui.statSecondaryHelp || '';
        var statSecondaryLabel = ui.statSecondaryLabel || 'Cash rate';
        var statSecondaryIcon = ui.statSecondaryIcon || 'stats';
        var statSecondaryValue = ui.statSecondaryValue || '...';
        root.innerHTML = [
            '<section class="market-terminal" aria-label="' + esc(ui.title) + ' workspace">',
                '<section class="terminal-column terminal-column-center">',
                    '<section class="panel terminal-panel terminal-workspace-panel" id="workspace">',

                        // Workspace nav: subtabs + actions
                        '<div class="workspace-nav-row">',
                            '<nav class="workspace-tab-nav" role="tablist" aria-label="' + esc(ui.title) + ' views">',
                                tabButtonMarkup(WORKSPACE_TABS[0], true),
                                tabButtonMarkup(WORKSPACE_TABS[1], false),
                                tabButtonMarkup(WORKSPACE_TABS[2], false),
                            '</nav>',
                            '<div class="workspace-nav-actions" role="toolbar" aria-label="Workspace actions">',
                                '<button type="button" id="refresh-page-btn" class="secondary small" aria-label="Refresh page and data">Refresh</button>',
                                '<span id="last-refreshed" class="hint"></span>',
                            '</div>',
                        '</div>',

                        // Inline status messages
                        '<div id="workspace-status" class="terminal-inline-feedback workspace-status is-warning" role="status" aria-live="polite" hidden>',
                            '<div class="workspace-status-copy">',
                                '<strong id="workspace-status-title">Startup degraded</strong>',
                                '<span id="workspace-status-message">Some controls are taking longer than expected.</span>',
                            '</div>',
                            '<div class="workspace-status-actions">',
                                '<button id="workspace-status-retry" class="secondary small" type="button">Retry startup</button>',
                            '</div>',
                        '</div>',
                        '<p id="workspace-copy-status" class="terminal-inline-feedback terminal-copy-status" role="status" aria-live="polite" hidden></p>',

                        // Active filter chips — always-visible editable strip
                        '<div id="active-filter-chips" class="chip-strip" hidden></div>',

                        // Filter drawer (collapsed by default)
                        filterDrawerMarkup(ui),

                        // ── Chart tab panel ──────────────────────────────────────
                        '<section id="panel-chart" class="tab-panel active" role="tabpanel" aria-labelledby="tab-chart">',
                            '<div class="chart-block">',
                                '<div class="chart-figure">',
                                    '<div class="chart-toolbar">',
                                        '<div class="chart-toolbar-stack">',
                                            chartQuestionMarkup(),
                                            chartEngineMarkup(),
                                        '</div>',
                                        chartEconomicOverlayMarkup(),
                                    '</div>',
                                    '<div class="terminal-chart-surface">',
                                        '<div id="chart-output" class="terminal-chart-output" aria-label="Interactive chart"></div>',
                                    '</div>',
                                '</div>',
                                '<footer class="chart-footer" aria-label="Chart overview">',
                                    '<div class="terminal-stat-grid chart-footer-stats" id="hero-stats">',
                                        '<div class="terminal-stat" id="stat-updated" data-help="Last collection date in the active slice." data-help-label="Updated"><span class="metric-code">' + iconText('calendar', 'Updated') + '</span><strong>...</strong></div>',
                                        '<div class="terminal-stat" id="stat-cash-rate" data-help="' + esc(statSecondaryHelp) + '" data-help-label="' + esc(statSecondaryLabel) + '"><span class="metric-code">' + iconText(statSecondaryIcon, statSecondaryLabel) + '</span><strong>' + esc(statSecondaryValue) + '</strong></div>',
                                        '<div class="terminal-stat" id="stat-records" data-help="Total rows available in the active slice." data-help-label="Rows"><span class="metric-code">' + iconText('rows', 'Rows') + '</span><strong>...</strong></div>',
                                        '<div class="terminal-stat terminal-stat-small" id="stat-feeds" data-help="Last time bank feeds were collected and stored." data-help-label="Bank feeds"><span class="metric-code">' + iconText('calendar', 'Bank feeds') + '</span><strong>...</strong></div>',
                                    '</div>',
                                '</footer>',
                                '<div class="chart-hidden-aux" hidden aria-hidden="true">',
                                    '<span id="chart-guidance" class="chart-footer-guidance hint">On demand</span>',
                                    '<div id="chart-summary" class="chart-summary chart-footer-summary" aria-live="polite"><span class="pill">Load chart when ready</span></div>',
                                    '<div class="chart-selection-rail" aria-label="Series and selection">',
                                        '<p id="chart-series-note" class="chart-series-note hint" aria-live="polite"></p>',
                                        '<div id="chart-series-list" class="chart-series-list" role="list"></div>',
                                        '<div id="chart-point-details" class="chart-point-details" aria-live="polite"></div>',
                                        '<div id="quick-compare-cards" class="quick-compare-cards" hidden></div>',
                                    '</div>',
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
                                            '<select id="chart-series-limit"><option value="compact" selected>Compact</option><option value="standard">Standard</option><option value="expanded">Expanded</option></select>',
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
                                            ? '<div class="terminal-field chart-structure-filters-wrap" id="chart-structure-filters-wrap" data-help="Include or exclude rate structures in slope and curve charts." data-help-label="Show structures">' +
                                                '<span class="field-code">' + (typeof iconText === 'function' ? iconText('compare', 'Show structures', 'field-code') : 'Show structures') + '</span>' +
                                                '<div id="chart-structure-filters" class="chart-structure-filters" role="group" aria-label="Rate structures to show"></div>' +
                                                '</div>'
                                            : ''),
                                    '</div>',
                                '</div>',
                                '<p id="hero-error" class="terminal-inline-feedback is-error" role="alert" hidden></p>',
                                '<p id="chart-error" class="terminal-inline-feedback is-error" role="alert" hidden></p>',
                                '<p id="chart-status" class="hint">Idle</p>',
                                // Spotlight detail — populated on chart series interaction
                                '<div class="chart-detail-area" id="chart-detail-area" hidden>',
                                    '<section class="panel terminal-subpanel"><div class="terminal-panel-head">' + panelIcon('focus', 'Spotlight') + panelHeadingMarkup('h3', 'Spotlight') + '</div><div id="chart-detail-output" class="chart-detail-output" aria-label="Focused detail trend"></div></section>',
                                    '<section class="panel terminal-subpanel"><div class="terminal-panel-head">' + panelIcon('history', 'History') + panelHeadingMarkup('h3', 'History summary') + '</div><div id="chart-data-summary" class="chart-data-summary" aria-live="polite"><p class="chart-data-summary-empty">History populates after chart load.</p></div></section>',
                                '</div>',
                            '</div>',
                        '</section>',

                        // ── Table tab panel ──────────────────────────────────────
                        '<section id="panel-explorer" class="tab-panel" role="tabpanel" aria-labelledby="tab-explorer" hidden>',
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
                            // Inline 24h rate changes
                            '<section class="rate-change-inline-section" aria-label="Recent rate changes">',
                                '<details id="rate-change-details" class="rate-change-details" open>',
                                    '<summary id="rate-change-summary" class="rate-change-summary">' + panelIcon('changes', 'Changes') + '<span id="rate-change-headline" class="rate-change-headline">Recent changes</span></summary>',
                                    '<p id="rate-change-warning" class="rate-change-warning" hidden></p>',
                                    '<p id="rate-change-status" class="hint">Loading changes</p>',
                                    '<ul id="rate-change-list" class="rate-change-list"><li class="rate-change-item-empty">Loading changes</li></ul>',
                                '</details>',
                            '</section>',
                        '</section>',

                        // ── Pivot tab panel ──────────────────────────────────────
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

                    '</section>',
                '</section>',
            '</section>',
        ].join('');
    }

    render(SECTION_UI[section] || SECTION_UI['home-loans']);
})();
