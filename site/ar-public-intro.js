(function () {
    'use strict';

    window.AR = window.AR || {};

    var section = window.AR.section || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    var terminal = root ? root.querySelector('.market-terminal') : null;

    if (!root || !terminal || root.querySelector('.market-intro')) return;

    var esc = window._arEsc || function (value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var uiIcons = (window.AR && window.AR.uiIcons) ? window.AR.uiIcons : {};
    var iconText = typeof uiIcons.text === 'function'
        ? uiIcons.text
        : function (_icon, label, className, textClassName) {
            var classes = ['ar-icon-label'];
            if (className) classes.push(className);
            return '' +
                '<span class="' + classes.join(' ') + '">' +
                    '<span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span>' +
                '</span>';
        };

    var DEFAULT_JUMP_LINKS = [
        { href: '#scenario', label: 'Filters', icon: 'filter', target: 'scenario' },
        { href: '#chart', label: 'Chart', icon: 'chart', target: 'chart' },
        { href: '#table', label: 'Table', icon: 'table', target: 'table' },
        { href: '#pivot', label: 'Pivot', icon: 'pivot', target: 'pivot' }
    ];

    function sectionCopy(config) {
        config.sessionStatus = 'Official daily data';
        config.jumpLinks = config.jumpLinks || DEFAULT_JUMP_LINKS;
        config.support = config.support || 'One filtered slice carries through chart, table, pivot, and export.';
        return config;
    }

    var SECTION_COPY = {
        'home-loans': sectionCopy({
            sessionLabel: 'Home loans',
            eyebrow: 'Official daily home loan rates',
            title: 'Compare home loan rates with a clearer first read.',
            summary: 'Set the borrowing scenario once, read price movement in the chart, then confirm exact products in the live table.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'Loading', note: 'Newest collection date in the active mortgage slice.' },
                { id: 'leader', label: 'Lowest live rate', value: 'Loading', note: 'Current headline leader after the active filters are applied.' },
                { id: 'rows', label: 'Rows in slice', value: 'Loading', note: 'Visible products carried through the current workspace.' }
            ],
            steps: [
                { label: 'Set the slice', detail: 'Choose purpose, repayment type, structure, and LVR before comparing.' },
                { label: 'Read the market', detail: 'Use the chart to spot leaders, spread, and recent repricing in the same slice.' },
                { label: 'Verify the shortlist', detail: 'Open the table or pivot to confirm exact products before exporting.' }
            ],
            primaryAction: 'Open filters',
            secondaryAction: 'See chart'
        }),
        savings: sectionCopy({
            sessionLabel: 'Savings',
            eyebrow: 'Official daily savings rates',
            title: 'Compare savings rates with a cleaner market view.',
            summary: 'Set account rules once, use the chart to spot yield leaders, then validate exact account conditions in the live table.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'Loading', note: 'Newest collection date in the active savings slice.' },
                { id: 'leader', label: 'Top live yield', value: 'Loading', note: 'Current top yield after account rules and bank filters are applied.' },
                { id: 'rows', label: 'Rows in slice', value: 'Loading', note: 'Visible accounts carried through the current workspace.' }
            ],
            steps: [
                { label: 'Set the account rules', detail: 'Choose account type, rate type, and deposit tier before comparing.' },
                { label: 'Read the yield range', detail: 'Use the chart to see where leaders sit and how rates move over time.' },
                { label: 'Check the exact product', detail: 'Use the table or pivot to confirm bank, product, and tier details.' }
            ],
            primaryAction: 'Open filters',
            secondaryAction: 'See chart'
        }),
        'term-deposits': sectionCopy({
            sessionLabel: 'Term deposits',
            eyebrow: 'Official daily term deposit rates',
            title: 'Compare term deposit rates with a sharper shortlist flow.',
            summary: 'Lock term and deposit settings once, use the chart to compare yields, then verify the precise products in the live table.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'Loading', note: 'Newest collection date in the active term-deposit slice.' },
                { id: 'leader', label: 'Top live yield', value: 'Loading', note: 'Current top yield after term, tier, and payment filters are applied.' },
                { id: 'rows', label: 'Rows in slice', value: 'Loading', note: 'Visible deposits carried through the current workspace.' }
            ],
            steps: [
                { label: 'Set term and balance', detail: 'Choose term length, tier, and payment frequency before comparing.' },
                { label: 'Read the market curve', detail: 'Use the chart to compare yield ranges and changes across terms.' },
                { label: 'Verify the product', detail: 'Open the table or pivot to confirm exact provider and term details.' }
            ],
            primaryAction: 'Open filters',
            secondaryAction: 'See chart'
        })
    };
    var copy = SECTION_COPY[section] || SECTION_COPY['home-loans'];

    function buttonLink(href, label, className) { return '<a class="buttonish ' + esc(className || 'secondary') + '" href="' + esc(href) + '">' + esc(label) + '</a>'; }
    function jumpLink(link) {
        return '' +
            '<a class="market-intro-nav-link" href="' + esc(link.href) + '" data-market-intro-target="' + esc(link.target) + '">' +
                iconText(link.icon, link.label, 'market-intro-nav-label') +
            '</a>';
    }
    function liveCard(card) {
        return '' +
            '<article class="market-intro-live-card">' +
                '<span class="market-intro-live-label">' + esc(card.label) + '</span>' +
                '<strong id="market-intro-live-' + esc(card.id) + '">' + esc(card.value) + '</strong>' +
                '<span id="market-intro-live-' + esc(card.id) + '-note" class="market-intro-live-note">' + esc(card.note) + '</span>' +
            '</article>';
    }
    function stepCard(step, index) {
        return '' +
            '<article class="market-intro-step">' +
                '<span class="market-intro-step-index">Step ' + esc(String(index + 1)) + '</span>' +
                '<strong>' + esc(step.label) + '</strong>' +
                '<p>' + esc(step.detail) + '</p>' +
            '</article>';
    }

    function setLiveMetric(id, value, note) {
        var valueEl = document.getElementById('market-intro-live-' + id);
        var noteEl = document.getElementById('market-intro-live-' + id + '-note');
        if (valueEl && value != null) valueEl.textContent = String(value);
        if (noteEl && note != null) noteEl.textContent = String(note);
    }
    function getActiveTarget() {
        var hash = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
        var tabs = window.AR.tabs;
        var activeTab = tabs && typeof tabs.getActiveTab === 'function' ? String(tabs.getActiveTab() || '') : '';

        if (hash === 'scenario') return 'scenario';
        if (hash === 'pivot' || activeTab === 'pivot') return 'pivot';
        if (hash === 'table' || activeTab === 'explorer') return 'table';
        return 'chart';
    }
    function syncJumpLinks() {
        var activeTarget = getActiveTarget();
        var links = intro.querySelectorAll('[data-market-intro-target]');
        links.forEach(function (link) {
            var target = link.getAttribute('data-market-intro-target');
            link.classList.toggle('is-active', target === activeTarget);
        });
    }

    var intro = document.createElement('section');
    intro.className = 'panel market-intro';
    intro.setAttribute('aria-label', 'Page introduction');
    intro.innerHTML = ''
        + '<div class="market-intro-head">'
        + '  <div class="market-intro-copy">'
        + '    <div class="market-intro-topline"><span class="market-intro-session-label">' + esc(copy.sessionLabel) + '</span><span class="market-intro-session-status">' + esc(copy.sessionStatus) + '</span></div>'
        + '    <p class="eyebrow">' + esc(copy.eyebrow) + '</p>'
        + '    <h1 class="market-intro-title">' + esc(copy.title) + '</h1>'
        + '    <p class="market-intro-summary">' + esc(copy.summary) + '</p>'
        + '    <p class="market-intro-support">' + esc(copy.support) + '</p>'
        + '  </div>'
        + '  <div class="market-intro-actions">'
        + '    ' + buttonLink('#scenario', copy.primaryAction || 'Open filters', 'primary')
        + '    ' + buttonLink('#chart', copy.secondaryAction || 'See chart', 'ghost')
        + '  </div>'
        + '</div>'
        + '<div class="market-intro-body">'
        + '  <section class="market-intro-group" aria-label="Live market snapshot">'
        + '    <span class="market-intro-section-label">Live snapshot</span>'
        + '    <div class="market-intro-live-grid">' + copy.liveCards.map(liveCard).join('') + '</div>'
        + '  </section>'
        + '  <section class="market-intro-group market-intro-guidance" aria-label="Suggested page path">'
        + '    <span class="market-intro-section-label">Suggested page path</span>'
        + '    <nav class="market-intro-nav" aria-label="Jump to section">' + copy.jumpLinks.map(jumpLink).join('') + '</nav>'
        + '    <div class="market-intro-steps">' + copy.steps.map(stepCard).join('') + '</div>'
        + '  </section>'
        + '</div>';

    root.insertBefore(intro, terminal);
    window.addEventListener('hashchange', syncJumpLinks);
    window.addEventListener('ar:tab-changed', syncJumpLinks);
    window.setTimeout(syncJumpLinks, 0);

    window.AR.publicIntro = {
        setLiveMetric: setLiveMetric,
        syncJumpLinks: syncJumpLinks
    };
})();
