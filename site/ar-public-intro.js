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
        config.primaryHref = config.primaryHref || '#compare-leaders';
        config.primaryAction = config.primaryAction || 'Compare current leaders';
        config.secondaryHref = config.secondaryHref || '#compare-start';
        config.secondaryAction = config.secondaryAction || 'Adjust scenario';
        config.liveCards = Array.isArray(config.liveCards) ? config.liveCards : [];
        config.steps = Array.isArray(config.steps) ? config.steps : [];
        config.quickPicksLabel = config.quickPicksLabel || '';
        config.quickPicks = Array.isArray(config.quickPicks) ? config.quickPicks : [];
        return config;
    }

    var SECTION_COPY = {
        'home-loans': sectionCopy({
            sessionLabel: 'session::home-loans',
            eyebrow: 'Official daily home loan rates',
            title: 'Compare current home loan leaders.',
            summary: 'Set your borrower scenario once, review the best current matches first, then use the chart and all-rates view for verification.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Lowest current rate', value: 'SCANNING', note: 'The leading current product appears here once the slice is resolved.' },
                { id: 'rows', label: 'Matching rows', value: 'SCANNING', note: 'All products in the current borrower slice.' }
            ],
            steps: [
                { index: '01', title: 'Set borrower type', body: 'Choose purpose, repayment, structure, and LVR.' },
                { index: '02', title: 'Review current leaders', body: 'Start with the best live matches before opening the full table.' },
                { index: '03', title: 'Verify with history', body: 'Use Compare for movement, All rates for detail, Advanced for deeper slicing.' }
            ]
        }),
        savings: sectionCopy({
            sessionLabel: 'session::savings',
            eyebrow: 'Official daily savings rates',
            title: 'Compare current savings leaders.',
            summary: 'Set the account slice once, start with the strongest current yields, then verify bonus, base, and tier detail below.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Top current yield', value: 'SCANNING', note: 'The leading yield appears here once the slice is resolved.' },
                { id: 'rows', label: 'Matching rows', value: 'SCANNING', note: 'All accounts in the current savings slice.' }
            ],
            steps: [
                { index: '01', title: 'Pick account rules', body: 'Choose account type, rate type, and deposit tier.' },
                { index: '02', title: 'Check current yield leaders', body: 'Use the leader rail to see who is strongest right now.' },
                { index: '03', title: 'Validate conditions', body: 'Use Compare for movement, All rates for caveats, Advanced for deeper analysis.' }
            ]
        }),
        'term-deposits': sectionCopy({
            sessionLabel: 'session::term-deposits',
            eyebrow: 'Official daily term deposit rates',
            title: 'Compare term deposit yields by term.',
            summary: 'Choose a term length first, review current leaders for that term, then open history and all-rates detail only when you need it.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Top current yield', value: 'SCANNING', note: 'The leading term deposit appears here once the slice is resolved.' },
                { id: 'rows', label: 'Matching rows', value: 'SCANNING', note: 'All products in the current term slice.' }
            ],
            steps: [
                { index: '01', title: 'Choose a term', body: 'Start with a popular term or open the full scenario controls.' },
                { index: '02', title: 'Review the best yield', body: 'Check the current leaders and the gap to the next-best option.' },
                { index: '03', title: 'Inspect nearby terms', body: 'Use Compare for movement, All rates for payment rules, Advanced for deeper slicing.' }
            ],
            quickPicksLabel: 'Popular terms',
            quickPicks: [
                { value: '3', label: '3m' },
                { value: '6', label: '6m' },
                { value: '12', label: '12m' },
                { value: '24', label: '24m' }
            ]
        })
    };
    var copy = SECTION_COPY[section] || SECTION_COPY['home-loans'];

    function buttonLink(href, label, className) { return '<a class="buttonish ' + esc(className || 'secondary') + '" href="' + esc(href) + '">' + esc(label) + '</a>'; }
    function liveCardMarkup(card) {
        return ''
            + '<article class="market-intro-live-card">'
            + '  <span class="market-intro-live-label">' + esc(card.label || 'Metric') + '</span>'
            + '  <strong id="market-intro-live-' + esc(card.id || 'metric') + '">' + esc(card.value || '...') + '</strong>'
            + '  <span id="market-intro-live-' + esc(card.id || 'metric') + '-note" class="market-intro-live-note">' + esc(card.note || '') + '</span>'
            + '</article>';
    }
    function stepMarkup(step) {
        return ''
            + '<article class="market-intro-step">'
            + '  <span class="market-intro-step-index">' + esc(step.index || '00') + '</span>'
            + '  <strong>' + esc(step.title || 'Step') + '</strong>'
            + '  <p>' + esc(step.body || '') + '</p>'
            + '</article>';
    }
    function quickPickMarkup(pick) {
        return ''
            + '<button class="market-intro-quick-pick chip-btn secondary" type="button" data-quick-term-months="' + esc(pick.value || '') + '">' + esc(pick.label || pick.value || '') + '</button>';
    }

    function setLiveMetric(id, value, note) {
        var valueEl = document.getElementById('market-intro-live-' + id);
        var noteEl = document.getElementById('market-intro-live-' + id + '-note');
        if (valueEl && value != null) valueEl.textContent = String(value);
        if (noteEl && note != null) noteEl.textContent = String(note);
    }

    function setQuickPickState() {
        var active = '';
        var termEl = document.getElementById('filter-term-months');
        if (termEl) active = String(termEl.value || '').trim();
        Array.prototype.slice.call(document.querySelectorAll('[data-quick-term-months]')).forEach(function (button) {
            var value = String(button.getAttribute('data-quick-term-months') || '').trim();
            var selected = !!active && active === value;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function applyQuickTerm(rawValue) {
        var termEl = document.getElementById('filter-term-months');
        var value = String(rawValue || '').trim();
        if (!termEl || !value) return;
        termEl.value = value;
        termEl.dispatchEvent(new Event('change', { bubbles: true }));
        setQuickPickState();
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
        + '    ' + buttonLink(copy.primaryHref || '#compare-leaders', copy.primaryAction || 'Compare current leaders', 'primary')
        + '    ' + buttonLink(copy.secondaryHref || '#compare-start', copy.secondaryAction || 'Adjust scenario', 'ghost')
        + '  </div>'
        + '</div>'
        + '<div class="market-intro-body">'
        + '  <div class="market-intro-live-grid">' + copy.liveCards.map(liveCardMarkup).join('') + '</div>'
        + (copy.quickPicks.length ? (
            '<div class="market-intro-quick-picks" role="group" aria-label="' + esc(copy.quickPicksLabel || 'Quick picks') + '">' +
                '<span class="market-intro-quick-picks-label">' + esc(copy.quickPicksLabel || 'Quick picks') + '</span>' +
                '<div class="market-intro-quick-picks-row">' + copy.quickPicks.map(quickPickMarkup).join('') + '</div>' +
            '</div>'
        ) : '')
        + '  <div class="market-intro-steps">' + copy.steps.map(stepMarkup).join('') + '</div>'
        + '</div>';

    root.insertBefore(intro, terminal);
    intro.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-quick-term-months]') : null;
        if (!button) return;
        event.preventDefault();
        applyQuickTerm(button.getAttribute('data-quick-term-months'));
    });
    window.addEventListener('ar:filters-state', setQuickPickState);
    window.setTimeout(setQuickPickState, 0);
    window.AR.publicIntro = { setLiveMetric: setLiveMetric, setQuickPickState: setQuickPickState };
})();
