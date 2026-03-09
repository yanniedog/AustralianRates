(function () {
    'use strict';

    window.AR = window.AR || {};

    var loc = window.location;
    var host = String((loc && loc.hostname) || '');
    var isMobileHost = /^m\./i.test(host);
    var isLocalHost = /(^|\.)localhost$/i.test(host);
    var desktopHost = isMobileHost ? host.replace(/^m\./i, 'www.') : (isLocalHost ? 'www.localhost' : 'www.australianrates.com');
    var mobileHost = isMobileHost ? host : (isLocalHost ? 'm.localhost' : 'm.australianrates.com');

    function swapHost(nextHost, path) {
        var url = new URL(String(path || loc.href), loc.origin);
        url.hostname = nextHost;
        return url.toString();
    }

    document.documentElement.setAttribute('data-ar-host-variant', isMobileHost ? 'mobile' : 'desktop');

    window.AR.siteVariant = {
        host: host,
        isMobileHost: isMobileHost,
        isDesktopHost: !isMobileHost,
        desktopHost: desktopHost,
        mobileHost: mobileHost,
        desktopUrl: function (path) { return swapHost(desktopHost, path); },
        mobileUrl: function (path) { return swapHost(mobileHost, path); },
        counterpartUrl: function (path) {
            return isMobileHost ? swapHost(desktopHost, path) : swapHost(mobileHost, path);
        }
    };
})();
