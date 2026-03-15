(function () {
    'use strict';

    window.AR = window.AR || {};

    var section = window.AR.section || document.body.getAttribute('data-ar-section') || 'home-loans';
    var root = document.getElementById('ar-section-root');
    var terminal = root ? root.querySelector('.market-terminal') : null;
    var uiIcons = window.AR.uiIcons || {};
    var bankBrand = window.AR.bankBrand || {};

    if (!root || !terminal || root.querySelector('.market-intro')) return;

    var esc = window._arEsc || function (value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    function fallbackText(_icon, label, className, textClassName) {
        var classes = ['ar-icon-label'];
        if (className) classes.push(className);
        return '<span class="' + classes.join(' ') + '"><span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span></span>';
    }

    function sectionCopy(config) {
        config.sessionStatus = 'live';
        config.consoleKicker = 'Live session';
        config.consoleStatus = 'streaming';
        return config;
    }

    var iconText = typeof uiIcons.text === 'function' ? uiIcons.text : fallbackText;
    var DATASET_LINKS = [
        { href: '/', label: 'Home loans', key: 'home-loans' },
        { href: '/savings/', label: 'Savings', key: 'savings' },
        { href: '/term-deposits/', label: 'Term deposits', key: 'term-deposits' }
    ];
    var SECTION_COPY = {
        'home-loans': sectionCopy({
            sessionLabel: 'session::home-loans',
            eyebrow: 'Daily official home loan rate tracking',
            command: 'compare home loans with official CDR data',
            title: 'Compare Australian home loan rates with official daily data.',
            summary: 'Set purpose, repayment, structure, LVR, lender, and date once, then compare today\'s leaders and one product\'s history without changing the slice.',
            consoleTitle: 'Home loan rate monitor',
            consoleCopy: 'Keep the same borrower slice in view while you check the latest collection, the current leader, and product continuity.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Lowest live rate', value: 'SCANNING', note: 'The leading live product appears here once the slice is resolved.' }
            ],
            principles: [{ icon: 'bank', label: 'official lender feeds' }, { icon: 'continuity', label: 'product history intact' }],
            commands: [
                'set purpose, repayment, structure, LVR, lender, and date',
                'compare leaders and product history in the same slice'
            ],
            consoleLines: ['latest collection loaded', 'product_key continuity preserved'],
            steps: [
                { index: '01', label: 'define', title: 'Set the borrowing scenario first', text: 'Purpose, repayment, structure, LVR, lender, and date stay locked before ranking begins.' },
                { index: '02', label: 'compare', title: 'Compare leaders without losing context', text: 'The leader rail, chart, and table stay aligned to the same mortgage slice.' },
                { index: '03', label: 'follow', title: 'Track one product through time', text: 'product_key continuity keeps one real product in view instead of blending unlike offers.' }
            ],
            banks: ['Commonwealth Bank of Australia', 'Westpac Banking Corporation', 'National Australia Bank', 'ANZ', 'Macquarie Bank', 'ING']
        }),
        savings: sectionCopy({
            sessionLabel: 'session::savings',
            eyebrow: 'Daily official savings rate tracking',
            command: 'compare savings rates with official CDR data',
            title: 'Compare Australian savings rates with official daily data.',
            summary: 'Set bank, account type, rate type, tier, and date once, then compare yields without dropping the conditions that create them.',
            consoleTitle: 'Savings rate monitor',
            consoleCopy: 'Keep the account rules visible while you check the latest collection, the current leader, and product continuity.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Top live yield', value: 'SCANNING', note: 'The leading yield appears here once the slice is resolved.' }
            ],
            principles: [{ icon: 'bank', label: 'major bank coverage' }, { icon: 'compare', label: 'account conditions attached' }],
            commands: [
                'set bank, account type, rate type, tier, and date',
                'compare bonus, base, and intro rates with the rules still attached'
            ],
            consoleLines: ['latest savings collection loaded', 'bonus, base, and intro logic retained'],
            steps: [
                { index: '01', label: 'define', title: 'Set the account rules first', text: 'Bank, account type, rate type, tier, and date stay in place before any yield ranking is shown.' },
                { index: '02', label: 'compare', title: 'Read leaders with the conditions intact', text: 'The leader rail, chart, and table stay aligned with the same savings rule set.' },
                { index: '03', label: 'share', title: 'Export the exact account setup', text: 'Downloads preserve the same filtered condition set instead of a flattened headline rate.' }
            ],
            banks: ['Commonwealth Bank of Australia', 'UBank', 'ING', 'Macquarie Bank', 'Bank of Queensland', 'HSBC Australia']
        }),
        'term-deposits': sectionCopy({
            sessionLabel: 'session::term-deposits',
            eyebrow: 'Daily official term deposit tracking',
            command: 'compare term deposits with official CDR data',
            title: 'Compare Australian term deposit rates with official daily data.',
            summary: 'Set term, deposit tier, payment pattern, bank, and date once, then compare current leaders without losing the exact maturity profile.',
            consoleTitle: 'Term deposit monitor',
            consoleCopy: 'Keep term, tier, and payment rhythm visible while you check the latest collection, the current leader, and product continuity.',
            liveCards: [
                { id: 'updated', label: 'Latest collection', value: 'SYNCING', note: 'Waiting for the newest collection date in the active slice.' },
                { id: 'leader', label: 'Top live yield', value: 'SCANNING', note: 'The leading term deposit appears here once the slice is resolved.' }
            ],
            principles: [{ icon: 'history', label: 'term aware' }, { icon: 'summary', label: 'tier visible' }],
            commands: [
                'set term, deposit tier, payment pattern, bank, and date',
                'compare current leaders against longer term-specific history'
            ],
            consoleLines: ['latest term deposit collection loaded', 'deposit tier and payment rhythm retained'],
            steps: [
                { index: '01', label: 'define', title: 'Set the maturity window first', text: 'Term, tier, payment pattern, bank, and date stay locked before any yield ranking is shown.' },
                { index: '02', label: 'compare', title: 'Read leaders with longer history', text: 'The right rail, chart, and table stay aligned to the same maturity profile.' },
                { index: '03', label: 'share', title: 'Carry the same term profile forward', text: 'Downloads preserve the exact term structure instead of blending unlike offers.' }
            ],
            banks: ['Commonwealth Bank of Australia', 'Westpac Banking Corporation', 'National Australia Bank', 'ANZ', 'Bankwest', 'Great Southern Bank']
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

    function principleItem(item) { return '<span class="market-intro-status-pill">' + iconText(item.icon || 'summary', item.label, 'metric-code') + '</span>'; }
    function commandLine(text) { return '<li class="market-intro-command-item"><span class="market-intro-command-prompt">$</span><span class="market-intro-command-text">' + esc(text) + '</span></li>'; }
    function consoleLine(text) { return '<li class="market-intro-console-log-item"><span class="market-intro-console-log-prompt">&gt;</span><span class="market-intro-console-log-text">' + esc(text) + '</span></li>'; }

    function stepCard(step) {
        return '<article class="market-intro-step"><div class="market-intro-step-meta"><span class="market-intro-step-index">' + esc(step.index) + '</span><span class="market-intro-step-label">' + esc(step.label) + '</span></div><h3 class="market-intro-step-title">' + esc(step.title) + '</h3><p>' + esc(step.text) + '</p></article>';
    }

    function bankChip(bankName) {
        var badge = typeof bankBrand.badge === 'function' ? bankBrand.badge(bankName, { compact: true, className: 'market-intro-bank-badge' }) : esc(bankName);
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
        + '    <div class="market-intro-topline"><span class="market-intro-session-label">' + esc(copy.sessionLabel) + '</span><span class="market-intro-session-status">' + esc(copy.sessionStatus) + '</span></div>'
        + '    <div class="market-intro-status-row" aria-label="Key product qualities">' + copy.principles.map(principleItem).join('') + '</div>'
        + '    <div class="market-intro-command-block">'
        + '      <div class="market-intro-command-head"><span class="market-intro-prompt">$</span><span class="market-intro-command-head-text">' + esc(copy.command) + '</span><span class="market-intro-caret" aria-hidden="true"></span></div>'
        + '      <p class="eyebrow">' + esc(copy.eyebrow) + '</p><h1 class="market-intro-title">' + esc(copy.title) + '</h1><p class="market-intro-summary">' + esc(copy.summary) + '</p>'
        + '    </div>'
        + '    <ol class="market-intro-command-list">' + copy.commands.map(commandLine).join('') + '</ol>'
        + '    <div class="market-intro-actions">' + buttonLink('#scenario', 'Open filters', 'primary') + '<div class="market-intro-secondary-actions">' + buttonLink('#ladder', 'See leaders', 'ghost') + buttonLink('/about/', 'Methodology', 'ghost') + '</div></div>'
        + '  </div>'
        + '  <aside class="market-intro-console" aria-label="Live session console">'
        + '    <div class="market-intro-console-head"><div><p class="market-intro-console-kicker">' + esc(copy.consoleKicker) + '</p><h2 class="market-intro-console-title">' + esc(copy.consoleTitle) + '</h2></div><span class="market-intro-console-status">' + esc(copy.consoleStatus) + '</span></div>'
        + '    <p class="market-intro-console-summary">' + esc(copy.consoleCopy) + '</p><div class="market-intro-live-grid">' + copy.liveCards.map(liveCard).join('') + '</div>'
        + '    <div class="market-intro-console-log-shell"><span class="market-intro-console-log-label">Event stream</span><ul class="market-intro-console-log">' + copy.consoleLines.map(consoleLine).join('') + '</ul></div>'
        + '    <div class="market-intro-bank-strip" aria-label="Coverage example"><span class="market-intro-bank-strip-label">Tracked institutions</span>' + copy.banks.map(bankChip).join('') + '</div>'
        + '  </aside>'
        + '</div>'
        + '<div class="market-intro-lower"><nav class="market-intro-nav" aria-label="Rate datasets">' + DATASET_LINKS.map(navLink).join('') + '</nav><div class="market-intro-proof-grid">' + copy.steps.map(stepCard).join('') + '</div></div>';

    root.insertBefore(intro, terminal);
    window.AR.publicIntro = { setLiveMetric: setLiveMetric };
})();
