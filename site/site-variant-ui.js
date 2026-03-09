(function () {
    'use strict';

    var variant = window.AR && window.AR.siteVariant;
    if (!variant) return;

    var body = document.body;
    if (!body) return;

    body.classList.add(variant.isMobileHost ? 'ar-host-mobile' : 'ar-host-desktop');

    function createLink(href, className, text) {
        var link = document.createElement('a');
        link.href = href;
        link.className = className;
        link.textContent = text;
        return link;
    }

    function enhanceHeader() {
        var nav = document.querySelector('.site-nav');
        var primary = document.querySelector('.site-nav-primary');
        var meta = document.querySelector('.site-nav-meta');
        var menu = document.querySelector('.site-nav-technical');
        var menuBody = document.querySelector('.site-nav-technical-body');
        if (!nav || !meta) return;

        if (!meta.querySelector('.site-nav-host-switch')) {
            meta.insertBefore(
                createLink(
                    variant.counterpartUrl(window.location.href),
                    'site-nav-host-switch',
                    variant.isMobileHost ? 'Desktop' : 'Mobile'
                ),
                meta.firstChild
            );
        }

        if (!variant.isMobileHost || !primary || !menu || !menuBody || menuBody.querySelector('.site-nav-mobile-links')) {
            return;
        }

        var mobileLinks = document.createElement('div');
        mobileLinks.className = 'site-nav-mobile-links';
        mobileLinks.innerHTML = primary.innerHTML;
        menuBody.insertBefore(mobileLinks, menuBody.firstChild);

        var mobileActions = document.createElement('div');
        mobileActions.className = 'site-nav-mobile-actions';
        mobileActions.appendChild(createLink(variant.desktopUrl(window.location.href), 'site-nav-mobile-action', 'Desktop site'));
        menuBody.appendChild(mobileActions);
    }

    function enhanceFooter() {
        var actions = document.querySelector('.site-footer-actions');
        if (!actions || actions.querySelector('.footer-host-switch')) return;
        actions.insertBefore(
            createLink(
                variant.counterpartUrl(window.location.href),
                'footer-host-switch',
                variant.isMobileHost ? 'Desktop site' : 'Mobile site'
            ),
            actions.firstChild
        );
    }

    function clickSelector(selector) {
        var el = document.querySelector(selector);
        if (el) el.click();
    }

    function scrollToSelector(selector) {
        var el = document.querySelector(selector);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function activateAnalysisTab(tabSelector, panelSelector) {
        clickSelector('#mode-analyst');
        window.setTimeout(function () {
            clickSelector(tabSelector);
            window.setTimeout(function () {
                scrollToSelector(panelSelector);
            }, 220);
        }, 160);
    }

    function buildMobileDock() {
        if (!variant.isMobileHost || !body.classList.contains('ar-public') || document.querySelector('.mobile-action-dock')) {
            return;
        }

        var dock = document.createElement('nav');
        dock.className = 'mobile-action-dock';
        dock.setAttribute('aria-label', 'Quick navigation');
        dock.innerHTML =
            '<button type="button" data-action="summary">Summary</button>' +
            '<button type="button" data-action="rates">Rates</button>' +
            '<button type="button" data-action="filters">Filters</button>' +
            '<button type="button" data-action="charts">Charts</button>' +
            '<button type="button" data-action="notes">Notes</button>';

        dock.addEventListener('click', function (event) {
            var button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
            if (!button) return;
            var action = String(button.getAttribute('data-action') || '');
            if (action === 'summary') {
                scrollToSelector('#workspace-summary-panel');
                return;
            }
            if (action === 'rates') {
                clickSelector('#mode-consumer');
                window.setTimeout(function () {
                    clickSelector('#tab-explorer');
                    scrollToSelector('#panel-explorer');
                }, 120);
                return;
            }
            if (action === 'filters') {
                var filterBar = document.getElementById('filter-bar');
                if (filterBar && filterBar.tagName === 'DETAILS') filterBar.open = true;
                scrollToSelector('.workspace-rail');
                return;
            }
            if (action === 'charts') {
                activateAnalysisTab('#tab-charts', '#panel-charts');
                return;
            }
            if (action === 'notes') {
                var marketNotes = document.getElementById('market-notes');
                if (marketNotes && marketNotes.tagName === 'DETAILS') marketNotes.open = true;
                scrollToSelector('#market-notes');
            }
        });

        document.body.appendChild(dock);
    }

    enhanceHeader();
    enhanceFooter();
    buildMobileDock();
})();
