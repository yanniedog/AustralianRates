(function () {
    'use strict';

    if (!window.AR || !window.AR.AdminPortal) return;

    var portal = window.AR.AdminPortal;
    var msgEl = document.getElementById('exports-msg');
    var msgTextEl = document.getElementById('exports-msg-copy');
    var msgDismissEl = document.getElementById('exports-msg-dismiss');
    var msgTimer = null;

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
        if (isError && normalized.indexOf('Error:') !== 0) normalized = 'Error: ' + normalized;
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
                    var error = new Error(payload && payload.error && payload.error.message ? payload.error.message : ('Request failed (' + response.status + ')'));
                    if (payload && payload.error) {
                        error.code = payload.error.code || '';
                        error.details = payload.error.details;
                    }
                    throw error;
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

    async function downloadFile(path, fileName) {
        var response;
        if (!path) throw new Error('Download is not ready yet.');
        response = await fetch(portal.apiBase() + path, {
            cache: 'no-store',
            headers: portal.authHeaders()
        });
        if (!response.ok) throw new Error('Download failed (' + response.status + ').');
        triggerBlobDownload(await response.blob(), fileName || 'australianrates-database-full.sql.gz');
    }

    if (msgDismissEl) msgDismissEl.addEventListener('click', hideMsg);

    window.AR.AdminExportsRuntime = {
        downloadFile: downloadFile,
        hideMsg: hideMsg,
        requestJson: requestJson,
        showMsg: showMsg
    };
})();
