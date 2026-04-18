(function () {
    'use strict';
    window.AR = window.AR || {};

    var utils = window.AR.utils || {};
    var clientLog = typeof utils.clientLog === 'function' ? utils.clientLog : function () {};

    function asPositiveInt(value, fallback) {
        var next = Number(value);
        if (!Number.isFinite(next) || next <= 0) return fallback;
        return Math.round(next);
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, ms);
        });
    }

    function requestLabel(url, fallback) {
        try {
            return new URL(String(url || ''), window.location.href).pathname || String(fallback || url || 'request');
        } catch (_error) {
            return String(fallback || url || 'request');
        }
    }

    function buildUserMessage(label, status, timeoutMs, timedOut) {
        if (timedOut) return String(label) + ' timed out after ' + Math.max(1, Math.round(timeoutMs / 1000)) + 's.';
        if (Number.isFinite(status)) return String(label) + ' returned HTTP ' + status + '.';
        return String(label) + ' could not be loaded.';
    }

    function normalizeError(error, label, timeoutMs, timedOut) {
        var status = error && Number.isFinite(Number(error.status)) ? Number(error.status) : null;
        var originalMessage = error && error.message ? String(error.message) : String(error || 'Request failed');
        var wrapped = new Error(buildUserMessage(label, status, timeoutMs, timedOut));

        wrapped.code = timedOut
            ? 'timeout'
            : status != null
                ? ('http_' + status)
                : (/abort/i.test(originalMessage) ? 'aborted' : 'network');
        wrapped.status = status;
        wrapped.timeoutMs = timeoutMs;
        wrapped.userMessage = wrapped.message;
        wrapped.requestLabel = label;
        wrapped.originalMessage = originalMessage;
        wrapped.payload = error && error.payload !== undefined ? error.payload : null;
        wrapped.cause = error || null;
        return wrapped;
    }

    function isRetriable(error) {
        if (!error || !error.code) return false;
        if (error.code === 'timeout' || error.code === 'network' || error.code === 'aborted') return true;
        return /^http_(408|409|425|429|5\d\d)$/.test(String(error.code));
    }

    /** Append cache_bust to URL when AR.state.state.cacheBust is set, so Worker cache is bypassed. */
    function appendCacheBust(url) {
        var u = String(url || '').trim();
        if (!u) return u;
        var state = window.AR && window.AR.state && window.AR.state.state ? window.AR.state.state : null;
        var bust = state && (state.cacheBust != null) ? state.cacheBust : null;
        if (bust == null) return u;
        try {
            var parsed = new URL(u, window.location.origin);
            parsed.searchParams.set('cache_bust', String(bust));
            return parsed.toString();
        } catch (_) {
            var sep = u.indexOf('?') >= 0 ? '&' : '?';
            return u + sep + 'cache_bust=' + encodeURIComponent(String(bust));
        }
    }

    function sortQueryParams(url) {
        var u = String(url || '').trim();
        if (!u) return u;
        try {
            var parsed = new URL(u, window.location.href);
            var entries = [];
            parsed.searchParams.forEach(function (value, key) {
                entries.push([key, value]);
            });
            entries.sort(function (left, right) {
                if (left[0] === right[0]) return String(left[1]).localeCompare(String(right[1]));
                return String(left[0]).localeCompare(String(right[0]));
            });
            parsed.search = '';
            entries.forEach(function (entry) {
                parsed.searchParams.append(entry[0], entry[1]);
            });
            return parsed.toString();
        } catch (_error) {
            return u;
        }
    }

    function prepareRequestUrl(url, options) {
        var opts = options || {};
        var nextUrl = String(url || '').trim();
        if (!nextUrl) return nextUrl;
        if (opts.sortQuery) nextUrl = sortQueryParams(nextUrl);
        if (!opts.skipCacheBust) nextUrl = appendCacheBust(nextUrl);
        return nextUrl;
    }

    /** Maximum time a snapshottable request will wait for /snapshot to arrive before falling through to network. */
    var SNAPSHOT_WAIT_BUDGET_MS = 1200;

    function readSnapshotCache(rawUrl) {
        var snap = window.AR && window.AR.snapshot;
        if (!snap || typeof snap.lookup !== 'function') return null;
        return snap.lookup(rawUrl);
    }

    async function awaitSnapshotIfApplicable(rawUrl, opts) {
        if (opts && opts.bypassSnapshot) return;
        var snap = window.AR && window.AR.snapshot;
        if (!snap) return;
        if (typeof snap.lookup === 'function' && snap.lookup(rawUrl) != null) return;
        if (snap.failed) return;
        if (typeof snap.isSnapshottableUrl !== 'function' || !snap.isSnapshottableUrl(rawUrl)) return;
        var budget = asPositiveInt(opts && opts.snapshotWaitMs, SNAPSHOT_WAIT_BUDGET_MS);
        try {
            if (typeof snap.awaitUrl === 'function') {
                await snap.awaitUrl(rawUrl, budget);
                return;
            }
            if (typeof snap.awaitReady === 'function') {
                await snap.awaitReady(budget);
            }
        } catch (_err) { /* ignore */ }
    }

    async function requestJson(url, options) {
        var opts = options || {};
        var rawUrl = String(url || '');
        url = prepareRequestUrl(rawUrl, opts);
        var timeoutMs = asPositiveInt(opts.timeoutMs, 12000);
        var retryCount = Math.max(0, Math.floor(Number(opts.retryCount || 0)));
        var retryDelayMs = asPositiveInt(opts.retryDelayMs, 650);
        var label = String(opts.requestLabel || requestLabel(url, 'request'));
        var lastError = null;

        if (!opts.bypassSnapshot) {
            await awaitSnapshotIfApplicable(rawUrl, opts);
            var cached = readSnapshotCache(rawUrl);
            if (cached != null) {
                var cachedText = JSON.stringify(cached);
                return { data: cached, response: null, text: cachedText, attempts: 0, fromSnapshot: true };
            }
        }

        for (var attempt = 0; attempt <= retryCount; attempt += 1) {
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timedOut = false;
            var timerId = controller
                ? window.setTimeout(function () {
                    timedOut = true;
                    controller.abort();
                }, timeoutMs)
                : 0;

            try {
                var response = await fetch(url, {
                    method: opts.method || 'GET',
                    headers: opts.headers,
                    body: opts.body,
                    cache: opts.cache || 'no-store',
                    signal: controller ? controller.signal : undefined,
                });
                var text = await response.text();
                var data = null;

                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch (parseError) {
                        if (response.ok) {
                            parseError.status = response.status;
                            throw parseError;
                        }
                    }
                }

                if (!response.ok) {
                    var httpError = new Error('HTTP ' + response.status);
                    httpError.status = response.status;
                    httpError.payload = data;
                    throw httpError;
                }

                if (timerId) window.clearTimeout(timerId);
                return {
                    data: data,
                    response: response,
                    text: text,
                    attempts: attempt + 1,
                };
            } catch (error) {
                if (timerId) window.clearTimeout(timerId);
                lastError = normalizeError(error, label, timeoutMs, timedOut);
                if (attempt >= retryCount || opts.retry === false || !isRetriable(lastError)) {
                    throw lastError;
                }

                clientLog('warn', 'Retrying request', {
                    request: label,
                    attempt: attempt + 1,
                    totalAttempts: retryCount + 1,
                    code: lastError.code,
                    status: lastError.status,
                });
                await wait(retryDelayMs * (attempt + 1));
            }
        }

        throw lastError || new Error(label + ' failed');
    }

    function describeError(error, fallback) {
        if (error && error.userMessage) return String(error.userMessage);
        if (error && error.message) return String(error.message);
        return String(fallback || 'Request failed.');
    }

    function isTimeoutError(error) {
        return !!(error && error.code === 'timeout');
    }

    window.AR.network = {
        appendCacheBust: appendCacheBust,
        describeError: describeError,
        isRetriable: isRetriable,
        isTimeoutError: isTimeoutError,
        prepareRequestUrl: prepareRequestUrl,
        requestJson: requestJson,
        sortQueryParams: sortQueryParams,
    };
})();
