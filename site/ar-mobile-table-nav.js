(function () {
    'use strict';
    window.AR = window.AR || {};

    var MOBILE_BREAKPOINT = 760;
    var MIN_SECTION_MULTIPLIER = 1.35;
    var SCROLL_STEP_MULTIPLIER = 0.7;
    var rail;
    var upButton;
    var downButton;
    var progressFill;
    var refreshFrame = 0;

    function isMobileViewport() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function getActiveTab() {
        return window.AR.tabs && typeof window.AR.tabs.getActiveTab === 'function'
            ? window.AR.tabs.getActiveTab()
            : 'explorer';
    }

    function getExplorerSection() {
        var fold = document.getElementById('table-details');
        if (fold && fold.tagName === 'DETAILS' && fold.open) return fold;
        return document.querySelector('#panel-explorer .panel-wide') || document.getElementById('panel-explorer');
    }

    function isExplorerVisible() {
        var panel = document.getElementById('panel-explorer');
        if (!panel || panel.hidden || !panel.classList.contains('active')) return false;
        return getComputedStyle(panel).display !== 'none';
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function getScrollRange() {
        var section = getExplorerSection();
        if (!section) return null;
        var rect = section.getBoundingClientRect();
        var top = window.scrollY + rect.top;
        var height = rect.height;
        var start = Math.max(0, top);
        var end = Math.max(start, top + height - window.innerHeight);
        return {
            height: height,
            start: start,
            end: end,
        };
    }

    function shouldShowRail(range) {
        if (!isMobileViewport()) return false;
        if (getActiveTab() !== 'explorer') return false;
        if (!isExplorerVisible()) return false;
        if (!range) return false;
        return range.height > window.innerHeight * MIN_SECTION_MULTIPLIER && range.end > range.start;
    }

    function setRailVisible(visible) {
        if (!rail) return;
        rail.hidden = !visible;
        rail.classList.toggle('is-visible', visible);
        rail.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function updateButtons(range) {
        if (!upButton || !downButton || !range) return;
        var current = clamp(window.scrollY, range.start, range.end);
        upButton.disabled = current <= range.start + 1;
        downButton.disabled = current >= range.end - 1;
    }

    function updateProgress(range) {
        if (!progressFill) return;
        if (!range || range.end <= range.start) {
            progressFill.style.height = '0%';
            return;
        }
        var current = clamp(window.scrollY, range.start, range.end);
        var progress = clamp((current - range.start) / (range.end - range.start), 0, 1);
        progressFill.style.height = String(progress * 100) + '%';
    }

    function scrollRail(direction) {
        var range = getScrollRange();
        if (!range) return;
        var base = clamp(window.scrollY, range.start, range.end);
        var target = clamp(
            base + (direction * window.innerHeight * SCROLL_STEP_MULTIPLIER),
            range.start,
            range.end
        );
        window.scrollTo({
            top: target,
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
    }

    function refreshRail() {
        refreshFrame = 0;
        var range = getScrollRange();
        var visible = shouldShowRail(range);
        setRailVisible(visible);
        if (!visible) return;
        updateButtons(range);
        updateProgress(range);
    }

    function scheduleRefresh() {
        if (refreshFrame) return;
        refreshFrame = window.requestAnimationFrame(refreshRail);
    }

    function ensureRail() {
        if (rail) return;
        rail = document.createElement('div');
        rail.id = 'mobile-table-rail';
        rail.className = 'mobile-table-rail';
        rail.hidden = true;
        rail.setAttribute('aria-hidden', 'true');
        rail.setAttribute('aria-label', 'Explorer navigation');

        upButton = document.createElement('button');
        upButton.type = 'button';
        upButton.className = 'mobile-table-rail-btn';
        upButton.setAttribute('aria-label', 'Scroll up through the rates explorer');
        upButton.textContent = '^';

        var track = document.createElement('div');
        track.className = 'mobile-table-rail-track';
        track.setAttribute('aria-hidden', 'true');

        progressFill = document.createElement('span');
        progressFill.className = 'mobile-table-rail-progress';
        track.appendChild(progressFill);

        downButton = document.createElement('button');
        downButton.type = 'button';
        downButton.className = 'mobile-table-rail-btn';
        downButton.setAttribute('aria-label', 'Scroll down through the rates explorer');
        downButton.textContent = 'v';

        rail.appendChild(upButton);
        rail.appendChild(track);
        rail.appendChild(downButton);
        document.body.appendChild(rail);

        upButton.addEventListener('click', function () { scrollRail(-1); });
        downButton.addEventListener('click', function () { scrollRail(1); });
    }

    function bindRail() {
        window.addEventListener('scroll', scheduleRefresh, { passive: true });
        window.addEventListener('resize', scheduleRefresh);
        window.addEventListener('orientationchange', scheduleRefresh);
        window.addEventListener('ar:tab-changed', scheduleRefresh);
        window.addEventListener('ar:ui-mode-changed', scheduleRefresh);
        window.addEventListener('ar:explorer-table-updated', scheduleRefresh);
        document.addEventListener('visibilitychange', scheduleRefresh);
    }

    ensureRail();
    bindRail();
    scheduleRefresh();

    window.AR.mobileTableNav = {
        refresh: scheduleRefresh,
    };
})();
