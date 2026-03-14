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
        if (!variant.hasCounterpartHost) return;
        var actions = document.querySelector('.site-header-actions');
        if (!actions || actions.querySelector('.site-host-switch')) return;
        actions.insertBefore(
            createLink(
                variant.counterpartUrl(window.location.href),
                'site-host-switch buttonish secondary',
                variant.isMobileHost ? 'DESK' : 'MOB'
            ),
            actions.firstChild
        );
    }

    function enhanceFooter() {
        if (!variant.hasCounterpartHost) return;
        var meta = document.querySelector('.site-footer-meta');
        if (!meta || meta.querySelector('.footer-host-switch')) return;
        meta.appendChild(
            createLink(
                variant.counterpartUrl(window.location.href),
                'footer-host-switch',
                variant.isMobileHost ? 'Desktop site' : 'Mobile site'
            )
        );
    }

    enhanceHeader();
    enhanceFooter();
})();
