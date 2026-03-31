(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal || !window.AR.AdminPortal.guard()) return;
    if (!window.AR.AdminExportsRuntime) return;

    var portal = window.AR.AdminPortal;
    var runtime = window.AR.AdminExportsRuntime;

    var datasetEl = document.getElementById('rate-export-dataset');
    var scopeEl = document.getElementById('rate-export-scope');
    var formatEl = document.getElementById('rate-export-format');
    var runBtn = document.getElementById('rate-export-run');
    var summaryEl = document.getElementById('rate-export-summary');

    var busy = false;

    function stripAdminPrefix(path) {
        var value = String(path || '');
        return value.indexOf('/admin') === 0 ? value.slice('/admin'.length) : value;
    }

    function datasetBase(dataset) {
        var normalized = String(dataset || '').trim().toLowerCase();
        if (normalized === 'savings') return '/rate-exports/savings';
        if (normalized === 'term-deposits') return '/rate-exports/term-deposits';
        return '/rate-exports/home-loans';
    }

    function setSummary(text, isError) {
        if (!summaryEl) return;
        var msg = String(text || '').trim();
        summaryEl.textContent = msg;
        summaryEl.classList.toggle('is-error', !!isError);
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function pollStatus(statusPath) {
        var attempt = 0;
        while (attempt < 120) {
            attempt += 1;
            var payload = await runtime.requestJson(stripAdminPrefix(statusPath));
            if (payload.status === 'completed') return payload;
            if (payload.status === 'failed') throw new Error(payload.error_message || 'Export job failed');
            await sleep(1000);
        }
        throw new Error('Export job timed out');
    }

    async function fetchJsonRows(downloadPath) {
        var res = await fetch(portal.apiBase() + downloadPath, {
            cache: 'no-store',
            headers: portal.authHeaders()
        });
        if (!res.ok) throw new Error('Export download failed (' + res.status + ').');
        var payload = await res.json();
        return payload && Array.isArray(payload.rows) ? payload.rows : [];
    }

    function safeFileName(dataset, scope, ext) {
        var ds = String(dataset || 'rates')
            .replace(/[^a-z0-9\\-]+/gi, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
        var sc = String(scope || 'rates').replace(/[^a-z0-9\\-]+/gi, '-').toLowerCase();
        return ds + '-' + sc + '-export.' + ext;
    }

    async function runExportJob(dataset, scope, format) {
        var base = datasetBase(dataset);
        var created = await runtime.requestJson(base + '/exports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format: format, export_type: scope })
        });
        var job = created.status === 'completed' ? created : await pollStatus(created.status_path);
        if (!job.download_path) throw new Error('Export completed without a download path');
        return job;
    }

    async function handleRun() {
        if (busy) return;
        busy = true;
        if (runBtn) runBtn.disabled = true;

        var dataset = datasetEl ? String(datasetEl.value || 'home-loans') : 'home-loans';
        var scope = scopeEl ? String(scopeEl.value || 'rates') : 'rates';
        var format = formatEl ? String(formatEl.value || 'csv') : 'csv';

        setSummary('Preparing export job...', false);
        try {
            if (format === 'xls') {
                if (!window.XLSX || !window.XLSX.utils) {
                    throw new Error('Excel export is unavailable right now. Use CSV or JSON.');
                }
                var jsonJob = await runExportJob(dataset, scope, 'json');
                var rows = await fetchJsonRows(jsonJob.download_path);
                var worksheet = window.XLSX.utils.json_to_sheet(rows);
                var workbook = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Rates');
                window.XLSX.writeFile(workbook, safeFileName(dataset, scope, 'xlsx'));
                setSummary('Excel export generated.', false);
            } else if (format === 'csv' || format === 'json') {
                var job = await runExportJob(dataset, scope, format);
                await runtime.downloadFile(job.download_path, job.file_name || safeFileName(dataset, scope, format));
                setSummary(format.toUpperCase() + ' export download started.', false);
            } else {
                throw new Error('Unsupported format: ' + format);
            }
        } catch (error) {
            setSummary(error && error.message ? error.message : 'Export failed.', true);
        } finally {
            busy = false;
            if (runBtn) runBtn.disabled = false;
        }
    }

    if (runBtn) runBtn.addEventListener('click', function () {
        handleRun();
    });
})();

