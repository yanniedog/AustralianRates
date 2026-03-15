(function () {
    'use strict';
    window.AR = window.AR || {};

    var state = window.AR.state;
    var filters = window.AR.filters;
    var tabs = window.AR.tabs;
    var explorerState = {
        status: 'idle',
        rows: 0,
        total: 0,
        currentPage: 1,
        totalPages: 1,
        message: '',
    };
    var copyResetTimer = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function getFilterSnapshot() {
        if (filters && typeof filters.getStateSnapshot === 'function') {
            return filters.getStateSnapshot();
        }
        return { params: {}, activeCount: 0, dirty: false };
    }

    function getActiveTab() {
        return tabs && typeof tabs.getActiveTab === 'function'
            ? tabs.getActiveTab()
            : 'explorer';
    }

    function updateExplorerOverview() {
        var titleEl = byId('explorer-overview-title');
        var textEl = byId('explorer-overview-text');
        var statusEl = byId('explorer-overview-status');
        var panelEl = byId('panel-explorer');
        if (!titleEl || !textEl || !statusEl) return;

        if (explorerState.status === 'error') {
            titleEl.textContent = 'Rate table unavailable';
            textEl.textContent = explorerState.message || 'The live table could not load right now.';
            statusEl.textContent = 'ERR';
            statusEl.className = 'pill danger';
        } else if (explorerState.status === 'ready' && Number(explorerState.total) === 0) {
            titleEl.textContent = 'No rates match this slice';
            textEl.textContent = 'Broaden the filters to see more rates.';
            statusEl.textContent = '0';
            statusEl.className = 'pill warning';
        } else if (explorerState.status === 'ready') {
            titleEl.textContent = 'Current rate table';
            textEl.textContent = explorerState.total > explorerState.rows
                ? ('Showing ' + explorerState.rows.toLocaleString() + ' of ' + explorerState.total.toLocaleString() + ' rows in the live slice.')
                : ('Showing ' + explorerState.total.toLocaleString() + ' rows in the live slice.');
            statusEl.textContent = 'OK';
            statusEl.className = 'pill positive';
        } else {
            titleEl.textContent = 'Current rate table';
            textEl.textContent = 'Loading the latest rates for the active slice.';
            statusEl.textContent = 'WAIT';
            statusEl.className = 'pill';
        }

        if (panelEl) panelEl.setAttribute('aria-busy', explorerState.status === 'loading' ? 'true' : 'false');
    }

    function copyCurrentLink() {
        var button = byId('workspace-copy-link');
        var text = window.location.href;

        function showCopiedLabel() {
            if (!button) return;
            button.textContent = 'DONE';
            window.clearTimeout(copyResetTimer);
            copyResetTimer = window.setTimeout(function () {
                button.textContent = 'LINK';
            }, 1400);
        }

        function fallbackCopy() {
            var probe = document.createElement('textarea');
            probe.value = text;
            probe.setAttribute('readonly', 'readonly');
            probe.style.position = 'absolute';
            probe.style.left = '-9999px';
            document.body.appendChild(probe);
            probe.select();
            try {
                document.execCommand('copy');
            } catch (_err) {}
            probe.remove();
            showCopiedLabel();
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(showCopiedLabel).catch(fallbackCopy);
            return;
        }
        fallbackCopy();
    }

    function refreshShellState() {
        var dirtyEl = byId('filter-dirty-indicator');
        if (dirtyEl) {
            var snapshot = getFilterSnapshot();
            dirtyEl.textContent = snapshot.dirty ? 'DIRTY' : String(snapshot.activeCount || 0);
            dirtyEl.className = snapshot.dirty ? 'pill warning' : 'pill';
        }
        updateExplorerOverview();
    }

    function focusAnchorFromHash() {
        var hash = String(window.location.hash || '').replace(/^#/, '');
        if (!hash) return;
        var el = document.getElementById(hash);
        if (!el) return;
        if (hash === 'notes' && el.tagName === 'DETAILS') el.open = true;
    }

    function bindActions() {
        var copyLinkBtn = byId('workspace-copy-link');
        if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyCurrentLink);
    }

    window.addEventListener('ar:explorer-state', function (event) {
        explorerState = event && event.detail ? event.detail : explorerState;
        updateExplorerOverview();
    });
    window.addEventListener('ar:filters-state', refreshShellState);
    window.addEventListener('ar:tab-changed', refreshShellState);
    window.addEventListener('hashchange', focusAnchorFromHash);
    window.addEventListener('resize', updateExplorerOverview);

    bindActions();
    window.setTimeout(function () {
        refreshShellState();
        focusAnchorFromHash();
    }, 0);

    window.AR.ux = {
        refresh: refreshShellState,
    };
})();
