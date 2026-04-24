(function () {
    'use strict';

    window.AR = window.AR || {};

    var loc = window.location;
    var host = String((loc && loc.hostname) || '');
    var isMobileHost = /^m\./i.test(host);
    var isLocalHost = /(^|\.)localhost$/i.test(host) || /^127(?:\.\d{1,3}){3}$/.test(host) || host === '::1';
    var hasCounterpartHost = isMobileHost;
    var desktopHost = isMobileHost ? host.replace(/^m\./i, 'www.') : host;
    var mobileHost = isMobileHost ? host : '';
    // Clarity bootstrap is enforced by scripts/check-clarity-installation.js and homepage QA.
    var clarityProjectId = 'vt4vtenviy';

    function swapHost(nextHost, path) {
        var url = new URL(String(path || loc.href), loc.origin);
        url.hostname = nextHost;
        return url.toString();
    }

    function initClarity(projectId) {
        if (!projectId || isLocalHost || typeof document === 'undefined') return false;
        if (document.getElementById('ar-clarity-tag')) return true;

        window.clarity = window.clarity || function () {
            (window.clarity.q = window.clarity.q || []).push(arguments);
        };

        var script = document.createElement('script');
        var firstScript = document.getElementsByTagName('script')[0];

        script.async = true;
        script.src = 'https://www.clarity.ms/tag/' + projectId;
        script.id = 'ar-clarity-tag';

        if (firstScript && firstScript.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
        else if (document.head) document.head.appendChild(script);

        return true;
    }

    document.documentElement.setAttribute('data-ar-host-variant', isMobileHost ? 'mobile' : 'desktop');
    initClarity(clarityProjectId);

    window.AR.siteVariant = {
        host: host,
        isMobileHost: isMobileHost,
        isDesktopHost: !isMobileHost,
        isLocalHost: isLocalHost,
        hasCounterpartHost: hasCounterpartHost,
        desktopHost: desktopHost,
        mobileHost: mobileHost,
        clarityProjectId: clarityProjectId,
        clarityEnabled: !isLocalHost,
        desktopUrl: function (path) { return swapHost(desktopHost, path); },
        mobileUrl: function (path) { return swapHost(mobileHost, path); },
        counterpartUrl: function (path) {
            return hasCounterpartHost ? swapHost(desktopHost, path) : swapHost(host, path);
        },
        initClarity: initClarity,
    };

    /* Public donate modal (Order Skew style): set address to show a tab; omit or leave blank to hide that network. */
    window.AR.donateNetworks = [
        { id: 'solana', label: 'Solana (SOL)', address: 'F6mjNXKBKzjmKTK1Z9cWabFHZYtxMg8rojuNuppX2EG1' },
        { id: 'cardano', label: 'Cardano (ADA)', address: '' },
        { id: 'bnb', label: 'Binance (BNB)', address: '' },
        { id: 'doge', label: 'Dogecoin (DOGE)', address: '' },
        { id: 'monero', label: 'Monero (XMR)', address: '' },
    ];
})();
