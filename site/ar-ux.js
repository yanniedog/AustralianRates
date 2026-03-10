(function () {
    'use strict';
    window.AR = window.AR || {};

    var state = window.AR.state;
    var filters = window.AR.filters;
    var tabs = window.AR.tabs;
    var sectionConfig = window.AR.sectionConfig || {};
    var esc = window._arEsc || function (value) { return String(value == null ? '' : value); };
    var section = window.AR.section || 'home-loans';
    var explorerState = {
        status: 'idle',
        rows: 0,
        total: 0,
        currentPage: 1,
        totalPages: 1,
        message: '',
    };
    var copyResetTimer = null;
    var MOBILE_BREAKPOINT = 760;

    function byId(id) {
        return document.getElementById(id);
    }

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function sectionLabel() {
        if (section === 'savings') return 'Savings';
        if (section === 'term-deposits') return 'Term deposits';
        return 'Home loans';
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

    function getUiMode() {
        return state && typeof state.getUiMode === 'function'
            ? state.getUiMode()
            : 'consumer';
    }

    function getActivePanel() {
        var activeTab = getActiveTab();
        return byId('panel-' + activeTab) || byId('panel-explorer');
    }

    function getDeepAnalysisDrawer() {
        return byId('deep-analysis-drawer');
    }

    function scrollToElement(element) {
        if (!element) return;
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    }

    function countSelectedBanks(params) {
        var raw = String(params && params.banks || '').trim();
        if (!raw) return 0;
        return raw.split(',').filter(Boolean).length;
    }

    function humanizeSortField(field) {
        var labels = sectionConfig.pivotFieldLabels || {};
        if (labels[field]) return labels[field];
        return String(field || 'collection_date')
            .split('_')
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
    }

    function tabLabel() {
        var activeTab = getActiveTab();
        if (activeTab === 'pivot') return 'Pivot';
        if (activeTab === 'charts') return 'Charts';
        return 'Rates';
    }

    function buildSummaryPills(snapshot) {
        var params = snapshot.params || {};
        var pills = [
            '<span class="workspace-summary-pill is-emphasis">' + esc(sectionLabel()) + '</span>',
            '<span class="workspace-summary-pill">' + esc(getUiMode() === 'analyst' ? 'Deep analysis' : 'Shortlist') + '</span>',
            '<span class="workspace-summary-pill">' + esc(tabLabel()) + '</span>',
        ];

        pills.push(
            '<span class="workspace-summary-pill' + (snapshot.dirty ? ' is-warning' : '') + '">' +
                esc(snapshot.activeCount ? snapshot.activeCount + ' active filters' : 'No active filters') +
            '</span>'
        );

        var selectedBanks = countSelectedBanks(params);
        if (selectedBanks > 0) {
            pills.push('<span class="workspace-summary-pill">' + esc(selectedBanks + (selectedBanks === 1 ? ' bank selected' : ' banks selected')) + '</span>');
        }
        if (params.start_date || params.end_date) {
            pills.push('<span class="workspace-summary-pill">' + esc((params.start_date || 'Start') + ' to ' + (params.end_date || 'Today')) + '</span>');
        }
        if (params.include_manual === 'true') {
            pills.push('<span class="workspace-summary-pill">Manual runs included</span>');
        }
        return pills.join('');
    }

    function updateWorkspaceSummary() {
        var titleEl = byId('workspace-summary-title');
        var textEl = byId('workspace-summary-text');
        var pillsEl = byId('workspace-summary-pills');
        if (!titleEl || !textEl || !pillsEl) return;

        var snapshot = getFilterSnapshot();
        var activeTab = getActiveTab();
        var mode = getUiMode();
        var title = 'Your current scenario is ready for a shortlist.';
        var text = 'Start with a bank, rate band, or date range, then refresh the shortlist for the current slice.';

        if (mode === 'analyst' && activeTab === 'charts') {
            title = 'Deep analysis is focused on trend evidence.';
            text = 'Use the chart studio to inspect product_key histories, compare lenders, and keep a shortlist in view.';
        } else if (mode === 'analyst' && activeTab === 'pivot') {
            title = 'Deep analysis is ready for slice-level pivots.';
            text = 'Load pivot data after you define the current slice to reshape the table by lender, structure, term, or date.';
        } else if (mode === 'analyst') {
            title = 'Deep analysis is surfacing the full metadata table.';
            text = 'The rates table now exposes more columns and controls for product-by-product inspection.';
        } else if (snapshot.activeCount > 0) {
            title = 'The shortlist is narrowed to your current slice.';
            text = 'Stay with the shortlist for a quick decision, or open Deep analysis once you want pivots and charts.';
        }

        if (snapshot.dirty) {
            text = 'You have unapplied filter changes. Apply filters to refresh the table, charts, and summary modules.';
        }

        titleEl.textContent = title;
        textEl.textContent = text;
        pillsEl.innerHTML = buildSummaryPills(snapshot);
    }

    function updateExplorerOverview() {
        var titleEl = byId('explorer-overview-title');
        var textEl = byId('explorer-overview-text');
        var statusEl = byId('explorer-overview-status');
        var panelEl = byId('panel-explorer');
        if (!titleEl || !textEl || !statusEl) return;

        var title = 'Loading the current rate table...';
        var text = 'Refreshing rows for the current slice.';
        var status = 'Loading';
        var statusClass = 'is-loading';
        var sort = window.AR.explorer && typeof window.AR.explorer.getCurrentSort === 'function'
            ? window.AR.explorer.getCurrentSort()
            : { field: 'collection_date', dir: 'desc' };
        var sortText = humanizeSortField(sort.field) + ' (' + String(sort.dir || 'desc').toUpperCase() + ')';

        if (explorerState.status === 'error') {
            title = 'The rates table could not be refreshed.';
            text = explorerState.message || 'Check connectivity, then try applying a broader slice.';
            status = 'Issue';
            statusClass = 'is-error';
        } else if (explorerState.status === 'ready' && Number(explorerState.total) === 0) {
            title = 'No matching rates in the current slice.';
            text = 'Broaden the bank, rate, or date filters, then apply again to search a wider set of products.';
            status = 'Empty';
            statusClass = 'is-warning';
        } else if (explorerState.status === 'ready') {
            title = explorerState.total > explorerState.rows
                ? 'Showing ' + explorerState.rows.toLocaleString() + ' of ' + explorerState.total.toLocaleString() + ' matching rates.'
                : 'Showing ' + explorerState.total.toLocaleString() + ' matching rates.';
            text = 'Sorted by ' + sortText + '. ' + (isMobile()
                ? 'Swipe sideways in the table to reveal more columns.'
                : 'Use Table settings in Analysis mode to reveal or hide more metadata.');
            status = 'Live';
            statusClass = 'is-ready';
        }

        titleEl.textContent = title;
        textEl.textContent = text;
        statusEl.className = 'explorer-overview-pill ' + statusClass;
        statusEl.textContent = status;
        if (panelEl) {
            panelEl.setAttribute('aria-busy', explorerState.status === 'loading' ? 'true' : 'false');
        }
    }

    function focusResults() {
        scrollToElement(getActivePanel());
    }

    function focusFilters() {
        var filterPanel = document.querySelector('.scenario-surface .panel-wide') || document.querySelector('.workspace-rail .panel-wide');
        scrollToElement(filterPanel);
        var firstInput = byId('filter-bank-search') || byId('filter-bank');
        if (firstInput && typeof firstInput.focus === 'function') {
            setTimeout(function () { firstInput.focus(); }, 180);
        }
    }

    function openMarketNotes() {
        var notes = byId('market-notes');
        if (notes && notes.tagName === 'DETAILS') notes.open = true;
        scrollToElement(notes);
    }

    function openCharts() {
        var drawer = getDeepAnalysisDrawer();
        if (drawer) drawer.open = true;
        if (state && typeof state.setUiMode === 'function') state.setUiMode('analyst');
        if (tabs && typeof tabs.activateTab === 'function') tabs.activateTab('charts');
        setTimeout(focusResults, 120);
    }

    function copyCurrentLink() {
        var button = byId('workspace-copy-link');
        var text = window.location.href;

        function showCopiedLabel() {
            if (!button) return;
            button.textContent = 'Copied link';
            window.clearTimeout(copyResetTimer);
            copyResetTimer = window.setTimeout(function () {
                button.textContent = 'Copy current view';
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

    function bindActions() {
        var jumpRates = byId('hero-jump-rates');
        var openChartsBtn = byId('hero-open-charts');
        var openNotesBtn = byId('hero-open-notes');
        var copyLinkBtn = byId('workspace-copy-link');
        var focusFiltersBtn = byId('workspace-focus-filters');

        if (jumpRates) jumpRates.addEventListener('click', focusResults);
        if (openChartsBtn) openChartsBtn.addEventListener('click', openCharts);
        if (openNotesBtn) openNotesBtn.addEventListener('click', openMarketNotes);
        if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyCurrentLink);
        if (focusFiltersBtn) focusFiltersBtn.addEventListener('click', focusFilters);
    }

    function refreshAll() {
        updateWorkspaceSummary();
        updateExplorerOverview();
    }

    window.addEventListener('ar:explorer-state', function (event) {
        explorerState = event && event.detail ? event.detail : explorerState;
        updateExplorerOverview();
    });
    window.addEventListener('ar:filters-state', updateWorkspaceSummary);
    window.addEventListener('ar:tab-changed', refreshAll);
    window.addEventListener('ar:ui-mode-changed', refreshAll);
    window.addEventListener('resize', updateExplorerOverview);

    bindActions();
    window.setTimeout(refreshAll, 0);
    window.setTimeout(refreshAll, 700);

    window.AR.ux = {
        refresh: refreshAll,
    };
})();
