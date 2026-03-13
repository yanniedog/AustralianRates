(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal) return;

    var portal = window.AR.AdminPortal;
    var msgEl = document.getElementById('exports-msg');
    var msgTimer = null;

    function showMsg(text, isError) {
        var normalized = String(text || '').trim();
        if (!msgEl) return;
        if (msgTimer) clearTimeout(msgTimer);
        if (isError && normalized && normalized.indexOf('Error:') !== 0) {
            normalized = 'Error: ' + normalized;
        }
        msgEl.textContent = normalized;
        msgEl.className = 'admin-message visible ' + (isError ? 'error' : 'success');
        msgTimer = setTimeout(function () { msgEl.classList.remove('visible'); }, 5000);
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

    async function downloadOperationalBundle(bundle, onProgress) {
        var blobs = [];
        if (!bundle) throw new Error('Operational snapshot bundle is not available.');
        if (bundle.downloadPath) {
            await downloadArtifact(bundle.downloadPath, bundle.fileName);
            return;
        }
        if (!bundle.parts || !bundle.parts.length) throw new Error('Operational snapshot parts are not available.');
        for (var index = 0; index < bundle.parts.length; index += 1) {
            var part = bundle.parts[index];
            var response;
            if (onProgress) onProgress(index + 1, bundle.parts.length);
            response = await fetch(portal.apiBase() + String(part.download_path || ''), {
                cache: 'no-store',
                headers: portal.authHeaders()
            });
            if (!response.ok) throw new Error('Snapshot part ' + (index + 1) + ' of ' + bundle.parts.length + ' failed (' + response.status + ').');
            blobs.push(await response.blob());
        }
        triggerBlobDownload(new Blob(blobs, { type: 'application/gzip' }), bundle.fileName || 'operational-all-snapshot.jsonl.gz');
    }

    window.AR.AdminExportsRuntime = {
        downloadArtifact: downloadArtifact,
        downloadOperationalBundle: downloadOperationalBundle,
        requestJson: requestJson,
        showMsg: showMsg
    };
})();
