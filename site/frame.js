(function () {
    var GITHUB_REPO = 'yanniedog/AustralianRates';
    var GITHUB_API = 'https://api.github.com/repos/' + GITHUB_REPO + '/commits?per_page=1';
    var sc = (window.AR && window.AR.sectionConfig) ? window.AR.sectionConfig : {};
    var SECTION_API_BASE = window.location.origin + (sc.apiPath || '/api/home-loan-rates');
    var LOG_API_BASE = window.location.origin + '/api/home-loan-rates';
    var utils = (window.AR && window.AR.utils) ? window.AR.utils : {};
    var timeUtils = (window.AR && window.AR.time) ? window.AR.time : {};
    var flushClientLogQueue = (typeof utils.flushClientLogQueue === 'function') ? utils.flushClientLogQueue : function () { return 0; };
    var _secretAdminShortcutBound = false;

    /* Session log (client-side buffer for this tab) */
    var SESSION_LOG_MAX = 500;
    var _sessionLog = [];
    var _systemLogCount = null;

    function addSessionLog(level, message, detail) {
        _sessionLog.push({
            ts: new Date().toISOString(),
            level: level || 'info',
            message: String(message || ''),
            detail: detail
        });
        if (_sessionLog.length > SESSION_LOG_MAX) _sessionLog.shift();
        updateClientLogCount();
    }

    function getSessionLogEntries() {
        return _sessionLog.slice();
    }

    window.addSessionLog = addSessionLog;
    window.getSessionLogEntries = getSessionLogEntries;
    var flushedCount = flushClientLogQueue();
    if (flushedCount > 0) {
        addSessionLog('info', 'Flushed queued client logs', { count: flushedCount });
    }

    function updateClientLogCount() {
        updateLogLinkText();
    }

    function updateLogLinkText() {
        var el = document.getElementById('footer-log-link-text');
        if (!el) return;
        var xx = _systemLogCount != null ? _systemLogCount.toLocaleString() : '...';
        var yy = _sessionLog.length.toLocaleString();
        el.textContent = 'log ' + xx + '/' + yy;
    }

    function downloadClientLog() {
        var entries = getSessionLogEntries();
        var lines = entries.map(function (e) {
            var parts = [e.ts, '[' + (e.level || 'info').toUpperCase() + ']', e.message];
            if (e.detail && typeof e.detail === 'object') parts.push(JSON.stringify(e.detail));
            else if (e.detail != null) parts.push(String(e.detail));
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

    function esc(s) {
        if (window._arEsc) return window._arEsc(s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Clears all site data for this origin: cookies, localStorage, sessionStorage,
     * and Cache API caches, then hard-reloads the page.
     */
    function clearSiteDataAndReload() {
        try {
            var cookies = document.cookie.split(';');
            for (var i = 0; i < cookies.length; i++) {
                var name = cookies[i].split('=')[0].trim();
                if (name) {
                    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;max-age=0';
                }
            }
        } catch (e) { /* ignore */ }
        try {
            if (typeof localStorage !== 'undefined' && localStorage) localStorage.clear();
        } catch (e) { /* ignore */ }
        try {
            if (typeof sessionStorage !== 'undefined' && sessionStorage) sessionStorage.clear();
        } catch (e) { /* ignore */ }
        function doReload() {
            window.location.replace(window.location.pathname + window.location.search + (window.location.search ? '&' : '?') + '_=' + Date.now());
        }
        if (typeof caches !== 'undefined' && caches.keys) {
            caches.keys().then(function (keys) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }).then(doReload).catch(doReload);
        } else {
            doReload();
        }
    }

    function buildNav() {
        var header = document.querySelector('.site-header');
        if (!header) return;

        var inner = header.querySelector('.site-header-inner');
        if (!inner) return;

        inner.innerHTML =
            '<h1 class="site-brand"><a href="/">AustralianRates</a></h1>' +
            '<nav class="site-nav">' +
                '<button type="button" id="theme-toggle" class="site-nav-theme-btn" aria-label="Switch to dark mode" title="Switch to dark mode">' +
                    '<span class="theme-toggle-icon" id="theme-toggle-icon"></span>' +
                '</button>' +
                '<button type="button" id="refresh-site-btn" class="site-nav-refresh-btn" aria-label="Clear cookies and cache and reload" title="Clear cookies, storage and cache for this site, then reload">Refresh</button>' +
                '<a href="https://github.com/' + GITHUB_REPO + '" target="_blank" rel="noopener" class="site-nav-github">' +
                    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' +
                    'GitHub' +
                '</a>' +
            '</nav>';
        bindThemeToggle(inner);
        var refreshBtn = inner.querySelector('#refresh-site-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', clearSiteDataAndReload);
    }

    var THEME_ICON_SUN = '<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
    var THEME_ICON_MOON = '<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

    function bindThemeToggle(headerInner) {
        var btn = headerInner && headerInner.querySelector('#theme-toggle');
        var iconEl = headerInner && headerInner.querySelector('#theme-toggle-icon');
        if (!btn || !iconEl) return;
        function updateIcon() {
            var theme = (window.ARTheme && window.ARTheme.getTheme) ? window.ARTheme.getTheme() : 'light';
            iconEl.innerHTML = theme === 'dark' ? THEME_ICON_SUN : THEME_ICON_MOON;
            btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        }
        updateIcon();
        btn.addEventListener('click', function () {
            if (window.ARTheme && typeof window.ARTheme.toggle === 'function') {
                window.ARTheme.toggle();
                updateIcon();
            }
        });
    }

    function getAdminPortalHref() {
        var path = (typeof window !== 'undefined' && window.location && window.location.pathname)
            ? window.location.pathname
            : '/';
        var markers = ['/savings/', '/term-deposits/'];
        for (var i = 0; i < markers.length; i++) {
            var idx = path.indexOf(markers[i]);
            if (idx >= 0) return path.substring(0, idx) + '/admin/';
        }
        if (path.endsWith('/')) return path + 'admin/';
        return path.replace(/\/[^/]*$/, '/') + 'admin/';
    }

    function getLegalHref(slug) {
        return '/' + String(slug || '').replace(/^\/+|\/+$/g, '') + '/';
    }

    function openAdminPortal(reason) {
        var href = getAdminPortalHref();
        addSessionLog('info', 'Admin portal navigation', { reason: reason || 'unknown', href: href });
        window.location.assign(href);
    }

    function shouldIgnoreShortcutTarget(target) {
        if (!target) return false;
        var tag = target.tagName ? String(target.tagName).toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true;
        return !!target.isContentEditable;
    }

    function bindSecretAdminShortcut() {
        if (_secretAdminShortcutBound) return;
        _secretAdminShortcutBound = true;

        document.addEventListener('keydown', function (e) {
            var key = String(e.key || '').toLowerCase();
            var hasModifiers = e.shiftKey && e.altKey && (e.ctrlKey || e.metaKey);
            if (key !== 'a' || !hasModifiers) return;
            if (shouldIgnoreShortcutTarget(e.target)) return;
            e.preventDefault();
            openAdminPortal('keyboard_shortcut');
        });
    }

    function buildFooter() {
        var existing = document.querySelector('.site-footer');
        if (existing) existing.remove();

        var footer = document.createElement('footer');
        footer.className = 'site-footer';
        footer.innerHTML =
            '<div class="site-footer-inner">' +
                '<span id="footer-commit">Loading commit info...</span>' +
                '<span class="footer-sep">|</span>' +
                '<span id="footer-log-info" class="footer-log-wrap">' +
                    '<a href="#" id="footer-log-link" class="footer-log-badge" title="View log options"><span id="footer-log-link-text">log .../0</span></a>' +
                    '<div id="footer-log-popup" class="footer-log-popup" role="dialog" aria-label="Log download options" hidden>' +
                        '<a href="' + esc(LOG_API_BASE + '/logs') + '" id="footer-log-download-system" class="footer-log-popup-item" download>Download system log</a>' +
                        '<button type="button" id="footer-log-download-client" class="footer-log-popup-item">Download client log</button>' +
                    '</div>' +
                '</span>' +
                '<span class="footer-sep">|</span>' +
                '<span class="footer-legal-links">' +
                    '<a href="' + esc(getLegalHref('about')) + '">About</a>' +
                    '<a href="' + esc(getLegalHref('privacy')) + '">Privacy</a>' +
                    '<a href="' + esc(getLegalHref('terms')) + '">Terms</a>' +
                    '<a href="' + esc(getLegalHref('contact')) + '">Contact</a>' +
                '</span>' +
                '<span class="footer-spacer"></span>' +
                '<span id="footer-copyright">&copy; ' + new Date().getFullYear() + ' <a href="' + esc(getAdminPortalHref()) + '" class="footer-admin-at" title="Admin portal">@</a>AustralianRates</span>' +
            '</div>';
        document.body.appendChild(footer);

        var logLink = document.getElementById('footer-log-link');
        var popup = document.getElementById('footer-log-popup');
        var downloadSystem = document.getElementById('footer-log-download-system');
        var downloadClient = document.getElementById('footer-log-download-client');
        var adminLink = footer.querySelector('.footer-admin-at');
        var copyrightEl = document.getElementById('footer-copyright');

        if (logLink && popup) {
            logLink.addEventListener('click', function (e) {
                e.preventDefault();
                var isOpen = !popup.hidden;
                popup.hidden = isOpen;
                if (!isOpen) {
                    downloadSystem.focus();
                }
            });
        }
        if (downloadClient) {
            downloadClient.addEventListener('click', function () {
                downloadClientLog();
                if (popup) popup.hidden = true;
            });
        }
        if (downloadSystem && popup) {
            downloadSystem.addEventListener('click', function () {
                popup.hidden = true;
            });
        }
        if (adminLink) {
            adminLink.addEventListener('click', function (e) {
                e.preventDefault();
                openAdminPortal('footer_at_link');
            });
        }
        if (copyrightEl) {
            copyrightEl.addEventListener('click', function (e) {
                if (!e.shiftKey || (!e.ctrlKey && !e.metaKey)) return;
                e.preventDefault();
                openAdminPortal('copyright_modifier_click');
            });
        }
        document.addEventListener('click', function (e) {
            if (!popup || popup.hidden) return;
            var wrap = document.getElementById('footer-log-info');
            if (wrap && !wrap.contains(e.target)) {
                popup.hidden = true;
            }
        });
        bindSecretAdminShortcut();
        updateLogLinkText();
    }

    function formatDate(iso) {
        if (timeUtils && typeof timeUtils.formatCheckedAt === 'function') {
            var rendered = timeUtils.formatCheckedAt(iso);
            if (rendered && rendered.text) return rendered.text;
        }
        return String(iso || '');
    }

    function getBadgeClass(status) {
        if (status === 'In sync') return 'footer-version-badge footer-version-sync';
        if (status === 'Behind') return 'footer-version-badge footer-version-behind';
        return 'footer-version-badge footer-version-unknown';
    }

    function renderCommitStatus(el, info) {
        var badge = '<span id="footer-sync-status" class="' + getBadgeClass(info.status) + '">' + esc(info.status) + '</span>';
        var deployText = info.deploySha
            ? '<a href="https://github.com/' + GITHUB_REPO + '/commit/' + esc(info.deploySha) + '" target="_blank" rel="noopener">deploy ' + esc(info.deployShort) + '</a>'
            : 'deploy unknown';
        var latestText = info.latestSha
            ? '<a href="' + esc(info.latestUrl) + '" target="_blank" rel="noopener">latest ' + esc(info.latestShort) + '</a>'
            : 'latest unknown';
        var parts = [badge, deployText, latestText];
        if (info.latestDate) parts.push(esc(formatDate(info.latestDate)));
        if (info.status === 'Behind') parts.push('Refresh to update.');
        if (info.status === 'Unknown') parts.push('Set Pages build to npm run build to show deploy version.');
        el.innerHTML = parts.join(' &middot; ');
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

    function fetchGithubLatestCommit() {
        return fetch(GITHUB_API, { headers: { Accept: 'application/vnd.github.v3+json' } })
            .then(function (r) {
                if (!r.ok) return null;
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

        Promise.all([fetchDeployVersion(versionUrl), fetchGithubLatestCommit()]).then(function (results) {
            var deployVersion = results[0];
            var githubData = results[1];
            var commit = Array.isArray(githubData) && githubData.length > 0 ? githubData[0] : null;
            var latestSha = commit && commit.sha ? commit.sha : null;
            var latestUrl = commit && commit.html_url ? commit.html_url : 'https://github.com/' + GITHUB_REPO + '/commits';
            var latestDate = commit && commit.commit && commit.commit.committer ? commit.commit.committer.date : null;
            var deploySha = deployVersion && deployVersion.commit ? deployVersion.commit : null;
            var status = 'Unknown';
            if (deploySha && latestSha) {
                status = deploySha === latestSha ? 'In sync' : 'Behind';
            }
            renderCommitStatus(el, {
                status: status,
                deploySha: deploySha,
                deployShort: deployVersion && deployVersion.shortCommit ? deployVersion.shortCommit : (deploySha ? deploySha.slice(0, 7) : ''),
                latestSha: latestSha,
                latestShort: latestSha ? latestSha.slice(0, 7) : '',
                latestUrl: latestUrl,
                latestDate: latestDate,
            });
            addSessionLog('info', 'Commit info loaded', {
                status: status,
                hasDeployVersion: !!deploySha,
                hasGithub: !!latestSha,
            });
        }).catch(function (err) {
            addSessionLog('error', 'Commit info fetch failed', { message: err && err.message });
            renderCommitStatus(el, {
                status: 'Unknown',
                deploySha: null,
                deployShort: '',
                latestSha: null,
                latestShort: '',
                latestUrl: 'https://github.com/' + GITHUB_REPO + '/commits',
                latestDate: null,
            });
        });
    }

    function loadLogStats() {
        fetch(LOG_API_BASE + '/logs/stats')
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' for /logs/stats');
                return r.json();
            })
            .then(function (data) {
                if (data && typeof data.count === 'number') {
                    _systemLogCount = data.count;
                    addSessionLog('info', 'System log stats loaded', { count: data.count });
                } else {
                    _systemLogCount = 0;
                    addSessionLog('info', 'System log stats (no count)', { data: !!data });
                }
                updateLogLinkText();
            })
            .catch(function (err) {
                _systemLogCount = 0;
                addSessionLog('warn', 'System log stats fetch failed', { message: err && err.message });
                updateLogLinkText();
            });
    }

    addSessionLog('info', 'Frame loaded', {
        sectionApiBase: SECTION_API_BASE,
        logApiBase: LOG_API_BASE,
    });
    buildNav();
    buildFooter();
    loadCommitInfo();
    loadLogStats();
})();
