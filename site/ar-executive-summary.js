(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var els = dom && dom.els ? dom.els : {};
    var utils = window.AR.utils || {};
    var esc = window._arEsc || function (v) { return String(v == null ? '' : v); };
    var clientLog = typeof utils.clientLog === 'function' ? utils.clientLog : function () {};

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

    function standoutText(example, label) {
        if (!example) return label + ': none';
        return label + ': ' + esc(example.bank_name || '') + ' - ' + esc(example.product_name || '') + ' (' + fmt(example.delta_bps, 2) + ' bps)';
    }

    function renderSections(sections) {
        var container = getContainerEl();
        if (!container) return;
        if (!Array.isArray(sections) || sections.length === 0) {
            container.innerHTML = '<p class="exec-empty">No executive summary sections available.</p>';
            return;
        }
        container.innerHTML = sections.map(function (section) {
            var metrics = section && section.metrics ? section.metrics : {};
            var concentration = section && section.concentration ? section.concentration : {};
            var standouts = section && section.standouts ? section.standouts : {};
            var topLender = concentration.top_lender;
            var topLenderText = topLender
                ? (esc(topLender.bank_name || '') + ' (' + fmt(topLender.change_count, 0) + ', ' + fmt(topLender.share_pct, 1) + '%)')
                : 'none';
            return (
                '<article class="exec-card">' +
                    '<h3>' + esc(section.title || '') + '</h3>' +
                    '<p class="exec-window">Window: ' + esc(section.window_start || '') + ' to ' + esc(section.window_end || '') + '</p>' +
                    '<p class="exec-metric-line"><strong>' + fmt(metrics.total_changes, 0) + '</strong> changes across <strong>' + fmt(metrics.lender_coverage, 0) + '</strong> lenders.</p>' +
                    '<p class="exec-metric-line">Up/Down split: ' + fmt(metrics.up_count, 0) + ' / ' + fmt(metrics.down_count, 0) + '</p>' +
                    '<p class="exec-metric-line">Mean/Median move: ' + fmt(metrics.mean_move_bps, 2) + ' bps / ' + fmt(metrics.median_move_bps, 2) + ' bps</p>' +
                    '<p class="exec-metric-line">Top lender concentration: ' + topLenderText + '</p>' +
                    '<p class="exec-metric-line">' + standoutText(standouts.largest_increase, 'Largest increase') + '</p>' +
                    '<p class="exec-metric-line">' + standoutText(standouts.largest_decrease, 'Largest decrease') + '</p>' +
                    '<p class="exec-narrative">' + esc(section.narrative || '') + '</p>' +
                '</article>'
            );
        }).join('');
    }

    async function loadExecutiveSummary() {
        var statusEl = getStatusEl();
        var container = getContainerEl();
        if (!statusEl || !container) return;

        statusEl.textContent = 'Loading executive summary...';
        try {
            var endpoint = window.location.origin + '/api/home-loan-rates/executive-summary?window_days=30';
            var res = await fetch(endpoint, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            var sections = Array.isArray(data && data.sections) ? data.sections : [];
            renderSections(sections);
            statusEl.textContent = 'Executive summary generated at ' + esc(data.generated_at || 'n/a') + '.';
        } catch (err) {
            statusEl.textContent = 'Executive summary unavailable right now.';
            container.innerHTML = '<p class="exec-empty">Unable to load summary data.</p>';
            clientLog('error', 'Executive summary load failed', {
                message: err && err.message ? err.message : String(err),
            });
        }
    }

    window.AR.executiveSummary = {
        loadExecutiveSummary: loadExecutiveSummary,
    };
})();
