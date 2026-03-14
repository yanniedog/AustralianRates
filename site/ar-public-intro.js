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

    var iconText = typeof uiIcons.text === 'function' ? uiIcons.text : fallbackText;

    var SECTION_COPY = {
        'home-loans': {
            eyebrow: 'Daily CDR-backed mortgage tracking',
            title: 'A cleaner way to read the Australian home loan market.',
            summary: 'Start with the exact borrower slice, compare the current leaders, and keep one product intact through time with canonical product_key continuity.',
            signalEyebrow: 'Product rule',
            signalTitle: 'One line equals one product.',
            signalCopy: 'Fixed terms, repayment types, and LVR bands stay longitudinal instead of getting blended into fake history.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'Live slice', note: 'Daily product feeds flow into the same comparison workspace.' },
                { id: 'rows', label: 'Rows in the slice', value: 'Filter-ready', note: 'Purpose, repayment, structure, LVR, bank, and date stay aligned across views.' },
                { id: 'leader', label: 'Best live rate', value: 'Leader scan', note: 'Use the leaders rail, chart, and table without changing context.' }
            ],
            principles: [
                { icon: 'bank', label: 'Official lender feeds' },
                { icon: 'continuity', label: 'Series-safe charting' },
                { icon: 'compare', label: 'Filter-led market slicing' }
            ],
            steps: [
                { title: 'Define the exact slice', text: 'Set the borrower context before looking at price.' },
                { title: 'Inspect today and history together', text: 'Leaders, table, history, and changes stay on the same slice.' },
                { title: 'Export without losing continuity', text: 'Charts and downloads preserve canonical product identity.' }
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
            title: 'A clearer view of Australian savings yields and conditions.',
            summary: 'Compare base, bonus, and introductory rates without dropping the account context that explains why those yields exist.',
            signalEyebrow: 'Tracking rule',
            signalTitle: 'Yield stays attached to the condition set.',
            signalCopy: 'Account type, rate type, and deposit tier remain visible so the market read stays honest.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'Live slice', note: 'Daily savings feeds feed the same comparison workspace.' },
                { id: 'rows', label: 'Rows in the slice', value: 'Condition-aware', note: 'Bank, account type, rate type, deposit tier, and date travel together.' },
                { id: 'leader', label: 'Best live yield', value: 'Leader scan', note: 'Leaders, charts, and pivot views all stay aligned.' }
            ],
            principles: [
                { icon: 'bank', label: 'Major bank coverage' },
                { icon: 'compare', label: 'Bonus versus base clarity' },
                { icon: 'download', label: 'Portable filtered exports' }
            ],
            steps: [
                { title: 'Filter the account context first', text: 'Bank, account type, rate type, tier, and date come before ranking.' },
                { title: 'Read leaders, then shape', text: 'Use the leaders rail for scan speed and charts for structure.' },
                { title: 'Share the exact conditions', text: 'Routes and exports preserve the same condition set.' }
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
            title: 'A stronger view of Australian term deposit yields by term and tier.',
            summary: 'Keep maturity, deposit tier, and payment rhythm visible while you move from current leaders to longer product history.',
            signalEyebrow: 'Tracking rule',
            signalTitle: 'A 6 month offer is not a 12 month story.',
            signalCopy: 'Term length, payment pattern, and deposit tier stay intact so yield comparisons remain product-true.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'Live slice', note: 'Daily term-deposit feeds feed the same comparison workspace.' },
                { id: 'rows', label: 'Rows in the slice', value: 'Term-aware', note: 'Bank, term, tier, payment pattern, and date stay aligned.' },
                { id: 'leader', label: 'Best live yield', value: 'Leader scan', note: 'Leaders, history, and exports stay on the same maturity window.' }
            ],
            principles: [
                { icon: 'history', label: 'Term-aware comparisons' },
                { icon: 'summary', label: 'Deposit tier visibility' },
                { icon: 'download', label: 'Export-ready filtered routes' }
            ],
            steps: [
                { title: 'Set the maturity window', text: 'Choose the term, tier, payment pattern, and date before ranking.' },
                { title: 'Compare live and historical offers', text: 'Leaders, table, and history stay in the same frame.' },
                { title: 'Carry the shortlist cleanly', text: 'Routes and exports keep the same product distinctions.' }
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
                '<strong id="market-intro-live-' + esc(card.id) + '">' + esc(card.value || '') + '</strong>' +
                '<p id="market-intro-live-' + esc(card.id) + '-note" class="market-intro-live-note">' + esc(card.note || '') + '</p>' +
            '</article>';
    }

    function principleItem(item) {
        return '<span class="market-intro-principle">' + iconText(item.icon || 'summary', item.label, 'metric-code') + '</span>';
    }

    function stepCard(step, index) {
        return '' +
            '<article class="market-intro-step">' +
                '<span class="market-intro-step-index">0' + (index + 1) + '</span>' +
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

    function setLiveMetric(id, value, note) {
        var valueEl = document.getElementById('market-intro-live-' + id);
        var noteEl = document.getElementById('market-intro-live-' + id + '-note');
        if (valueEl && value != null) valueEl.textContent = String(value);
        if (noteEl && note != null) noteEl.textContent = String(note);
    }

    var intro = document.createElement('section');
    intro.className = 'panel market-intro';
    intro.setAttribute('aria-label', 'Page introduction');
    intro.innerHTML = ''
        + '<div class="market-intro-grid">'
        + '  <div class="market-intro-copy">'
        + '    <p class="eyebrow">' + esc(copy.eyebrow) + '</p>'
        + '    <h2 class="market-intro-title">' + esc(copy.title) + '</h2>'
        + '    <p class="market-intro-summary">' + esc(copy.summary) + '</p>'
        + '    <div class="market-intro-actions">'
        +        buttonLink('#scenario', 'Open filters', 'primary')
        +        buttonLink('#ladder', 'See leaders', 'secondary')
        +        buttonLink('/about/', 'Methodology', 'secondary')
        + '    </div>'
        + '    <div class="market-intro-principles">'
        +        copy.principles.map(principleItem).join('')
        + '    </div>'
        + '    <div class="market-intro-live-grid">'
        +        copy.liveCards.map(liveCard).join('')
        + '    </div>'
        + '  </div>'
        + '  <aside class="market-intro-signal">'
        + '    <div class="market-intro-signal-copy">'
        + '      <p class="eyebrow">' + esc(copy.signalEyebrow) + '</p>'
        + '      <h3 class="market-intro-signal-title">' + esc(copy.signalTitle) + '</h3>'
        + '      <p class="market-intro-signal-summary">' + esc(copy.signalCopy) + '</p>'
        + '    </div>'
        + '    <div class="market-intro-visual" aria-hidden="true">'
        + '      <span class="market-intro-visual-line is-one"></span>'
        + '      <span class="market-intro-visual-line is-two"></span>'
        + '      <span class="market-intro-visual-line is-three"></span>'
        + '      <span class="market-intro-visual-dot is-alpha"></span>'
        + '      <span class="market-intro-visual-dot is-beta"></span>'
        + '      <span class="market-intro-visual-dot is-gamma"></span>'
        + '    </div>'
        + '    <div class="market-intro-bank-strip" aria-label="Coverage example">'
        + '      <span class="market-intro-bank-strip-label">Tracked institutions</span>'
        +        copy.banks.map(bankChip).join('')
        + '    </div>'
        + '  </aside>'
        + '</div>'
        + '<div class="market-intro-lower">'
        + '  <nav class="market-intro-nav" aria-label="Rate datasets">'
        +        navLink('/', 'Home loans', section === 'home-loans')
        +        navLink('/savings/', 'Savings', section === 'savings')
        +        navLink('/term-deposits/', 'Term deposits', section === 'term-deposits')
        + '  </nav>'
        + '  <div class="market-intro-proof-grid">'
        +        copy.steps.map(stepCard).join('')
        + '  </div>'
        + '</div>';

    root.insertBefore(intro, terminal);

    window.AR.publicIntro = {
        setLiveMetric: setLiveMetric,
    };
})();
