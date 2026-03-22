(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    var pathApiPath = (path.indexOf('/savings') !== -1) ? '/api/savings-rates' : (path.indexOf('/term-deposits') !== -1) ? '/api/term-deposit-rates' : '/api/home-loan-rates';
    var effectiveApiPath = (window.AR.sectionConfig && window.AR.sectionConfig.apiPath) ? window.AR.sectionConfig.apiPath : pathApiPath;
    var apiBase = (config && config.apiBase) ? config.apiBase : (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin + effectiveApiPath : '');
    var clientLog = utils.clientLog || function () {};
    var downloadInFlight = false;
    var downloadStatusTimer = 0;

    function safeSectionLabel() {
        var section = String(window.AR.section || 'home-loans').toLowerCase();
        if (section === 'savings') return 'savings-rates';
        if (section === 'term-deposits') return 'term-deposit-rates';
        return 'home-loan-rates';
    }

    function buildExportRequestBody(format) {
        return { format: format, export_type: 'rates' };
    }

    function parseFileName(contentDisposition, fallback) {
        var fallbackName = String(fallback || 'rates-export');
        var raw = String(contentDisposition || '');
        var quoted = raw.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i);
        if (!quoted) return fallbackName;
        var value = quoted[1] || quoted[2] || quoted[3] || fallbackName;
        try { return decodeURIComponent(String(value).trim()); } catch (_err) { return String(value).trim(); }
    }

    function triggerBlobDownload(blob, filename) {
        var href = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = href;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
    }

    function resetDownloadFormat() {
        if (els.downloadFormat) els.downloadFormat.value = '';
    }

    function setDownloadStatus(message, tone, autoHideMs) {
        if (!els.downloadStatus) return;
        window.clearTimeout(downloadStatusTimer);
        if (!message) {
            els.downloadStatus.hidden = true;
            els.downloadStatus.textContent = '';
            els.downloadStatus.classList.remove('is-error', 'is-warning');
            return;
        }
        els.downloadStatus.hidden = false;
        els.downloadStatus.textContent = String(message);
        els.downloadStatus.classList.remove('is-error', 'is-warning');
        if (tone === 'error') els.downloadStatus.classList.add('is-error');
        else if (tone === 'warning') els.downloadStatus.classList.add('is-warning');
        if (Number(autoHideMs) > 0) {
            downloadStatusTimer = window.setTimeout(function () {
                setDownloadStatus('');
            }, Number(autoHideMs));
        }
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function createHttpError(message, status) {
        var error = new Error(message);
        error.status = status;
        return error;
    }

    function shouldFallbackToLegacy(error) {
        var status = Number(error && error.status);
        return status === 404 || status === 405 || status === 501;
    }

    function extractExportRows(payload) {
        if (Array.isArray(payload)) return payload;
        if (payload && Array.isArray(payload.rows)) return payload.rows;
        if (payload && Array.isArray(payload.data)) return payload.data;
        return [];
    }

    async function requestExportJob(format) {
        var response = await fetch(apiBase + '/exports', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildExportRequestBody(format)),
        });
        if (!response.ok) throw createHttpError('Export failed (HTTP ' + response.status + ')', response.status);
        return response.json();
    }

    async function waitForExportJob(jobId) {
        var attempts = 0;
        while (attempts < 120) {
            attempts += 1;
            var response = await fetch(apiBase + '/exports/' + encodeURIComponent(jobId), { cache: 'no-store' });
            if (!response.ok) throw createHttpError('Export status failed (HTTP ' + response.status + ')', response.status);
            var payload = await response.json();
            if (payload.status === 'completed') return payload;
            if (payload.status === 'failed') {
                throw new Error(payload.error_message || 'Export job failed');
            }
            await sleep(1000);
        }
        throw new Error('Export job timed out');
    }

    async function fetchCompletedExport(format) {
        var started = await requestExportJob(format);
        var job = started;
        if (job.status !== 'completed') {
            job = await waitForExportJob(job.job_id);
        }
        if (!job.download_path) throw new Error('Export job completed without a download path');
        var response = await fetch(apiBase + job.download_path, { cache: 'no-store' });
        if (!response.ok) throw createHttpError('Export download failed (HTTP ' + response.status + ')', response.status);
        return {
            response: response,
            job: job,
            transport: 'async-job',
        };
    }

    async function fetchLegacyExport(format) {
        var response = await fetch(apiBase + '/export?format=' + encodeURIComponent(format), { cache: 'no-store' });
        if (!response.ok) throw createHttpError('Export failed (HTTP ' + response.status + ')', response.status);
        return {
            response: response,
            job: null,
            transport: 'legacy-direct',
        };
    }

    async function fetchExportResult(format) {
        try {
            return await fetchCompletedExport(format);
        } catch (error) {
            if (!shouldFallbackToLegacy(error)) throw error;
            clientLog('warn', 'Async export route unavailable, falling back to legacy export', {
                format: format,
                status: Number(error && error.status) || 0,
            });
            setDownloadStatus('Using direct download path for this export.', 'warning', 2600);
            return fetchLegacyExport(format);
        }
    }

    async function downloadViaExport(format) {
        var result = await fetchExportResult(format);
        var filename = parseFileName(
            result.response.headers.get('content-disposition'),
            safeSectionLabel() + '-export.' + format
        );
        var blob = await result.response.blob();
        triggerBlobDownload(blob, filename);
        return result;
    }

    async function fetchJsonPayload() {
        var result = await fetchExportResult('json');
        var payload = await result.response.json();
        return {
            payload: payload,
            transport: result.transport,
        };
    }

    async function downloadXlsx() {
        if (!window.XLSX || !window.XLSX.utils) {
            throw new Error('Excel export is unavailable right now. Use CSV or JSON.');
        }

        var result = await fetchJsonPayload();
        var rows = extractExportRows(result.payload);
        var worksheet = window.XLSX.utils.json_to_sheet(rows);
        var workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Rates');

        window.XLSX.writeFile(workbook, safeSectionLabel() + '-export.xlsx');
        return { transport: result.transport };
    }

    function formatDownloadLabel(format) {
        if (format === 'xls') return 'Excel';
        return String(format || '').toUpperCase();
    }

    function userFacingDownloadError(error) {
        var message = String(error && error.message ? error.message : '').trim();
        if (!message) return 'Download failed. Please try again.';
        if (message.indexOf('Excel export is unavailable') >= 0) return message;
        return 'Download failed. Please try again.';
    }

    async function downloadSelectedFormat(format) {
        var selected = String(format || '').toLowerCase().trim();
        if (!selected) return;

        if (downloadInFlight) {
            setDownloadStatus('A download is already in progress.', 'warning', 2200);
            return;
        }
        downloadInFlight = true;
        setDownloadStatus('Preparing ' + formatDownloadLabel(selected) + ' download...', 'warning');
        try {
            var result = null;
            if (selected === 'csv' || selected === 'json') {
                result = await downloadViaExport(selected);
            } else if (selected === 'xls') {
                result = await downloadXlsx();
            } else {
                throw new Error('Unsupported download format: ' + selected);
            }
            setDownloadStatus(formatDownloadLabel(selected) + ' download started.', null, 3200);
            clientLog('info', 'Export download completed', {
                format: selected,
                transport: result && result.transport ? result.transport : 'unknown',
            });
        } catch (err) {
            setDownloadStatus(userFacingDownloadError(err), 'error');
            clientLog('error', 'Export download failed', {
                format: selected,
                message: err && err.message ? err.message : String(err),
            });
        } finally {
            downloadInFlight = false;
            resetDownloadFormat();
        }
    }

    function downloadCsv() {
        downloadSelectedFormat('csv');
    }

    window.AR.export = {
        downloadCsv: downloadCsv,
        downloadSelectedFormat: downloadSelectedFormat,
    };
})();
