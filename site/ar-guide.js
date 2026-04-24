(function () {
    'use strict';

    var COOKIE_NAME = 'ar_guide_dismissed';
    var sheet = null;

    function esc(value) {
        if (window._arEsc) return window._arEsc(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function icon(name, label) {
        var uiIcons = window.AR && window.AR.uiIcons;
        if (uiIcons && typeof uiIcons.icon === 'function') return uiIcons.icon(name, label);
        return '<span class="ar-icon" aria-hidden="true">' + esc(String(label || '').charAt(0) || '*') + '</span>';
    }

    function context() {
        var body = document.body;
        var section = (body && body.getAttribute('data-ar-section')) || (window.AR && window.AR.section) || 'home-loans';
        return {
            section: section,
            admin: !!(body && body.classList.contains('ar-admin')),
            legal: !!(body && body.classList.contains('ar-legal')),
            notFound: !!(body && body.classList.contains('ar-not-found')),
        };
    }

    function sectionLabel(ctx) {
        if (ctx.notFound) return 'Not Found';
        if (ctx.legal) {
            var title = document.querySelector('.legal-page h1');
            return title ? title.textContent.trim() : 'Reference';
        }
        if (ctx.section === 'savings') return 'Savings';
        if (ctx.section === 'term-deposits') return 'Term Deposits';
        if (ctx.section === 'economic-data') return 'Economic Data';
        return 'Home Loans';
    }

    function hasDismissed() {
        try {
            return document.cookie.split(';').some(function (part) {
                return part.trim().indexOf(COOKIE_NAME + '=1') === 0;
            });
        } catch (_err) {
            return false;
        }
    }

    function shouldAutoOpen() {
        if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
        return !hasDismissed();
    }

    function dismissForYear() {
        var cookie = COOKIE_NAME + '=1; Max-Age=31536000; Path=/; SameSite=Lax';
        if (window.location && window.location.protocol === 'https:') cookie += '; Secure';
        document.cookie = cookie;
    }

    function overlayOpen() {
        return document.body.classList.contains('is-nav-open') ||
            document.body.classList.contains('has-help-open') ||
            document.body.classList.contains('has-donate-open') ||
            document.body.classList.contains('has-guide-open');
    }

    function syncOverlayState() {
        if (!document.body) return;
        document.body.classList.toggle('has-overlay-open', overlayOpen());
    }

    function closeFrameOverlays() {
        var help = document.getElementById('site-help-sheet');
        var donate = document.getElementById('site-donate-sheet');
        var menu = document.getElementById('site-menu-drawer');
        var menuBtn = document.getElementById('site-menu-toggle');
        if (help) help.hidden = true;
        if (donate) donate.hidden = true;
        if (menu) menu.hidden = true;
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('has-help-open', 'has-donate-open', 'is-nav-open');
    }

    function markup(ctx) {
        return '' +
            '<div class="site-help-backdrop" data-guide-close></div>' +
            '<div class="site-help-panel site-guide-panel" role="dialog" aria-modal="true" aria-labelledby="site-guide-title">' +
                '<div class="site-help-head">' +
                    '<h2 id="site-guide-title" tabindex="-1">AustralianRates guide</h2>' +
                    '<button type="button" class="icon-btn secondary" data-guide-close aria-label="Close guide">' + icon('close', 'Close') + '</button>' +
                '</div>' +
                '<div class="site-help-body site-guide-body">' +
                    '<p class="site-guide-current">Current section: <strong>' + esc(sectionLabel(ctx)) + '</strong></p>' +
                    '<ol class="site-guide-list">' +
                        '<li><strong>Choose a market.</strong><span>Use the product nav for Mortgage, Savings, Term Deposits, and Economic Data.</span></li>' +
                        '<li><strong>Read the chart first.</strong><span>The chart and signal strip show the active slice before deeper tables or details.</span></li>' +
                        '<li><strong>Open filters only when needed.</strong><span>Drawers keep lender, product, rate, term, and indicator controls close without crowding the page.</span></li>' +
                        '<li><strong>Follow section colours.</strong><span>Blue is Mortgage, green is Savings, amber is Term Deposits, and teal is Economic Data.</span></li>' +
                        '<li><strong>Use Menu for support.</strong><span>Theme, Help, Donate, GitHub, refresh, and this guide stay available from the header or menu.</span></li>' +
                    '</ol>' +
                    '<div class="site-guide-actions">' +
                        '<button type="button" class="buttonish secondary" data-guide-dismiss>Skip</button>' +
                        '<button type="button" class="buttonish primary" data-guide-dismiss>Done</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    function ensureSheet() {
        if (sheet) return sheet;
        sheet = document.createElement('div');
        sheet.id = 'site-guide-sheet';
        sheet.className = 'site-help-sheet site-guide-sheet';
        sheet.hidden = true;
        sheet.addEventListener('click', function (event) {
            if (event.target && event.target.closest && event.target.closest('[data-guide-dismiss]')) {
                dismissForYear();
                close();
                return;
            }
            if (event.target && event.target.closest && event.target.closest('[data-guide-close]')) close();
        });
        document.body.appendChild(sheet);
        return sheet;
    }

    function open(options) {
        var ctx = context();
        if (ctx.admin) return;
        closeFrameOverlays();
        var el = ensureSheet();
        el.innerHTML = markup(ctx); // nosemgrep: javascript.browser.security.insecure-innerhtml,javascript.browser.security.insecure-document-method -- guide copy is static and section labels are escaped.
        el.hidden = false;
        document.body.classList.add('has-guide-open');
        syncOverlayState();
        var focusTarget = el.querySelector('[data-guide-dismiss]') || el.querySelector('#site-guide-title');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            window.setTimeout(function () { focusTarget.focus(); }, 0);
        }
        if (!(options && options.manual) && typeof window.addSessionLog === 'function') {
            window.addSessionLog('info', 'First-run guide shown', { section: ctx.section });
        }
    }

    function close() {
        if (!sheet) return;
        sheet.hidden = true;
        document.body.classList.remove('has-guide-open');
        syncOverlayState();
    }

    document.addEventListener('click', function (event) {
        if (event.target && event.target.closest && event.target.closest('[data-guide-open]')) {
            event.preventDefault();
            open({ manual: true });
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && sheet && !sheet.hidden) close();
    });

    window.ARGuide = {
        open: open,
        close: close,
        hasDismissed: hasDismissed,
    };

    window.setTimeout(function () {
        var ctx = context();
        if (ctx.admin || !shouldAutoOpen()) return;
        if (document.body.classList.contains('has-overlay-open')) return;
        open();
    }, 650);
})();
