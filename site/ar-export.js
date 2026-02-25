(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var explorer = window.AR.explorer;
    var utils = window.AR.utils || {};
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
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

    async function downloadViaApi(format) {
        var q = buildExportQuery();
        q.set('format', format);
        var url = apiBase + '/export?' + q.toString();
        var response = await fetch(url);
        if (!response.ok) throw new Error('Export failed (HTTP ' + response.status + ')');
        var filename = parseFileName(response.headers.get('content-disposition'), safeSectionLabel() + '-export.' + format);
        var blob = await response.blob();
        triggerBlobDownload(blob, filename);
    }

    async function downloadXlsx() {
        if (!window.XLSX || !window.XLSX.utils) {
            throw new Error('XLSX library is unavailable');
        }

        var q = buildExportQuery();
        q.set('format', 'json');
        var url = apiBase + '/export?' + q.toString();
        var response = await fetch(url);
        if (!response.ok) throw new Error('Export failed (HTTP ' + response.status + ')');
        var payload = await response.json();
        var rows = payload && payload.data && Array.isArray(payload.data) ? payload.data : [];
        var worksheet = window.XLSX.utils.json_to_sheet(rows);
        var workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Rates');
        window.XLSX.writeFile(workbook, safeSectionLabel() + '-export.xlsx');
    }

    async function downloadSelectedFormat(format) {
        var selected = String(format || '').toLowerCase().trim();
        if (!selected || downloadInFlight) return;

        downloadInFlight = true;
        try {
            if (selected === 'csv' || selected === 'json') {
                await downloadViaApi(selected);
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
