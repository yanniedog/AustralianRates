/**
 * Shared admin portal: token storage, auth guard, API client with Bearer.
 * All admin pages (except login) must call AR.AdminPortal.guard() first.
 */
(function () {
    // #region agent log
    try {
        fetch('http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'e952bc' }, body: JSON.stringify({ sessionId: 'e952bc', location: 'admin-portal.js:load', message: 'admin-portal.js loaded', data: { hasWindow: typeof window !== 'undefined' }, hypothesisId: 'H2', timestamp: Date.now() }) }).catch(function () {});
    } catch (err) {}
    // #endregion
    'use strict';
    var STORAGE_KEY = 'ar_admin_token';
    var API_BASE = (typeof window !== 'undefined' && window.location && window.location.origin)
        ? (window.location.origin + '/api/home-loan-rates')
        : '';

    function getToken() {
        try {
            var t = sessionStorage.getItem(STORAGE_KEY);
            return t ? String(t).trim() : '';
        } catch (e) {
            return '';
        }
    }

    function setToken(token) {
        try {
            sessionStorage.setItem(STORAGE_KEY, String(token).trim());
        } catch (e) {}
    }

    function clearToken() {
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
    }

    function authHeaders() {
        var t = getToken();
        return t ? { Authorization: 'Bearer ' + t } : {};
    }

    /** Redirect to login if no token. Call on dashboard, database, config, runs pages. */
    function guard() {
        var token = getToken();
        var path = (typeof window !== 'undefined' && window.location) ? window.location.pathname : '';
        var hasToken = !!(token && token.length);
        var willRedirect = !hasToken;
        // #region agent log
        try {
            fetch('http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'e952bc' }, body: JSON.stringify({ sessionId: 'e952bc', location: 'admin-portal.js:guard', message: 'guard() called', data: { path: path, tokenLength: token ? token.length : 0, hasToken: hasToken, willRedirect: willRedirect }, hypothesisId: 'H3', timestamp: Date.now() }) }).catch(function () {});
        } catch (err) {}
        // #endregion
        if (!hasToken) {
            var idx = path.indexOf('/admin');
            var adminBase = idx >= 0 ? path.substring(0, idx) + '/admin/' : '/admin/';
            window.location.href = adminBase;
            return false;
        }
        return true;
    }

    function logout() {
        clearToken();
        var path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
        var adminBase = path.substring(0, path.lastIndexOf('/') + 1) || '/admin/';
        window.location.href = adminBase + (adminBase.endsWith('admin/') ? '' : 'admin/');
    }

    /**
     * GET admin API. path e.g. '/config', '/db/tables', '/runs'
     */
    async function fetchAdmin(path, options) {
        var url = API_BASE + '/admin' + path;
        var opts = options || {};
        var headers = Object.assign({}, opts.headers || {}, authHeaders());
        var res = await fetch(url, Object.assign({}, opts, { headers: headers }));
        if (res.status === 401) {
            clearToken();
            var path = window.location.pathname || '';
            var idx = path.indexOf('/admin');
            var adminBase = idx >= 0 ? path.substring(0, idx) + '/admin/' : '/admin/';
            window.location.href = adminBase;
            throw new Error('Unauthorized');
        }
        return res;
    }

    window.AR = window.AR || {};
    window.AR.AdminPortal = {
        getToken: getToken,
        setToken: setToken,
        clearToken: clearToken,
        authHeaders: authHeaders,
        guard: guard,
        logout: logout,
        fetchAdmin: fetchAdmin,
        apiBase: function () { return API_BASE; },
    };
})();
