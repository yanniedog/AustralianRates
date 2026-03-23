(function () {
    'use strict';

    window.AR = window.AR || {};

    var section = window.AR.section || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    var terminal = root ? root.querySelector('.market-terminal') : null;
    var compactViewport = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);

    if (!root || !terminal || root.querySelector('.market-intro')) return;

    var esc = window._arEsc || function (value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    function sectionCopy(config) {
        config.sessionStatus = 'live';
        return config;
    }

    var DATASET_LINKS = [
        { href: '/', label: 'Home loans', key: 'home-loans' },
        { href: '/savings/', label: 'Savings', key: 'savings' },
        { href: '/term-deposits/', label: 'Term deposits', key: 'term-deposits' }
    ];
    var SECTION_COPY = {
        'home-loans': sectionCopy({
            sessionLabel: 'session::home-loans',
            eyebrow: 'Official daily home loan rates',
            title: 'Compare home loan rates quickly.',
            summary: 'Pick your borrowing slice once, then use the chart first and the table for verification.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Lowest live rate', value: 'SCANNING', note: 'The leading live product appears here once the slice is resolved.' }
            ],
            primaryAction: compactViewport ? 'See chart' : 'Open filters',
            secondaryAction: compactViewport ? 'Open filters' : 'See chart'
        }),
        savings: sectionCopy({
            sessionLabel: 'session::savings',
            eyebrow: 'Official daily savings rates',
            title: 'Compare savings rates quickly.',
            summary: 'Select account rules once, use charts to spot yield leaders, then validate in the table.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Top live yield', value: 'SCANNING', note: 'The leading yield appears here once the slice is resolved.' }
            ],
            primaryAction: compactViewport ? 'See chart' : 'Open filters',
            secondaryAction: compactViewport ? 'Open filters' : 'See chart'
        }),
        'term-deposits': sectionCopy({
            sessionLabel: 'session::term-deposits',
            eyebrow: 'Official daily term deposit rates',
            title: 'Compare term deposit rates quickly.',
            summary: 'Lock term and deposit settings once, then focus on chart comparisons before drilling into rows.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Top live yield', value: 'SCANNING', note: 'The leading term deposit appears here once the slice is resolved.' }
            ],
            primaryAction: compactViewport ? 'See chart' : 'Open filters',
            secondaryAction: compactViewport ? 'Open filters' : 'See chart'
        })
    };
    var copy = SECTION_COPY[section] || SECTION_COPY['home-loans'];

    function buttonLink(href, label, className) { return '<a class="buttonish ' + esc(className || 'secondary') + '" href="' + esc(href) + '">' + esc(label) + '</a>'; }

    function navLink(link) {
        var active = link.key === section;
        return '<a class="buttonish secondary market-intro-nav-link' + (active ? ' is-active' : '') + '" href="' + esc(link.href) + '"' + (active ? ' aria-current="page"' : '') + '>' + esc(link.label) + '</a>';
    }

    function liveCard(card) {
        return '<article class="market-intro-live-card" data-live-card="' + esc(card.id) + '"><span class="market-intro-live-label">' + esc(card.label) + '</span><strong id="market-intro-live-' + esc(card.id) + '">' + esc(card.value || '') + '</strong><p id="market-intro-live-' + esc(card.id) + '-note" class="market-intro-live-note">' + esc(card.note || '') + '</p></article>';
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
        + '<div class="market-intro-head">'
        + '  <div class="market-intro-copy">'
        + '    <div class="market-intro-topline"><span class="market-intro-session-label">' + esc(copy.sessionLabel) + '</span><span class="market-intro-session-status">' + esc(copy.sessionStatus) + '</span></div>'
        + '    <p class="eyebrow">' + esc(copy.eyebrow) + '</p>'
        + '    <h1 class="market-intro-title">' + esc(copy.title) + '</h1>'
        + '    <p class="market-intro-summary">' + esc(copy.summary) + '</p>'
        + '  </div>'
        + '  <div class="market-intro-actions">'
        + '    ' + buttonLink(compactViewport ? '#chart' : '#scenario', copy.primaryAction || 'Open filters', 'primary')
        + '    ' + buttonLink(compactViewport ? '#scenario' : '#chart', copy.secondaryAction || 'See chart', 'ghost')
        + '  </div>'
        + '</div>'
        + '<div class="market-intro-body">'
        + '  <div class="market-intro-live-grid" aria-label="Live stats">' + copy.liveCards.map(liveCard).join('') + '</div>'
        + '  <nav class="market-intro-nav" aria-label="Rate datasets">' + DATASET_LINKS.map(navLink).join('') + '</nav>'
        + '</div>';

    root.insertBefore(intro, terminal);
    window.AR.publicIntro = { setLiveMetric: setLiveMetric };
})();
