(function () {
    'use strict';

    var dom = window.AR.dom;
    var state = window.AR.state;
    var tabs = window.AR.tabs;
    var filters = window.AR.filters;
    var explorer = window.AR.explorer;
    var pivot = window.AR.pivot;
    var charts = window.AR.charts;
    var refresh = window.AR.refresh;
    var exportModule = window.AR.export;
    var rateChanges = window.AR.rateChanges;
    var executiveSummary = window.AR.executiveSummary;
    var hero = window.AR.hero;
    var utils = window.AR.utils || {};
    var network = window.AR.network || {};
    var routeState = (window.AR && window.AR.routeState) || {};
    var clientLog = utils.clientLog || function () {};
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };

    var els = dom && dom.els ? dom.els : {};
    var tabState = state && state.state ? state.state : {};
    var appInitialized = false;
    var liveApplyTimerId = 0;
    var liveApplyDelayMs = 280;
    var liveApplyInProgress = false;
    var startupRetryTimerId = 0;
    var startupRetryAttempts = 0;
    var maxStartupRetryAttempts = 2;
    var startupRetryDelayMs = 3500;
    var hasFiltersReadyOnce = false;
    var hasExplorerReadyOnce = false;

    clientLog('info', 'App init start', {
        section: window.AR.section || 'home-loans',
        activeTab: tabState.activeTab || 'explorer',
    });

    if (routeState.notFound) {
        clientLog('info', 'Skipping app init for not-found route', {
            path: routeState.normalizedPath || window.location.pathname || '/',
        });
        return;
    }

    function setFilterLiveStatus(text, tone) {
        if (!els.filterLiveStatus) return;
        els.filterLiveStatus.textContent = String(text || 'Live sync on');
        els.filterLiveStatus.classList.remove('is-live', 'is-pending', 'is-error');
        if (tone) els.filterLiveStatus.classList.add(String(tone));
    }

    function hideWorkspaceStatus() {
        if (!els.workspaceStatus) return;
        els.workspaceStatus.hidden = true;
        if (els.workspaceStatusRetry) els.workspaceStatusRetry.disabled = false;
    }

    function setWorkspaceStatus(title, message, tone, disableRetry) {
        if (!els.workspaceStatus) return;
        if (els.workspaceStatusTitle) els.workspaceStatusTitle.textContent = String(title || 'Startup degraded');
        if (els.workspaceStatusMessage) els.workspaceStatusMessage.textContent = String(message || 'Some controls are taking longer than expected.');
        els.workspaceStatus.classList.remove('is-warning', 'is-error');
        els.workspaceStatus.classList.add(tone === 'is-error' ? 'is-error' : 'is-warning');
        els.workspaceStatus.hidden = false;
        if (els.workspaceStatusRetry) els.workspaceStatusRetry.disabled = !!disableRetry;
    }

    function clearStartupRetryTimer() {
        if (!startupRetryTimerId) return;
        window.clearTimeout(startupRetryTimerId);
        startupRetryTimerId = 0;
    }

    function showStartupDegraded(message, tone) {
        setFilterLiveStatus('Retry startup', 'is-error');
        setWorkspaceStatus(
            'Startup degraded',
            String(message || 'Some controls are taking longer than expected.'),
            tone === 'is-error' ? 'is-error' : 'is-warning',
            false
        );
    }

    function showStartupRetryPending() {
        setFilterLiveStatus(appInitialized ? 'Retry queued' : 'Retrying startup...', 'is-pending');
        setWorkspaceStatus(
            'Retrying startup',
            'Some controls are taking longer than expected. Retrying automatically.',
            'is-warning',
            false
        );
    }

    function maybeCompleteStartupRecovery() {
        if (!hasFiltersReadyOnce || !hasExplorerReadyOnce) return false;
        clearStartupRetryTimer();
        startupRetryAttempts = 0;
        hideWorkspaceStatus();
        setFilterLiveStatus('Live sync on', 'is-live');
        return true;
    }

    function scheduleStartupRetry(_message) {
        if (startupRetryTimerId) return true;
        if (startupRetryAttempts >= maxStartupRetryAttempts) return false;
        if (hasFiltersReadyOnce && hasExplorerReadyOnce) return false;

        startupRetryAttempts += 1;
        showStartupRetryPending();
        startupRetryTimerId = window.setTimeout(function () {
            startupRetryTimerId = 0;
            retryStartup({ auto: true });
        }, startupRetryDelayMs);
        return true;
    }

    function reloadStartupSurfaces() {
        if (explorer && explorer.reloadExplorer) explorer.reloadExplorer();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (rateChanges && rateChanges.loadRateChanges) rateChanges.loadRateChanges();
        if (executiveSummary && executiveSummary.loadExecutiveSummary && els.executiveSummarySections) {
            executiveSummary.loadExecutiveSummary();
        }
    }

    function handleFilterBootstrapResult(result, successSource, failureSource) {
        var ok = !result || result.ok !== false;
        if (ok) {
            hasFiltersReadyOnce = true;
            if (!appInitialized) finishAppInit(successSource || 'filters-loaded');
            else if (!maybeCompleteStartupRecovery() && startupRetryAttempts > 0 && !hasExplorerReadyOnce) {
                showStartupRetryPending();
            } else if (startupRetryAttempts === 0) {
                hideWorkspaceStatus();
                setFilterLiveStatus('Live sync on', 'is-live');
            }
            return;
        }

        var message = describeError(result.error, 'Filter controls timed out. Rates are still loading with a reduced startup path.');
        if (scheduleStartupRetry(message)) {
            if (!appInitialized) finishAppInit((failureSource || 'filters-load-failed') + '-pending');
            return;
        }
        showStartupDegraded(message, 'is-warning');
        if (!appInitialized) finishAppInit(failureSource || 'filters-load-failed');
    }

    function retryStartup(options) {
        var opts = options || {};
        if (!filters || !filters.loadFilters) return;
        clearStartupRetryTimer();
        setFilterLiveStatus('Retrying startup...', 'is-pending');
        setWorkspaceStatus(
            'Retrying startup',
            opts.auto ? 'Retrying startup automatically...' : 'Refreshing filter controls...',
            'is-warning',
            true
        );
        filters.loadFilters().then(function (result) {
            handleFilterBootstrapResult(result, 'filters-retried', 'filters-retry-failed');
            reloadStartupSurfaces();
        }).catch(function (error) {
            var message = describeError(error, 'Filter controls could not be retried.');
            reloadStartupSurfaces();
            if (!scheduleStartupRetry(message)) {
                showStartupDegraded(message, 'is-error');
            }
        });
    }

    function clearLiveApplyTimer() {
        if (!liveApplyTimerId) return;
        window.clearTimeout(liveApplyTimerId);
        liveApplyTimerId = 0;
    }

    function applyUiMode(mode, options) {
        var opts = options || {};
        var uiMode = String(mode || (state && state.getUiMode ? state.getUiMode() : 'analyst'));
        document.body.classList.toggle('ui-mode-consumer', uiMode !== 'analyst');
        document.body.classList.toggle('ui-mode-analyst', uiMode === 'analyst');

        if (tabs && tabs.applyUiMode) tabs.applyUiMode();
        if (filters && filters.applyUiMode) filters.applyUiMode();
        if (explorer && explorer.applyUiMode) explorer.applyUiMode();

        if (!opts.skipRefresh) {
            if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
            if (filters && filters.syncUrlState) filters.syncUrlState();
            if (filters && filters.markFiltersApplied) filters.markFiltersApplied();
        }
    }

    function scheduleLiveApply(reason) {
        if (!appInitialized) return;
        clearLiveApplyTimer();
        setFilterLiveStatus('Sync queued', 'is-pending');
        liveApplyTimerId = window.setTimeout(function () {
            liveApplyTimerId = 0;
            applyFilters({
                source: 'live',
                reason: reason || 'filters-state',
                passiveValidation: true,
            });
        }, liveApplyDelayMs);
    }

    function applyFilters(options) {
        var opts = options || {};
        clearLiveApplyTimer();
        if (filters && filters.validateInputs && !filters.validateInputs(opts.passiveValidation ? { focusInvalid: false } : undefined)) {
            setFilterLiveStatus('Fix date range', 'is-error');
            clientLog('warn', 'Apply filters blocked by invalid input', {
                section: window.AR.section || 'home-loans',
            });
            return;
        }

        liveApplyInProgress = true;
        setFilterLiveStatus(opts.source === 'live' ? 'Syncing...' : 'Refreshing...', 'is-pending');
        if (filters && filters.syncUrlState) filters.syncUrlState();
        if (filters && filters.markFiltersApplied) filters.markFiltersApplied();
        if (explorer && explorer.reloadExplorer) explorer.reloadExplorer();
        if (hero && hero.loadHeroStats) hero.loadHeroStats();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (pivot && pivot.invalidatePivot) {
            pivot.invalidatePivot({
                message: tabState.activeTab === 'pivot'
                    ? 'Pivot stale. Press Refresh pivot to reload.'
                    : 'Pivot grid queued until you open the Pivot tab.',
            });
        } else if (tabState.pivotLoaded && els.pivotStatus) {
            els.pivotStatus.textContent = 'STALE';
        }
        if (charts && charts.markStale) charts.markStale('STALE');
        if (rateChanges && rateChanges.loadRateChanges) rateChanges.loadRateChanges();
        if (executiveSummary && executiveSummary.loadExecutiveSummary && els.executiveSummarySections) {
            executiveSummary.loadExecutiveSummary();
        }
        window.setTimeout(function () {
            liveApplyInProgress = false;
            setFilterLiveStatus('Live sync on', 'is-live');
        }, opts.source === 'live' ? 220 : 360);
    }

    function applyFiltersShortcut(event) {
        if (!event || event.defaultPrevented) return;
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.shiftKey || event.altKey || event.key !== 'Enter') return;
        if (event.target && String(event.target.tagName || '').toUpperCase() === 'TEXTAREA') return;
        event.preventDefault();
        applyFilters();
    }

    function collapsePanelsByDefault() {
        if (els.filterBar && els.filterBar.tagName === 'DETAILS') els.filterBar.open = false;
        var notes = document.getElementById('notes');
        if (notes && notes.tagName === 'DETAILS') notes.open = false;
    }

    function finishAppInit(source) {
        if (appInitialized) return;
        appInitialized = true;

        applyUiMode(state && state.getUiMode ? state.getUiMode() : 'analyst', { skipRefresh: true });
        if (tabs && tabs.activateTab) tabs.activateTab(tabState.activeTab || 'explorer', { skipHash: false });
        if (explorer && explorer.initRateTable) explorer.initRateTable();
        if (hero && hero.loadHeroStats) hero.loadHeroStats();
        if (hero && hero.loadQuickCompare) hero.loadQuickCompare();
        if (rateChanges && rateChanges.loadRateChanges) rateChanges.loadRateChanges();
        if (executiveSummary && executiveSummary.loadExecutiveSummary && els.executiveSummarySections) {
            executiveSummary.loadExecutiveSummary();
        }
        if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
        var sourceText = String(source || '');
        if (sourceText.indexOf('pending') >= 0) showStartupRetryPending();
        else if (sourceText.indexOf('failed') >= 0) setFilterLiveStatus('Retry startup', 'is-error');
        else setFilterLiveStatus('Live sync on', 'is-live');

        clientLog('info', 'App init complete', {
            activeTab: tabState.activeTab || 'explorer',
            source: source || 'unknown',
        });
    }

    if (els.applyFilters) els.applyFilters.addEventListener('click', applyFilters);
    if (els.workspaceStatusRetry) {
        els.workspaceStatusRetry.addEventListener('click', function () {
            retryStartup();
        });
    }
    if (els.resetFilters) {
        els.resetFilters.addEventListener('click', function (event) {
            if (event) event.preventDefault();
            if (filters && filters.resetFilters) filters.resetFilters();
        });
    }
    if (els.downloadFormat) {
        els.downloadFormat.addEventListener('change', function () {
            var format = String(els.downloadFormat.value || '').trim();
            if (!format) return;
            if (exportModule && exportModule.downloadSelectedFormat) exportModule.downloadSelectedFormat(format);
            else if (exportModule && exportModule.downloadCsv) exportModule.downloadCsv();
        });
    }
    if (els.downloadCsv) {
        els.downloadCsv.addEventListener('click', function () {
            if (exportModule && exportModule.downloadSelectedFormat) exportModule.downloadSelectedFormat('csv');
            else if (exportModule && exportModule.downloadCsv) exportModule.downloadCsv();
        });
    }
    if (els.loadPivot) {
        els.loadPivot.addEventListener('click', function () {
            if (filters && filters.validateInputs && !filters.validateInputs()) return;
            if (pivot && pivot.ensurePivotLoaded) {
                pivot.ensurePivotLoaded({
                    reason: 'manual-refresh',
                    statusMessage: 'Loading default pivot grid...',
                    statusPrefix: 'Loading default pivot grid... ',
                });
            } else if (pivot && pivot.loadPivotData) {
                pivot.loadPivotData({
                    reason: 'manual-refresh',
                    statusMessage: 'Loading default pivot grid...',
                    statusPrefix: 'Loading default pivot grid... ',
                });
            }
        });
    }
    if (els.pivotRepresentation) {
        els.pivotRepresentation.addEventListener('change', function () {
            if (pivot && pivot.invalidatePivot) {
                pivot.invalidatePivot({
                    message: tabState.activeTab === 'pivot'
                        ? 'Pivot stale. Press Refresh pivot to reload.'
                        : 'Pivot grid queued until you open the Pivot tab.',
                });
            }
            if (tabState.activeTab === 'pivot' && pivot && pivot.loadPivotData) {
                pivot.loadPivotData({
                    force: true,
                    reason: 'representation-change',
                    statusMessage: 'Refreshing default pivot grid...',
                    statusPrefix: 'Refreshing default pivot grid... ',
                });
            }
        });
    }
    if (els.drawChart) {
        els.drawChart.addEventListener('click', function () {
            if (filters && filters.validateInputs && !filters.validateInputs()) return;
            if (charts && charts.drawChart) charts.drawChart();
        });
    }
    if (els.filterIncludeManual) {
        els.filterIncludeManual.addEventListener('change', function () {
            if (filters && filters.refreshFilterUiState) filters.refreshFilterUiState();
        });
    }
    if (els.filterMode) {
        els.filterMode.addEventListener('change', function () {
            if (filters && filters.refreshFilterUiState) filters.refreshFilterUiState();
        });
    }
    if (els.refreshInterval) {
        els.refreshInterval.addEventListener('change', function () {
            if (filters && filters.syncUrlState) filters.syncUrlState();
            if (refresh && refresh.setupAutoRefresh) refresh.setupAutoRefresh();
            if (filters && filters.refreshFilterUiState) filters.refreshFilterUiState();
        });
    }

    window.addEventListener('ar:ui-mode-changed', function (event) {
        applyUiMode(event && event.detail ? event.detail.mode : null);
    });
    window.addEventListener('ar:filters-state', function (event) {
        var detail = event && event.detail ? event.detail : {};
        if (!appInitialized) return;
        if (!detail.dirty) {
            if (liveApplyInProgress) return;
            if (!liveApplyTimerId) setFilterLiveStatus('Live sync on', 'is-live');
            return;
        }
        scheduleLiveApply('filters-state');
    });
    window.addEventListener('ar:tab-changed', function (event) {
        var tab = event && event.detail && event.detail.tab;
        if (tab === 'history' && charts) {
            if (!tabState.chartDrawn && charts.drawChart) charts.drawChart();
            else if (charts.refreshFromCache) charts.refreshFromCache('history-tab');
        }
        if (tab === 'pivot' && pivot && pivot.ensurePivotLoaded) {
            pivot.ensurePivotLoaded({ reason: 'pivot-tab-activated' });
        }
    });
    window.addEventListener('ar:theme-changed', function () {
        if (tabState.chartDrawn && charts && charts.drawChart) {
            charts.drawChart();
        }
    });
    window.addEventListener('ar:explorer-state', function (event) {
        var detail = event && event.detail ? event.detail : {};
        if (detail.status === 'ready') {
            hasExplorerReadyOnce = true;
            maybeCompleteStartupRecovery();
            return;
        }
        if (detail.status !== 'error') return;
        if (hasFiltersReadyOnce && hasExplorerReadyOnce) return;
        var message = describeError({ userMessage: detail.message }, 'Live rates table could not be loaded.');
        if (!scheduleStartupRetry(message)) {
            showStartupDegraded(message, 'is-warning');
        }
    });
    document.addEventListener('keydown', applyFiltersShortcut);

    if (tabs && tabs.bindTabListeners) tabs.bindTabListeners();
    collapsePanelsByDefault();
    applyUiMode(state && state.getUiMode ? state.getUiMode() : 'analyst', { skipRefresh: true });

    if (filters && filters.loadFilters) {
        filters.loadFilters().then(function (result) {
            handleFilterBootstrapResult(result, 'filters-loaded', 'filters-load-failed');
        }).catch(function (err) {
            clientLog('error', 'App init failed while loading filters', {
                message: describeError(err, 'Filter controls could not be loaded.'),
            });
            var message = describeError(err, 'Filter controls could not be loaded.');
            if (scheduleStartupRetry(message)) {
                finishAppInit('filters-load-pending');
                return;
            }
            showStartupDegraded(message, 'is-error');
            finishAppInit('filters-load-failed');
        });
    } else {
        finishAppInit('no-filter-module');
    }
})();
