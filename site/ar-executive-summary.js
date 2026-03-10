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
        return label + ': ' + esc(example.bank_name || '') + ' (' + fmt(example.delta_bps, 2) + ' bps)';
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
            var metricGrid = [
                renderMetric('Total changes', fmt(metrics.total_changes, 0)),
                renderMetric('Lenders touched', fmt(metrics.lender_coverage, 0)),
                renderMetric('Up / Down', fmt(metrics.up_count, 0) + ' / ' + fmt(metrics.down_count, 0))
            ].join('');
            var narrative = String(section.narrative || '').trim();
            if (narrative.length > 140) narrative = narrative.slice(0, 137).trim() + '...';
            return (
                '<article class="exec-card">' +
                    '<div class="exec-kicker">' +
                        '<h3>' + esc(section.title || '') + '</h3>' +
                        '<p class="exec-window">' + esc(section.window_start || '') + ' to ' + esc(section.window_end || '') + '</p>' +
                    '</div>' +
                    '<div class="exec-metric-grid">' + metricGrid + '</div>' +
                    '<p class="exec-standouts">Top lender: ' + topLenderText + '</p>' +
                    '<p class="exec-standouts">' + standoutText(standouts.largest_increase, 'Largest increase') + '</p>' +
                    '<p class="exec-narrative">' + esc(narrative || 'No additional narrative.') + '</p>' +
                '</article>'
            );
        }).join('');
    }

    async function loadExecutiveSummary() {
        var statusEl = getStatusEl();
        var container = getContainerEl();
        if (!statusEl || !container) return;

        statusEl.textContent = 'Loading summary...';
        try {
            var endpoint = window.location.origin + '/api/home-loan-rates/executive-summary?window_days=30';
            var res = await fetch(endpoint, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            var sections = Array.isArray(data && data.sections) ? data.sections : [];
            renderSections(pickPrimarySections(sections));
            statusEl.textContent = 'Updated ' + esc(data.generated_at || 'n/a') + '.';
        } catch (err) {
            statusEl.textContent = 'Summary unavailable right now.';
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
