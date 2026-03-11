(function () {
    'use strict';

    var GITHUB_REPO = 'yanniedog/AustralianRates';
    var sc = (window.AR && window.AR.sectionConfig) ? window.AR.sectionConfig : {};
    var SECTION_API_BASE = window.location.origin + (sc.apiPath || '/api/home-loan-rates');
    var utils = (window.AR && window.AR.utils) ? window.AR.utils : {};
    var timeUtils = (window.AR && window.AR.time) ? window.AR.time : {};
    var flushClientLogQueue = (typeof utils.flushClientLogQueue === 'function') ? utils.flushClientLogQueue : function () { return 0; };
    var themeApi = window.ARTheme || {};
    var uiIcons = (window.AR && window.AR.uiIcons) ? window.AR.uiIcons : {};
    var SESSION_LOG_MAX = 500;
    var TOOLTIP_DELAY_MS = 450;
    var LONG_PRESS_MS = 500;
    var _sessionLog = [];
    var tooltipEl = null;
    var tooltipTimer = 0;
    var longPressTimer = 0;
    var helpSheet = null;

    function addSessionLog(level, message, detail) {
        _sessionLog.push({
            ts: new Date().toISOString(),
            level: level || 'info',
            message: String(message || ''),
            detail: detail
        });
        if (_sessionLog.length > SESSION_LOG_MAX) _sessionLog.shift();
        updateLogLinkText();
    }

    function getSessionLogEntries() {
        return _sessionLog.slice();
    }

    function clearSessionLog() {
        _sessionLog.length = 0;
        updateLogLinkText();
    }

    function esc(value) {
        if (window._arEsc) return window._arEsc(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fallbackText(_icon, label, className, textClassName) {
        var classes = ['ar-icon-label'];
        if (className) classes.push(className);
        return '' +
            '<span class="' + classes.join(' ') + '">' +
                '<span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span>' +
            '</span>';
    }

    function fallbackPanel(_icon, label, className) {
        var classes = ['panel-code'];
        if (className) classes.push(className);
        return '<span class="' + classes.join(' ') + '" aria-hidden="true">' + esc(String(label || '').charAt(0) || '*') + '</span>';
    }

    function fallbackIcon(_icon, label, className) {
        var classes = ['ar-icon'];
        if (className) classes.push(className);
        return '<span class="' + classes.join(' ') + '" aria-hidden="true">' + esc(String(label || '').charAt(0) || '*') + '</span>';
    }

    var iconText = typeof uiIcons.text === 'function' ? uiIcons.text : fallbackText;
    var panelIcon = typeof uiIcons.panel === 'function' ? uiIcons.panel : fallbackPanel;
    var iconOnly = typeof uiIcons.icon === 'function' ? uiIcons.icon : fallbackIcon;

    function updateLogLinkText() {
        var el = document.getElementById('footer-log-link-text');
        if (!el) return;
        el.textContent = 'log/' + _sessionLog.length.toLocaleString();
    }

    function downloadClientLog() {
        var entries = getSessionLogEntries();
        var lines = entries.map(function (entry) {
            var parts = [entry.ts, '[' + (entry.level || 'info').toUpperCase() + ']', entry.message];
            if (entry.detail && typeof entry.detail === 'object') parts.push(JSON.stringify(entry.detail));
            else if (entry.detail != null) parts.push(String(entry.detail));
            return parts.join(' ');
        });
        var text = '# AustralianRates Client Log (' + entries.length + ' entries)\n# Downloaded at ' + new Date().toISOString() + '\n\n' + lines.join('\n') + '\n';
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'australianrates-client-log.txt';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function clearSiteDataAndReload() {
        var hostname = typeof location !== 'undefined' && location.hostname ? location.hostname : '';
        var expired = 'expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;max-age=0';

        try {
            var cookies = document.cookie.split(';');
            for (var i = 0; i < cookies.length; i++) {
                var name = cookies[i].split('=')[0].trim();
                if (!name) continue;
                document.cookie = name + '=;' + expired;
                if (hostname) document.cookie = name + '=;' + expired + ';domain=' + hostname;
            }
        } catch (_err) {}
        try {
            if (typeof localStorage !== 'undefined' && localStorage) localStorage.clear();
        } catch (_err) {}
        try {
            if (typeof sessionStorage !== 'undefined' && sessionStorage) sessionStorage.clear();
        } catch (_err) {}

        function doReload() {
            var q = (window.location.search ? '&' : '?') + '_=' + Date.now();
            window.location.replace(window.location.pathname + window.location.search + q + window.location.hash);
        }

        var p = Promise.resolve();
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            p = p.then(function () {
                return navigator.serviceWorker.getRegistrations().then(function (regs) {
                    return Promise.all(regs.map(function (r) { return r.unregister(); }));
                });
            });
        }
        if (typeof caches !== 'undefined' && caches.keys) {
            p = p.then(function () {
                return caches.keys().then(function (keys) {
                    return Promise.all(keys.map(function (key) { return caches.delete(key); }));
                });
            });
        }
        p.then(doReload).catch(doReload);
    }

    function getPageContext() {
        var body = document.body;
        if (!body) return { section: 'home-loans', admin: false, legal: false };
        return {
            section: body.getAttribute('data-ar-section') || (window.AR && window.AR.section) || 'home-loans',
            admin: body.classList.contains('ar-admin'),
            legal: body.classList.contains('ar-legal'),
        };
    }

    function sectionMeta(section) {
        if (section === 'savings') return { label: 'Savings', code: 'SAV', icon: 'stats', path: '/savings/' };
        if (section === 'term-deposits') return { label: 'Term Deposits', code: 'TD', icon: 'history', path: '/term-deposits/' };
        return { label: 'Home Loans', code: 'HL', icon: 'home', path: '/' };
    }

    function currentPageLabel(context) {
        if (context.admin) {
            var path = window.location.pathname.toLowerCase();
            if (path.indexOf('/admin/status') >= 0) return 'Status';
            if (path.indexOf('/admin/database') >= 0) return 'Database';
            if (path.indexOf('/admin/clear') >= 0) return 'Clear';
            if (path.indexOf('/admin/config') >= 0) return 'Config';
            if (path.indexOf('/admin/runs') >= 0) return 'Runs';
            if (path.indexOf('/admin/logs') >= 0) return 'Logs';
            if (path.indexOf('/admin/dashboard') >= 0) return 'Dashboard';
            return 'Admin';
        }
        if (context.legal) {
            var legalPath = window.location.pathname.toLowerCase();
            if (legalPath.indexOf('/about/') >= 0) return 'About';
            if (legalPath.indexOf('/contact/') >= 0) return 'Contact';
            if (legalPath.indexOf('/privacy/') >= 0) return 'Privacy';
            if (legalPath.indexOf('/terms/') >= 0) return 'Terms';
            return 'Reference';
        }
        return sectionMeta(context.section).label;
    }

    function getLegalHref(slug) {
        return '/' + String(slug || '').replace(/^\/+|\/+$/g, '') + '/';
    }

    function buildMarketLinks(baseHref) {
        return [
            { href: baseHref + '#chart', label: 'Charts', icon: 'chart' },
            { href: baseHref + '#ladder', label: 'Leaders', icon: 'ladder' },
            { href: baseHref + '#table', label: 'Table', icon: 'table' },
            { href: baseHref + '#pivot', label: 'Pivot', icon: 'pivot' },
            { href: baseHref + '#history', label: 'History', icon: 'history' },
            { href: baseHref + '#changes', label: 'Changes', icon: 'changes' },
            { href: baseHref + '#export', label: 'Download', icon: 'download' },
            { href: baseHref + '#market-notes', label: 'Notes', icon: 'notes' }
        ];
    }

    function publicTreeMarkup(context) {
        var sections = [
            sectionMeta('home-loans'),
            sectionMeta('savings'),
            sectionMeta('term-deposits')
        ];
        var currentPath = window.location.pathname;
        return '' +
            '<nav class="site-tree" aria-label="Market tree">' +
                '<div class="site-tree-group">' +
                    sections.map(function (item) {
                        var activeRoot = currentPath === item.path || (item.path !== '/' && currentPath.indexOf(item.path) === 0);
                        return '' +
                            '<details class="site-tree-branch"' + (activeRoot ? ' open' : '') + '>' +
                                '<summary class="site-tree-root' + (activeRoot ? ' is-active' : '') + '">' +
                                    '<a href="' + esc(item.path) + '"' + (activeRoot ? ' aria-current="page"' : '') + '>' + iconText(item.icon || 'home', item.label, 'nav-link-label') + '</a>' +
                                '</summary>' +
                                '<div class="site-tree-children">' +
                                    buildMarketLinks(item.path).map(function (link) {
                                        var active = activeRoot && window.location.hash === link.href.slice(item.path.length);
                                        return '<a class="site-tree-leaf' + (active ? ' is-active' : '') + '" href="' + esc(link.href) + '">' + iconText(link.icon, link.label, 'nav-link-label') + '</a>';
                                    }).join('') +
                                '</div>' +
                            '</details>';
                    }).join('') +
                '</div>' +
                '<div class="site-tree-group site-tree-group-secondary">' +
                    panelIcon('reference', 'Reference') +
                    '<a class="site-tree-leaf" href="' + esc(getLegalHref('about')) + '">About</a>' +
                    '<a class="site-tree-leaf" href="' + esc(getLegalHref('contact')) + '">Contact</a>' +
                    '<a class="site-tree-leaf" href="' + esc(getLegalHref('privacy')) + '">Privacy</a>' +
                    '<a class="site-tree-leaf" href="' + esc(getLegalHref('terms')) + '">Terms</a>' +
                '</div>' +
            '</nav>';
    }

    function adminNavMarkup() {
        var path = window.location.pathname.toLowerCase();
        var links = [
            { href: '/admin/dashboard.html', label: 'Dashboard' },
            { href: '/admin/status.html', label: 'Status' },
            { href: '/admin/database.html', label: 'Database' },
            { href: '/admin/clear.html', label: 'Clear' },
            { href: '/admin/config.html', label: 'Config' },
            { href: '/admin/runs.html', label: 'Runs' },
            { href: '/admin/logs.html', label: 'Logs' },
            { href: '/', label: 'Public' }
        ];
        return '' +
            '<nav class="admin-sidebar-nav" aria-label="Admin navigation">' +
                links.map(function (link) {
                    var active = path === link.href.toLowerCase() || (link.href.indexOf('/admin/') >= 0 && path.indexOf(link.href.toLowerCase().replace('.html', '')) === 0);
                    return '<a class="admin-sidebar-link' + (active ? ' is-active' : '') + '" href="' + esc(link.href) + '"' + (active ? ' aria-current="page"' : '') + '>' + esc(link.label) + '</a>';
                }).join('') +
            '</nav>';
    }

    function headerActionsMarkup(context) {
        return '' +
            '<div class="site-header-actions">' +
                '<button type="button" class="icon-btn secondary" data-theme-toggle aria-label="Toggle theme"></button>' +
                '<button type="button" id="site-help-btn" class="icon-btn secondary" aria-label="Open help" title="Open help">' + iconOnly('help', 'Open help') + '</button>' +
                '<button type="button" id="refresh-site-btn" class="icon-btn secondary" aria-label="Clear cookies and cache and reload" title="Clear cookies, storage and cache for this site, then reload">' + iconOnly('refresh', 'Clear cookies and cache and reload') + '</button>' +
                '<a href="https://github.com/' + GITHUB_REPO + '" target="_blank" rel="noopener" class="buttonish secondary icon-link" aria-label="GitHub repository" title="GitHub repository">' + iconOnly('github', 'GitHub repository') + '</a>' +
                '<button type="button" id="site-menu-toggle" class="icon-btn secondary" aria-label="Toggle menu" title="Toggle menu">' + iconOnly('menu', 'Toggle menu') + '</button>' +
            '</div>';
    }

    function buildHeader() {
        var header = document.querySelector('.site-header');
        if (!header) return;
        var inner = header.querySelector('.site-header-inner');
        if (!inner) return;

        var context = getPageContext();
        inner.innerHTML =
            '<div class="site-brand-lockup">' +
                '<a href="/" class="site-brand-mark" aria-label="AustralianRates home">' + iconOnly('brand', 'AustralianRates home') + '</a>' +
                '<div class="site-brand-copy">' +
                    '<a href="/" class="site-brand">AustralianRates</a>' +
                    '<span class="site-brand-tagline">' + esc(currentPageLabel(context)) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="site-header-context">' +
                '<span class="eyebrow">' + esc(context.admin ? 'Admin' : (context.legal ? 'Reference' : 'Markets')) + '</span>' +
                '<strong class="site-header-title">' + esc(currentPageLabel(context)) + '</strong>' +
            '</div>' +
            headerActionsMarkup(context);

        if (themeApi && typeof themeApi.initToggles === 'function') {
            themeApi.initToggles(inner);
        }
    }

    function buildPublicTree(context) {
        var target = document.getElementById('market-nav-tree');
        if (!target) return;
        target.innerHTML = publicTreeMarkup(context);
    }

    function buildAdminSidebar(context) {
        if (!context.admin) return;
        if (window.location.pathname.toLowerCase().indexOf('/admin/index.html') >= 0 || window.location.pathname.toLowerCase().endsWith('/admin/')) return;
        if (document.querySelector('.admin-sidebar')) return;

        var aside = document.createElement('aside');
        aside.className = 'admin-sidebar';
        aside.innerHTML =
            '<div class="admin-sidebar-head">' +
                panelIcon('admin', 'Admin') +
                '<strong>Admin</strong>' +
            '</div>' +
            adminNavMarkup();
        var main = document.querySelector('main.admin-shell');
        if (main && main.parentNode) {
            main.parentNode.insertBefore(aside, main);
            document.body.classList.add('has-admin-sidebar');
        }
    }

    function buildLegalDrawer(context) {
        if (!context.legal) return;
        if (document.getElementById('site-menu-drawer')) return;

        var drawer = document.createElement('aside');
        drawer.id = 'site-menu-drawer';
        drawer.className = 'site-menu-drawer';
        drawer.hidden = true;
        drawer.innerHTML =
            '<div class="site-menu-backdrop" data-menu-close></div>' +
            '<div class="site-menu-panel">' +
                '<div class="site-menu-head">' +
                    panelIcon('menu', 'Menu') +
                    '<button type="button" class="icon-btn secondary" data-menu-close aria-label="Close menu">' + iconOnly('close', 'Close menu') + '</button>' +
                '</div>' +
                publicTreeMarkup(context) +
            '</div>';
        document.body.appendChild(drawer);
    }

    function buildFooter() {
        var existing = document.querySelector('.site-footer');
        if (existing) existing.remove();

        var context = getPageContext();
        var footer = document.createElement('footer');
        footer.className = 'site-footer';
        footer.innerHTML =
            '<div class="site-footer-inner">' +
                '<div class="site-footer-meta">' +
                    '<strong>AustralianRates</strong>' +
                    '<a href="' + esc(getLegalHref('about')) + '">About</a>' +
                    '<a href="' + esc(getLegalHref('contact')) + '">Contact</a>' +
                    '<a href="' + esc(getLegalHref('privacy')) + '">Privacy</a>' +
                    '<a href="' + esc(getLegalHref('terms')) + '">Terms</a>' +
                '</div>' +
                '<div class="site-footer-tech">' +
                    '<details class="footer-technical" id="footer-technical">' +
                        '<summary class="footer-technical-summary">' + iconText('tech', 'Technical', 'nav-link-label') + '</summary>' +
                        '<div class="footer-technical-body">' +
                            '<span id="footer-commit">Loading commit info...</span>' +
                            '<span id="footer-log-info" class="footer-log-wrap">' +
                                '<a href="#" id="footer-log-link" class="footer-log-badge" title="View log options"><span id="footer-log-link-text">log/0</span></a>' +
                                '<div id="footer-log-popup" class="footer-log-popup" role="dialog" aria-label="Log download options" hidden>' +
                                    '<button type="button" id="footer-log-download-client" class="footer-log-popup-item">Download client log</button>' +
                                '</div>' +
                            '</span>' +
                            (context.admin ? '<span class="footer-note">Admin tooling</span>' : '<span class="footer-note">General information only</span>') +
                        '</div>' +
                    '</details>' +
                '</div>' +
            '</div>';
        document.body.appendChild(footer);

        var logLink = document.getElementById('footer-log-link');
        var popup = document.getElementById('footer-log-popup');
        var downloadClient = document.getElementById('footer-log-download-client');

        if (logLink && popup) {
            logLink.addEventListener('click', function (event) {
                event.preventDefault();
                popup.hidden = !popup.hidden;
                if (!popup.hidden && downloadClient) downloadClient.focus();
            });
        }
        if (downloadClient) {
            downloadClient.addEventListener('click', function () {
                downloadClientLog();
                if (popup) popup.hidden = true;
            });
        }
        document.addEventListener('click', function (event) {
            if (!popup || popup.hidden) return;
            var wrap = document.getElementById('footer-log-info');
            if (wrap && !wrap.contains(event.target)) popup.hidden = true;
        });

        updateLogLinkText();
    }

    function formatDate(iso) {
        if (timeUtils && typeof timeUtils.formatCheckedAt === 'function') {
            var rendered = timeUtils.formatCheckedAt(iso);
            if (rendered && rendered.text) return rendered.text;
        }
        return String(iso || '');
    }

    function renderCommitStatus(el, info) {
        var deployText = info.deploySha
            ? '<a href="https://github.com/' + GITHUB_REPO + '/commit/' + esc(info.deploySha) + '" target="_blank" rel="noopener">deploy ' + esc(info.deployShort) + '</a>'
            : 'deploy ?';
        var buildText = info.buildTime ? ('build ' + esc(formatDate(info.buildTime))) : 'build ?';
        el.innerHTML = [esc(info.status), deployText, buildText].join(' | ');
    }

    function fetchDeployVersion(versionUrl) {
        return fetch(versionUrl, { cache: 'no-store' })
            .then(function (r) {
                if (!r.ok) return null;
                var type = String(r.headers.get('content-type') || '').toLowerCase();
                if (type.indexOf('application/json') === -1) return null;
                return r.json().catch(function () { return null; });
            })
            .catch(function () { return null; });
    }

    function loadCommitInfo() {
        var el = document.getElementById('footer-commit');
        if (!el) return;

        var base = document.querySelector('base') && document.querySelector('base').href
            ? new URL(document.querySelector('base').href).origin
            : window.location.origin;
        var versionUrl = base + '/version.json';

        fetchDeployVersion(versionUrl).then(function (deployVersion) {
            var deploySha = deployVersion && deployVersion.commit ? deployVersion.commit : null;
            renderCommitStatus(el, {
                status: deploySha ? 'LIVE' : 'UNKNOWN',
                deploySha: deploySha,
                deployShort: deployVersion && deployVersion.shortCommit ? deployVersion.shortCommit : (deploySha ? deploySha.slice(0, 7) : ''),
                buildTime: deployVersion && deployVersion.buildTime ? deployVersion.buildTime : null,
            });
            addSessionLog('info', 'Commit info loaded', {
                status: deploySha ? 'LIVE' : 'UNKNOWN',
                hasDeployVersion: !!deploySha,
            });
        }).catch(function (err) {
            addSessionLog('error', 'Commit info fetch failed', { message: err && err.message });
            renderCommitStatus(el, {
                status: 'UNKNOWN',
                deploySha: null,
                deployShort: '',
                buildTime: null,
            });
        });
    }

    function helpSheetHtml(title, body) {
        return '' +
            '<div class="site-help-backdrop" data-help-close></div>' +
            '<div class="site-help-panel" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
                '<div class="site-help-head">' +
                    '<strong>' + esc(title) + '</strong>' +
                    '<button type="button" class="icon-btn secondary" data-help-close aria-label="Close help">x</button>' +
                '</div>' +
                '<div class="site-help-body">' + body + '</div>' +
            '</div>';
    }

    function ensureHelpSheet() {
        if (helpSheet) return helpSheet;
        helpSheet = document.createElement('div');
        helpSheet.id = 'site-help-sheet';
        helpSheet.className = 'site-help-sheet';
        helpSheet.hidden = true;
        document.body.appendChild(helpSheet);
        helpSheet.addEventListener('click', function (event) {
            if (event.target && event.target.closest && event.target.closest('[data-help-close]')) {
                closeHelpSheet();
            }
        });
        return helpSheet;
    }

    function openHelpSheet(title, text) {
        var sheet = ensureHelpSheet();
        sheet.innerHTML = helpSheetHtml(title, '<p>' + esc(text) + '</p>');
        sheet.hidden = false;
        document.body.classList.add('has-help-open');
    }

    function closeHelpSheet() {
        var sheet = ensureHelpSheet();
        sheet.hidden = true;
        document.body.classList.remove('has-help-open');
    }

    function pageHelpText(context) {
        if (context.admin) return 'Use the left rail for admin destinations. Hover or focus controls for field definitions.';
        if (context.legal) return 'Use the menu for section links. Theme and utility actions remain in the top bar.';
        return 'Use the left rail for market and pane navigation. Hover or focus short labels for full definitions. Long press on touch devices opens contextual help.';
    }

    function ensureTooltip() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'site-tooltip';
        tooltipEl.className = 'site-tooltip';
        tooltipEl.hidden = true;
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    function hideTooltip() {
        window.clearTimeout(tooltipTimer);
        if (!tooltipEl) return;
        tooltipEl.hidden = true;
        tooltipEl.textContent = '';
    }

    function showTooltipFor(target) {
        if (!target) return;
        var text = String(target.getAttribute('data-help') || '').trim();
        if (!text) return;
        var tooltip = ensureTooltip();
        var label = String(target.getAttribute('data-help-label') || '').trim();
        tooltip.innerHTML = label ? ('<strong>' + esc(label) + '</strong><span>' + esc(text) + '</span>') : ('<span>' + esc(text) + '</span>');
        tooltip.hidden = false;
        var rect = target.getBoundingClientRect();
        var tooltipRect = tooltip.getBoundingClientRect();
        var top = Math.max(12, rect.top + window.scrollY - tooltipRect.height - 10);
        var left = Math.min(window.scrollX + window.innerWidth - tooltipRect.width - 12, Math.max(12, rect.left + window.scrollX));
        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
    }

    function scheduleTooltip(target) {
        hideTooltip();
        tooltipTimer = window.setTimeout(function () {
            showTooltipFor(target);
        }, TOOLTIP_DELAY_MS);
    }

    function closestHelpTarget(node) {
        return node && node.closest ? node.closest('[data-help]') : null;
    }

    function bindTooltipSystem() {
        ensureTooltip();
        ensureHelpSheet();

        document.addEventListener('mouseover', function (event) {
            var target = closestHelpTarget(event.target);
            if (!target || window.matchMedia('(hover: none)').matches) return;
            scheduleTooltip(target);
        });
        document.addEventListener('mouseout', function (event) {
            var target = closestHelpTarget(event.target);
            if (!target) return;
            if (!event.relatedTarget || !target.contains(event.relatedTarget)) hideTooltip();
        });
        document.addEventListener('focusin', function (event) {
            var target = closestHelpTarget(event.target);
            if (target) scheduleTooltip(target);
        });
        document.addEventListener('focusout', function (event) {
            var target = closestHelpTarget(event.target);
            if (!target) return;
            hideTooltip();
        });
        document.addEventListener('touchstart', function (event) {
            var target = closestHelpTarget(event.target);
            window.clearTimeout(longPressTimer);
            if (!target) return;
            longPressTimer = window.setTimeout(function () {
                openHelpSheet(
                    target.getAttribute('data-help-label') || 'Help',
                    target.getAttribute('data-help') || ''
                );
            }, LONG_PRESS_MS);
        }, { passive: true });
        document.addEventListener('touchend', function () {
            window.clearTimeout(longPressTimer);
        }, { passive: true });
        document.addEventListener('touchmove', function () {
            window.clearTimeout(longPressTimer);
        }, { passive: true });
    }

    function setMenuOpen(open) {
        document.body.classList.toggle('is-nav-open', !!open);
        var drawer = document.getElementById('site-menu-drawer');
        if (drawer) drawer.hidden = !open;
    }

    function bindFrameControls(context) {
        var refreshBtn = document.getElementById('refresh-site-btn');
        var helpBtn = document.getElementById('site-help-btn');
        var menuBtn = document.getElementById('site-menu-toggle');
        if (refreshBtn) refreshBtn.addEventListener('click', clearSiteDataAndReload);
        if (helpBtn) {
            helpBtn.addEventListener('click', function () {
                openHelpSheet(currentPageLabel(context), pageHelpText(context));
            });
        }
        if (menuBtn) {
            menuBtn.addEventListener('click', function () {
                setMenuOpen(!document.body.classList.contains('is-nav-open'));
            });
        }
        document.addEventListener('click', function (event) {
            if (event.target && event.target.closest && event.target.closest('[data-menu-close]')) {
                setMenuOpen(false);
            }
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                setMenuOpen(false);
                closeHelpSheet();
                hideTooltip();
            }
        });
    }

    window.addSessionLog = addSessionLog;
    window.getSessionLogEntries = getSessionLogEntries;
    window.clearSessionLog = clearSessionLog;
    window.refreshSystemLogCount = function () { return null; };

    var flushedCount = flushClientLogQueue();
    if (flushedCount > 0) {
        addSessionLog('info', 'Flushed queued client logs', { count: flushedCount });
    }

    addSessionLog('info', 'Frame loaded', {
        sectionApiBase: SECTION_API_BASE,
        systemLogsPublic: false,
    });

    var context = getPageContext();
    buildHeader();
    if (!context.admin) buildPublicTree(context);
    buildLegalDrawer(context);
    buildAdminSidebar(context);
    buildFooter();
    bindTooltipSystem();
    bindFrameControls(context);
    loadCommitInfo();
})();
