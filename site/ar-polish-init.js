/*
 * ar-polish-init.js
 * Tiny init: toggles `is-scrolled` on <body> so the sticky header can adopt
 * a section-tinted shadow after the first scroll. Also registers a
 * rAF-throttled listener so we don't thrash layout on long pages.
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    var body = document.body;
    if (!body) return;

    var ticking = false;
    var threshold = 6;

    function update() {
        ticking = false;
        var y = window.scrollY || window.pageYOffset || 0;
        if (y > threshold) {
            if (!body.classList.contains('is-scrolled')) body.classList.add('is-scrolled');
        } else if (body.classList.contains('is-scrolled')) {
            body.classList.remove('is-scrolled');
        }
    }

    function onScroll() {
        if (ticking) return;
        ticking = true;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(update);
        } else {
            setTimeout(update, 16);
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('load', update);
    update();
})();
