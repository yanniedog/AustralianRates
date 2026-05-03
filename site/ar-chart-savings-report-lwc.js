/**
 * Savings rate report — ECharts ribbon (min–max bands per institution). RBA + CPI via chartReportPlot.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    var BANK_SHORT = {
        'commonwealth bank of australia': 'CBA',
        'westpac banking corporation':    'WBC',
        'anz':                            'ANZ',
        'national australia bank':        'NAB',
        'macquarie bank':                 'MQG',
        'ing':                            'ING',
        'ubank':                          'UBank',
        'bankwest':                       'BWT',
        'bank of queensland':             'BOQ',
        'suncorp bank':                   'SUN',
        'great southern bank':            'GSB',
        'amp bank':                       'AMP',
        'bendigo and adelaide bank':      'BEN',
        'bank of melbourne':              'BoM',
        'st. george bank':                'STG',
        'hsbc australia':                 'HSBC',
        'teachers mutual bank':           'TMB',
        'beyond bank australia':          'BBA',
        'me bank':                        'MEB',
        'mystate bank':                   'MYS',
    };
    var BANK_COLOR = {
        'commonwealth bank of australia': '#e8b400',
        'westpac banking corporation':    '#d50032',
        'anz':                            '#0033a0',
        'national australia bank':        '#8a1538',
        'macquarie bank':                 '#006d5b',
        'ing':                            '#ff6200',
        'ubank':                          '#7d3e84',
        'bankwest':                       '#4a8f26',
        'bank of queensland':             '#00a3e0',
        'suncorp bank':                   '#1b5fa8',
        'great southern bank':            '#00a651',
        'amp bank':                       '#c85a00',
        'bendigo and adelaide bank':      '#a6192e',
        'bank of melbourne':              '#6b1f3a',
        'st. george bank':                '#b8000a',
        'hsbc australia':                 '#cc0000',
        'teachers mutual bank':           '#1a6b3c',
        'beyond bank australia':          '#005ea8',
        'me bank':                        '#003b6f',
        'mystate bank':                   '#e05c00',
    };

    function bankShort(name) {
        var shared = window.AR && window.AR.chartMacroLwcShared;
        if (shared && typeof shared.bankAcronym === 'function') return shared.bankAcronym(name);
        var k = String(name || '').trim().toLowerCase();
        return BANK_SHORT[k] || String(name || '').slice(0, 12).trim();
    }
    function bankColor(name, idx) {
        var k = String(name || '').trim().toLowerCase();
        var u = window.AR && window.AR.utils;
        var lead = u && typeof u.resolveSectionRibbonAccentHex === 'function' ? u.resolveSectionRibbonAccentHex() : '#10b981';
        return BANK_COLOR[k] || [lead,'#27c27a','#f0b90b','#f97316','#8b5cf6','#ef4444','#14b8a6','#64748b','#a78bfa','#fb923c'][idx % 10];
    }

    function isDark() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    }
    function th() {
        var dark = isDark();
        var u = window.AR && window.AR.utils;
        var cross = u && typeof u.sectionRibbonCrosshairLineRgba === 'function'
            ? u.sectionRibbonCrosshairLineRgba(dark)
            : (dark ? 'rgba(99,179,237,0.60)' : 'rgba(37,99,235,0.55)');
        return {
            text:     dark ? '#e2e8f0'                : '#0f172a',
            muted:    dark ? '#94a3b8'                : '#64748b',
            grid:     dark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.16)',
            axis:     dark ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.35)',
            crosshairLine: cross,
            crosshairLabelBg: dark ? 'rgba(15,20,25,0.96)' : 'rgba(255,255,255,0.98)',
            rba:      '#f59e0b',
            cpi:      dark ? '#f87171'                : '#dc2626',
            ttBg:     dark ? 'rgba(15,23,42,0.96)'    : 'rgba(255,255,255,0.97)',
            ttBorder: dark ? 'rgba(100,116,139,0.30)' : 'rgba(100,116,139,0.20)',
            ttText:   dark ? '#e2e8f0'                : '#1e293b',
            good:     dark ? '#34d399'                : '#059669',
            bad:      dark ? '#f87171'                : '#dc2626',
        };
    }

    function todayYmd() { return new Date().toISOString().slice(0, 10); }

    function extractBankNames(allSeries) {
        var seen = {};
        var list = [];
        (allSeries || []).forEach(function (s) {
            var bn = String(s.bankName || '').trim();
            if (!bn) return;
            var k = bn.toLowerCase();
            if (seen[k]) return;
            seen[k] = true;
            list.push({ full: bn, short: bankShort(bn) });
        });
        list.sort(function (a, b) { return a.short.localeCompare(b.short); });
        return list;
    }

    function createInfoBox(t) {
        var M = window.AR.chartMacroLwcShared;
        return M.createReportSelectionInfoBox(t);
    }

    function render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries) {
        if (!container) return null;
        var M = window.AR.chartMacroLwcShared;
        var reportPlot = window.AR.chartReportPlot;
        if (!M || typeof M.prepareRbaCpiForReport !== 'function') {
            throw new Error('chartMacroLwcShared not loaded');
        }
        if (!reportPlot || typeof reportPlot.render !== 'function') {
            container.textContent = 'Chart module unavailable.';
            return null;
        }

        if (container._reportDispose) {
            try { container._reportDispose(); } catch (_) {}
            container._reportDispose = null;
        }

        var section = window.AR.section || 'savings';
        var vm = M.getViewMode(section);
        var reportRange = M.getReportRange(section);
        var allSeries = (model && (model.allSeries || model.visibleSeries)) || [];
        container.setAttribute('data-report-view-mode', vm.mode);

        var plotPayload = model && model.reportPlots ? model.reportPlots.bands : null;
        var combinedRange = reportPlot.combinedDateRange
            ? reportPlot.combinedDateRange(plotPayload, model)
            : reportPlot.payloadDateRange(plotPayload);
        var plotMin = combinedRange.minDate || todayYmd();
        var plotMax = combinedRange.maxDate || plotMin;
        var dataMinPlot = reportRange === 'All'
            ? (M.resolveReportDataMin(plotMin, rbaHistory, cpiData, economicOverlaySeries) || plotMin)
            : plotMin;
        var ctxMaxPlot = plotMax;
        var viewStartPlot = reportRange === 'All'
            ? dataMinPlot
            : M.resolveReportRangeStart(plotMin, ctxMaxPlot, reportRange);
        var tBandsSav = th();
        var infoBoxBandsSav = createInfoBox(tBandsSav);
        var bandsTraySav =
            reportPlot.bankTrayEntriesFromBandsPayload &&
            reportPlot.bankTrayEntriesFromBandsPayload(plotPayload, bankShort);
        var plotState = reportPlot.render({
            container: container,
            section: section,
            vm: vm,
            reportViewKind: 'economicReport',
            bankList: bandsTraySav != null ? bandsTraySav : extractBankNames(allSeries),
            plotPayload: plotPayload,
            allSeries: allSeries,
            range: {
                reportRange: reportRange,
                dataMin: dataMinPlot,
                ctxMax: ctxMaxPlot,
                viewStart: viewStartPlot,
                chartStart: viewStartPlot,
            },
            theme: tBandsSav,
            rbaHistory: rbaHistory,
            cpiData: cpiData,
            economicOverlaySeries: economicOverlaySeries,
            slicePairParams: model && model.slicePairParams ? model.slicePairParams : null,
            bankColor: bankColor,
            noteText: '',
            infoBox: infoBoxBandsSav,
            onReRender: function () {
                render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
            },
            onRangeChange: function () {
                if (window.AR && window.AR.charts && typeof window.AR.charts.refreshReportRangePreview === 'function') {
                    window.AR.charts.refreshReportRangePreview();
                } else if (window.AR && window.AR.charts && typeof window.AR.charts.drawChart === 'function') {
                    window.AR.charts.drawChart();
                } else {
                    render(container, model, fields, rbaHistory, cpiData, economicOverlaySeries);
                }
            },
        });
        if (plotState && typeof plotState.dispose === 'function') {
            container._reportDispose = plotState.dispose;
        }
        return plotState;
    }

    window.AR.chartSavingsReportLwc = { render: render };
})();
