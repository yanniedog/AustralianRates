(function () {
    'use strict';

    var section = (window.AR && window.AR.section) || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    var terminal = root ? root.querySelector('.market-terminal') : null;
    var uiIcons = (window.AR && window.AR.uiIcons) || {};

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
            title: 'Track Australian home loan rates without losing product history.',
            summary: 'Filter daily CDR-backed rates, compare current leaders, and follow the same product over time with canonical product_key continuity.',
            steps: [
                { title: 'Slice the market', text: 'Use purpose, repayment, structure, LVR, bank, and date filters to define the exact loan slice you want.' },
                { title: 'Compare current leaders', text: 'Use the ladder, live table, history, and movement chart panels to inspect pricing and continuity together.' },
                { title: 'Share the exact view', text: 'Use Link or export the active slice as CSV, Excel, or JSON once the shortlist is where you need it.' }
            ]
        },
        'savings': {
            title: 'Compare Australian savings rates with bonus-rate conditions in view.',
            summary: 'Track base, bonus, and introductory savings rates across banks, then move from live leaders to deeper history without changing context.',
            steps: [
                { title: 'Set the account slice', text: 'Filter by bank, account type, rate type, deposit tier, and dates before comparing the live field.' },
                { title: 'Spot yield leaders', text: 'Use the ladder and table to see current leaders, then switch to charts and pivot views for history.' },
                { title: 'Keep the view portable', text: 'Copy the current filtered route or export the active slice for offline review and handoff.' }
            ]
        },
        'term-deposits': {
            title: 'Compare Australian term deposit yields by term, tier, and payment pattern.',
            summary: 'Track current term deposit offers, keep maturity context visible, and inspect longitudinal series without flattening different products together.',
            steps: [
                { title: 'Define the term window', text: 'Filter by bank, term length, deposit tier, payment frequency, and collection dates before comparing yields.' },
                { title: 'Inspect leaders and history', text: 'Use the leaders rail, the live table, and the history tab to see both current offers and movement over time.' },
                { title: 'Share or export cleanly', text: 'Use Link to preserve the exact filters, or export the visible slice when you need a portable copy.' }
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

    function stepCard(step, index) {
        return '' +
            '<article class="market-intro-step">' +
                '<span class="market-intro-step-index">0' + (index + 1) + '</span>' +
                '<strong>' + esc(step.title) + '</strong>' +
                '<p>' + esc(step.text) + '</p>' +
            '</article>';
    }

    function pill(icon, label) {
        return '<span class="market-intro-pill">' + iconText(icon, label, 'metric-code') + '</span>';
    }

    var intro = document.createElement('section');
    intro.className = 'panel market-intro';
    intro.setAttribute('aria-label', 'Page introduction');
    intro.innerHTML = ''
        + '<div class="market-intro-head">'
        + '  <div class="market-intro-copy">'
        + '    <p class="eyebrow">Daily CDR-backed rate tracking</p>'
        + '    <h2 class="market-intro-title">' + esc(copy.title) + '</h2>'
        + '    <p class="market-intro-summary">' + esc(copy.summary) + '</p>'
        + '    <div class="market-intro-pills">'
        +        pill('summary', 'Independent public-data dashboard')
        +        pill('history', 'Product-key continuity in charts')
        +        pill('link', 'Shareable filtered views and exports')
        + '    </div>'
        + '  </div>'
        + '  <div class="market-intro-actions">'
        +        buttonLink('#scenario', 'Start with filters', 'primary')
        +        buttonLink('#table', 'Jump to table', 'secondary')
        +        buttonLink('/about/', 'About the data', 'secondary')
        + '  </div>'
        + '</div>'
        + '<div class="market-intro-body">'
        + '  <nav class="market-intro-nav" aria-label="Rate datasets">'
        +        navLink('/', 'Home loans', section === 'home-loans')
        +        navLink('/savings/', 'Savings', section === 'savings')
        +        navLink('/term-deposits/', 'Term deposits', section === 'term-deposits')
        + '  </nav>'
        + '  <div class="market-intro-steps">'
        +        copy.steps.map(stepCard).join('')
        + '  </div>'
        + '</div>';

    root.insertBefore(intro, terminal);
})();
