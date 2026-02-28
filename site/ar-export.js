(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var explorer = window.AR.explorer;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    var pathApiPath = (path.indexOf('/savings') !== -1) ? '/api/savings-rates' : (path.indexOf('/term-deposits') !== -1) ? '/api/term-deposit-rates' : '/api/home-loan-rates';
    var effectiveApiPath = (window.AR.sectionConfig && window.AR.sectionConfig.apiPath) ? window.AR.sectionConfig.apiPath : pathApiPath;
    var apiBase = (config && config.apiBase) ? config.apiBase : (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin + effectiveApiPath : '');
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var clientLog = utils.clientLog || function () {};
    var downloadInFlight = false;

    function safeSectionLabel() {
        var section = String(window.AR.section || 'home-loans').toLowerCase();
        if (section === 'savings') return 'savings-rates';
        if (section === 'term-deposits') return 'term-deposit-rates';
        return 'home-loan-rates';
    }

    function buildExportQuery() {
        var fp = buildFilterParams();
        var sortState = explorer && explorer.getCurrentSort ? explorer.getCurrentSort() : null;
        if (sortState && sortState.field) {
            fp.sort = sortState.field;
            fp.dir = String(sortState.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
        }
        return new URLSearchParams(fp);
    }

    function buildExportRequestBody(format) {
        var query = buildExportQuery();
        var body = { format: format, export_type: 'rates' };
        query.forEach(function (value, key) {
            body[key] = value;
        });
        return body;
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

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function requestExportJob(format) {
        var response = await fetch(apiBase + '/exports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildExportRequestBody(format)),
        });
        if (!response.ok) throw new Error('Export failed (HTTP ' + response.status + ')');
        return response.json();
    }

    async function waitForExportJob(jobId) {
        var attempts = 0;
        while (attempts < 120) {
            attempts += 1;
            var response = await fetch(apiBase + '/exports/' + encodeURIComponent(jobId));
            if (!response.ok) throw new Error('Export status failed (HTTP ' + response.status + ')');
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
        var response = await fetch(apiBase + job.download_path);
        if (!response.ok) throw new Error('Export download failed (HTTP ' + response.status + ')');
        return {
            response: response,
            job: job,
        };
    }

    async function downloadViaJob(format) {
        var result = await fetchCompletedExport(format);
        var filename = parseFileName(
            result.response.headers.get('content-disposition'),
            safeSectionLabel() + '-export.' + format
        );
        var blob = await result.response.blob();
        triggerBlobDownload(blob, filename);
    }

    async function downloadXlsx() {
        if (!window.XLSX || !window.XLSX.utils) {
            throw new Error('XLSX library is unavailable');
        }

        var result = await fetchCompletedExport('json');
        var payload = await result.response.json();
        var rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
        var worksheet = window.XLSX.utils.json_to_sheet(rows);
        var workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Rates');

        window.XLSX.writeFile(workbook, safeSectionLabel() + '-export.xlsx');
    }

    async function downloadSelectedFormat(format) {
        var selected = String(format || '').toLowerCase().trim();
        if (!selected) return;

        if (downloadInFlight) return;
        downloadInFlight = true;
        try {
            if (selected === 'csv' || selected === 'json') {
                await downloadViaJob(selected);
            } else if (selected === 'xls') {
                await downloadXlsx();
            } else {
                throw new Error('Unsupported download format: ' + selected);
            }
            clientLog('info', 'Export download completed', { format: selected });
        } catch (err) {
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
