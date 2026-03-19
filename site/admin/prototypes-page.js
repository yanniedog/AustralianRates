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

    function escapeHtml(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
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

    function renderCard(entry, version) {
        var datasets = Array.isArray(entry.datasets) ? entry.datasets.join(', ') : '';
        var versionMeta = version && version.branch && version.shortCommit && version.commitDate
            ? ('<p class="admin-nav-card-copy"><strong>Latest:</strong> ' + escapeHtml(version.branch) + ' @ ' + escapeHtml(version.shortCommit) + ' · ' + escapeHtml(formatCommitDate(version.commitDate)) + '</p>')
            : '<p class="admin-nav-card-copy">Commit metadata unavailable.</p>';
        return ''
            + '<article class="admin-nav-card">'
            + '  <span class="admin-nav-card-title">' + escapeHtml(entry.title) + '</span>'
            + '  <p class="admin-nav-card-copy">' + escapeHtml(entry.description) + '</p>'
            + '  <p class="admin-nav-card-copy"><strong>Datasets:</strong> ' + escapeHtml(datasets) + '</p>'
            + '  <p class="admin-nav-card-copy"><strong>Status:</strong> ' + escapeHtml(entry.active ? 'Active' : 'Inactive') + '</p>'
            + versionMeta
            + '  <a class="secondary" href="' + escapeHtml(entry.previewUrl) + '">Open preview</a>'
            + '</article>';
    }

    async function render() {
        if (!grid || !status) return;
        if (!registry.length) {
            status.textContent = 'No prototype entries are registered.';
            grid.innerHTML = '';
            return;
        }

        status.textContent = 'Loading prototype metadata…';
        var versions = await Promise.all(registry.map(function (entry) {
            return loadVersion(entry.previewUrl).catch(function () { return null; });
        }));

        grid.innerHTML = registry.map(function (entry, index) {
            return renderCard(entry, versions[index]);
        }).join('');
        status.textContent = 'Prototype catalogue loaded.';
    }

    render().catch(function () {
        if (status) status.textContent = 'Failed to load prototype catalogue.';
        if (grid) grid.innerHTML = '';
    });
})();
