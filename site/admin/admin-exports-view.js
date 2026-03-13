(function () {
    'use strict';

    function escapeHtml(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    function formatTimestamp(timeUtils, value) {
        if (!value) return '--';
        if (!timeUtils || !timeUtils.formatCheckedAt) return String(value);
        return timeUtils.formatCheckedAt(value).text || String(value);
    }

    function formatInteger(value) {
        var n = Number(value);
        if (!isFinite(n)) return '--';
        return Math.floor(n).toLocaleString();
    }

    function formatByteSize(value) {
        var bytes = Number(value);
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var unitIndex = 0;
        var digits = 0;
        if (!isFinite(bytes) || bytes < 0) return '--';
        while (bytes >= 1024 && unitIndex < units.length - 1) {
            bytes /= 1024;
            unitIndex += 1;
        }
        digits = bytes >= 100 || unitIndex === 0 ? 0 : bytes >= 10 ? 1 : 2;
        return bytes.toFixed(digits).replace(/\.0+$/, '') + ' ' + units[unitIndex];
    }

    function isJobSelectable(job) {
        var status = String(job && job.status || '');
        return status === 'completed' || status === 'failed';
    }

    function hasPendingEntries(entries) {
        return entries.some(function (entry) {
            var status = entry && entry.job ? String(entry.job.status || '') : '';
            return status === 'queued' || status === 'processing';
        });
    }

    function latestCompletedCursorValue(entries) {
        for (var index = 0; index < entries.length; index += 1) {
            var job = entries[index] && entries[index].job ? entries[index].job : null;
            var value = Number(job && job.end_cursor);
            if (job && job.status === 'completed' && isFinite(value) && value >= 0) {
                return Math.floor(value);
            }
        }
        return null;
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
                    if (leftManifest && rightManifest) {
                        return String(left.file_name || '').localeCompare(String(right.file_name || ''));
                    }
                    return leftManifest ? 1 : -1;
                }
                return String(left && left.file_name || '').localeCompare(String(right && right.file_name || ''));
            });
    }

    function buildOperationalBundle(entry, job, artifacts) {
        var parts = operationalBundleParts(artifacts);
        if (!job || !job.job_id || (!entry.download_path && !parts.length)) return null;
        return {
            fileName: entry.download_file_name || 'operational-all-snapshot.jsonl.gz',
            downloadPath: entry.download_path || '',
            parts: parts
        };
    }

    function statusBadge(job) {
        var status = String(job && job.status || 'unknown');
        return '<span class="export-status export-status--' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
    }

    function renderJobMeta(job, timeUtils) {
        return ''
            + 'Mode: ' + escapeHtml(job.mode || '--') + ' | Scope: ' + escapeHtml(job.scope || '--') + ' | Requested: ' + escapeHtml(formatTimestamp(timeUtils, job.requested_at)) + '<br>'
            + 'Started: ' + escapeHtml(formatTimestamp(timeUtils, job.started_at)) + ' | Completed: ' + escapeHtml(formatTimestamp(timeUtils, job.completed_at)) + '<br>'
            + 'Since cursor: ' + escapeHtml(job.since_cursor == null ? '--' : formatInteger(job.since_cursor)) + ' | End cursor: ' + escapeHtml(job.end_cursor == null ? '--' : formatInteger(job.end_cursor));
    }

    function artifactMeta(artifact, timeUtils) {
        var parts = [];
        parts.push('Rows ' + formatInteger(artifact.row_count));
        parts.push('Size ' + formatByteSize(artifact.byte_size));
        if (artifact.cursor_start != null || artifact.cursor_end != null) {
            parts.push('Cursor ' + formatInteger(artifact.cursor_start) + ' -> ' + formatInteger(artifact.cursor_end));
        }
        parts.push('Ready ' + formatTimestamp(timeUtils, artifact.created_at));
        return parts.join(' | ');
    }

    function jobArtifactSummary(job, artifacts) {
        var cursorEnd = null;
        var cursorStart = null;
        var hasBytes = false;
        var hasRows = false;
        var index;
        var parts = [];
        var totalBytes = 0;
        var totalRows = 0;

        if (!artifacts.length) {
            if (job && (job.status === 'queued' || job.status === 'processing')) return 'Artifacts pending while the job runs.';
            if (job && job.status === 'failed') return 'No artifacts were created for this failed job. Use Retry to queue it again.';
            return 'No artifacts available for this job yet.';
        }

        parts.push('Artifacts ' + formatInteger(artifacts.length));
        for (index = 0; index < artifacts.length; index += 1) {
            var artifact = artifacts[index] || {};
            var byteSize = Number(artifact.byte_size);
            var rowCount = Number(artifact.row_count);
            var nextCursorEnd = Number(artifact.cursor_end);
            var nextCursorStart = Number(artifact.cursor_start);

            if (isFinite(rowCount) && rowCount >= 0) {
                totalRows += Math.floor(rowCount);
                hasRows = true;
            }
            if (isFinite(byteSize) && byteSize >= 0) {
                totalBytes += byteSize;
                hasBytes = true;
            }
            if (isFinite(nextCursorStart) && nextCursorStart >= 0) {
                nextCursorStart = Math.floor(nextCursorStart);
                cursorStart = cursorStart == null ? nextCursorStart : Math.min(cursorStart, nextCursorStart);
            }
            if (isFinite(nextCursorEnd) && nextCursorEnd >= 0) {
                nextCursorEnd = Math.floor(nextCursorEnd);
                cursorEnd = cursorEnd == null ? nextCursorEnd : Math.max(cursorEnd, nextCursorEnd);
            }
        }

        if (hasRows) parts.push('Rows ' + formatInteger(totalRows));
        if (hasBytes) parts.push('Size ' + formatByteSize(totalBytes));
        if (cursorStart != null || cursorEnd != null) {
            parts.push('Cursor ' + formatInteger(cursorStart) + ' -> ' + formatInteger(cursorEnd));
        }
        return parts.join(' | ');
    }

    function renderArtifactCard(artifact, timeUtils) {
        var label = artifact.file_name || artifact.artifact_kind || 'artifact';
        return ''
            + '<div class="export-artifact-card">'
            + '  <div class="export-artifact-head">'
            + '    <strong>' + escapeHtml(label) + '</strong>'
            + '    <span class="export-artifact-kind">' + escapeHtml(artifact.artifact_kind || 'artifact') + '</span>'
            + '  </div>'
            + '  <div class="export-artifact-meta">' + escapeHtml(artifactMeta(artifact, timeUtils)) + '</div>'
            + '  <button type="button" class="secondary" data-action="download-artifact"'
            + ' data-path="' + escapeHtml(artifact.download_path || '') + '"'
            + ' data-file-name="' + escapeHtml(artifact.file_name || '') + '">Download artifact</button>'
            + '</div>';
    }

    function renderBundlePanel(bundle, job) {
        if (!bundle && job && (job.status === 'queued' || job.status === 'processing')) {
            return '<div class="export-bundle-panel"><strong>Full snapshot bundle</strong><div class="export-bundle-copy">The single-file snapshot appears when the job completes. Until then, auto-refresh keeps checking every 5 seconds.</div></div>';
        }
        if (!bundle) {
            return '<div class="export-bundle-panel"><strong>Full snapshot bundle</strong><div class="export-bundle-copy">No snapshot bundle is available for this job. Download the table artifacts individually or retry the job if it failed.</div></div>';
        }
        return ''
            + '<div class="export-bundle-panel">'
            + '  <strong>Full snapshot bundle</strong>'
            + '  <div class="export-bundle-copy">' + escapeHtml(bundle.downloadPath ? 'Single-file download is ready.' : ('Client-side bundle will be assembled from ' + bundle.parts.length + ' stored parts.')) + '</div>'
            + '  <button type="button" class="secondary" data-action="download-operational-bundle" data-job-id="' + escapeHtml(job.job_id || '') + '">Download full snapshot</button>'
            + '</div>';
    }

    function renderJobActions(sectionKey, job) {
        var html = ''
            + '<button type="button" class="secondary" data-action="poll-job" data-section="' + escapeHtml(sectionKey) + '" data-job-id="' + escapeHtml(job.job_id || '') + '">Poll</button>';
        if (String(job.status || '') === 'failed') {
            html += '<button type="button" class="secondary" data-action="retry-job" data-section="' + escapeHtml(sectionKey) + '" data-job-id="' + escapeHtml(job.job_id || '') + '">Retry</button>';
        }
        if (job.end_cursor != null) {
            html += '<button type="button" class="secondary" data-action="copy-cursor" data-cursor="' + escapeHtml(job.end_cursor) + '">Copy cursor</button>';
        }
        return html;
    }

    function renderJob(sectionKey, section, entry, timeUtils) {
        var artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
        var bundle = sectionKey === 'operational' ? buildOperationalBundle(entry, entry.job, artifacts) : null;
        var job = entry.job || {};
        var jobId = String(job.job_id || '');
        var checked = !!section.selection[jobId];
        var selectable = isJobSelectable(job);
        var artifactHtml = artifacts.length
            ? artifacts.map(function (artifact) { return renderArtifactCard(artifact, timeUtils); }).join('')
            : '<div class="export-empty">No artifacts yet.</div>';
        return {
            bundle: bundle,
            html: ''
                + '<div class="export-job">'
                + '  <div class="export-job-head">'
                + '    <div class="export-job-heading"><strong>' + escapeHtml(jobId) + '</strong>' + statusBadge(job) + '</div>'
                + '    <label class="export-job-select"><input type="checkbox" data-action="toggle-job-selection" data-section="' + escapeHtml(sectionKey) + '" data-job-id="' + escapeHtml(jobId) + '"' + (checked ? ' checked' : '') + (selectable ? '' : ' disabled') + '> Select</label>'
                + '  </div>'
                + '  <div class="export-job-meta">' + renderJobMeta(job, timeUtils) + '</div>'
                + '  <div class="export-job-artifact-summary">' + escapeHtml(jobArtifactSummary(job, artifacts)) + '</div>'
                + (job.error_message ? '<div class="export-job-error">Error: ' + escapeHtml(job.error_message) + '</div>' : '')
                + '  <div class="export-job-actions">' + renderJobActions(sectionKey, job) + '</div>'
                + (sectionKey === 'operational' ? renderBundlePanel(bundle, job) : '')
                + '  <div class="export-artifact-list">' + artifactHtml + '</div>'
                + '</div>'
        };
    }

    function renderSummary(section, entries, timeUtils) {
        var latest = entries[0] || null;
        var latestCursor = latestCompletedCursorValue(entries);
        var cells = [
            { label: 'Latest completed cursor', value: latestCursor == null ? '--' : formatInteger(latestCursor) },
            { label: 'Jobs shown', value: formatInteger(entries.length) },
            { label: 'Latest status', value: latest && latest.job ? latest.job.status : '--' },
            { label: 'Latest requested', value: latest && latest.job ? formatTimestamp(timeUtils, latest.job.requested_at) : '--' },
            { label: 'Latest completed', value: latest && latest.job ? formatTimestamp(timeUtils, latest.job.completed_at) : '--' }
        ];
        section.summaryEl.innerHTML = cells.map(function (cell) {
            return '<div class="summary-cell"><div class="label">' + escapeHtml(cell.label) + '</div><div class="value">' + escapeHtml(cell.value) + '</div></div>';
        }).join('');
    }

    function renderHistory(section, entries) {
        var selectedCount = entries.reduce(function (count, entry) {
            var job = entry && entry.job ? entry.job : null;
            var jobId = job ? String(job.job_id || '') : '';
            return count + (jobId && section.selection[jobId] ? 1 : 0);
        }, 0);
        var meta = entries.length ? ('Showing ' + entries.length + ' recent jobs') : 'No jobs loaded yet.';
        if (selectedCount) meta += ' | ' + selectedCount + ' selected';
        if (hasPendingEntries(entries)) meta += ' | Auto-refresh every 5s while jobs are pending';
        if (section.loading) meta += ' | Refreshing...';
        section.historyEl.textContent = meta;
        section.loadMoreBtn.disabled = section.loading || entries.length < section.limit || section.limit >= 250;
        section.selectVisibleBtn.disabled = section.loading || !entries.some(function (entry) { return isJobSelectable(entry.job); });
        section.clearSelectionBtn.disabled = section.loading || selectedCount === 0;
        section.deleteSelectedBtn.disabled = section.loading || selectedCount === 0;
        section.deleteSelectedBtn.textContent = selectedCount ? ('Delete selected (' + selectedCount + ')') : 'Delete selected';
    }

    function renderJobs(sectionKey, section, entries, timeUtils) {
        var bundles = Object.create(null);
        if (!entries.length) {
            section.jobsEl.innerHTML = '<div class="export-empty">No jobs yet for this stream and scope.</div>';
            return bundles;
        }
        section.jobsEl.innerHTML = entries.map(function (entry) {
            var rendered = renderJob(sectionKey, section, entry, timeUtils);
            var job = entry && entry.job ? entry.job : null;
            if (job && job.job_id && rendered.bundle) bundles[job.job_id] = rendered.bundle;
            return rendered.html;
        }).join('');
        return bundles;
    }

    window.AR = window.AR || {};
    window.AR.AdminExportsView = {
        hasPendingEntries: hasPendingEntries,
        isJobSelectable: isJobSelectable,
        latestCompletedCursorValue: latestCompletedCursorValue,
        renderHistory: renderHistory,
        renderJobs: renderJobs,
        renderSummary: renderSummary,
        sectionRenderKey: sectionRenderKey
    };
})();
