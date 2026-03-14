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
                download_path: entry && entry.download_path ? entry.download_path : '',
                download_file_name: entry && entry.download_file_name ? entry.download_file_name : '',
                artifacts: artifacts.map(function (artifact) {
                    return [
                        artifact.artifact_id || '',
                        artifact.file_name || '',
                        artifact.row_count == null ? '' : artifact.row_count,
                        artifact.byte_size == null ? '' : artifact.byte_size,
                        artifact.cursor_start == null ? '' : artifact.cursor_start,
                        artifact.cursor_end == null ? '' : artifact.cursor_end,
                        artifact.created_at || ''
                    ].join('|');
                })
            };
        }));
    }

    function totalArtifactRows(artifacts) {
        return artifacts.reduce(function (sum, artifact) {
            var rowCount = Number(artifact && artifact.row_count);
            return sum + (isFinite(rowCount) && rowCount > 0 ? Math.floor(rowCount) : 0);
        }, 0);
    }

    function totalArtifactBytes(artifacts) {
        return artifacts.reduce(function (sum, artifact) {
            var byteSize = Number(artifact && artifact.byte_size);
            return sum + (isFinite(byteSize) && byteSize > 0 ? byteSize : 0);
        }, 0);
    }

    function isLegacyBundle(entry) {
        var fileName = String(entry && entry.download_file_name || '').toLowerCase();
        return fileName.endsWith('.jsonl.gz');
    }

    function jobArtifactSummary(job, artifacts) {
        var parts = [];
        if (!artifacts.length) {
            if (job && (job.status === 'queued' || job.status === 'processing')) return 'Stored parts will appear while the dump is being assembled.';
            if (job && job.status === 'failed') return 'No dump parts were created for this failed job. Use Retry to queue it again.';
            return 'No stored dump parts are available for this job yet.';
        }
        parts.push('Stored parts ' + formatInteger(artifacts.length));
        parts.push('Rows ' + formatInteger(totalArtifactRows(artifacts)));
        parts.push('Size ' + formatByteSize(totalArtifactBytes(artifacts)));
        return parts.join(' | ');
    }

    function statusBadge(job) {
        var status = String(job && job.status || 'unknown');
        return '<span class="export-status export-status--' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
    }

    function renderJobMeta(job, timeUtils) {
        return ''
            + 'Requested: ' + escapeHtml(formatTimestamp(timeUtils, job.requested_at)) + '<br>'
            + 'Started: ' + escapeHtml(formatTimestamp(timeUtils, job.started_at)) + ' | Completed: ' + escapeHtml(formatTimestamp(timeUtils, job.completed_at));
    }

    function renderDownloadPanel(entry, job, artifacts) {
        var legacy = isLegacyBundle(entry);
        if (job && (job.status === 'queued' || job.status === 'processing')) {
            return '<div class="export-download-panel"><strong>Preparing full dump</strong><div class="export-download-copy">The worker is assembling the dump now. Auto-refresh keeps checking every 5 seconds until the file is ready.</div></div>';
        }
        if (!entry || !entry.download_path) {
            return '<div class="export-download-panel"><strong>Download unavailable</strong><div class="export-download-copy">No single-file download is available for this job. Retry it if it failed or delete it if it is legacy history you no longer need.</div></div>';
        }
        return ''
            + '<div class="export-download-panel">'
            + '  <strong>' + escapeHtml(legacy ? 'Legacy bundle' : 'Full database dump') + '</strong>'
            + '  <div class="export-download-copy">' + escapeHtml(legacy
                ? 'This job was created by the previous operational JSONL exporter. New jobs produce a restorable SQL dump instead.'
                : 'Single-file SQL dump is ready. Download it, decompress it to .sql, and apply it with Wrangler D1 execute.') + '</div>'
            + '  <div class="export-download-copy">File: ' + escapeHtml(entry.download_file_name || 'australianrates-database-full.sql.gz') + '</div>'
            + '  <div class="export-download-copy">Stored parts: ' + escapeHtml(String(artifacts.length)) + '</div>'
            + '  <button type="button" class="secondary" data-action="download-job" data-path="' + escapeHtml(entry.download_path || '') + '" data-file-name="' + escapeHtml(entry.download_file_name || '') + '">Download file</button>'
            + '</div>';
    }

    function renderJobActions(job) {
        var html = '<button type="button" class="secondary" data-action="poll-job" data-job-id="' + escapeHtml(job.job_id || '') + '">Poll</button>';
        if (String(job.status || '') === 'failed') {
            html += '<button type="button" class="secondary" data-action="retry-job" data-job-id="' + escapeHtml(job.job_id || '') + '">Retry</button>';
        }
        return html;
    }

    function renderJob(section, entry, timeUtils) {
        var artifacts = Array.isArray(entry && entry.artifacts) ? entry.artifacts : [];
        var job = entry && entry.job ? entry.job : {};
        var jobId = String(job.job_id || '');
        var checked = !!section.selection[jobId];
        var selectable = isJobSelectable(job);
        return ''
            + '<div class="export-job">'
            + '  <div class="export-job-head">'
            + '    <div class="export-job-heading"><strong>' + escapeHtml(jobId) + '</strong>' + statusBadge(job) + '</div>'
            + '    <label class="export-job-select"><input type="checkbox" data-action="toggle-job-selection" data-job-id="' + escapeHtml(jobId) + '"' + (checked ? ' checked' : '') + (selectable ? '' : ' disabled') + '> Select</label>'
            + '  </div>'
            + '  <div class="export-job-meta">' + renderJobMeta(job, timeUtils) + '</div>'
            + '  <div class="export-job-artifact-summary">' + escapeHtml(jobArtifactSummary(job, artifacts)) + '</div>'
            + (job.error_message ? '<div class="export-job-error">Error: ' + escapeHtml(job.error_message) + '</div>' : '')
            + '  <div class="export-job-actions">' + renderJobActions(job) + '</div>'
            + renderDownloadPanel(entry, job, artifacts)
            + '</div>';
    }

    function renderSummary(section, entries, timeUtils) {
        var latest = entries[0] || null;
        var latestJob = latest && latest.job ? latest.job : null;
        var cells = [
            { label: 'Jobs shown', value: formatInteger(entries.length) },
            { label: 'Latest status', value: latestJob ? latestJob.status : '--' },
            { label: 'Latest requested', value: latestJob ? formatTimestamp(timeUtils, latestJob.requested_at) : '--' },
            { label: 'Latest completed', value: latestJob ? formatTimestamp(timeUtils, latestJob.completed_at) : '--' },
            { label: 'Latest file', value: latest && latest.download_file_name ? latest.download_file_name : '--' }
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
        var meta = entries.length ? ('Showing ' + entries.length + ' recent dump jobs') : 'No jobs loaded yet.';
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

    function renderJobs(section, entries, timeUtils) {
        if (!entries.length) {
            section.jobsEl.innerHTML = '<div class="export-empty">No dump jobs yet.</div>';
            return;
        }
        section.jobsEl.innerHTML = entries.map(function (entry) {
            return renderJob(section, entry, timeUtils);
        }).join('');
    }

    window.AR = window.AR || {};
    window.AR.AdminExportsView = {
        hasPendingEntries: hasPendingEntries,
        isJobSelectable: isJobSelectable,
        renderHistory: renderHistory,
        renderJobs: renderJobs,
        renderSummary: renderSummary,
        sectionRenderKey: sectionRenderKey
    };
})();
