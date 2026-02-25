(function () {
    'use strict';
    window.AR = window.AR || {};

    var UTC = 'UTC';

    function asText(value) {
        if (value == null) return '';
        return String(value).trim();
    }

    function getUserTimeZone() {
        try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return tz ? String(tz) : UTC;
        } catch (_) {
            return UTC;
        }
    }

    function parseServerTimestamp(value) {
        var raw = asText(value);
        if (!raw) return { ok: false, raw: raw, reason: 'empty' };

        var normalized = raw;
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
            normalized = raw.replace(' ', 'T') + 'Z';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
            normalized = raw + 'Z';
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            normalized = raw + 'T00:00:00Z';
        }

        var date = new Date(normalized);
        if (!isFinite(date.getTime())) {
            return { ok: false, raw: raw, normalized: normalized, reason: 'invalid' };
        }

        return { ok: true, raw: raw, normalized: normalized, date: date };
    }

    function formatLocalDate(date, timeZone) {
        return new Intl.DateTimeFormat('en-AU', {
            timeZone: timeZone,
            year: 'numeric',
            month: 'short',
            day: '2-digit'
        }).format(date);
    }

    function formatLocalDateTime(date, timeZone) {
        return new Intl.DateTimeFormat('en-AU', {
            timeZone: timeZone,
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(date);
    }

    function formatCheckedAt(value, tz) {
        var timeZone = asText(tz) || getUserTimeZone();
        var parsed = parseServerTimestamp(value);
        if (!parsed.ok) {
            return {
                ok: false,
                text: 'Invalid timestamp',
                title: 'Invalid timestamp. Raw: ' + (parsed.raw || '(empty)')
            };
        }
        var rendered = formatLocalDateTime(parsed.date, timeZone) + ' (' + timeZone + ')';
        return {
            ok: true,
            text: rendered,
            title: 'Raw: ' + parsed.raw + ' | Timezone: ' + timeZone
        };
    }

    function formatSourceDateWithLocal(sourceDate, parsedAt, tz) {
        var canonical = asText(sourceDate) || '-';
        var timeZone = asText(tz) || getUserTimeZone();
        var parsed = parseServerTimestamp(parsedAt);
        if (!parsed.ok) {
            var fallbackTitle = 'Source date: ' + canonical;
            if (asText(parsedAt)) {
                fallbackTitle += ' | Local date unavailable (invalid parsed_at: ' + asText(parsedAt) + ')';
            }
            return {
                ok: false,
                text: canonical,
                title: fallbackTitle
            };
        }

        var localDate = formatLocalDate(parsed.date, timeZone);
        return {
            ok: true,
            text: canonical + ' (local: ' + localDate + ')',
            title: 'Source date: ' + canonical + ' | Local date in ' + timeZone + ': ' + localDate + ' | parsed_at: ' + parsed.raw
        };
    }

    window.AR.time = {
        getUserTimeZone: getUserTimeZone,
        parseServerTimestamp: parseServerTimestamp,
        formatCheckedAt: formatCheckedAt,
        formatSourceDateWithLocal: formatSourceDateWithLocal
    };
})();
