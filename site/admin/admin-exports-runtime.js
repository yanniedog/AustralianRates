(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal) return;

    var portal = window.AR.AdminPortal;
    var msgEl = document.getElementById('exports-msg');
    var msgTextEl = document.getElementById('exports-msg-copy');
    var msgDismissEl = document.getElementById('exports-msg-dismiss');
    var msgTimer = null;
    var STORAGE_PREFIX = 'ar.admin.exports.cursor.';

    function hideMsg() {
        if (!msgEl) return;
        if (msgTimer) clearTimeout(msgTimer);
        msgTimer = null;
        msgEl.classList.remove('visible');
    }

    function showMsg(text, isError) {
        var normalized = String(text || '').trim();
        if (!msgEl) return;
        if (!normalized) {
            hideMsg();
            return;
        }
        if (msgTimer) clearTimeout(msgTimer);
        if (isError && normalized && normalized.indexOf('Error:') !== 0) {
            normalized = 'Error: ' + normalized;
        }
        if (msgTextEl) msgTextEl.textContent = normalized;
        if (!msgTextEl) msgEl.textContent = normalized;
        msgEl.className = 'admin-message visible ' + (isError ? 'error' : 'success');
        msgEl.setAttribute('role', isError ? 'alert' : 'status');
        msgEl.setAttribute('aria-live', isError ? 'assertive' : 'polite');
        msgTimer = setTimeout(hideMsg, 5000);
    }

    function requestJson(path, options) {
        return portal.fetchAdmin(path, options).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
                if (!response.ok || !payload || payload.ok !== true) {
                    throw new Error(payload && payload.error && payload.error.message ? payload.error.message : ('Request failed (' + response.status + ')'));
                }
                return payload;
            });
        });
    }

    function triggerBlobDownload(blob, fileName) {
        var href = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = href;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
    }

    async function downloadArtifact(path, fileName) {
        var response;
        if (!path) throw new Error('Download is not ready yet.');
        response = await fetch(portal.apiBase() + path, {
            cache: 'no-store',
            headers: portal.authHeaders()
        });
        if (!response.ok) throw new Error('Download failed (' + response.status + ').');
        triggerBlobDownload(await response.blob(), fileName || 'admin-download.jsonl.gz');
    }

    function storageKey(sectionKey, scope) {
        return STORAGE_PREFIX + String(sectionKey || '') + '.' + String(scope || 'all');
    }

    function readStoredCursor(sectionKey, scope) {
        try {
            if (!window.localStorage) return '';
            return String(window.localStorage.getItem(storageKey(sectionKey, scope)) || '').trim();
        } catch (_) {
            return '';
        }
    }

    function writeStoredCursor(sectionKey, scope, value) {
        var normalized = String(value == null ? '' : value).trim();
        try {
            if (!window.localStorage) return normalized;
            if (normalized) window.localStorage.setItem(storageKey(sectionKey, scope), normalized);
            if (!normalized) window.localStorage.removeItem(storageKey(sectionKey, scope));
        } catch (_) {
            return normalized;
        }
        return normalized;
    }

    async function downloadOperationalBundle(bundle, onProgress) {
        var blobs = [];
        if (!bundle) throw new Error('Operational snapshot bundle is not available.');
        if (bundle.downloadPath) {
            await downloadArtifact(bundle.downloadPath, bundle.fileName);
            return;
        }
        if (!bundle.parts || !bundle.parts.length) throw new Error('Operational snapshot parts are not available.');
        for (var index = 0; index < bundle.parts.length; index += 1) {
            var part = bundle.parts[index] || {};
            var partName = String(part.file_name || ('part ' + (index + 1)));
            var partPath = String(part.download_path || '');
            var response;
            if (onProgress) onProgress(index + 1, bundle.parts.length, partName);
            if (!partPath) throw new Error('Snapshot part ' + (index + 1) + ' of ' + bundle.parts.length + ' (' + partName + ') is missing a download path.');
            response = await fetch(portal.apiBase() + partPath, {
                cache: 'no-store',
                headers: portal.authHeaders()
            });
            if (!response.ok) throw new Error('Snapshot part ' + (index + 1) + ' of ' + bundle.parts.length + ' (' + partName + ') failed with HTTP ' + response.status + '.');
            blobs.push(await response.blob());
        }
        triggerBlobDownload(new Blob(blobs, { type: 'application/gzip' }), bundle.fileName || 'operational-all-snapshot.jsonl.gz');
    }

    if (msgDismissEl) msgDismissEl.addEventListener('click', hideMsg);

    window.AR.AdminExportsRuntime = {
        downloadArtifact: downloadArtifact,
        downloadOperationalBundle: downloadOperationalBundle,
        hideMsg: hideMsg,
        readStoredCursor: readStoredCursor,
        requestJson: requestJson,
        showMsg: showMsg,
        writeStoredCursor: writeStoredCursor
    };
})();
