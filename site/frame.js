(function () {
    var GITHUB_REPO = 'yanniedog/AustralianRates';
    var GITHUB_API = 'https://api.github.com/repos/' + GITHUB_REPO + '/commits?per_page=1';
    var sc = (window.AR && window.AR.sectionConfig) ? window.AR.sectionConfig : {};
    var API_BASE = window.location.origin + (sc.apiPath || '/api/home-loan-rates');

    /* ── Session log (client-side buffer for this tab) ─── */
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

    function buildNav() {
        var header = document.querySelector('.site-header');
        if (!header) return;

        var inner = header.querySelector('.site-header-inner');
        if (!inner) return;

        inner.innerHTML =
            '<h1 class="site-brand"><a href="/">AustralianRates</a></h1>' +
            '<nav class="site-nav">' +
                '<a href="https://github.com/' + GITHUB_REPO + '" target="_blank" rel="noopener" class="site-nav-github">' +
                    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' +
                    'GitHub' +
                '</a>' +
            '</nav>';
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
                        '<a href="' + esc(API_BASE + '/logs') + '" id="footer-log-download-system" class="footer-log-popup-item" download>Download system log</a>' +
                        '<button type="button" id="footer-log-download-client" class="footer-log-popup-item">Download client log</button>' +
                    '</div>' +
                '</span>' +
                '<span class="footer-spacer"></span>' +
                '<span>&copy; ' + new Date().getFullYear() + ' AustralianRates</span>' +
            '</div>';
        document.body.appendChild(footer);

        var logLink = document.getElementById('footer-log-link');
        var popup = document.getElementById('footer-log-popup');
        var downloadSystem = document.getElementById('footer-log-download-system');
        var downloadClient = document.getElementById('footer-log-download-client');

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
        document.addEventListener('click', function (e) {
            if (!popup || popup.hidden) return;
            var wrap = document.getElementById('footer-log-info');
            if (wrap && !wrap.contains(e.target)) {
                popup.hidden = true;
            }
        });
        updateLogLinkText();
    }

    function formatDate(iso) {
        try {
            var d = new Date(iso);
            return d.toLocaleString('en-AU', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short'
            });
        } catch (e) {
            return iso;
        }
    }

    function loadCommitInfo() {
        var el = document.getElementById('footer-commit');
        if (!el) return;

        fetch(GITHUB_API, { headers: { Accept: 'application/vnd.github.v3+json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!Array.isArray(data) || data.length === 0) {
                    el.textContent = 'Commit info unavailable';
                    return;
                }
                var commit = data[0];
                var sha = commit.sha.slice(0, 7);
                var date = commit.commit && commit.commit.committer && commit.commit.committer.date;
                var message = commit.commit && commit.commit.message;
                var shortMessage = message ? message.split('\n')[0].slice(0, 60) : '';
                var url = commit.html_url;

                el.innerHTML =
                    'Latest commit: ' +
                    '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(shortMessage) + '">' +
                        esc(sha) +
                    '</a>' +
                    ' &middot; ' + esc(formatDate(date));
            })
            .catch(function () {
                el.textContent = 'Commit info unavailable';
            });
    }

    function loadLogStats() {
        fetch(API_BASE + '/logs/stats')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && typeof data.count === 'number') {
                    _systemLogCount = data.count;
                } else {
                    _systemLogCount = 0;
                }
                updateLogLinkText();
            })
            .catch(function () {
                _systemLogCount = 0;
                updateLogLinkText();
            });
    }

    buildNav();
    buildFooter();
    loadCommitInfo();
    loadLogStats();
})();
