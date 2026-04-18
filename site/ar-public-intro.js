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
        config.secondaryHref = config.secondaryHref || '#scenario';
        config.secondaryAction = config.secondaryAction || 'Adjust scenario';
        config.liveCards = Array.isArray(config.liveCards) ? config.liveCards : [];
        config.quickPicksLabel = config.quickPicksLabel || '';
        config.quickPicks = Array.isArray(config.quickPicks) ? config.quickPicks : [];
        return config;
    }

    var SECTION_COPY = {
        'home-loans': sectionCopy({
            eyebrow: 'Daily CDR data · major lenders',
            title: 'Home loan rates, tracked.',
            summary: '',
            liveCards: [
                { id: 'updated', label: 'Updated', value: '—', note: 'Latest collection date in the active slice.' },
                { id: 'leader', label: 'Lowest rate', value: '—', note: 'Leading product in the current slice.' },
                { id: 'rows', label: 'Products', value: '—', note: 'Total products in the current filter.' }
            ]
        }),
        savings: sectionCopy({
            eyebrow: 'Daily CDR data · major lenders',
            title: 'Savings rates, tracked.',
            summary: '',
            liveCards: [
                { id: 'updated', label: 'Updated', value: '—', note: 'Latest collection date in the active slice.' },
                { id: 'leader', label: 'Top yield', value: '—', note: 'Leading yield in the current slice.' },
                { id: 'rows', label: 'Products', value: '—', note: 'Total accounts in the current filter.' }
            ]
        }),
        'term-deposits': sectionCopy({
            eyebrow: 'Daily CDR data · major lenders',
            title: 'Term deposit yields, tracked.',
            summary: '',
            liveCards: [
                { id: 'updated', label: 'Updated', value: '—', note: 'Latest collection date in the active slice.' },
                { id: 'leader', label: 'Top yield', value: '—', note: 'Leading product in the current slice.' },
                { id: 'rows', label: 'Products', value: '—', note: 'Total products in the current filter.' }
            ],
            quickPicksLabel: 'Term',
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
        var cardId = String(card && card.id ? card.id : 'metric');
        return ''
            + '<span class="market-intro-live-card market-intro-live-card-' + esc(cardId) + '">'
            + '  <span class="market-intro-live-label">' + esc(card.label || 'Metric') + '</span>'
            + '  <strong id="market-intro-live-' + esc(cardId) + '">' + esc(card.value || '...') + '</strong>'
            + '  <span id="market-intro-live-' + esc(cardId) + '-note" class="market-intro-live-note" hidden>' + esc(card.note || '') + '</span>'
            + '</span>';
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
        + '    <p class="eyebrow">' + esc(copy.eyebrow) + '</p>'
        + '    <h1 class="market-intro-title">' + esc(copy.title) + '</h1>'
        + '  </div>'
        + '  <div class="market-intro-actions">'
        + '    ' + buttonLink(copy.primaryHref || '#compare-leaders', copy.primaryAction || 'Compare leaders', 'primary')
        + '    ' + buttonLink(copy.secondaryHref || '#scenario', copy.secondaryAction || 'Adjust filters', 'ghost')
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
