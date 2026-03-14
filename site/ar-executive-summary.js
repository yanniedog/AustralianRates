(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config || {};
    var els = dom && dom.els ? dom.els : {};
    var utils = window.AR.utils || {};
    var network = window.AR.network || {};
    var esc = window._arEsc || function (v) { return String(v == null ? '' : v); };
    var clientLog = typeof utils.clientLog === 'function' ? utils.clientLog : function () {};
    var bankBrand = window.AR.bankBrand || {};
    var ymd = utils.ymdDate || function (value) { return String(value == null ? '' : value).trim() || '-'; };
    var sectionConfig = window.AR.sectionConfig || {};
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };
    var formatChangeWindow = utils.formatChangeWindow || function (previousValue, currentValue, options) {
        var settings = options || {};
        var previous = ymd(previousValue);
        var current = ymd(currentValue);
        if (current === '-') return settings.missingText || 'Date unavailable';
        if (previous !== '-' && previous !== current) return previous + ' -> ' + current;
        return (settings.throughPrefix != null ? String(settings.throughPrefix) : 'Through ') + current;
    };
    var requestTimeoutMs = Number(sectionConfig.requestTimeoutMs);
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) requestTimeoutMs = 10000;

    function getStatusEl() {
        return (els && els.executiveSummaryStatus) || document.getElementById('executive-summary-status');
    }

    function getContainerEl() {
        return (els && els.executiveSummarySections) || document.getElementById('executive-summary-sections');
    }

    function fmt(value, digits) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(Number.isFinite(digits) ? digits : 1);
    }

    function changeWindow(example) {
        if (!example) return 'Date unavailable';
        return formatChangeWindow(example.previous_collection_date, example.collection_date, {
            missingText: 'Date unavailable',
            throughPrefix: 'Through ',
        });
    }

    function standoutText(example, label) {
        if (!example) return label + ': none';
        var bank = bankBrand && typeof bankBrand.shortLabel === 'function'
            ? bankBrand.shortLabel(example.bank_name || '')
            : String(example.bank_name || '');
        return label + ': ' + esc(bank) + ' (' + fmt(example.delta_bps, 2) + ' bps, ' + changeWindow(example) + ')';
    }

    function renderMetric(label, value) {
        return (
            '<div class="exec-metric">' +
                '<div class="exec-metric-label">' + esc(label) + '</div>' +
                '<div class="exec-metric-value">' + esc(value) + '</div>' +
            '</div>'
        );
    }

    function getPrimaryDataset() {
        var section = String(
            (window.AR && window.AR.section) ||
            (document.body && document.body.getAttribute('data-ar-section')) ||
            ''
        ).trim();
        if (section === 'home-loans') return 'home_loans';
        if (section === 'term-deposits') return 'term_deposits';
        if (section === 'savings') return 'savings';
        return '';
    }

    function pickPrimarySections(sections) {
        if (!Array.isArray(sections) || sections.length === 0) return [];
        var primaryDataset = getPrimaryDataset();
        if (!primaryDataset) return sections.slice(0, 1);
        var matching = sections.filter(function (section) {
            return section && section.dataset === primaryDataset;
        });
        return matching.length ? matching : sections.slice(0, 1);
    }

    function renderSections(sections) {
        var container = getContainerEl();
        if (!container) return;
        if (!Array.isArray(sections) || sections.length === 0) {
            container.innerHTML = '<p class="exec-empty">No data</p>';
            return;
        }
        container.innerHTML = sections.map(function (section) {
            var metrics = section && section.metrics ? section.metrics : {};
            var concentration = section && section.concentration ? section.concentration : {};
            var standouts = section && section.standouts ? section.standouts : {};
            var topLender = concentration.top_lender;
            var windowStart = ymd(section.window_start || '');
            var windowEnd = ymd(section.window_end || '');
            var topLenderText = topLender
                ? (esc(bankBrand && typeof bankBrand.shortLabel === 'function' ? bankBrand.shortLabel(topLender.bank_name || '') : (topLender.bank_name || '')) + ' (' + fmt(topLender.change_count, 0) + ' changes, ' + fmt(topLender.share_pct, 1) + '%)')
                : 'none';
            var metricGrid = [
                renderMetric('Total changes through ' + windowEnd, fmt(metrics.total_changes, 0)),
                renderMetric('Lenders touched', fmt(metrics.lender_coverage, 0)),
                renderMetric('Up / Down', fmt(metrics.up_count, 0) + ' / ' + fmt(metrics.down_count, 0))
            ].join('');
            return (
                '<article class="exec-card">' +
                    '<div class="exec-kicker">' +
                        '<h3>' + esc(section.title || '') + '</h3>' +
                        '<p class="exec-window">' + esc(windowStart) + ' -> ' + esc(windowEnd) + '</p>' +
                    '</div>' +
                    '<div class="exec-metric-grid">' + metricGrid + '</div>' +
                    '<p class="exec-standouts">Top lender through ' + esc(windowEnd) + ': ' + topLenderText + '</p>' +
                    '<p class="exec-standouts">' + standoutText(standouts.largest_increase, 'Largest increase') + '</p>' +
                    '<p class="exec-standouts">' + standoutText(standouts.largest_decrease, 'Largest decrease') + '</p>' +
                '</article>'
            );
        }).join('');
    }

    function executiveSummaryEndpoint() {
        var apiBase = String(config.apiBase || '').trim() || (window.location.origin + '/api/home-loan-rates');
        try {
            var url = new URL(apiBase, window.location.origin);
            url.pathname = url.pathname.replace(/\/+$/, '') + '/executive-summary';
            url.search = '';
            url.hash = '';
            return url.toString() + '?window_days=30';
        } catch (_error) {
            return String(apiBase).replace(/\/+$/, '') + '/executive-summary?window_days=30';
        }
    }

    async function loadExecutiveSummary() {
        var statusEl = getStatusEl();
        var container = getContainerEl();
        if (!statusEl || !container) return;

        statusEl.textContent = 'WAIT';
        try {
            var endpoint = executiveSummaryEndpoint();
            var data = requestJson
                ? (await requestJson(endpoint, {
                    requestLabel: 'Executive summary',
                    timeoutMs: requestTimeoutMs,
                    retryCount: 1,
                    retryDelayMs: 700,
                })).data
                : await fetch(endpoint, { cache: 'no-store' }).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                });
            var sections = Array.isArray(data && data.sections) ? data.sections : [];
            renderSections(pickPrimarySections(sections));
            statusEl.textContent = esc(data.generated_at || 'n/a');
        } catch (err) {
            statusEl.textContent = 'ERR';
            container.innerHTML = '<p class="exec-empty">Unavailable</p>';
            clientLog('error', 'Executive summary load failed', {
                message: describeError(err, 'Executive summary is temporarily unavailable.'),
            });
        }
    }

    window.AR.executiveSummary = {
        loadExecutiveSummary: loadExecutiveSummary,
    };
})();
