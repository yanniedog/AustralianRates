(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;
    if (!window.AR.AdminExportsView || !window.AR.AdminExportsRuntime) return;

    var timeUtils = window.AR.time || {};
    var view = window.AR.AdminExportsView;
    var runtime = window.AR.AdminExportsRuntime;
    var pollTimer = null;
    var POLL_MS = 5000;
    var section = {
        pageSize: 12,
        limit: 12,
        entries: [],
        loaded: false,
        loading: false,
        renderKey: '',
        selection: Object.create(null),
        restoreAnalysis: Object.create(null),
        analysisBusy: Object.create(null),
        restoreBusy: Object.create(null),
        summaryEl: document.getElementById('database-dump-summary'),
        historyEl: document.getElementById('database-dump-history'),
        loadMoreBtn: document.getElementById('database-dump-load-more'),
        selectVisibleBtn: document.getElementById('database-dump-select-visible'),
        clearSelectionBtn: document.getElementById('database-dump-clear-selection'),
        deleteSelectedBtn: document.getElementById('database-dump-delete-selected'),
        jobsEl: document.getElementById('database-dump-jobs')
    };

    function preserveWindowScroll(mutator) {
        var x = window.scrollX || window.pageXOffset || 0;
        var y = window.scrollY || window.pageYOffset || 0;
        mutator();
        window.requestAnimationFrame(function () {
            window.scrollTo(x, y);
        });
    }

    function selectedIds() {
        return Object.keys(section.selection).filter(function (jobId) { return !!section.selection[jobId]; });
    }

    function cleanupSelection(entries) {
        var visible = Object.create(null);
        entries.forEach(function (entry) {
            var jobId = entry && entry.job ? String(entry.job.job_id || '') : '';
            if (jobId) visible[jobId] = true;
        });
        Object.keys(section.selection).forEach(function (jobId) {
            if (!visible[jobId]) delete section.selection[jobId];
        });
        Object.keys(section.restoreAnalysis).forEach(function (jobId) {
            if (!visible[jobId]) delete section.restoreAnalysis[jobId];
        });
        Object.keys(section.analysisBusy).forEach(function (jobId) {
            if (!visible[jobId]) delete section.analysisBusy[jobId];
        });
        Object.keys(section.restoreBusy).forEach(function (jobId) {
            if (!visible[jobId]) delete section.restoreBusy[jobId];
        });
    }

    var BACKGROUND_REFRESH_MS = 30000;
    var backgroundRefreshId = null;

    function schedulePolling() {
        if (pollTimer) clearTimeout(pollTimer);
        if (view.hasPendingEntries(section.entries)) {
            pollTimer = setTimeout(loadSection, POLL_MS);
        } else {
            pollTimer = null;
        }
    }

    function startBackgroundRefresh() {
        if (backgroundRefreshId) return;
        backgroundRefreshId = setInterval(loadSection, BACKGROUND_REFRESH_MS);
    }

    function renderSection(force) {
        var nextKey = view.sectionRenderKey(section.entries);
        if (force || section.renderKey !== nextKey) {
            preserveWindowScroll(function () {
                view.renderSummary(section, section.entries, timeUtils);
                view.renderJobs(section, section.entries, timeUtils);
            });
            section.renderKey = nextKey;
        } else {
            view.renderSummary(section, section.entries, timeUtils);
        }
        view.renderHistory(section, section.entries);
    }

    function requestJson(path, options) {
        return runtime.requestJson(path, options);
    }

    function showMsg(text, isError) {
        runtime.showMsg(text, isError);
    }

    async function loadSection() {
        var payload;
        var entries;
        if (!section.loaded) section.jobsEl.innerHTML = '<div class="export-empty">Loading...</div>';
        section.loading = true;
        renderSection(false);
        try {
            payload = await requestJson('/downloads?stream=operational&limit=' + encodeURIComponent(section.limit));
            entries = Array.isArray(payload.jobs) ? payload.jobs : [];
            cleanupSelection(entries);
            section.entries = entries;
            section.loaded = true;
            renderSection(false);
            startBackgroundRefresh();
            return entries;
        } finally {
            section.loading = false;
            renderSection(false);
            schedulePolling();
        }
    }

    async function createDumpJob() {
        var payload = await requestJson('/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stream: 'operational', scope: 'all', mode: 'snapshot' })
        });
        showMsg('Full dump job queued: ' + (payload.job && payload.job.job_id ? payload.job.job_id : 'pending'), false);
        await loadSection();
    }

    async function pollJob(jobId) {
        var payload = await requestJson('/downloads/' + encodeURIComponent(jobId));
        showMsg('Job ' + jobId + ': ' + (payload.job && payload.job.status ? payload.job.status : 'unknown'), false);
        await loadSection();
    }

    async function retryJob(jobId) {
        var payload = await requestJson('/downloads/' + encodeURIComponent(jobId) + '/retry', { method: 'POST' });
        showMsg('Retry requested for ' + jobId + ': ' + (payload.job && payload.job.status ? payload.job.status : 'queued'), false);
        await loadSection();
    }

    function restoreSummaryText(analysis) {
        var restoreRows = Number(analysis && analysis.impact && analysis.impact.rows_to_restore || 0);
        var removeRows = Number(analysis && analysis.impact && analysis.impact.rows_to_remove || 0);
        return 'rows to restore ' + restoreRows.toLocaleString() + ', rows to remove ' + removeRows.toLocaleString();
    }

    async function analyzeRestore(jobId, suppressMessage) {
        var payload;
        section.analysisBusy[jobId] = true;
        preserveWindowScroll(function () { renderSection(true); });
        try {
            payload = await requestJson('/downloads/' + encodeURIComponent(jobId) + '/restore/analysis');
            section.restoreAnalysis[jobId] = payload.analysis || null;
            if (!suppressMessage && payload.analysis) {
                showMsg((payload.analysis.ready ? 'Restore analysis ready: ' : 'Restore analysis blocked: ') + restoreSummaryText(payload.analysis), !payload.analysis.ready);
            }
            return payload.analysis || null;
        } catch (error) {
            if (error && error.details && error.details.analysis) section.restoreAnalysis[jobId] = error.details.analysis;
            if (!suppressMessage) showMsg(error && error.message ? error.message : 'Failed to analyze restore.', true);
            throw error;
        } finally {
            delete section.analysisBusy[jobId];
            preserveWindowScroll(function () { renderSection(true); });
        }
    }

    async function restoreJob(jobId) {
        var analysis = section.restoreAnalysis[jobId] || await analyzeRestore(jobId, true);
        var payload;
        var prompt;
        if (!analysis || analysis.ready !== true) {
            showMsg('Restore is blocked. Review the latest analysis on this job card.', true);
            return;
        }
        prompt = 'Restore this dump into the current database?\n\n'
            + 'This will overwrite the current D1 state using the selected dump.\n'
            + 'Review summary: ' + restoreSummaryText(analysis);
        if (analysis.requires_force) prompt += '\n\nWarnings were found. Proceed only if you want the dump to replace missing or obsolete data.';
        if (!confirm(prompt)) return;

        section.restoreBusy[jobId] = true;
        preserveWindowScroll(function () { renderSection(true); });
        try {
            payload = await requestJson('/downloads/' + encodeURIComponent(jobId) + '/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true })
            });
            section.restoreAnalysis[jobId] = payload.analysis || null;
            showMsg('Database restore completed. Verified ' + String(payload.restore && payload.restore.verified_tables || 0) + ' table(s).', false);
            await loadSection();
        } catch (error) {
            if (error && error.details && error.details.analysis) section.restoreAnalysis[jobId] = error.details.analysis;
            showMsg(error && error.message ? error.message : 'Failed to restore dump.', true);
            throw error;
        } finally {
            delete section.restoreBusy[jobId];
            preserveWindowScroll(function () { renderSection(true); });
        }
    }

    function selectVisible() {
        section.entries.forEach(function (entry) {
            var job = entry && entry.job ? entry.job : null;
            var jobId = job ? String(job.job_id || '') : '';
            if (jobId && view.isJobSelectable(job)) section.selection[jobId] = true;
        });
        preserveWindowScroll(function () { renderSection(true); });
    }

    function clearSelection() {
        section.selection = Object.create(null);
        preserveWindowScroll(function () { renderSection(true); });
    }

    async function deleteSelected() {
        var jobIds = selectedIds();
        var payload;
        if (!jobIds.length) {
            showMsg('Select one or more completed or failed jobs first.', true);
            return;
        }
        if (!confirm('Delete ' + jobIds.length + ' selected dump job(s)? This removes their stored files and cannot be undone.')) return;
        payload = await requestJson('/downloads', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_ids: jobIds })
        });
        section.selection = Object.create(null);
        showMsg('Deleted ' + Number(payload.deleted_job_count || 0) + ' dump job(s).', false);
        await loadSection();
    }

    async function loadMoreJobs() {
        section.limit = Math.min(250, section.limit + section.pageSize);
        await loadSection();
    }

    var dailyBackupsSection = {
        dates: [],
        loaded: false,
        loading: false,
        summaryEl: document.getElementById('daily-backups-summary'),
        listEl: document.getElementById('daily-backups-list'),
        refreshBtn: document.getElementById('daily-backups-refresh')
    };

    async function loadDailyBackups() {
        if (!dailyBackupsSection.listEl) return;
        dailyBackupsSection.loading = true;
        if (dailyBackupsSection.summaryEl) dailyBackupsSection.summaryEl.textContent = 'Loading...';
        try {
            var payload = await requestJson('/backups/daily?limit=62');
            dailyBackupsSection.dates = Array.isArray(payload.dates) ? payload.dates : [];
            dailyBackupsSection.loaded = true;
            renderDailyBackups();
        } catch (error) {
            if (dailyBackupsSection.summaryEl) dailyBackupsSection.summaryEl.textContent = '';
            dailyBackupsSection.listEl.innerHTML = '<div class="export-empty">Failed to load: ' + (error && error.message ? error.message : 'unknown') + '</div>';
        } finally {
            dailyBackupsSection.loading = false;
        }
    }

    function renderDailyBackups() {
        var dates = dailyBackupsSection.dates;
        var listEl = dailyBackupsSection.listEl;
        var summaryEl = dailyBackupsSection.summaryEl;
        if (!listEl) return;
        if (summaryEl) summaryEl.textContent = dates.length + ' day(s) available.';
        if (!dates.length) {
            listEl.innerHTML = '<div class="export-empty">No daily backups yet. They are created automatically at 09:00 UTC for the previous Melbourne day.</div>';
            return;
        }
        var html = '<ul class="export-job-list-inner">';
        dates.forEach(function (date) {
            var fileName = 'australianrates-daily-' + date + '.sql.gz';
            var downloadPath = '/admin/backups/daily/' + encodeURIComponent(date) + '/download';
            html += '<li class="export-job-item">'
                + '<span class="export-job-date">' + date + '</span>'
                + '<button type="button" class="secondary" data-action="download-daily-backup" data-path="' + downloadPath.replace(/"/g, '&quot;') + '" data-file-name="' + fileName.replace(/"/g, '&quot;') + '">Download</button>'
                + '</li>';
        });
        html += '</ul>';
        listEl.innerHTML = html;
    }

    function handleClick(event) {
        var action;
        var target = event.target;
        if (!target || !target.getAttribute) return;

        if (target.getAttribute('data-action') === 'refresh-daily-backups') {
            loadDailyBackups().catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to load daily backups.', true); });
            return;
        }
        if (target.getAttribute('data-action') === 'create-daily-backup') {
            var dateInput = document.getElementById('daily-backup-date');
            var date = dateInput ? String(dateInput.value || '').trim() : '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                showMsg('Pick a date (YYYY-MM-DD) first.', true);
                return;
            }
            requestJson('/backups/daily', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: date })
            }).then(function (payload) {
                showMsg('Daily backup created for ' + date + '. ' + (payload.backup && payload.backup.byte_size ? 'Size: ' + Math.round(payload.backup.byte_size / 1024) + ' KB' : ''), false);
                return loadDailyBackups();
            }).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to create daily backup.', true);
            });
            return;
        }
        if (target.getAttribute('data-action') === 'download-daily-backup') {
            runtime.downloadFile(target.getAttribute('data-path') || '', target.getAttribute('data-file-name') || '').then(function () {
                showMsg('Daily backup download started.', false);
            }).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to download.', true);
            });
            return;
        }
        if (target.getAttribute('data-create-job') === 'database-dump') {
            createDumpJob().catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to create dump job.', true); });
            return;
        }
        if (target.getAttribute('data-refresh-section') === 'database-dump') {
            loadSection().catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to refresh dump jobs.', true); });
            return;
        }

        action = target.getAttribute('data-action');
        if (action === 'poll-job') pollJob(target.getAttribute('data-job-id') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to poll job.', true); });
        if (action === 'retry-job') retryJob(target.getAttribute('data-job-id') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to retry job.', true); });
        if (action === 'load-more') loadMoreJobs().catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to load older jobs.', true); });
        if (action === 'select-visible') selectVisible();
        if (action === 'clear-selection') clearSelection();
        if (action === 'delete-selected') deleteSelected().catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to delete selected jobs.', true); });
        if (action === 'download-job') runtime.downloadFile(target.getAttribute('data-path') || '', target.getAttribute('data-file-name') || '').then(function () {
            showMsg('Database dump download started.', false);
        }).catch(function (error) {
            showMsg(error && error.message ? error.message : 'Failed to download dump.', true);
        });
        if (action === 'analyze-restore') analyzeRestore(target.getAttribute('data-job-id') || '', false).catch(function () {});
        if (action === 'restore-job') restoreJob(target.getAttribute('data-job-id') || '').catch(function () {});
    }

    function handleChange(event) {
        var jobId;
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-action') !== 'toggle-job-selection') return;
        jobId = String(target.getAttribute('data-job-id') || '').trim();
        if (!jobId) return;
        if (target.checked) section.selection[jobId] = true;
        if (!target.checked) delete section.selection[jobId];
        view.renderHistory(section, section.entries);
    }

    document.body.addEventListener('click', handleClick);
    document.body.addEventListener('change', handleChange);
    document.body.addEventListener('ar:admin-page-unload', function () {
        if (backgroundRefreshId) clearInterval(backgroundRefreshId);
        if (pollTimer) clearTimeout(pollTimer);
    });

    loadSection().catch(function (error) {
        showMsg(error && error.message ? error.message : 'Failed to load dump jobs.', true);
    });
    loadDailyBackups().catch(function (error) {
        showMsg(error && error.message ? error.message : 'Failed to load daily backups.', true);
    });
})();
