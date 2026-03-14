(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    var terminal = root ? root.querySelector('.market-terminal') : null;
    var uiIcons = (window.AR && window.AR.uiIcons) || {};
    var bankBrand = (window.AR && window.AR.bankBrand) || {};

    if (!root || !terminal || root.querySelector('.market-intro')) return;

    var esc = window._arEsc || function (value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

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

    var iconText = typeof uiIcons.text === 'function' ? uiIcons.text : fallbackText;
    var panelIcon = typeof uiIcons.panel === 'function' ? uiIcons.panel : fallbackPanel;

    var SECTION_COPY = {
        'home-loans': {
            eyebrow: 'Daily CDR-backed mortgage intelligence',
            title: 'Track Australian home loan pricing without losing product identity.',
            summary: 'Filter official lender feeds, compare the live leaders, and keep the same product intact through time with canonical product_key continuity.',
            manifestoLabel: 'Tracking rule',
            manifestoTitle: 'One line equals one product.',
            manifestoCopy: 'Charts and exports preserve canonical product identity so fixed terms, repayment types, and LVR bands stay longitudinal instead of blending into fake history.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', note: 'Waiting for the newest market snapshot.' },
                { id: 'rows', label: 'Rows in the slice', note: 'Counts update once your filters load.' },
                { id: 'leader', label: 'Best live rate', note: 'Searching the current leaders.' }
            ],
            principles: [
                { icon: 'bank', label: 'Official lender feeds' },
                { icon: 'continuity', label: 'Series-safe charting' },
                { icon: 'link', label: 'Shareable filtered routes' },
                { icon: 'download', label: 'CSV, Excel, and JSON exports' }
            ],
            steps: [
                { icon: 'filter', title: 'Define the exact borrower slice', text: 'Use purpose, repayment, structure, LVR, bank, and date filters before comparing rates.' },
                { icon: 'ladder', title: 'Move from leaders to product detail', text: 'The leaders rail, live table, charts, and change log stay aligned to the same filtered market slice.' },
                { icon: 'history', title: 'Carry continuity into every export', text: 'Charts and downloads keep longitudinal product identity so your shortlist can survive handoff and revisit.' }
            ],
            banks: [
                'Commonwealth Bank of Australia',
                'Westpac Banking Corporation',
                'National Australia Bank',
                'ANZ',
                'Macquarie Bank',
                'ING'
            ]
        },
        'savings': {
            eyebrow: 'Daily savings market tracking',
            title: 'Compare Australian savings yields with the real conditions still in frame.',
            summary: 'Track base, bonus, and introductory savings rates across major banks, then move from live leaders to deeper history without changing context.',
            manifestoLabel: 'What stays visible',
            manifestoTitle: 'Yield without losing the rule set.',
            manifestoCopy: 'Bonus-rate conditions, deposit tiers, and account type matter. This workspace keeps those product distinctions visible while you scan the market.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', note: 'Waiting for the newest market snapshot.' },
                { id: 'rows', label: 'Rows in the slice', note: 'Counts update once your filters load.' },
                { id: 'leader', label: 'Best live yield', note: 'Searching the current leaders.' }
            ],
            principles: [
                { icon: 'bank', label: 'Major bank coverage' },
                { icon: 'compare', label: 'Bonus versus base clarity' },
                { icon: 'continuity', label: 'Longitudinal product tracking' },
                { icon: 'download', label: 'Portable filtered exports' }
            ],
            steps: [
                { icon: 'filter', title: 'Set the account slice first', text: 'Filter by bank, account type, rate type, deposit tier, and date before ranking yields.' },
                { icon: 'summary', title: 'Read the market at two speeds', text: 'Use the leaders rail for quick yield scanning, then move to charts and pivot views for history and shape.' },
                { icon: 'link', title: 'Share the exact conditions', text: 'Copy the filtered route or export the active slice so the same bonus-rate conditions survive into review.' }
            ],
            banks: [
                'Commonwealth Bank of Australia',
                'UBank',
                'ING',
                'Macquarie Bank',
                'Bank of Queensland',
                'HSBC Australia'
            ]
        },
        'term-deposits': {
            eyebrow: 'Daily term deposit market tracking',
            title: 'Compare term deposit yields with term, tier, and payment rhythm intact.',
            summary: 'Track current term deposit offers, keep maturity context visible, and inspect longitudinal series without flattening different products together.',
            manifestoLabel: 'What matters',
            manifestoTitle: 'A 6 month yield is not a 12 month story.',
            manifestoCopy: 'Term, deposit tier, and payment pattern all change the product. This workspace keeps those distinctions visible while you compare the market.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', note: 'Waiting for the newest market snapshot.' },
                { id: 'rows', label: 'Rows in the slice', note: 'Counts update once your filters load.' },
                { id: 'leader', label: 'Best live yield', note: 'Searching the current leaders.' }
            ],
            principles: [
                { icon: 'history', label: 'Term-aware comparisons' },
                { icon: 'summary', label: 'Deposit tier visibility' },
                { icon: 'continuity', label: 'Longitudinal product keys' },
                { icon: 'download', label: 'Export-ready filtered views' }
            ],
            steps: [
                { icon: 'filter', title: 'Start with the maturity window', text: 'Filter by bank, term length, deposit tier, payment frequency, and date before ranking yields.' },
                { icon: 'ladder', title: 'Move from live leaders to trend', text: 'The leaders rail, table, and history views stay aligned so you can compare both current offers and movement.' },
                { icon: 'link', title: 'Hand off the exact shortlist', text: 'Use the shareable route or an export when you need the same filtered term window outside the app.' }
            ],
            banks: [
                'Commonwealth Bank of Australia',
                'Westpac Banking Corporation',
                'National Australia Bank',
                'ANZ',
                'Bankwest',
                'Great Southern Bank'
            ]
        }
    };

    var copy = SECTION_COPY[section] || SECTION_COPY['home-loans'];

    function buttonLink(href, label, className) {
        return '<a class="buttonish ' + esc(className || 'secondary') + '" href="' + esc(href) + '">' + esc(label) + '</a>';
    }

    function navLink(href, label, active) {
        return '<a class="buttonish secondary market-intro-nav-link' + (active ? ' is-active' : '') + '" href="' + esc(href) + '"' + (active ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
    }

    function liveCard(card) {
        return '' +
            '<article class="market-intro-live-card" data-live-card="' + esc(card.id) + '">' +
                '<span class="market-intro-live-label">' + esc(card.label) + '</span>' +
                '<strong id="market-intro-live-' + esc(card.id) + '">Loading</strong>' +
                '<p id="market-intro-live-' + esc(card.id) + '-note" class="market-intro-live-note">' + esc(card.note || '') + '</p>' +
            '</article>';
    }

    function principleChip(item) {
        return '<span class="market-intro-manifesto-point">' + iconText(item.icon || 'summary', item.label, 'metric-code') + '</span>';
    }

    function stepCard(step, index) {
        return '' +
            '<article class="market-intro-step">' +
                '<div class="market-intro-step-top">' +
                    '<span class="market-intro-step-index">0' + (index + 1) + '</span>' +
                    panelIcon(step.icon || 'summary', step.title, 'market-intro-step-icon') +
                '</div>' +
                '<strong>' + esc(step.title) + '</strong>' +
                '<p>' + esc(step.text) + '</p>' +
            '</article>';
    }

    function bankChip(bankName) {
        var badge = typeof bankBrand.badge === 'function'
            ? bankBrand.badge(bankName, { compact: true, className: 'market-intro-bank-badge' })
            : esc(bankName);
        return '<span class="market-intro-bank-chip">' + badge + '</span>';
    }

    function pill(icon, label) {
        return '<span class="market-intro-pill">' + iconText(icon, label, 'metric-code') + '</span>';
    }

    function setLiveMetric(id, value, note) {
        var valueEl = document.getElementById('market-intro-live-' + id);
        var noteEl = document.getElementById('market-intro-live-' + id + '-note');
        if (valueEl) valueEl.textContent = String(value == null ? '' : value);
        if (noteEl && note != null) noteEl.textContent = String(note);
    }

    var intro = document.createElement('section');
    intro.className = 'panel market-intro';
    intro.setAttribute('aria-label', 'Page introduction');
    intro.innerHTML = ''
        + '<div class="market-intro-grid">'
        + '  <div class="market-intro-story">'
        + '    <div class="market-intro-copy">'
        + '      <p class="eyebrow">' + esc(copy.eyebrow) + '</p>'
        + '      <h2 class="market-intro-title">' + esc(copy.title) + '</h2>'
        + '      <p class="market-intro-summary">' + esc(copy.summary) + '</p>'
        + '      <div class="market-intro-pills">'
        +          pill('summary', 'Independent public-data workspace')
        +          pill('continuity', 'Canonical series continuity')
        +          pill('download', 'Portable exports and routes')
        + '      </div>'
        + '    </div>'
        + '    <div class="market-intro-actions">'
        +        buttonLink('#scenario', 'Open filters', 'primary')
        +        buttonLink('#ladder', 'See leaders', 'secondary')
        +        buttonLink('/about/', 'Methodology', 'secondary')
        + '    </div>'
        + '    <div class="market-intro-live-grid">'
        +        copy.liveCards.map(liveCard).join('')
        + '    </div>'
        + '  </div>'
        + '  <aside class="market-intro-manifesto">'
        + '    <span class="market-intro-manifesto-label">' + esc(copy.manifestoLabel) + '</span>'
        + '    <strong class="market-intro-manifesto-title">' + esc(copy.manifestoTitle) + '</strong>'
        + '    <p class="market-intro-manifesto-copy">' + esc(copy.manifestoCopy) + '</p>'
        + '    <div class="market-intro-manifesto-list">'
        +        copy.principles.map(principleChip).join('')
        + '    </div>'
        + '  </aside>'
        + '</div>'
        + '<div class="market-intro-lower">'
        + '  <div class="market-intro-nav-wrap">'
        + '    <p class="eyebrow">Datasets</p>'
        + '    <nav class="market-intro-nav" aria-label="Rate datasets">'
        +        navLink('/', 'Home loans', section === 'home-loans')
        +        navLink('/savings/', 'Savings', section === 'savings')
        +        navLink('/term-deposits/', 'Term deposits', section === 'term-deposits')
        + '    </nav>'
        + '  </div>'
        + '  <div class="market-intro-proof-grid">'
        +        copy.steps.map(stepCard).join('')
        + '  </div>'
        + '  <div class="market-intro-bank-strip" aria-label="Coverage example">'
        + '    <span class="market-intro-bank-strip-label">Coverage includes</span>'
        +        copy.banks.map(bankChip).join('')
        + '  </div>'
        + '</div>';

    root.insertBefore(intro, terminal);

    window.AR.publicIntro = {
        setLiveMetric: setLiveMetric,
    };
})();
