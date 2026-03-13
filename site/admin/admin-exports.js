(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;

    var portal = window.AR.AdminPortal;
    var timeUtils = window.AR.time || {};
    var msgEl = document.getElementById('exports-msg');
    var operationalBundles = Object.create(null);
    var pollTimer = null;
    var msgTimer = null;
    var POLL_MS = 5000;
    var sections = {
        canonical: {
            stream: 'canonical',
            pageSize: 12,
            limit: 12,
            entries: [],
            loaded: false,
            loading: false,
            renderKey: '',
            selection: Object.create(null),
            autoCursorValue: '',
            scopeEl: document.getElementById('canonical-scope'),
            sinceCursorEl: document.getElementById('canonical-since-cursor'),
            cursorStateEl: document.getElementById('canonical-cursor-state'),
            payloadsEl: document.getElementById('canonical-payloads'),
            summaryEl: document.getElementById('canonical-summary'),
            historyEl: document.getElementById('canonical-history'),
            loadMoreBtn: document.getElementById('canonical-load-more'),
            selectVisibleBtn: document.getElementById('canonical-select-visible'),
            clearSelectionBtn: document.getElementById('canonical-clear-selection'),
            deleteSelectedBtn: document.getElementById('canonical-delete-selected'),
            jobsEl: document.getElementById('canonical-jobs')
        },
        optimized: {
            stream: 'optimized',
            pageSize: 12,
            limit: 12,
            entries: [],
            loaded: false,
            loading: false,
            renderKey: '',
            selection: Object.create(null),
            autoCursorValue: '',
            scopeEl: document.getElementById('optimized-scope'),
            sinceCursorEl: document.getElementById('optimized-since-cursor'),
            cursorStateEl: document.getElementById('optimized-cursor-state'),
            payloadsEl: null,
            summaryEl: document.getElementById('optimized-summary'),
            historyEl: document.getElementById('optimized-history'),
            loadMoreBtn: document.getElementById('optimized-load-more'),
            selectVisibleBtn: document.getElementById('optimized-select-visible'),
            clearSelectionBtn: document.getElementById('optimized-clear-selection'),
            deleteSelectedBtn: document.getElementById('optimized-delete-selected'),
            jobsEl: document.getElementById('optimized-jobs')
        },
        operational: {
            stream: 'operational',
            pageSize: 12,
            limit: 12,
            entries: [],
            loaded: false,
            loading: false,
            renderKey: '',
            selection: Object.create(null),
            autoCursorValue: '',
            scopeEl: null,
            sinceCursorEl: null,
            cursorStateEl: null,
            payloadsEl: null,
            summaryEl: document.getElementById('operational-summary'),
            historyEl: document.getElementById('operational-history'),
            loadMoreBtn: document.getElementById('operational-load-more'),
            selectVisibleBtn: document.getElementById('operational-select-visible'),
            clearSelectionBtn: document.getElementById('operational-clear-selection'),
            deleteSelectedBtn: document.getElementById('operational-delete-selected'),
            jobsEl: document.getElementById('operational-jobs')
        }
    };

    function escapeHtml(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    function showMsg(text, isError) {
        if (!msgEl) return;
        if (msgTimer) clearTimeout(msgTimer);
        var normalized = String(text || '').trim();
        if (isError && normalized && normalized.indexOf('Error:') !== 0) {
            normalized = 'Error: ' + normalized;
        }
        msgEl.textContent = normalized;
        msgEl.className = 'admin-message visible ' + (isError ? 'error' : 'success');
        msgTimer = setTimeout(function () {
            msgEl.classList.remove('visible');
        }, 5000);
    }

    function formatTimestamp(value) {
        if (!value) return '--';
        if (!timeUtils.formatCheckedAt) return String(value);
        return timeUtils.formatCheckedAt(value).text || String(value);
    }

    function formatInteger(value) {
        var n = Number(value);
        if (!isFinite(n)) return '--';
        return Math.floor(n).toLocaleString();
    }

    function formatByteSize(value) {
        var bytes = Number(value);
        if (!isFinite(bytes) || bytes < 0) return '--';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var unitIndex = 0;
        while (bytes >= 1024 && unitIndex < units.length - 1) {
            bytes /= 1024;
            unitIndex += 1;
        }
        var digits = bytes >= 100 || unitIndex === 0 ? 0 : bytes >= 10 ? 1 : 2;
        return bytes.toFixed(digits).replace(/\.0+$/, '') + ' ' + units[unitIndex];
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

    function hasPendingEntries(entries) {
        return entries.some(function (entry) {
            var status = entry && entry.job ? String(entry.job.status || '') : '';
            return status === 'queued' || status === 'processing';
        });
    }

    function schedulePolling() {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
        var pending = Object.keys(sections).some(function (sectionKey) {
            return hasPendingEntries(sections[sectionKey].entries);
        });
        if (pending) {
            pollTimer = setTimeout(loadAllSections, POLL_MS);
        }
    }

    function isJobSelectable(job) {
        var status = String(job && job.status || '');
        return status === 'completed' || status === 'failed';
    }

    function sectionSelectedIds(sectionKey) {
        var section = sections[sectionKey];
        if (!section) return [];
        return Object.keys(section.selection).filter(function (jobId) {
            return !!section.selection[jobId];
        });
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

    function selectedVisibleCount(sectionKey, entries) {
        var section = sections[sectionKey];
        return entries.reduce(function (count, entry) {
            var job = entry && entry.job ? entry.job : null;
            var jobId = job ? String(job.job_id || '') : '';
            return count + (jobId && section.selection[jobId] ? 1 : 0);
        }, 0);
    }

    function sectionRenderKey(entries) {
        return JSON.stringify(entries.map(function (entry) {
            var job = entry && entry.job ? entry.job : {};
            var artifacts = Array.isArray(entry && entry.artifacts) ? entry.artifacts : [];
            return {
                job_id: job.job_id || '',
                status: job.status || '',
                started_at: job.started_at || '',
                completed_at: job.completed_at || '',
                error_message: job.error_message || '',
                end_cursor: job.end_cursor == null ? null : job.end_cursor,
                download_path: entry && entry.download_path ? entry.download_path : '',
                download_file_name: entry && entry.download_file_name ? entry.download_file_name : '',
                artifacts: artifacts.map(function (artifact) {
                    return [
                        artifact.artifact_id || '',
                        artifact.artifact_kind || '',
                        artifact.file_name || '',
                        artifact.row_count == null ? '' : artifact.row_count,
                        artifact.byte_size == null ? '' : artifact.byte_size,
                        artifact.cursor_start == null ? '' : artifact.cursor_start,
                        artifact.cursor_end == null ? '' : artifact.cursor_end,
                        artifact.created_at || '',
                        artifact.download_path || ''
                    ].join('|');
                })
            };
        }));
    }

    async function requestJson(path, options) {
        var response = await portal.fetchAdmin(path, options);
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload || payload.ok !== true) {
            throw new Error(payload && payload.error && payload.error.message ? payload.error.message : ('Request failed (' + response.status + ')'));
        }
        return payload;
    }

    function triggerBlobDownload(blob, filename) {
        var href = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
    }

    async function downloadArtifact(path, fileName) {
        var response = await fetch(portal.apiBase() + path, {
            cache: 'no-store',
            headers: portal.authHeaders()
        });
        if (!response.ok) throw new Error('Download failed (' + response.status + ')');
        var blob = await response.blob();
        triggerBlobDownload(blob, fileName || 'admin-download.jsonl.gz');
    }

    function operationalBundleParts(artifacts) {
        return artifacts
            .filter(function (artifact) {
                var kind = String(artifact && artifact.artifact_kind || '');
                return kind === 'main' || kind === 'manifest';
            })
            .slice()
            .sort(function (left, right) {
                var leftManifest = String(left && left.artifact_kind || '') === 'manifest';
                var rightManifest = String(right && right.artifact_kind || '') === 'manifest';
                if (leftManifest || rightManifest) {
                    if (leftManifest && rightManifest) return String(left.file_name || '').localeCompare(String(right.file_name || ''));
                    return leftManifest ? 1 : -1;
                }
                return String(left && left.file_name || '').localeCompare(String(right && right.file_name || ''));
            });
    }

    async function downloadOperationalBundle(jobId) {
        var bundle = operationalBundles[jobId];
        if (!bundle) throw new Error('Operational snapshot bundle is not available.');
        if (bundle.downloadPath) {
            await downloadArtifact(bundle.downloadPath, bundle.fileName);
            return;
        }
        if (!bundle.parts || !bundle.parts.length) {
            throw new Error('Operational snapshot parts are not available.');
        }

        var blobs = [];
        for (var i = 0; i < bundle.parts.length; i += 1) {
            var part = bundle.parts[i];
            showMsg('Downloading snapshot part ' + (i + 1) + ' of ' + bundle.parts.length + '...', false);
            var response = await fetch(portal.apiBase() + String(part.download_path || ''), {
                cache: 'no-store',
                headers: portal.authHeaders()
            });
            if (!response.ok) {
                throw new Error('Snapshot part ' + (i + 1) + ' of ' + bundle.parts.length + ' failed (' + response.status + ').');
            }
            blobs.push(await response.blob());
        }

        triggerBlobDownload(new Blob(blobs, { type: 'application/gzip' }), bundle.fileName || 'operational-all-snapshot.jsonl.gz');
    }

    function latestCompletedCursorValue(entries) {
        for (var i = 0; i < entries.length; i += 1) {
            var job = entries[i] && entries[i].job ? entries[i].job : null;
            var value = Number(job && job.end_cursor);
            if (job && job.status === 'completed' && isFinite(value) && value >= 0) {
                return Math.floor(value);
            }
        }
        return null;
    }

    function syncSinceCursor(sectionKey, entries) {
        var section = sections[sectionKey];
        if (!section || !section.sinceCursorEl || !section.cursorStateEl) return;

        var latest = latestCompletedCursorValue(entries);
        section.cursorStateEl.textContent = latest == null
            ? 'No completed cursor in this scope yet.'
            : ('Latest completed end cursor: ' + formatInteger(latest) + '.');

        var current = String(section.sinceCursorEl.value || '').trim();
        var autoValue = String(section.autoCursorValue || '');
        var nextAutoValue = latest == null ? '' : String(latest);
        if (!current || current === autoValue) {
            section.sinceCursorEl.value = nextAutoValue;
        }
        section.autoCursorValue = nextAutoValue;
    }

    function useLatestCursor(sectionKey) {
        var section = sections[sectionKey];
        if (!section || !section.sinceCursorEl) return;
        var latest = latestCompletedCursorValue(section.entries);
        if (latest == null) {
            showMsg('No completed cursor is available for this stream and scope yet.', true);
            return;
        }
        section.sinceCursorEl.value = String(latest);
        section.autoCursorValue = String(latest);
        showMsg('Using latest completed cursor ' + formatInteger(latest) + ' for the next delta job.', false);
    }

    function renderSummary(sectionKey, entries) {
        var section = sections[sectionKey];
        var latest = entries[0] || null;
        var latestCompletedCursor = latestCompletedCursorValue(entries);
        var cells = [
            { label: 'Latest completed cursor', value: latestCompletedCursor == null ? '--' : formatInteger(latestCompletedCursor) },
            { label: 'Jobs shown', value: entries.length },
            { label: 'Latest status', value: latest && latest.job ? latest.job.status : '--' },
            { label: 'Latest requested', value: latest && latest.job ? formatTimestamp(latest.job.requested_at) : '--' },
            { label: 'Latest completed', value: latest && latest.job ? formatTimestamp(latest.job.completed_at) : '--' }
        ];
        section.summaryEl.innerHTML = cells.map(function (cell) {
            return '<div class="summary-cell"><div class="label">' + escapeHtml(cell.label) + '</div><div class="value">' + escapeHtml(cell.value) + '</div></div>';
        }).join('');
    }

    function updateSectionHistory(sectionKey, entries) {
        var section = sections[sectionKey];
        var selectedCount = selectedVisibleCount(sectionKey, entries);
        var pending = hasPendingEntries(entries);
        var text = entries.length
            ? ('Showing ' + entries.length + ' recent jobs'
                + (selectedCount ? ' | ' + selectedCount + ' selected' : '')
                + (pending ? ' | Auto-refresh every 5s' : '')
                + (section.loading ? ' | Refreshing...' : ''))
            : (section.loading ? 'Loading recent jobs...' : 'No jobs loaded yet.');
        section.historyEl.textContent = text;
        section.loadMoreBtn.disabled = section.loading || entries.length < section.limit || section.limit >= 250;
        section.selectVisibleBtn.disabled = section.loading || !entries.some(function (entry) { return isJobSelectable(entry.job); });
        section.clearSelectionBtn.disabled = section.loading || selectedCount === 0;
        section.deleteSelectedBtn.disabled = section.loading || selectedCount === 0;
        section.deleteSelectedBtn.textContent = selectedCount ? ('Delete selected (' + selectedCount + ')') : 'Delete selected';
    }

    function artifactKindLabel(kind) {
        if (kind === 'payload_bodies') return 'Payload bodies';
        if (kind === 'manifest') return 'Manifest';
        return 'Main';
    }

    function artifactCursorRangeText(artifact) {
        var hasStart = artifact && artifact.cursor_start != null && isFinite(Number(artifact.cursor_start));
        var hasEnd = artifact && artifact.cursor_end != null && isFinite(Number(artifact.cursor_end));
        if (!hasStart && !hasEnd) return 'Cursor range: --';
        if (hasStart && hasEnd) {
            return 'Cursor range: ' + formatInteger(artifact.cursor_start) + ' -> ' + formatInteger(artifact.cursor_end);
        }
        if (hasStart) return 'Cursor start: ' + formatInteger(artifact.cursor_start);
        return 'Cursor end: ' + formatInteger(artifact.cursor_end);
    }

    function renderArtifactCard(artifact) {
        var label = artifact.file_name || (artifactKindLabel(String(artifact.artifact_kind || 'main')) + ' artifact');
        var stats = [
            'Kind: ' + artifactKindLabel(String(artifact.artifact_kind || 'main')),
            'Rows: ' + (artifact.row_count == null ? '--' : formatInteger(artifact.row_count)),
            'Size: ' + formatByteSize(artifact.byte_size),
            artifactCursorRangeText(artifact)
        ];
        return ''
            + '<div class="export-artifact">'
            + '  <div class="export-artifact-meta">'
            + '    <div class="export-artifact-label">' + escapeHtml(label) + '</div>'
            + '    <div class="export-artifact-stats">' + stats.map(function (stat) {
                return '<span>' + escapeHtml(stat) + '</span>';
            }).join('') + '</div>'
            + '  </div>'
            + (artifact.download_path
                ? ('<button type="button" class="secondary" data-action="download-artifact"'
                    + ' data-path="' + escapeHtml(artifact.download_path || '') + '"'
                    + ' data-file-name="' + escapeHtml(artifact.file_name || '') + '">Download</button>')
                : '<span class="export-empty">Pending</span>')
            + '</div>';
    }

    function renderArtifacts(sectionKey, job, artifacts) {
        if (artifacts.length) return artifacts.map(renderArtifactCard).join('');
        if (sectionKey === 'operational' && job && (job.status === 'queued' || job.status === 'processing')) {
            return '<span class="export-empty">Snapshot parts will appear when the job completes.</span>';
        }
        return '<span class="export-empty">No artifacts yet.</span>';
    }

    function buildOperationalBundle(entry, job, artifacts) {
        if (!job || !job.job_id) return null;
        var parts = operationalBundleParts(artifacts);
        if (!entry.download_path && !parts.length) return null;
        var bundle = {
            fileName: entry.download_file_name || 'operational-all-snapshot.jsonl.gz',
            downloadPath: entry.download_path || '',
            parts: parts
        };
        operationalBundles[job.job_id] = bundle;
        return bundle;
    }

    function renderJobActions(sectionKey, job, bundle) {
        var actions = [
            '<button type="button" class="secondary" data-action="poll-job" data-section="' + escapeHtml(sectionKey) + '" data-job-id="' + escapeHtml(job.job_id || '') + '">Poll</button>'
        ];
        if (job && job.status === 'failed') {
            actions.push('<button type="button" class="secondary" data-action="retry-job" data-section="' + escapeHtml(sectionKey) + '" data-job-id="' + escapeHtml(job.job_id || '') + '">Retry</button>');
        }
        if (job && job.end_cursor != null) {
            actions.push('<button type="button" class="secondary" data-action="copy-cursor" data-cursor="' + escapeHtml(job.end_cursor) + '">Copy cursor</button>');
        }
        if (sectionKey === 'operational' && bundle) {
            actions.push('<button type="button" class="secondary" data-action="download-operational-bundle" data-job-id="' + escapeHtml(job.job_id || '') + '">Download full snapshot</button>');
        }
        return actions.join('');
    }

    function renderJobMeta(job) {
        var payloadsText = job && job.stream === 'canonical'
            ? (' | Payload bodies: ' + (Number(job.include_payload_bodies || 0) === 1 ? 'included' : 'excluded'))
            : '';
        return ''
            + 'Mode: ' + escapeHtml(job.mode || '--') + ' | Scope: ' + escapeHtml(job.scope || '--') + payloadsText + ' | Requested: ' + escapeHtml(formatTimestamp(job.requested_at)) + '<br>'
            + 'Started: ' + escapeHtml(formatTimestamp(job.started_at)) + ' | Completed: ' + escapeHtml(formatTimestamp(job.completed_at)) + '<br>'
            + 'Since cursor: ' + escapeHtml(job.since_cursor == null ? '--' : formatInteger(job.since_cursor)) + ' | End cursor: ' + escapeHtml(job.end_cursor == null ? '--' : formatInteger(job.end_cursor))
            + (job.error_message ? '<br>Error: ' + escapeHtml(job.error_message) : '');
    }

    function renderJobs(sectionKey, entries) {
        var section = sections[sectionKey];
        if (sectionKey === 'operational') {
            operationalBundles = Object.create(null);
        }
        if (!entries.length) {
            section.jobsEl.innerHTML = '<div class="export-empty">No jobs yet for this stream and scope.</div>';
            return;
        }
        section.jobsEl.innerHTML = entries.map(function (entry) {
            var job = entry.job || {};
            var artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
            var bundle = sectionKey === 'operational' ? buildOperationalBundle(entry, job, artifacts) : null;
            var jobId = String(job.job_id || '');
            var selectable = isJobSelectable(job);
            var checked = !!section.selection[jobId];
            return ''
                + '<div class="export-job">'
                + '  <div class="export-job-head"><strong>' + escapeHtml(job.job_id || '') + '</strong><span>' + escapeHtml(job.status || '') + '</span></div>'
                + '  <label class="export-job-select"><input type="checkbox" data-action="toggle-job-selection" data-section="' + escapeHtml(sectionKey) + '" data-job-id="' + escapeHtml(jobId) + '"' + (checked ? ' checked' : '') + (selectable ? '' : ' disabled') + '> Select</label>'
                + '  <div class="export-job-meta">' + renderJobMeta(job) + '</div>'
                + '  <div class="export-job-actions">' + renderJobActions(sectionKey, job, bundle) + '</div>'
                + '  <div class="export-artifacts">' + renderArtifacts(sectionKey, job, artifacts) + '</div>'
                + '</div>';
        }).join('');
    }

    async function loadSection(sectionKey) {
        var section = sections[sectionKey];
        if (!section.loaded) {
            section.jobsEl.innerHTML = '<div class="export-empty">Loading...</div>';
        }
        section.loading = true;
        updateSectionHistory(sectionKey, section.entries);
        try {
            var payload = await requestJson(
                '/downloads?stream=' + encodeURIComponent(section.stream)
                + '&scope=' + encodeURIComponent(currentScope(sectionKey))
                + '&limit=' + encodeURIComponent(section.limit)
            );
            var entries = Array.isArray(payload.jobs) ? payload.jobs : [];
            cleanupSelection(sectionKey, entries);
            section.entries = entries;
            syncSinceCursor(sectionKey, entries);
            var nextKey = sectionRenderKey(entries);
            var shouldRender = !section.loaded || section.renderKey !== nextKey;
            section.renderKey = nextKey;
            if (shouldRender) {
                preserveWindowScroll(function () {
                    renderSummary(sectionKey, entries);
                    renderJobs(sectionKey, entries);
                });
            }
            section.loaded = true;
            return entries;
        } finally {
            section.loading = false;
            updateSectionHistory(sectionKey, section.entries);
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
        var section = sections[sectionKey];
        var body = {
            stream: section.stream,
            scope: currentScope(sectionKey),
            mode: mode
        };
        if (mode === 'delta' && section.sinceCursorEl) {
            body.since_cursor = Math.max(0, asInt(section.sinceCursorEl.value || 0));
        }
        if (section.payloadsEl) {
            body.include_payload_bodies = !!section.payloadsEl.checked;
        }
        var payload = await requestJson('/downloads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        var jobId = payload && payload.job ? payload.job.job_id : '';
        showMsg('Download job queued: ' + jobId, false);
        await loadSection(sectionKey);
    }

    async function pollJob(jobId, sectionKey) {
        var payload = await requestJson('/downloads/' + encodeURIComponent(jobId));
        var status = payload && payload.job ? payload.job.status : 'unknown';
        showMsg('Job ' + jobId + ': ' + status, false);
        if (sectionKey && sections[sectionKey]) {
            await loadSection(sectionKey);
            return;
        }
        await loadAllSections();
    }

    async function retryJob(jobId, sectionKey) {
        var payload = await requestJson('/downloads/' + encodeURIComponent(jobId) + '/retry', {
            method: 'POST'
        });
        var status = payload && payload.job ? payload.job.status : 'queued';
        showMsg('Retry started for ' + jobId + ' (' + status + ').', false);
        if (sectionKey && sections[sectionKey]) {
            await loadSection(sectionKey);
            return;
        }
        await loadAllSections();
    }

    function selectVisible(sectionKey) {
        var section = sections[sectionKey];
        section.entries.forEach(function (entry) {
            var job = entry && entry.job ? entry.job : null;
            var jobId = job ? String(job.job_id || '') : '';
            if (jobId && isJobSelectable(job)) section.selection[jobId] = true;
        });
        preserveWindowScroll(function () {
            renderJobs(sectionKey, section.entries);
        });
        updateSectionHistory(sectionKey, section.entries);
    }

    function clearSelection(sectionKey) {
        var section = sections[sectionKey];
        section.selection = Object.create(null);
        preserveWindowScroll(function () {
            renderJobs(sectionKey, section.entries);
        });
        updateSectionHistory(sectionKey, section.entries);
    }

    async function deleteSelected(sectionKey) {
        var section = sections[sectionKey];
        var jobIds = sectionSelectedIds(sectionKey);
        if (!jobIds.length) {
            showMsg('Select one or more completed or failed jobs first.', true);
            return;
        }
        if (!confirm('Delete ' + jobIds.length + ' selected export job(s)? This removes their stored files and cannot be undone.')) {
            return;
        }
        var payload = await requestJson('/downloads', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_ids: jobIds })
        });
        section.selection = Object.create(null);
        showMsg('Deleted ' + Number(payload.deleted_job_count || 0) + ' export job(s).', false);
        await loadSection(sectionKey);
    }

    async function loadMoreJobs(sectionKey) {
        var section = sections[sectionKey];
        section.limit = Math.min(250, section.limit + section.pageSize);
        await loadSection(sectionKey);
    }

    document.body.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;

        var createJobSpec = target.getAttribute('data-create-job');
        if (createJobSpec) {
            var parts = createJobSpec.split(':');
            createJob(parts[0], parts[1]).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to create job.', true);
            });
            return;
        }

        var refreshSectionKey = target.getAttribute('data-refresh-section');
        if (refreshSectionKey) {
            loadSection(refreshSectionKey).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to refresh jobs.', true);
            });
            return;
        }

        var action = target.getAttribute('data-action');
        if (action === 'use-latest-cursor') {
            useLatestCursor(target.getAttribute('data-section') || '');
            return;
        }
        if (action === 'poll-job') {
            pollJob(
                target.getAttribute('data-job-id') || '',
                target.getAttribute('data-section') || ''
            ).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to poll job.', true);
            });
            return;
        }
        if (action === 'retry-job') {
            retryJob(
                target.getAttribute('data-job-id') || '',
                target.getAttribute('data-section') || ''
            ).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to retry job.', true);
            });
            return;
        }
        if (action === 'load-more') {
            loadMoreJobs(target.getAttribute('data-section') || '').catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to load older jobs.', true);
            });
            return;
        }
        if (action === 'select-visible') {
            selectVisible(target.getAttribute('data-section') || '');
            return;
        }
        if (action === 'clear-selection') {
            clearSelection(target.getAttribute('data-section') || '');
            return;
        }
        if (action === 'delete-selected') {
            deleteSelected(target.getAttribute('data-section') || '').catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to delete selected jobs.', true);
            });
            return;
        }
        if (action === 'copy-cursor') {
            var cursor = String(target.getAttribute('data-cursor') || '').trim();
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                showMsg('Clipboard access is not available in this browser.', true);
                return;
            }
            navigator.clipboard.writeText(cursor).then(function () {
                showMsg('Copied cursor ' + cursor, false);
            }).catch(function () {
                showMsg('Failed to copy cursor.', true);
            });
            return;
        }
        if (action === 'download-artifact') {
            downloadArtifact(
                target.getAttribute('data-path') || '',
                target.getAttribute('data-file-name') || ''
            ).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to download artifact.', true);
            });
            return;
        }
        if (action === 'download-operational-bundle') {
            downloadOperationalBundle(target.getAttribute('data-job-id') || '').then(function () {
                showMsg('Full operational snapshot download started.', false);
            }).catch(function (error) {
                showMsg(error && error.message ? error.message : 'Failed to prepare snapshot bundle.', true);
            });
        }
    });

    document.body.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-action') !== 'toggle-job-selection') return;
        var sectionKey = target.getAttribute('data-section') || '';
        var section = sections[sectionKey];
        var jobId = String(target.getAttribute('data-job-id') || '').trim();
        if (!section || !jobId) return;
        section.selection[jobId] = !!target.checked;
        if (!target.checked) delete section.selection[jobId];
        updateSectionHistory(sectionKey, section.entries);
    });

    ['canonical', 'optimized'].forEach(function (sectionKey) {
        var section = sections[sectionKey];
        if (section.scopeEl) {
            section.scopeEl.addEventListener('change', function () {
                section.limit = section.pageSize;
                section.selection = Object.create(null);
                section.renderKey = '';
                section.autoCursorValue = '';
                if (section.sinceCursorEl) section.sinceCursorEl.value = '';
                loadSection(sectionKey).catch(function (error) {
                    showMsg(error && error.message ? error.message : 'Failed to refresh jobs.', true);
                });
            });
        }
    });

    loadAllSections().catch(function (error) {
        showMsg(error && error.message ? error.message : 'Failed to load export jobs.', true);
    });
})();
