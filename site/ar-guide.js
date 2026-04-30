(function () {
    'use strict';

    var COOKIE_NAME = 'ar_guide_dismissed';
    var sheet = null;
    var stepIndex = 0;
    var activeSteps = [];
    var lastFocus = null;

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

    function hasDismissed() {
        try {
            return document.cookie.split(';').some(function (part) {
                return part.trim().indexOf(COOKIE_NAME + '=1') === 0;
            });
        } catch (_err) {
            return false;
        }
    }

    function shouldAutoOpen(ctx) {
        if (ctx.admin || ctx.legal || ctx.notFound) return false;
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

    function fallbackTarget() {
        return document.querySelector('main') || document.body;
    }

    function findTarget(step) {
        var target = document.querySelector('[data-guide-target="' + step.target + '"]');
        if (!target && step.selector) target = document.querySelector(step.selector);
        return target || fallbackTarget();
    }

    function baseSteps(ctx) {
        if (ctx.section === 'economic-data') {
            return [
                { target: 'product-nav', title: 'Choose a market', action: 'Click', body: 'Use this nav to switch between Mortgage, Savings, Term Deposits, and Economic Data.' },
                { target: 'main-chart', title: 'Read the chart', action: 'Observe', body: 'The active signal or selected raw series is shown here first.' },
                { target: 'filters', title: 'Pick indicators', action: 'Click', body: 'Open these controls to change presets or select one indicator.' },
                { target: 'range-controls', title: 'Set range and mode', action: 'Click', body: 'Use Signal, Raw, Indexed, range chips, and scale only when needed.' },
                { target: 'data-table', title: 'Check components', action: 'Observe', body: 'This table gives the current signal inputs without chart clutter.' },
                { target: 'export-help', title: 'Export and help', action: 'Click', body: 'Use footer data links or Menu for catalog, status, help, and this guide.' },
            ];
        }
        return [
            { target: 'product-nav', selector: '.site-header-segment', title: 'Choose a market', action: 'Click', body: 'Use this nav to switch between Mortgage, Savings, Term Deposits, and Economic Data.' },
            { target: 'main-chart', selector: '.chart-figure, #chart, .terminal-stage-panel', title: 'Read the chart', action: 'Observe', body: 'Start with the chart before opening filters or exports.' },
            { target: 'filters', selector: '.terminal-filter-panel, #filters, [data-filter-drawer]', title: 'Filter the table', action: 'Click', body: 'Open filters only when the default slice is too broad.' },
            { target: 'range-controls', selector: '#range-row, .chart-toolbar, .terminal-toolbar', title: 'Adjust range and mode', action: 'Click', body: 'Use compact controls for timeframe, series, and chart mode.' },
            { target: 'data-table', selector: '#rates-table, .terminal-data-panel, table', title: 'Scan rows', action: 'Observe', body: 'Tables carry the exact lender, product, and rate details.' },
            { target: 'export-help', selector: '.site-footer-data-link, #site-help-btn, [data-guide-open]', title: 'Export and help', action: 'Click', body: 'Use Menu or footer links for help, refresh, exports, and this guide.' },
        ];
    }

    function visibleSteps(ctx) {
        return baseSteps(ctx).filter(function (step) {
            return !!findTarget(step);
        });
    }

    function markup() {
        return '' +
            '<div class="site-help-backdrop site-guide-backdrop" data-guide-close></div>' +
            '<div class="site-guide-spotlight" aria-hidden="true"></div>' +
            '<div class="site-guide-popover" role="dialog" aria-modal="true" aria-labelledby="site-guide-title">' +
                '<div class="site-guide-popover-head">' +
                    '<span class="site-guide-step-count"></span>' +
                    '<button type="button" class="icon-btn secondary" data-guide-close aria-label="Close guide">' + icon('close', 'Close') + '</button>' +
                '</div>' +
                '<h2 id="site-guide-title" tabindex="-1"></h2>' +
                '<p class="site-guide-action"></p>' +
                '<p class="site-guide-copy"></p>' +
                '<div class="site-guide-actions">' +
                    '<button type="button" class="buttonish secondary" data-guide-skip>Skip</button>' +
                    '<button type="button" class="buttonish secondary" data-guide-back>Back</button>' +
                    '<button type="button" class="buttonish primary" data-guide-next>Next</button>' +
                '</div>' +
            '</div>';
    }

    function ensureSheet() {
        if (sheet) return sheet;
        sheet = document.createElement('div');
        sheet.id = 'site-guide-sheet';
        sheet.className = 'site-help-sheet site-guide-sheet';
        sheet.hidden = true;
        sheet.innerHTML = markup(); // nosemgrep: javascript.browser.security.insecure-innerhtml -- static guide chrome.
        sheet.addEventListener('click', function (event) {
            if (event.target && event.target.closest && event.target.closest('[data-guide-skip]')) {
                dismissForYear();
                close();
                return;
            }
            if (event.target && event.target.closest && event.target.closest('[data-guide-close]')) close();
            if (event.target && event.target.closest && event.target.closest('[data-guide-back]')) previousStep();
            if (event.target && event.target.closest && event.target.closest('[data-guide-next]')) nextStep();
        });
        document.body.appendChild(sheet);
        return sheet;
    }

    function placePopover(targetRect) {
        if (!sheet) return;
        var popover = sheet.querySelector('.site-guide-popover');
        if (!popover) return;
        var width = Math.min(360, Math.max(280, window.innerWidth - 24));
        var left = Math.min(Math.max(12, targetRect.left), window.innerWidth - width - 12);
        var top = targetRect.bottom + 12;
        if (top + 230 > window.innerHeight && targetRect.top > 250) top = targetRect.top - 230;
        popover.style.width = width + 'px';
        popover.style.left = left + 'px';
        popover.style.top = Math.max(12, top) + 'px';
    }

    function renderStep() {
        if (!sheet || !activeSteps.length) return;
        var step = activeSteps[Math.max(0, Math.min(stepIndex, activeSteps.length - 1))];
        var target = findTarget(step);
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        window.setTimeout(function () {
            if (!sheet || sheet.hidden) return;
            var rect = target.getBoundingClientRect();
            var pad = 6;
            var spotlight = sheet.querySelector('.site-guide-spotlight');
            var popover = sheet.querySelector('.site-guide-popover');
            if (spotlight) {
                spotlight.style.left = Math.max(8, rect.left - pad) + 'px';
                spotlight.style.top = Math.max(8, rect.top - pad) + 'px';
                spotlight.style.width = Math.min(window.innerWidth - 16, rect.width + pad * 2) + 'px';
                spotlight.style.height = Math.min(window.innerHeight - 16, rect.height + pad * 2) + 'px';
            }
            placePopover(rect);
            if (popover) {
                popover.querySelector('.site-guide-step-count').textContent = 'Step ' + (stepIndex + 1) + ' of ' + activeSteps.length;
                popover.querySelector('#site-guide-title').textContent = step.title;
                popover.querySelector('.site-guide-action').textContent = step.action + ':';
                popover.querySelector('.site-guide-copy').textContent = step.body;
                popover.querySelector('[data-guide-back]').disabled = stepIndex === 0;
                popover.querySelector('[data-guide-next]').textContent = stepIndex === activeSteps.length - 1 ? 'Done' : 'Next';
                var focusTarget = popover.querySelector('[data-guide-next]');
                if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
            }
        }, 160);
    }

    function nextStep() {
        if (stepIndex >= activeSteps.length - 1) {
            dismissForYear();
            close();
            return;
        }
        stepIndex += 1;
        renderStep();
    }

    function previousStep() {
        stepIndex = Math.max(0, stepIndex - 1);
        renderStep();
    }

    function trapFocus(event) {
        if (event.key !== 'Tab' || !sheet || sheet.hidden) return;
        var focusables = Array.from(sheet.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function open(options) {
        var ctx = context();
        if (ctx.admin) return;
        activeSteps = visibleSteps(ctx);
        if (!activeSteps.length) return;
        stepIndex = 0;
        lastFocus = document.activeElement;
        closeFrameOverlays();
        ensureSheet().hidden = false;
        document.body.classList.add('has-guide-open');
        syncOverlayState();
        renderStep();
        if (!(options && options.manual) && typeof window.addSessionLog === 'function') {
            window.addSessionLog('info', 'First-run guide shown', { section: ctx.section });
        }
    }

    function close() {
        if (!sheet) return;
        sheet.hidden = true;
        document.body.classList.remove('has-guide-open');
        syncOverlayState();
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    document.addEventListener('click', function (event) {
        if (event.target && event.target.closest && event.target.closest('[data-guide-open]')) {
            event.preventDefault();
            open({ manual: true });
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && sheet && !sheet.hidden) close();
        trapFocus(event);
    });

    window.addEventListener('resize', function () {
        if (sheet && !sheet.hidden) renderStep();
    });

    window.ARGuide = {
        open: open,
        close: close,
        next: nextStep,
        back: previousStep,
        hasDismissed: hasDismissed,
    };

    window.setTimeout(function () {
        var ctx = context();
        if (!shouldAutoOpen(ctx)) return;
        if (document.body.classList.contains('has-overlay-open')) return;
        open();
    }, 650);
})();
