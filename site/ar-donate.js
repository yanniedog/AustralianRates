(function () {
    'use strict';

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

    function networks() {
        var raw = window.AR && Array.isArray(window.AR.donateNetworks) ? window.AR.donateNetworks : [];
        return raw.filter(function (n) {
            return n && String(n.address || '').trim().length > 0;
        });
    }

    function qrUrl(address) {
        var text = String(address || '').trim();
        return text ? 'https://quickchart.io/qr?size=220x220&margin=2&text=' + encodeURIComponent(text) : '';
    }

    function modalHtml(items) {
        var sub = 'Choose a network, scan the QR, or copy the wallet to support AustralianRates.';
        if (!items.length) {
            return '' +
                '<div class="site-help-backdrop" data-donate-close></div>' +
                '<div class="site-help-panel site-donate-panel" role="dialog" aria-modal="true" aria-labelledby="site-donate-title">' +
                    '<div class="site-help-head">' +
                        '<h2 id="site-donate-title" tabindex="-1">Fuel the development</h2>' +
                        '<button type="button" class="icon-btn secondary" data-donate-close aria-label="Close">' + icon('close', 'Close') + '</button>' +
                    '</div>' +
                    '<div class="site-help-body site-donate-body">' +
                        '<p class="site-donate-lead">' + esc(sub) + '</p>' +
                        '<p class="site-donate-config-hint">No donation address is currently configured.</p>' +
                    '</div>' +
                '</div>';
        }
        var tabs = items.map(function (n, i) {
            return '<button type="button" class="site-donate-tab" role="tab" aria-selected="' + (i === 0 ? 'true' : 'false') + '" data-donate-tab="' + i + '" id="site-donate-tab-' + i + '">' + esc(n.label) + '</button>';
        }).join('');
        var panes = items.map(function (n, i) {
            var addr = String(n.address || '').trim();
            var shortLabel = String(n.label || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Wallet';
            var qr = qrUrl(addr);
            return '' +
                '<div class="site-donate-pane" role="tabpanel" aria-labelledby="site-donate-tab-' + i + '" data-donate-pane="' + i + '"' + (i === 0 ? '' : ' hidden') + '>' +
                    '<p class="site-donate-wallet-label">' + esc(shortLabel) + ' wallet</p>' +
                    '<p class="site-donate-field-label">Wallet address</p>' +
                    '<pre class="site-donate-address" aria-label="Wallet address">' + esc(addr) + '</pre>' +
                    '<button type="button" class="buttonish secondary site-donate-copy" data-donate-copy>Copy address</button>' +
                    (qr ? '<img class="site-donate-qr" src="' + esc(qr) + '" width="220" height="220" alt="" loading="lazy" decoding="async">' : '') +
                '</div>';
        }).join('');
        return '' +
            '<div class="site-help-backdrop" data-donate-close></div>' +
            '<div class="site-help-panel site-donate-panel" role="dialog" aria-modal="true" aria-labelledby="site-donate-title">' +
                '<div class="site-help-head">' +
                    '<h2 id="site-donate-title" tabindex="-1">Fuel the development</h2>' +
                    '<button type="button" class="icon-btn secondary" data-donate-close aria-label="Close">' + icon('close', 'Close') + '</button>' +
                '</div>' +
                '<div class="site-help-body site-donate-body">' +
                    '<p class="site-donate-lead">' + esc(sub) + '</p>' +
                    '<p class="site-donate-blockchain-label">Blockchain</p>' +
                    '<div class="site-donate-tabs" role="tablist" aria-label="Blockchain">' + tabs + '</div>' +
                    '<div id="site-donate-copy-status" class="site-donate-copy-status" aria-live="polite" hidden></div>' +
                    '<div class="site-donate-panels">' + panes + '</div>' +
                '</div>' +
            '</div>';
    }

    function ensureSheet() {
        if (sheet) return sheet;
        sheet = document.createElement('div');
        sheet.id = 'site-donate-sheet';
        sheet.className = 'site-help-sheet site-donate-sheet';
        sheet.hidden = true;
        sheet.addEventListener('click', function (event) {
            if (event.target && event.target.closest && event.target.closest('[data-donate-close]')) {
                close();
                return;
            }
            var tabBtn = event.target && event.target.closest ? event.target.closest('[data-donate-tab]') : null;
            if (tabBtn) {
                var idx = Number(tabBtn.getAttribute('data-donate-tab'));
                if (!Number.isNaN(idx)) setTab(idx);
                return;
            }
            if (event.target && event.target.closest && event.target.closest('[data-donate-copy]')) copyActiveAddress(event.target);
        });
        document.body.appendChild(sheet);
        return sheet;
    }

    function closeOtherOverlays() {
        var help = document.getElementById('site-help-sheet');
        var menu = document.getElementById('site-menu-drawer');
        var menuBtn = document.getElementById('site-menu-toggle');
        if (help) help.hidden = true;
        if (menu) menu.hidden = true;
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
        if (window.ARGuide && typeof window.ARGuide.close === 'function') window.ARGuide.close();
        document.body.classList.remove('has-help-open', 'is-nav-open');
    }

    function overlayOpen() {
        return document.body.classList.contains('has-donate-open') ||
            document.body.classList.contains('has-help-open') ||
            document.body.classList.contains('has-guide-open') ||
            document.body.classList.contains('is-nav-open');
    }

    function syncOverlayState() {
        document.body.classList.toggle('has-overlay-open', overlayOpen());
    }

    function setTab(index) {
        var tabs = ensureSheet().querySelectorAll('[data-donate-tab]');
        var panes = ensureSheet().querySelectorAll('[data-donate-pane]');
        for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
        for (var j = 0; j < panes.length; j++) {
            if (j === index) panes[j].removeAttribute('hidden');
            else panes[j].setAttribute('hidden', 'hidden');
        }
    }

    function copyActiveAddress(target) {
        var pane = target.closest('.site-donate-pane');
        var addrEl = pane && pane.querySelector('.site-donate-address');
        var text = addrEl ? String(addrEl.textContent || '').trim() : '';
        var statusEl = document.getElementById('site-donate-copy-status');
        if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
        navigator.clipboard.writeText(text).then(function () {
            if (!statusEl) return;
            statusEl.textContent = 'Value copied!';
            statusEl.hidden = false;
            window.setTimeout(function () {
                if (statusEl) statusEl.hidden = true;
            }, 2200);
        }).catch(function () {});
    }

    function open() {
        closeOtherOverlays();
        var el = ensureSheet();
        el.innerHTML = modalHtml(networks()); // nosemgrep: javascript.browser.security.insecure-innerhtml,javascript.browser.security.insecure-document-method -- modal values are escaped and sourced from local site config.
        el.hidden = false;
        document.body.classList.add('has-donate-open');
        syncOverlayState();
        var focusTarget = el.querySelector('[data-donate-close]') || el.querySelector('#site-donate-title');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            window.setTimeout(function () { focusTarget.focus(); }, 0);
        }
    }

    function close() {
        if (!sheet) return;
        sheet.hidden = true;
        document.body.classList.remove('has-donate-open');
        syncOverlayState();
    }

    document.addEventListener('click', function (event) {
        var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
        if (link && link.id === 'site-footer-donate') {
            event.preventDefault();
            open();
            return;
        }
        if (event.target && event.target.closest && event.target.closest('[data-donate-open], #site-donate-btn')) {
            event.preventDefault();
            open();
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && sheet && !sheet.hidden) close();
    });

    window.ARDonate = {
        open: open,
        close: close,
    };
})();
