(function () {
    var GITHUB_REPO = 'yanniedog/AustralianRates';
    var GITHUB_API = 'https://api.github.com/repos/' + GITHUB_REPO + '/commits?per_page=1';
    var API_BASE = window.location.origin + '/api/home-loan-rates';

    function esc(s) {
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
                '<a href="/" class="active">Dashboard</a>' +
                '<a href="/?mode=daily">Daily Rates</a>' +
                '<a href="/?mode=historical">Historical</a>' +
                '<span class="site-nav-spacer"></span>' +
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
                '<span id="footer-log-info">' +
                    '<a href="' + esc(API_BASE + '/logs') + '" class="footer-log-badge" title="Download full log file">' +
                        'Log: <span id="footer-log-count">...</span> entries' +
                    '</a>' +
                '</span>' +
                '<span class="footer-spacer"></span>' +
                '<span>&copy; ' + new Date().getFullYear() + ' AustralianRates</span>' +
            '</div>';
        document.body.appendChild(footer);
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
        var countEl = document.getElementById('footer-log-count');
        if (!countEl) return;

        fetch(API_BASE + '/logs/stats')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && typeof data.count === 'number') {
                    countEl.textContent = data.count.toLocaleString();
                } else {
                    countEl.textContent = '0';
                }
            })
            .catch(function () {
                countEl.textContent = '?';
            });
    }

    buildNav();
    buildFooter();
    loadCommitInfo();
    loadLogStats();
})();
