(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;
    if (!window.AR.AdminExportsView) return;
    if (!window.AR.AdminExportsRuntime) return;

    var timeUtils = window.AR.time || {};
    var view = window.AR.AdminExportsView;
    var runtime = window.AR.AdminExportsRuntime;
    var pollTimer = null;
    var operationalBundles = Object.create(null);
    var POLL_MS = 5000;
    var sections = {
        canonical: buildSection('canonical', 'canonical', true),
        optimized: buildSection('optimized', 'optimized', true),
        operational: buildSection('operational', 'operational', false)
    };

    function buildSection(key, stream, hasScope) {
        return {
            key: key,
            stream: stream,
            pageSize: 12,
            limit: 12,
            entries: [],
            loaded: false,
            loading: false,
            renderKey: '',
            selection: Object.create(null),
            autoCursorValue: '',
            scopeEl: hasScope ? document.getElementById(key + '-scope') : null,
            sinceCursorEl: document.getElementById(key + '-since-cursor'),
            cursorStateEl: document.getElementById(key + '-cursor-state'),
            useLatestBtn: document.querySelector('[data-action="use-latest-cursor"][data-section="' + key + '"]'),
            payloadsEl: document.getElementById(key + '-payloads'),
            summaryEl: document.getElementById(key + '-summary'),
            historyEl: document.getElementById(key + '-history'),
            loadMoreBtn: document.getElementById(key + '-load-more'),
            selectVisibleBtn: document.getElementById(key + '-select-visible'),
            clearSelectionBtn: document.getElementById(key + '-clear-selection'),
            deleteSelectedBtn: document.getElementById(key + '-delete-selected'),
            jobsEl: document.getElementById(key + '-jobs')
        };
    }

    function asInt(value) {
        var n = Number(value);
        if (!isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
    }

    function currentScope(sectionKey) {
        var section = sections[sectionKey];
        return section && section.scopeEl ? String(section.scopeEl.value || 'all') : 'all';
    }

    function preserveWindowScroll(mutator) {
        var x = window.scrollX || window.pageXOffset || 0;
        var y = window.scrollY || window.pageYOffset || 0;
        mutator();
        window.requestAnimationFrame(function () {
            window.scrollTo(x, y);
        });
    }

    function sectionSelectedIds(sectionKey) {
        var section = sections[sectionKey];
        return Object.keys(section.selection).filter(function (jobId) { return !!section.selection[jobId]; });
    }

    function cleanupSelection(sectionKey, entries) {
        var section = sections[sectionKey];
        var visible = Object.create(null);
        entries.forEach(function (entry) {
            var jobId = entry && entry.job ? String(entry.job.job_id || '') : '';
            if (jobId) visible[jobId] = true;
        });
        Object.keys(section.selection).forEach(function (jobId) {
            if (!visible[jobId]) delete section.selection[jobId];
        });
    }

    function schedulePolling() {
        if (pollTimer) clearTimeout(pollTimer);
        if (Object.keys(sections).some(function (key) { return view.hasPendingEntries(sections[key].entries); })) {
            pollTimer = setTimeout(loadAllSections, POLL_MS);
        } else {
            pollTimer = null;
        }
    }

    async function downloadOperationalBundle(jobId) {
        var bundle = operationalBundles[jobId];
        await runtime.downloadOperationalBundle(bundle, function (current, total) {
            runtime.showMsg('Downloading snapshot part ' + current + ' of ' + total + '...', false);
        });
    }

    function updateCursorState(sectionKey, entries) {
        var cursor;
        var section = sections[sectionKey];
        if (!section.cursorStateEl) return;
        cursor = view.latestCompletedCursorValue(entries);
        section.autoCursorValue = cursor == null ? '' : String(cursor);
        section.cursorStateEl.textContent = section.autoCursorValue ? ('Latest completed cursor: ' + section.autoCursorValue + '.') : 'No completed jobs yet for this scope.';
        if (section.useLatestBtn) section.useLatestBtn.disabled = !section.autoCursorValue || section.loading;
    }

    function renderSection(sectionKey, force) {
        var nextKey;
        var section = sections[sectionKey];
        updateCursorState(sectionKey, section.entries);
        nextKey = view.sectionRenderKey(section.entries);
        if (force || section.renderKey !== nextKey) {
            preserveWindowScroll(function () {
                view.renderSummary(section, section.entries, timeUtils);
                if (sectionKey === 'operational') {
                    operationalBundles = view.renderJobs(sectionKey, section, section.entries, timeUtils);
                } else {
                    view.renderJobs(sectionKey, section, section.entries, timeUtils);
                }
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

    async function loadSection(sectionKey) {
        var entries;
        var payload;
        var section = sections[sectionKey];
        if (!section.loaded) section.jobsEl.innerHTML = '<div class="export-empty">Loading...</div>';
        section.loading = true;
        renderSection(sectionKey, false);
        try {
            payload = await requestJson(
                '/downloads?stream=' + encodeURIComponent(section.stream)
                + '&scope=' + encodeURIComponent(currentScope(sectionKey))
                + '&limit=' + encodeURIComponent(section.limit)
            );
            entries = Array.isArray(payload.jobs) ? payload.jobs : [];
            cleanupSelection(sectionKey, entries);
            section.entries = entries;
            section.loaded = true;
            renderSection(sectionKey, false);
            return entries;
        } finally {
            section.loading = false;
            renderSection(sectionKey, false);
            schedulePolling();
        }
    }

    async function loadAllSections() {
        await Promise.all([
            loadSection('canonical'),
            loadSection('optimized'),
            loadSection('operational')
        ]);
        schedulePolling();
    }

    async function createJob(sectionKey, mode) {
        var body;
        var payload;
        var section = sections[sectionKey];
        body = { stream: section.stream, scope: currentScope(sectionKey), mode: mode };
        if (mode === 'delta' && section.sinceCursorEl) body.since_cursor = asInt(section.sinceCursorEl.value || 0);
        if (section.payloadsEl) body.include_payload_bodies = !!section.payloadsEl.checked;
        payload = await requestJson('/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        showMsg('Download job queued: ' + (payload.job && payload.job.job_id ? payload.job.job_id : 'pending'), false);
        await loadSection(sectionKey);
    }

    async function pollJob(jobId, sectionKey) {
        var payload = await requestJson('/downloads/' + encodeURIComponent(jobId));
        showMsg('Job ' + jobId + ': ' + (payload.job && payload.job.status ? payload.job.status : 'unknown'), false);
        if (sectionKey && sections[sectionKey]) {
            await loadSection(sectionKey);
        } else {
            await loadAllSections();
        }
    }

    async function retryJob(jobId, sectionKey) {
        var payload = await requestJson('/downloads/' + encodeURIComponent(jobId) + '/retry', { method: 'POST' });
        showMsg('Retry requested for ' + jobId + ': ' + (payload.job && payload.job.status ? payload.job.status : 'queued'), false);
        await loadSection(sectionKey);
    }

    function selectVisible(sectionKey) {
        var section = sections[sectionKey];
        section.entries.forEach(function (entry) {
            var job = entry && entry.job ? entry.job : null;
            var jobId = job ? String(job.job_id || '') : '';
            if (jobId && view.isJobSelectable(job)) section.selection[jobId] = true;
        });
        preserveWindowScroll(function () { renderSection(sectionKey, true); });
    }

    function clearSelection(sectionKey) {
        sections[sectionKey].selection = Object.create(null);
        preserveWindowScroll(function () { renderSection(sectionKey, true); });
    }

    async function deleteSelected(sectionKey) {
        var jobIds = sectionSelectedIds(sectionKey);
        var payload;
        if (!jobIds.length) {
            showMsg('Select one or more completed or failed jobs first.', true);
            return;
        }
        if (!confirm('Delete ' + jobIds.length + ' selected export job(s)? This removes their stored files and cannot be undone.')) return;
        payload = await requestJson('/downloads', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_ids: jobIds })
        });
        sections[sectionKey].selection = Object.create(null);
        showMsg('Deleted ' + Number(payload.deleted_job_count || 0) + ' export job(s).', false);
        await loadSection(sectionKey);
    }

    async function loadMoreJobs(sectionKey) {
        var section = sections[sectionKey];
        section.limit = Math.min(250, section.limit + section.pageSize);
        await loadSection(sectionKey);
    }

    function useLatestCursor(sectionKey) {
        var section = sections[sectionKey];
        if (!section.sinceCursorEl || !section.autoCursorValue) {
            showMsg('No completed cursor is available for this scope yet.', true);
            return;
        }
        section.sinceCursorEl.value = section.autoCursorValue;
        showMsg('Filled delta cursor with ' + section.autoCursorValue + '.', false);
    }

    function handleClick(event) {
        var action;
        var createJobSpec;
        var target = event.target;
        if (!target || !target.getAttribute) return;
        createJobSpec = target.getAttribute('data-create-job');
        if (createJobSpec) {
            var createParts = createJobSpec.split(':');
            createJob(createParts[0], createParts[1]).catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to create job.', true); });
            return;
        }
        if (target.getAttribute('data-refresh-section')) {
            loadSection(target.getAttribute('data-refresh-section') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to refresh jobs.', true); });
            return;
        }
        action = target.getAttribute('data-action');
        if (action === 'poll-job') pollJob(target.getAttribute('data-job-id') || '', target.getAttribute('data-section') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to poll job.', true); });
        if (action === 'retry-job') retryJob(target.getAttribute('data-job-id') || '', target.getAttribute('data-section') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to retry job.', true); });
        if (action === 'load-more') loadMoreJobs(target.getAttribute('data-section') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to load older jobs.', true); });
        if (action === 'select-visible') selectVisible(target.getAttribute('data-section') || '');
        if (action === 'clear-selection') clearSelection(target.getAttribute('data-section') || '');
        if (action === 'delete-selected') deleteSelected(target.getAttribute('data-section') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to delete selected jobs.', true); });
        if (action === 'use-latest-cursor') useLatestCursor(target.getAttribute('data-section') || '');
        if (action === 'copy-cursor' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(String(target.getAttribute('data-cursor') || '').trim()).then(function () {
                showMsg('Copied cursor ' + String(target.getAttribute('data-cursor') || '').trim(), false);
            }).catch(function () {
                showMsg('Failed to copy cursor.', true);
            });
        }
        if (action === 'download-artifact') runtime.downloadArtifact(target.getAttribute('data-path') || '', target.getAttribute('data-file-name') || '').catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to download artifact.', true); });
        if (action === 'download-operational-bundle') downloadOperationalBundle(target.getAttribute('data-job-id') || '').then(function () { showMsg('Full operational snapshot download started.', false); }).catch(function (error) { showMsg(error && error.message ? error.message : 'Failed to prepare snapshot bundle.', true); });
    }

    function handleChange(event) {
        var jobId;
        var section;
        var sectionKey;
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-action') !== 'toggle-job-selection') return;
        sectionKey = target.getAttribute('data-section') || '';
        section = sections[sectionKey];
        jobId = String(target.getAttribute('data-job-id') || '').trim();
        if (!section || !jobId) return;
        if (target.checked) section.selection[jobId] = true;
        if (!target.checked) delete section.selection[jobId];
        view.renderHistory(section, section.entries);
    }

    document.body.addEventListener('click', handleClick);
    document.body.addEventListener('change', handleChange);

    ['canonical', 'optimized'].forEach(function (sectionKey) {
        var section = sections[sectionKey];
        if (!section.scopeEl) return;
        section.scopeEl.addEventListener('change', function () {
            section.limit = section.pageSize;
            section.selection = Object.create(null);
            section.renderKey = '';
            loadSection(sectionKey).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to refresh jobs.', true);
            });
        });
    });

    loadAllSections().catch(function (error) {
        showMsg(error && error.message ? error.message : 'Failed to load export jobs.', true);
    });
})();
