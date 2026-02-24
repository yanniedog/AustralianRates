(function () {
    'use strict';
    window.AR = window.AR || {};

    var CLIENT_LOG_QUEUE_MAX = 500;
    var clientLogQueue = [];

    function pct(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(3) + '%';
    }

    function money(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return '$' + n.toFixed(2);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function normalizeLevel(level) {
        var v = String(level || 'info').toLowerCase();
        if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
        return 'info';
    }

    function addToQueue(entry) {
        clientLogQueue.push(entry);
        if (clientLogQueue.length > CLIENT_LOG_QUEUE_MAX) {
            clientLogQueue.shift();
        }
    }

    function clientLog(level, message, detail) {
        var entryLevel = normalizeLevel(level);
        var entryMessage = String(message || '');
        if (typeof window.addSessionLog === 'function') {
            window.addSessionLog(entryLevel, entryMessage, detail);
            return;
        }
        addToQueue({ level: entryLevel, message: entryMessage, detail: detail });
    }

    function flushClientLogQueue() {
        if (typeof window.addSessionLog !== 'function' || clientLogQueue.length === 0) {
            return 0;
        }
        var entries = clientLogQueue.slice();
        clientLogQueue.length = 0;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            window.addSessionLog(entry.level, entry.message, entry.detail);
        }
        return entries.length;
    }

    window._arEsc = esc;
    window.AR.utils = {
        pct: pct,
        money: money,
        esc: esc,
        clientLog: clientLog,
        flushClientLogQueue: flushClientLogQueue,
    };
})();
