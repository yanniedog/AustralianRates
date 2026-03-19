(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var grid = document.getElementById('prototype-grid');
    var status = document.getElementById('prototype-status');
    var logoutBtn = document.getElementById('logout-btn');
    var registry = window.ARPrototypeRegistry && Array.isArray(window.ARPrototypeRegistry.entries)
        ? window.ARPrototypeRegistry.entries
        : [];

    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            window.AR.AdminPortal.logout();
        });
    }

    function formatCommitDate(value) {
        if (!value) return '';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleString('en-AU', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
    }

    function versionUrlFor(previewUrl) {
        return new URL('/version.json', previewUrl).href;
    }

    async function loadVersion(previewUrl) {
        var response = await fetch(versionUrlFor(previewUrl), { method: 'GET' });
        if (!response.ok) throw new Error('version fetch failed');
        return response.json();
    }

    function appendCopy(parent, text) {
        var p = document.createElement('p');
        p.className = 'admin-nav-card-copy';
        p.textContent = text == null ? '' : String(text);
        parent.appendChild(p);
    }

    function buildCardElement(entry, version) {
        var article = document.createElement('article');
        article.className = 'admin-nav-card';

        var title = document.createElement('span');
        title.className = 'admin-nav-card-title';
        title.textContent = entry.title == null ? '' : String(entry.title);
        article.appendChild(title);

        appendCopy(article, entry.description);

        var datasets = Array.isArray(entry.datasets) ? entry.datasets.join(', ') : '';
        appendCopy(article, 'Datasets: ' + datasets);

        appendCopy(article, 'Status: ' + (entry.active ? 'Active' : 'Inactive'));

        if (version && version.branch && version.shortCommit && version.commitDate) {
            appendCopy(article, 'Latest: ' + version.branch + ' @ ' + version.shortCommit + ' · ' + formatCommitDate(version.commitDate));
        } else {
            appendCopy(article, 'Commit metadata unavailable.');
        }

        var link = document.createElement('a');
        link.className = 'secondary';
        link.href = entry.previewUrl == null ? '#' : String(entry.previewUrl);
        link.textContent = 'Open preview';
        article.appendChild(link);

        return article;
    }

    async function render() {
        if (!grid || !status) return;
        if (!registry.length) {
            status.textContent = 'No prototype entries are registered.';
            grid.replaceChildren();
            return;
        }

        status.textContent = 'Loading prototype metadata…';
        var versions = await Promise.all(registry.map(function (entry) {
            return loadVersion(entry.previewUrl).catch(function () { return null; });
        }));

        grid.replaceChildren();
        for (var i = 0; i < registry.length; i++) {
            grid.appendChild(buildCardElement(registry[i], versions[i]));
        }
        status.textContent = 'Prototype catalogue loaded.';
    }

    render().catch(function () {
        if (status) status.textContent = 'Failed to load prototype catalogue.';
        if (grid) grid.replaceChildren();
    });
})();
