(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal) return;
    if (!window.AR.AdminPortal.getToken()) return;

    var body = document.body;
    var main = document.querySelector('.admin-shell');
    if (!body || !main) return;
    if (document.querySelector('.admin-sidebar')) return;

    var path = (window.location && window.location.pathname) ? window.location.pathname : '';
    var page = path.split('/').filter(Boolean).pop() || 'dashboard.html';
    if (page === 'index.html') return;

    var items = [
        { href: 'dashboard.html', label: 'Dashboard' },
        { href: 'status.html', label: 'Status' },
        { href: 'integrity.html', label: 'Data integrity' },
        { href: 'database.html', label: 'Database' },
        { href: 'exports.html', label: 'Exports' },
        { href: 'clear.html', label: 'Clear data' },
        { href: 'config.html', label: 'Configuration' },
        { href: 'runs.html', label: 'Runs' },
        { href: 'logs.html', label: 'Logs' }
    ];

    function escapeHtml(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    function linkMarkup(item) {
        var active = item.href === page;
        return '<a class="admin-sidebar-link' + (active ? ' is-active' : '') + '" href="' + escapeHtml(item.href) + '">' + escapeHtml(item.label) + '</a>';
    }

    var sidebar = document.createElement('aside');
    sidebar.className = 'admin-sidebar';
    sidebar.setAttribute('aria-label', 'Admin navigation');
    sidebar.innerHTML = ''
        + '<div class="admin-sidebar-head"><strong>Admin menu</strong></div>'
        + '<nav class="admin-sidebar-nav">' + items.map(linkMarkup).join('') + '</nav>'
        + '<div class="admin-sidebar-actions">'
        + '  <a class="admin-sidebar-link" href="../index.html">Public site</a>'
        + '  <button type="button" class="secondary" id="admin-sidebar-logout">Log out</button>'
        + '</div>';

    body.classList.add('has-admin-sidebar');
    body.insertBefore(sidebar, main);

    var logoutBtn = document.getElementById('admin-sidebar-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            window.AR.AdminPortal.logout();
        });
    }
})();
