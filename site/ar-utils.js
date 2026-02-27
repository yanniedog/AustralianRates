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

    function asText(value) {
        if (value == null) return '';
        return String(value).trim();
    }

    function toTitleWords(value) {
        return String(value || '')
            .split(' ')
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
    }

    function humanizeCode(value) {
        var raw = asText(value);
        if (!raw) return '';
        var spaced = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        return toTitleWords(spaced);
    }

    function trimTrailingZeros(input) {
        if (String(input).indexOf('.') === -1) return String(input);
        return String(input).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    }

    function compactAmount(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '';
        if (n >= 1000000) return '$' + trimTrailingZeros((n / 1000000).toFixed(1)) + 'm';
        if (n >= 1000) return '$' + trimTrailingZeros((n / 1000).toFixed(1)) + 'k';
        return '$' + trimTrailingZeros(n.toFixed(n % 1 === 0 ? 0 : 2));
    }

    function normalizeAmountToken(token) {
        var raw = asText(token).replace(/\s+/g, '');
        if (!raw) return '';
        var m = raw.match(/^\$?(\d+(?:\.\d+)?)([kKmM]?)$/);
        if (m) {
            var amount = Number(m[1]);
            var suffix = String(m[2] || '').toLowerCase();
            if (!Number.isFinite(amount)) return raw;
            if (!suffix) return compactAmount(amount);
            return ('$' + trimTrailingZeros(amount.toFixed(1)) + suffix).replace(/\.0([km])$/, '$1');
        }
        return raw.replace(/\.0(?=[kKmM]\b)/g, '').replace(/[kKmM]\b/g, function (x) { return x.toLowerCase(); });
    }

    function formatDepositTier(value, minValue, maxValue) {
        var min = Number(minValue);
        var max = Number(maxValue);
        var hasMin = Number.isFinite(min);
        var hasMax = Number.isFinite(max);
        if (hasMin || hasMax) {
            if (hasMin && hasMax) return compactAmount(min) + ' to ' + compactAmount(max);
            if (hasMin) return compactAmount(min) + '+';
            if (hasMax) return 'Up to ' + compactAmount(max);
        }

        var raw = asText(value);
        if (!raw) return '';
        if (raw.toLowerCase() === 'all') return 'All balances';

        var range = raw.split('-');
        if (range.length === 2) {
            var start = normalizeAmountToken(range[0]);
            var end = normalizeAmountToken(range[1]);
            if (start && end) return start + ' to ' + end;
        }

        if (/\+$/.test(raw)) return normalizeAmountToken(raw.slice(0, -1)) + '+';
        var upTo = raw.match(/^up\s*to\s+(.+)$/i);
        if (upTo) return 'Up to ' + normalizeAmountToken(upTo[1]);
        return normalizeAmountToken(raw);
    }

    function formatEnum(field, value) {
        var v = asText(value).toLowerCase();
        if (!v) return '';

        if (field === 'security_purpose') {
            if (v === 'owner_occupied') return 'Owner occupied';
            if (v === 'investment') return 'Investment';
        }
        if (field === 'repayment_type') {
            if (v === 'principal_and_interest') return 'Principal & Interest';
            if (v === 'interest_only') return 'Interest only';
        }
        if (field === 'rate_structure') {
            if (v === 'variable') return 'Variable';
            var fixed = v.match(/^fixed_(\d+)yr$/);
            if (fixed) {
                var years = Number(fixed[1]);
                return 'Fixed ' + years + ' ' + (years === 1 ? 'year' : 'years');
            }
        }
        if (field === 'lvr_tier') {
            if (v === 'lvr_=60%') return '<=60%';
            var lvrRange = v.match(/^lvr_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/);
            if (lvrRange) return lvrRange[1] + '-' + lvrRange[2] + '%';
        }
        if (field === 'feature_set') {
            if (v === 'basic') return 'Basic';
            if (v === 'premium') return 'Premium';
        }
        if (field === 'account_type' && v === 'at_call') return 'At call';
        if (field === 'interest_payment' && v === 'at_maturity') return 'At maturity';
        if (field === 'retrieval_type') {
            if (v === 'historical_scrape') return 'Historical scrape';
            if (v === 'present_scrape_same_date' || v === 'cdr_live') return 'Present scrape (same date)';
        }
        if (field === 'data_quality_flag') {
            if (v.indexOf('parsed_from_wayback') === 0) return 'Historical (Wayback)';
            if (v.indexOf('cdr_live') === 0) return 'CDR live';
            if (v.indexOf('scraped_fallback') === 0) return 'Web fallback';
            if (v === 'ok') return 'Legacy verified';
        }
        if (field === 'term_months') {
            var months = Number(v);
            if (Number.isFinite(months)) return String(months) + ' month' + (months === 1 ? '' : 's');
        }

        return humanizeCode(v);
    }

    function cleanConditionsText(value) {
        var raw = asText(value);
        if (!raw) return '';
        var parts = raw.split(/[\n|]+/);
        var seen = {};
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var normalized = parts[i].replace(/\s+/g, ' ').trim();
            if (!normalized) continue;
            if (/^P(?:\d+[YMWD])*(?:T\d+[HMS])*$/i.test(normalized)) continue;
            var key = normalized.toLowerCase();
            if (seen[key]) continue;
            seen[key] = true;
            out.push(normalized);
        }
        return out.join(' | ');
    }

    function truncateText(value, maxLen) {
        var text = asText(value);
        var limit = Number(maxLen);
        if (!Number.isFinite(limit) || limit <= 0) limit = 140;
        if (text.length <= limit) return text;
        return text.slice(0, limit - 1) + '...';
    }

    function formatFilterValue(field, value) {
        if (field === 'deposit_tier') return formatDepositTier(value);
        return formatEnum(field, value) || asText(value);
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
        if (entryLevel === 'error') {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[Client error]', entryMessage, detail != null ? detail : '');
            }
        }
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
        formatEnum: formatEnum,
        formatDepositTier: formatDepositTier,
        cleanConditionsText: cleanConditionsText,
        truncateText: truncateText,
        formatFilterValue: formatFilterValue,
        clientLog: clientLog,
        flushClientLogQueue: flushClientLogQueue,
    };
})();
