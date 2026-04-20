(function () {
    'use strict';
    window.AR = window.AR || {};
    window.AR.ribbon = window.AR.ribbon || {};
    var R = window.AR.ribbon;
    var ribbonBankShortName = R.ribbonBankShortName;
    var ribbonRangeText = R.ribbonRangeText;
    var ribbonSpreadBpText = R.ribbonSpreadBpText;
    var ribbonTierFieldsForSection = R.ribbonTierFieldsForSection;
    var ribbonInitialTierFieldsForSection = R.ribbonInitialTierFieldsForSection;
    var formatRibbonTierValue = R.formatRibbonTierValue;
    var ribbonFieldLabel = R.ribbonFieldLabel;
    var ribbonCompactTierValue = R.ribbonCompactTierValue;
    var ribbonCompactFieldLabel = R.ribbonCompactFieldLabel;
    var ribbonCompactBranchLabel = R.ribbonCompactBranchLabel;
    var ribbonTrimProductName = R.ribbonTrimProductName || function (s) { return String(s || ''); };
    var ribbonFiniteNumberOrNull = R.ribbonFiniteNumberOrNull;
    var ribbonMoneyAmountFromText = R.ribbonMoneyAmountFromText;
    var ribbonDepositTierBoundsFromLabel = R.ribbonDepositTierBoundsFromLabel;
    var ribbonDepositTierBoundsFromRow = R.ribbonDepositTierBoundsFromRow;
    var ribbonDepositTierBandEntriesForProduct = R.ribbonDepositTierBandEntriesForProduct;
    var buildRibbonFieldGroups = R.buildRibbonFieldGroups;
    var buildRibbonTierTree = R.buildRibbonTierTree;
    var ribbonRateAtAnchorForHierarchy = R.ribbonRateAtAnchorForHierarchy;
    var minMaxRibbonNodeRates = R.minMaxRibbonNodeRates;
    var formatRibbonTierRateRange = R.formatRibbonTierRateRange;
    var collectRibbonNodeKeys = R.collectRibbonNodeKeys;
    var collectRibbonNodeKeysInto = R.collectRibbonNodeKeysInto;
    var ribbonProductSeriesKey = R.ribbonProductSeriesKey;

    // Helpers extracted to focused modules so this file stays under the per-file ceiling.
    // See .cursor/rules/multiagent-modularity.mdc.
    var U = window.AR.chartReportPlotUtils || {};
    var chartClientLog = U.chartClientLog;
    var chartLogClip = U.chartLogClip;
    var chartLogProductParts = U.chartLogProductParts;
    var isHomeLoan = U.isHomeLoan;
    var buildDateRange = U.buildDateRange;
    var hexToRgba = U.hexToRgba;
    var parseHexRgb = U.parseHexRgb;
    var mixHexWithGrey = U.mixHexWithGrey;
    var fmtReportDateYmd = U.fmtReportDateYmd;
    var finiteRateOrNull = U.finiteRateOrNull;
    var positiveRibbonRateOrNull = U.positiveRibbonRateOrNull;

    var EX = window.AR.chartReportPlotExtent || {};
    var latestRibbonPointForSeries = EX.latestRibbonPointForSeries;
    var computeBandsRateExtentFromPayload = EX.computeBandsRateExtentFromPayload;
    var extentFromDailyRows = EX.extentFromDailyRows;
    var mergeRateExtents = EX.mergeRateExtents;
    var padExtent = EX.padExtent;
    var computeRibbonLodIndices = EX.computeRibbonLodIndices;
    var RIBBON_STEP_MODE = EX.RIBBON_STEP_MODE;
    var RIBBON_ECHARTS_PRODUCT_CAP = EX.RIBBON_ECHARTS_PRODUCT_CAP;

    var SB = window.AR.chartReportPlotSeries || {};
    var buildRibbonBankSummaryData = SB.buildRibbonBankSummaryData;
    var getRibbonStyleResolved = SB.getRibbonStyleResolved;
    var ribbonFlowGradientFill = SB.ribbonFlowGradientFill;
    var ribbonAreaStyleMerged = SB.ribbonAreaStyleMerged;
    var buildMovesSeries = SB.buildMovesSeries;
    var buildRbaChangeMarkAreaPairs = SB.buildRbaChangeMarkAreaPairs;
    var buildBandSeries = SB.buildBandSeries;
    var buildProductOverlay = SB.buildProductOverlay;
    var buildRibbonCanvasProductModel = SB.buildRibbonCanvasProductModel;
    var computeRibbonRateQuintileThresholds = SB.computeRibbonRateQuintileThresholds;

    var MP = window.AR.chartReportPlotMovesPane || {};
    var createMovesStrip = MP.createMovesStrip;
    var prepareLwcMovesHistogram = MP.prepareLwcMovesHistogram;
    var attachLwcMovesPane = MP.attachLwcMovesPane;

    var HP = window.AR.chartReportPlotHierarchyPanel || {};
    var createRibbonHierarchyPanel = HP.createRibbonHierarchyPanel;

    function render(options) {
        var echarts = window.echarts;
        var M = window.AR.chartMacroLwcShared;
        var overlayModule = window.AR.chartEconomicOverlays || {};
        if (!echarts || !M) throw new Error('report plot dependencies not loaded');
        var escHtml = typeof M.escHtml === 'function'
            ? M.escHtml
            : function (value) {
                return String(value == null ? '' : value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            };

        var container = options.container;
        var theme = options.theme;
        var plotPayload = options.plotPayload;
        var range = options.range;
        var section = options.section;
        var bankList = options.bankList || [];
        var ribbonSummaryData = plotPayload && plotPayload.mode === 'bands'
            ? buildRibbonBankSummaryData(plotPayload, options.allSeries || [], range.viewStart, range.ctxMax)
            : { summaries: {}, spotlightBank: '', spotlightDate: '' };
        bankList = bankList.map(function (bank) {
            var summary = ribbonSummaryData.summaries[String(bank && bank.full || '').trim()] || null;
            return {
                full: bank && bank.full ? bank.full : '',
                short: bank && bank.short ? bank.short : '',
                metric: summary ? summary.metric : '',
                meta: summary ? summary.meta : '',
            };
        });
        var clientLog = chartClientLog();
        var lastRibbonScrubLogAt = 0;
        var lastRibbonVisualSig = '';
        var lastSiteUiRibbonLogAt = 0;
        var ribbonChromeHandlers = {
            onChipClick: function () {},
            onChipPointerEnter: function () {},
            onChipPointerLeave: function () {},
        };
        var ribbonUnderchartSyncedOnFinish = false;
        var ribbonTrayRoot = null;
        var ribbonHoverLabelEl = null;

        container.innerHTML = '';
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';
        container.appendChild(wrapper);
        var ribbonWorkspace = (container && container.closest && container.closest('.chart-workspace')) || null;
        var ribbonHierarchyRail = ribbonWorkspace && ribbonWorkspace.querySelector
            ? ribbonWorkspace.querySelector('.chart-selection-rail')
            : null;
        var ribbonHierarchySidePanel = ribbonWorkspace && ribbonWorkspace.querySelector
            ? ribbonWorkspace.querySelector('.chart-side-panel')
            : null;
        var ribbonHierarchyHost = ribbonHierarchyRail || ribbonHierarchySidePanel || ((container && container.closest && container.closest('.chart-figure')) || wrapper);
        if (ribbonHierarchyHost && ribbonHierarchyHost.querySelectorAll) {
            ribbonHierarchyHost.querySelectorAll('.ar-report-underchart-tree').forEach(function (panel) {
                if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
            });
        }

        var viewBarOpts = {
            section: section,
            vm: options.vm,
            bankList: bankList,
            onReRender: options.onReRender,
        };
        if (options.vm && options.vm.mode === 'bands') {
            viewBarOpts.onRibbonBankChipClick = function (full) {
                ribbonChromeHandlers.onChipClick(full);
            };
            viewBarOpts.onRibbonBankChipPointerEnter = function (full) {
                ribbonChromeHandlers.onChipPointerEnter(full);
            };
            viewBarOpts.onRibbonBankChipPointerLeave = function (full, ev) {
                ribbonChromeHandlers.onChipPointerLeave(full, ev);
            };
        }
        var viewBar = M.createReportViewModeBar(viewBarOpts);
        wrapper.appendChild(viewBar);
        if (options.vm && options.vm.mode === 'bands') {
            ribbonTrayRoot = viewBar.querySelector('.lwc-focus-bank-tray');
            ribbonHoverLabelEl = null;
        }
        wrapper.appendChild(M.createReportRangeBar({
            section: section,
            range: range.reportRange,
            minDate: range.dataMin,
            maxDate: range.ctxMax,
            onChange: options.onRangeChange,
        }));

        var mount = document.createElement('div');
        mount.className = 'lwc-chart-mount lwc-chart-mount--report-plot';
        mount.style.cssText = 'width:100%;flex:1;min-height:180px;position:relative;';
        wrapper.appendChild(mount);
        var ribbonHierarchyPanel = createRibbonHierarchyPanel(theme, escHtml);
        if (ribbonHierarchyHost && typeof ribbonHierarchyHost.insertBefore === 'function') {
            ribbonHierarchyHost.insertBefore(ribbonHierarchyPanel.el, ribbonHierarchyHost.firstChild || null);
        } else {
            ribbonHierarchyHost.appendChild(ribbonHierarchyPanel.el);
        }

        if (options.noteText) {
            var note = document.createElement('div');
            note.textContent = options.noteText;
            note.style.cssText = 'position:absolute;bottom:44px;left:8px;font-size:9px;opacity:0.5;color:inherit;pointer-events:none;font-family:"Space Grotesk",system-ui,sans-serif;white-space:nowrap;z-index:3;';
            mount.appendChild(note);
        }

        var chart = echarts.init(mount, null, { renderer: 'canvas' });
        /** Ribbons + overlays use left % axis (index 0); grid also has yAxis 1 (e.g. moves count). */
        var ribbonAxisFinder = { gridIndex: 0, xAxisIndex: 0, yAxisIndex: 0 };
        var dates = buildDateRange(range.viewStart, range.ctxMax);
        var bankColorForBands = typeof options.bankColor === 'function'
            ? options.bankColor
            : function (_name, ix) {
                var pal = ['#64748b', '#3b82f6', '#27c27a', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6'];
                return pal[ix % pal.length];
            };
        var chartWidth = mount.clientWidth || container.clientWidth || window.innerWidth || 0;
        var showRibbonEdgeLabels = chartWidth >= 1080;
        var reportGridRight = showRibbonEdgeLabels ? 144 : (chartWidth >= 760 ? 28 : 18);
        var prep = M.prepareRbaCpiForReport(options.rbaHistory, options.cpiData, range.viewStart, range.ctxMax);
        var rbaDaily = M.fillForwardDaily(prep.rbaData.points, 'date', 'rate', range.chartStart, range.ctxMax);
        var cpiDaily = M.fillForwardDaily(prep.cpiPoints, 'date', 'value', range.chartStart, range.ctxMax);
        var overlayDefs = overlayModule.prepareWindowSeries
            ? overlayModule.prepareWindowSeries(options.economicOverlaySeries || [], range.viewStart, range.ctxMax)
            : [];

        var bandsReportEarly = plotPayload && plotPayload.mode === 'bands';
        var showRbaMacroLine = bandsReportEarly ? !!(container._ribbonMacroRba) : false;
        var showCpiMacroLine = bandsReportEarly ? !!(container._ribbonMacroCpi) : false;
        var bandsOnlyYExtent = bandsReportEarly ? computeBandsRateExtentFromPayload(plotPayload, dates) : null;
        var rbaLineShown = !bandsReportEarly || showRbaMacroLine;
        var cpiLineShown = !bandsReportEarly || showCpiMacroLine;

        var rbaDecisionsWindow = (prep.rbaData.decisions || []).filter(function (row) {
            var d = String(row.date || '').slice(0, 10);
            return d && d >= String(range.viewStart || '').slice(0, 10) && d <= String(range.ctxMax || '').slice(0, 10);
        });
        var rbaChangeMarkPairs = bandsReportEarly
            ? buildRbaChangeMarkAreaPairs(dates, rbaDecisionsWindow, range.viewStart, range.ctxMax)
            : [];

        var series = [
            {
                name: 'RBA',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                step: 'end',
                lineStyle: { color: theme.rba, width: 2, type: 'dashed', opacity: rbaLineShown ? 1 : 0 },
                data: dates.map(function (date) {
                    var point = rbaDaily.find(function (entry) { return entry.date === date; });
                    return [date, point ? finiteRateOrNull(point.value) : null];
                }),
                silent: !rbaLineShown,
            },
            {
                name: 'CPI',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                step: 'end',
                lineStyle: { color: theme.cpi, width: 2, type: 'dashed', opacity: cpiLineShown ? 1 : 0 },
                data: dates.map(function (date) {
                    var point = cpiDaily.find(function (entry) { return entry.date === date; });
                    return [date, point ? finiteRateOrNull(point.value) : null];
                }),
                silent: !cpiLineShown,
            },
        ];
        if (bandsReportEarly && rbaChangeMarkPairs.length) {
            series.push({
                name: 'RBA change',
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                silent: true,
                lineStyle: { width: 0, opacity: 0 },
                data: dates.map(function (d) {
                    return [d, bandsOnlyYExtent ? bandsOnlyYExtent.min : 0];
                }),
                markArea: {
                    silent: true,
                    itemStyle: { color: 'rgba(234, 179, 8, 0.14)' },
                    data: rbaChangeMarkPairs,
                },
            });
        }
        if (plotPayload && plotPayload.mode === 'moves') {
            series.push({
                name: 'Baseline',
                type: 'line',
                yAxisIndex: 1,
                symbol: 'none',
                silent: true,
                lineStyle: { color: theme.axis, width: 1, opacity: 0.65 },
                data: dates.map(function (date) { return [date, 0]; }),
            });
        }
        (overlayDefs || []).forEach(function (overlay) {
            series.push({
                name: overlay.label,
                type: 'line',
                yAxisIndex: 0,
                symbol: 'none',
                lineStyle: { color: overlay.color, width: 1.5, type: 'dashed', opacity: 0.8 },
                data: (overlay.points || []).map(function (point) {
                    return [point.date, Number.isFinite(Number(point.normalized_value)) ? Number(point.normalized_value) : null];
                }),
            });
        });

        if (plotPayload && plotPayload.mode === 'moves') series = series.concat(buildMovesSeries(section, dates, plotPayload, theme));

        var productOverlay = [];
        var isBandsMode = plotPayload && plotPayload.mode === 'bands';
        if (isBandsMode && plotPayload && plotPayload.series && plotPayload.series.length) {
            series = series.concat(
                buildBandSeries({
                    dates: dates,
                    plotPayload: plotPayload,
                    bankColor: bankColorForBands,
                })
            );
        }
        var ribbonCanvasModel = { flat: [], byBank: {}, count: 0 };
        var useRibbonCanvas = false;
        var ribbonCanvas = null;
        var ribbonCanvasCtx = null;
        var ribbonLodIndices = null;
        var ribbonRaf = null;
        var zrRibbonSubs = [];
        var siteUiRibbonListener = null;
        var leaderFocusListener = null;

        if (isBandsMode) {
            ribbonCanvasModel = buildRibbonCanvasProductModel(dates, options.allSeries || [], options.bankColor);
            useRibbonCanvas = false;
            productOverlay = [];
            series.push({
                id: 'scoped_min', name: 'Scoped min', type: 'line', yAxisIndex: 0,
                stack: 'scoped_band', step: RIBBON_STEP_MODE, smooth: false, symbol: 'none',
                connectNulls: false,
                lineStyle: { width: 0, opacity: 0 }, areaStyle: { opacity: 0 },
                data: [], silent: true, z: 2,
            });
            series.push({
                id: 'scoped_fill', name: 'Scoped fill', type: 'line', yAxisIndex: 0,
                stack: 'scoped_band', step: RIBBON_STEP_MODE, smooth: false, symbol: 'none',
                connectNulls: false,
                lineStyle: { width: 0, opacity: 0 }, areaStyle: { opacity: 0 },
                data: [], silent: true, z: 2.01,
            });
            series.push({
                id: 'scoped_max', name: 'Scoped max', type: 'line', yAxisIndex: 0,
                step: RIBBON_STEP_MODE, smooth: false, symbol: 'none',
                connectNulls: false,
                lineStyle: { width: 0, opacity: 0 },
                data: [], silent: true, z: 2.02,
            });
            series.push({
                id: 'scoped_mean', name: 'Scoped mean', type: 'line', yAxisIndex: 0,
                step: RIBBON_STEP_MODE, smooth: false, symbol: 'none',
                connectNulls: false,
                lineStyle: { width: 0, opacity: 0 },
                data: [], silent: true, z: 2.03,
            });
            series.push({
                id: 'scoped_line', name: 'Scoped product line', type: 'line', yAxisIndex: 0,
                smooth: true, symbol: 'none',
                connectNulls: false,
                lineStyle: { width: 0, opacity: 0 },
                data: [], silent: true, z: 3,
            });
        }

        var bandByDateByBank = {};
        var knownBanks = {};
        if (isBandsMode && plotPayload.series) {
            plotPayload.series.forEach(function (bank) {
                knownBanks[bank.bank_name] = true;
                var byDate = {};
                (bank.points || []).forEach(function (p) {
                    var d = String(p.date || '').slice(0, 10);
                    if (!d) return;
                    var lo = positiveRibbonRateOrNull(p.min_rate);
                    var hi = positiveRibbonRateOrNull(p.max_rate);
                    if (lo == null || hi == null || hi < lo) return;
                    byDate[d] = p;
                });
                bandByDateByBank[bank.bank_name] = byDate;
            });
        }

        var ribbonQuintileThresholds = isBandsMode && plotPayload ? computeRibbonRateQuintileThresholds(plotPayload) : null;

        function ribbonAlphaForQuintileRate(r, qs) {
            if (!qs || !Number.isFinite(r)) return 0.48;
            if (r < qs.q20) return 0.2;
            if (r < qs.q40) return 0.4;
            if (r < qs.q60) return 0.6;
            if (r < qs.q80) return 0.4;
            return 0.2;
        }

        function buildRibbonGlobalQuintileFillColor(chartInst, hex, qs, yMin, yMax, axisFinder, refDateStr) {
            if (!chartInst || !qs || !Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) return null;
            var span = yMax - yMin;
            var rgb = parseHexRgb(hex);
            var top = chartInst.convertToPixel(axisFinder, [refDateStr, yMax]);
            var bot = chartInst.convertToPixel(axisFinder, [refDateStr, yMin]);
            if (!top || !bot || !Number.isFinite(top[0]) || !Number.isFinite(top[1]) || !Number.isFinite(bot[0]) || !Number.isFinite(bot[1])) {
                return null;
            }
            function tForRate(rate) {
                return Math.max(0, Math.min(1, (yMax - rate) / span));
            }
            var uniq = [];
            function addT(t) {
                if (!Number.isFinite(t)) return;
                var c = Math.max(0, Math.min(1, t));
                for (var ti = 0; ti < uniq.length; ti++) {
                    if (Math.abs(uniq[ti] - c) < 1e-6) return;
                }
                uniq.push(c);
            }
            addT(0);
            addT(1);
            addT(tForRate(qs.q80));
            addT(tForRate(qs.q60));
            addT(tForRate(qs.q40));
            addT(tForRate(qs.q20));
            uniq.sort(function (a, b) { return a - b; });
            var stops = [];
            for (var si = 0; si < uniq.length; si++) {
                var t = uniq[si];
                var rate = yMax - t * span;
                stops.push({
                    offset: t,
                    color: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + String(ribbonAlphaForQuintileRate(rate, qs)) + ')',
                });
            }
            var deduped = [];
            for (var j = 0; j < stops.length; j++) {
                if (!deduped.length || deduped[deduped.length - 1].color !== stops[j].color) deduped.push(stops[j]);
            }
            return {
                type: 'linear',
                x: top[0],
                y: top[1],
                x2: bot[0],
                y2: bot[1],
                globalCoord: true,
                colorStops: deduped,
            };
        }

        function syncRibbonQuintileFillGradients() {
            var rsQ = getRibbonStyleResolved();
            if (!isBandsMode || !chart || !rsQ.ribbon_rate_quintile_fill || !ribbonQuintileThresholds || !plotPayload || !plotPayload.series) {
                return;
            }
            var opt = chart.getOption();
            var yax = opt.yAxis && opt.yAxis[0];
            var yMinLive = Number.isFinite(Number(yax && yax.min)) ? Number(yax.min) : (bandsOnlyYExtent ? bandsOnlyYExtent.min : NaN);
            var yMaxLive = Number.isFinite(Number(yax && yax.max)) ? Number(yax.max) : (bandsOnlyYExtent ? bandsOnlyYExtent.max : NaN);
            if (!Number.isFinite(yMinLive) || !Number.isFinite(yMaxLive) || yMaxLive <= yMinLive) return;
            var ref = dates.length ? dates[Math.floor(dates.length / 2)] : '';
            if (!ref) return;
            var updates = [];
            (plotPayload.series || []).forEach(function (bank, index) {
                var color = bankColorForBands(bank.bank_name, index);
                var g = buildRibbonGlobalQuintileFillColor(chart, color, ribbonQuintileThresholds, yMinLive, yMaxLive, ribbonAxisFinder, ref);
                if (!g) return;
                updates.push({
                    id: 'ribbon_fill_' + index,
                    areaStyle: ribbonAreaStyleMerged({ color: g }),
                });
            });
            if (!updates.length) return;
            try {
                chart.setOption({ series: updates }, { lazyUpdate: true, silent: true });
            } catch (_e2) {}
        }

        var hoveredBank = '';
        var ribbonAutoSpotlightBank = ribbonSummaryData.spotlightBank || '';
        var ribbonProductBank = '';
        var ribbonTrayHoverBank = '';
        var lastPointerDate = ribbonSummaryData.spotlightDate || '';
        var ribbonListHoverKeys = null;
        var ribbonHoverScopeMap = {};
        var ribbonHoverScopeSeq = 0;
        var ribbonExpandedPaths = {};
        var ribbonTreeAnchorYmd = '';
        var ribbonListHoverPath = '';
        var ribbonCurrentTree = null;
        var ribbonAnchorProductsCache = {};
        var ribbonTreeCache = {};

        function deepestExpandedRibbonPath() {
            var best = '';
            var bestDepth = -1;
            Object.keys(ribbonExpandedPaths).forEach(function (p) {
                if (!ribbonExpandedPaths[p]) return;
                var depth = p ? p.split('>').length : 0;
                if (depth > bestDepth) {
                    bestDepth = depth;
                    best = p;
                }
            });
            return best;
        }

        function ribbonPathSegments(path) {
            var parts = String(path || '').split('>').filter(Boolean);
            var out = [];
            var acc = '';
            parts.forEach(function (part) {
                acc = acc ? acc + '>' + part : String(part);
                out.push(acc);
            });
            return out;
        }

        function ribbonFocusedChildIndex(path) {
            var deep = deepestExpandedRibbonPath();
            if (!deep) return -1;
            var deepParts = String(deep).split('>').filter(Boolean);
            var pathParts = String(path || '').split('>').filter(Boolean);
            if (pathParts.length >= deepParts.length) return -1;
            for (var i = 0; i < pathParts.length; i += 1) {
                if (pathParts[i] !== deepParts[i]) return -1;
            }
            var idx = Number(deepParts[pathParts.length]);
            return Number.isFinite(idx) ? idx : -1;
        }

        function setRibbonExpandedBranchPath(path, shouldOpen) {
            var next = {};
            var segs = ribbonPathSegments(path);
            if (!shouldOpen && segs.length) segs.pop();
            segs.forEach(function (seg) {
                next[seg] = true;
            });
            ribbonExpandedPaths = next;
        }

        function ribbonAnchorCacheKey(bankName, anchorYmd) {
            return String(bankName || '') + '::' + String(anchorYmd || '');
        }

        function productsAtRibbonAnchor(bankName, anchorYmd, sec) {
            var key = ribbonAnchorCacheKey(bankName, anchorYmd);
            if (ribbonAnchorProductsCache[key]) return ribbonAnchorProductsCache[key];
            var plist = ribbonCanvasModel.byBank[bankName] || [];
            var out = [];
            plist.forEach(function (prod) {
                var value = prod.byDate[anchorYmd];
                if (value == null || !Number.isFinite(value) || value <= 0) return;
                if (sec === 'savings' && value < 1.0) return;
                out.push(prod);
            });
            out.sort(function (a, b) {
                var va = a.byDate[anchorYmd];
                var vb = b.byDate[anchorYmd];
                return (Number.isFinite(vb) ? vb : 0) - (Number.isFinite(va) ? va : 0);
            });
            ribbonAnchorProductsCache[key] = out;
            return out;
        }

        function ribbonTreeForAnchor(bankName, anchorYmd, tierFields) {
            var key = ribbonAnchorCacheKey(bankName, anchorYmd);
            if (ribbonTreeCache[key]) return ribbonTreeCache[key];
            var sec = String(section || '');
            var prodsAtAnchor = productsAtRibbonAnchor(bankName, anchorYmd, sec);
            var tree = prodsAtAnchor.length ? buildRibbonTierTree(prodsAtAnchor, tierFields, 0) : null;
            ribbonTreeCache[key] = {
                prodsAtAnchor: prodsAtAnchor,
                tree: tree,
            };
            return ribbonTreeCache[key];
        }

        function buildRibbonBreadcrumbItems(tree) {
            var deep = deepestExpandedRibbonPath();
            if (!deep || !tree || tree.kind !== 'branch') return [];
            var node = tree;
            var crumbs = [];
            var acc = '';
            var ancestorValues = [];
            deep.split('>').forEach(function (part) {
                if (!node || node.kind !== 'branch') return;
                var idx = Number(part);
                if (!Number.isFinite(idx) || !node.groups || !node.groups[idx]) return;
                acc = acc ? acc + '>' + idx : String(idx);
                var group = node.groups[idx];
                var rawLabel = String(group.label || '');
                var preStripped = node.field === 'product_name'
                    ? ribbonTrimProductName(rawLabel)
                    : rawLabel;
                var compactValue = ribbonStripAncestorWords(preStripped, ancestorValues) || preStripped;
                crumbs.push({
                    path: acc,
                    label: ribbonFieldLabel(node.field) + ': ' + rawLabel,
                    compactLabel: ribbonCompactBranchLabel(node.field, compactValue, 'crumb'),
                });
                ancestorValues.push(rawLabel);
                node = group.child;
            });
            return crumbs;
        }

        function ribbonNodeAtPath(node, path) {
            var cur = node;
            var parts = String(path || '').split('>').filter(Boolean);
            for (var i = 0; i < parts.length; i += 1) {
                if (!cur || cur.kind !== 'branch' || !cur.groups) return null;
                var idx = Number(parts[i]);
                if (!Number.isFinite(idx) || !cur.groups[idx]) return null;
                cur = cur.groups[idx].child;
            }
            return cur;
        }

        function ribbonBankKey(bankName) {
            return normRibbonBankName(canonicalBandsBankFromUi(String(bankName || '').trim()));
        }

        function collectRibbonNodeBankKeysInto(node, out) {
            if (!node || !out) return;
            if (node.kind === 'leaves') {
                (node.products || []).forEach(function (p) {
                    var bankKey = ribbonBankKey((p && p.bankName) || (p && p.row && p.row.bank_name) || '');
                    if (bankKey) out[bankKey] = true;
                });
                return;
            }
            (node.groups || []).forEach(function (g) {
                collectRibbonNodeBankKeysInto(g.child, out);
            });
        }

        function ribbonBankKeysFromSelectionKeys(keys) {
            var out = {};
            (keys || []).forEach(function (key) {
                var raw = String(key || '');
                if (raw.indexOf('[P]') === 0) raw = raw.slice(3);
                var bankKey = ribbonBankKey(raw.split('|')[0]);
                if (bankKey) out[bankKey] = true;
            });
            return out;
        }

        function currentRibbonTrayBankState() {
            if (ribbonListHoverKeys && ribbonListHoverKeys.length) {
                return ribbonBankKeysFromSelectionKeys(ribbonListHoverKeys);
            }
            if (!ribbonCurrentTree) return {};
            var focusNode = ribbonNodeAtPath(ribbonCurrentTree, deepestExpandedRibbonPath()) || ribbonCurrentTree;
            var out = {};
            collectRibbonNodeBankKeysInto(focusNode, out);
            return out;
        }

        function setRibbonHierarchyLayoutActive(isActive) {
            if (ribbonHierarchyRail && ribbonHierarchyRail.classList) {
                ribbonHierarchyRail.classList.toggle('has-ribbon-hierarchy', !!isActive);
            }
            if (ribbonHierarchySidePanel && ribbonHierarchySidePanel.classList) {
                ribbonHierarchySidePanel.classList.toggle('has-ribbon-hierarchy', !!isActive);
            }
        }

        var ribbonTreeHadBranches = false;

        function ribbonPathAllowsProductLines(rowPath) {
            var rp = String(rowPath || '');
            var deep = deepestExpandedRibbonPath();
            if (!deep) {
                if (!ribbonTreeHadBranches) return true;
                return false;
            }
            return rp === deep || rp.indexOf(deep + '>') === 0;
        }

        function clearRibbonHoverScopes() {
            ribbonHoverScopeMap = {};
            ribbonHoverScopeSeq = 0;
        }

        function registerRibbonHoverScope(keys) {
            var id = String(++ribbonHoverScopeSeq);
            ribbonHoverScopeMap[id] = keys.slice();
            return id;
        }

        function normRibbonBankName(n) {
            return String(n || '')
                .trim()
                .replace(/[\u00A0\u2000-\u200B\uFEFF]/g, ' ')
                .replace(/\s+/g, ' ')
                .toLowerCase();
        }

        /** Normalized key only if name matches a bands series; else '' (all ribbons stay active — avoids all-grey when focus string is orphan). */
        function resolveBandsFocusKey(nameRaw) {
            var raw = String(nameRaw || '').trim();
            if (!raw || !plotPayload || !plotPayload.series || !plotPayload.series.length) return '';
            var want = normRibbonBankName(raw);
            for (var i = 0; i < plotPayload.series.length; i++) {
                if (normRibbonBankName(plotPayload.series[i].bank_name) === want) return want;
            }
            return '';
        }

        /** Map UI/chip string to plotPayload bank_name spelling when possible (canvas byBank + series ids). */
        function canonicalBandsBankFromUi(nameRaw) {
            var raw = String(nameRaw || '').trim();
            if (!raw || !plotPayload || !plotPayload.series) return raw;
            var want = normRibbonBankName(raw);
            for (var i = 0; i < plotPayload.series.length; i++) {
                var bn = String(plotPayload.series[i].bank_name || '').trim();
                if (normRibbonBankName(bn) === want) return bn;
            }
            return raw;
        }

        function ribbonSummaryForBank(bankName) {
            return ribbonSummaryData && ribbonSummaryData.summaries
                ? ribbonSummaryData.summaries[String(bankName || '').trim()] || null
                : null;
        }

        function ribbonHoverSummaryText(bankName) {
            var bank = String(bankName || '').trim();
            if (!bank) return '';
            var summary = ribbonSummaryForBank(bank);
            if (!summary) return bank;
            return [
                bank,
                summary.metric || '',
                summary.mean != null ? '\u03bc ' + summary.mean.toFixed(2) + '%' : '',
                ribbonSpreadBpText(summary.lo, summary.hi),
            ].filter(Boolean).join(' \u00b7 ');
        }

        function ribbonPanelBank() {
            return String(ribbonTrayHoverBank || ribbonProductBank || '').trim();
        }

        /** Bank whose corridor is foregrounded: explicit panel focus, then chart hover, then the best current lender. */
        function ribbonChartHighlightBank() {
            return String(ribbonPanelBank() || hoveredBank || ribbonAutoSpotlightBank || '').trim();
        }

        function ribbonLineFilterKeys() {
            var list = ribbonListHoverKeys;
            if (!list || !list.length) return [];
            if (!ribbonPathAllowsProductLines(String(ribbonListHoverPath || ''))) return [];
            return list.slice();
        }

        function productLineVisible(prodKey) {
            var fk = ribbonLineFilterKeys();
            for (var i = 0; i < fk.length; i++) {
                if (fk[i] === prodKey) return true;
            }
            return false;
        }

        function resolveDateFromAxisValue(xRaw) {
            if (xRaw == null) return '';
            if (typeof xRaw === 'number' && Number.isFinite(xRaw)) {
                var i = Math.round(xRaw);
                if (i >= 0 && i < dates.length) return dates[i];
            }
            var s = String(xRaw).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(s) && dates.indexOf(s) >= 0) return s;
            return '';
        }

        /** Bank under pointer: full min–max band at date (narrowest band wins if overlapping). */
        function pickBankFromRibbonBand(dateStr, yVal) {
            if (!dateStr || !Number.isFinite(yVal)) return '';
            var candidates = [];
            Object.keys(knownBanks).forEach(function (bn) {
                var p = bandByDateByBank[bn] && bandByDateByBank[bn][dateStr];
                if (!p) return;
                var lo = positiveRibbonRateOrNull(p.min_rate);
                var hi = positiveRibbonRateOrNull(p.max_rate);
                if (lo == null || hi == null || hi < lo) return;
                if (yVal >= lo && yVal <= hi) {
                    var w = hi - lo;
                    candidates.push({ bn: bn, w: Number.isFinite(w) ? w : 0 });
                }
            });
            candidates.sort(function (a, b) { return a.w - b.w; });
            return candidates.length ? candidates[0].bn : '';
        }

        function syncRibbonTrayUi() {
            if (!ribbonTrayRoot) return;
            var activeBanks = currentRibbonTrayBankState();
            var hasActiveBanks = !!Object.keys(activeBanks).length;
            var hlRaw = String(ribbonTrayHoverBank || (ribbonProductBank ? '' : hoveredBank) || '').trim();
            var hlKey = hlRaw ? normRibbonBankName(canonicalBandsBankFromUi(hlRaw)) : '';
            var selKey =
                ribbonProductBank && resolveBandsFocusKey(ribbonProductBank)
                    ? normRibbonBankName(canonicalBandsBankFromUi(String(ribbonProductBank || '').trim()))
                    : '';
            var chips = ribbonTrayRoot.querySelectorAll('.lwc-focus-bank-chip');
            for (var i = 0; i < chips.length; i++) {
                var ch = chips[i];
                var fk = normRibbonBankName(
                    canonicalBandsBankFromUi(String(ch.getAttribute('data-ar-bank-full') || ch.title || '').trim())
                );
                var isHover = !!hlKey && fk === hlKey;
                var isSelected = !!selKey && fk === selKey;
                var isActive = isHover || isSelected || !hasActiveBanks || !!activeBanks[fk];
                ch.classList.toggle('is-ribbon-active', isActive);
                ch.classList.toggle('is-ribbon-hover', isHover);
                ch.classList.toggle('is-ribbon-selected', isSelected);
                ch.classList.toggle('is-ribbon-dim', !isActive);
            }
        }

        function syncInfoboxRowHighlight() {
            syncRibbonScopedRowHighlight(options.infoBox && options.infoBox.el);
            syncRibbonScopedRowHighlight(ribbonHierarchyPanel && ribbonHierarchyPanel.el);
        }

        function syncRibbonScopedRowHighlight(root) {
            if (!root) return;
            var k = ribbonListHoverKeys && ribbonListHoverKeys.length === 1 ? ribbonListHoverKeys[0] : '';
            var rows = root.querySelectorAll('.ar-report-infobox-row[data-ribbon-prod-key]');
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                row.classList.toggle('is-ribbon-chart-sync', !!k && row.getAttribute('data-ribbon-prod-key') === k);
            }
            var scopes = root.querySelectorAll('[data-ribbon-scope]');
            for (var j = 0; j < scopes.length; j++) {
                var el = scopes[j];
                if (el.classList.contains('ar-report-infobox-row') && el.hasAttribute('data-ribbon-prod-key')) continue;
                var sid = el.getAttribute('data-ribbon-scope');
                var ks = ribbonHoverScopeMap[sid];
                var hit = false;
                if (k && ks && ks.length) {
                    for (var x = 0; x < ks.length; x++) {
                        if (ks[x] === k) {
                            hit = true;
                            break;
                        }
                    }
                }
                el.classList.toggle('is-ribbon-chart-sync', hit);
            }
        }

        function setRibbonAnchorDate(dateStr) {
            var ymd = String(dateStr || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
            if (dates.indexOf(ymd) < 0) return false;
            lastPointerDate = ymd;
            return true;
        }

        function syncRibbonPinnedPanelState() {
            applyRibbonBankHighlightState(ribbonChartHighlightBank());
            updateProductVisibility();
            refreshRibbonUnderChartPanel();
            scheduleRibbonRedraw();
            syncRibbonTrayUi();
        }

        function resolveHoverBank(seriesName) {
            if (!seriesName) return '';
            if (seriesName.endsWith(' ribbon')) return seriesName.slice(0, -7);
            if (seriesName.endsWith(' mean')) return seriesName.slice(0, -5);
            if (seriesName.endsWith(' max')) return seriesName.slice(0, -4);
            if (knownBanks[seriesName]) return seriesName;
            return '';
        }

        function updateProductVisibility() {
            if (useRibbonCanvas) {
                scheduleRibbonRedraw();
                if (isBandsMode) {
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                }
                return;
            }
            if (!productOverlay.length) return;
            var rs = getRibbonStyleResolved();
            var oh = Math.max(0, Math.min(1, Number(rs.product_line_opacity_hover)));
            var wh = Math.max(0, Number(rs.product_line_width_hover) || 1.2);
            var updates = [];
            productOverlay.forEach(function (s) {
                var rest = s.name.slice(3);
                var pipe = rest.indexOf('|');
                var bn = pipe >= 0 ? rest.slice(0, pipe) : rest;
                var pb = ribbonPanelBank();
                var showBank = pb && normRibbonBankName(bn) === normRibbonBankName(pb);
                var match = productLineVisible(s.name);
                var show = showBank && match;
                var base = s._ribbonBaseHex || '#64748b';
                updates.push({
                    id: s.id,
                    lineStyle: {
                        color: hexToRgba(base, oh),
                        width: wh,
                        opacity: show ? 1 : 0,
                        cap: 'round',
                        join: 'round',
                    },
                    silent: true,
                });
            });
            chart.setOption({ series: updates }, { lazyUpdate: false, silent: true });
            if (isBandsMode) {
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
            }
        }

        function syncRibbonCanvasSize() {
            if (!ribbonCanvas) return;
            var w = mount.clientWidth || 0;
            var h = mount.clientHeight || 0;
            var dpr = window.devicePixelRatio || 1;
            ribbonCanvas.style.width = w + 'px';
            ribbonCanvas.style.height = h + 'px';
            ribbonCanvas.width = Math.max(1, Math.floor(w * dpr));
            ribbonCanvas.height = Math.max(1, Math.floor(h * dpr));
            if (ribbonCanvasCtx) ribbonCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function recomputeRibbonLod() {
            if (!useRibbonCanvas || !dates.length) {
                ribbonLodIndices = null;
                return;
            }
            var w = mount.clientWidth || 800;
            var approxCols = Math.max(100, Math.floor(w * 0.85));
            ribbonLodIndices = computeRibbonLodIndices(dates.length, approxCols);
        }

        function redrawRibbonCanvas() {
            if (!useRibbonCanvas || !ribbonCanvasCtx) return;
            syncRibbonCanvasSize();
            var ctx = ribbonCanvasCtx;
            ctx.clearRect(0, 0, ribbonCanvas.width, ribbonCanvas.height);
            var pb = ribbonPanelBank();
            if (!pb) return;
            var prods = ribbonCanvasModel.byBank[pb];
            if (!prods || !prods.length) return;
            var idxs = ribbonLodIndices;
            prods.forEach(function (prod) {
                if (!productLineVisible(prod.key)) return;
                ctx.beginPath();
                var first = true;
                function plotAt(di) {
                    var d = dates[di];
                    var v = prod.byDate[d];
                    if (v == null) return;
                    var pix = chart.convertToPixel(ribbonAxisFinder, [d, v]);
                    if (!pix || pix.length < 2 || !Number.isFinite(pix[0]) || !Number.isFinite(pix[1])) return;
                    if (first) {
                        ctx.moveTo(pix[0], pix[1]);
                        first = false;
                    } else {
                        ctx.lineTo(pix[0], pix[1]);
                    }
                }
                if (idxs && idxs.length) {
                    for (var ii = 0; ii < idxs.length; ii++) plotAt(idxs[ii]);
                } else {
                    for (var di = 0; di < dates.length; di++) plotAt(di);
                }
                if (first) return;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                var rsC = getRibbonStyleResolved();
                var oh = Math.max(0, Math.min(1, Number(rsC.product_line_opacity_hover)));
                var wh = Math.max(0, Number(rsC.product_line_width_hover) || 1.2);
                ctx.strokeStyle = hexToRgba(prod.baseHex, oh);
                ctx.lineWidth = wh;
                ctx.stroke();
            });
        }

        function scheduleRibbonRedraw() {
            if (!useRibbonCanvas) return;
            if (ribbonRaf != null) return;
            ribbonRaf = window.requestAnimationFrame(function () {
                ribbonRaf = null;
                redrawRibbonCanvas();
            });
        }

        function hideRibbonInfoBox() {
            var ib = options.infoBox;
            if (ib && typeof ib.hide === 'function') ib.hide();
        }

        function showRibbonEmptyPanel(heading, meta, message) {
            ribbonListHoverKeys = null;
            ribbonListHoverPath = '';
            ribbonExpandedPaths = {};
            ribbonCurrentTree = null;
            ribbonTreeHadBranches = false;
            setRibbonHierarchyLayoutActive(true);
            if (!ribbonHierarchyPanel || typeof ribbonHierarchyPanel.show !== 'function') return;
            ribbonHierarchyPanel.show({
                heading: heading || 'Hierarchy',
                meta: meta || '',
                compact: true,
                renderBody: function (wrap) {
                    var empty = document.createElement('div');
                    empty.className = 'chart-series-empty';
                    empty.textContent = message || 'No hierarchy data available.';
                    wrap.appendChild(empty);
                },
            });
            syncInfoboxRowHighlight();
            syncRibbonTrayUi();
        }

        function hideRibbonHierarchyPanel() {
            ribbonListHoverKeys = null;
            ribbonListHoverPath = '';
            ribbonExpandedPaths = {};
            ribbonTreeBank = '';
            ribbonTreeAnchorYmd = '';
            ribbonCurrentTree = null;
            ribbonTreeHadBranches = false;
            setRibbonHierarchyLayoutActive(false);
            if (ribbonHierarchyPanel && typeof ribbonHierarchyPanel.hide === 'function') ribbonHierarchyPanel.hide();
            syncInfoboxRowHighlight();
            syncRibbonTrayUi();
        }

        function showRibbonIdlePanel() {
            if (!ribbonHierarchyPanel || typeof ribbonHierarchyPanel.show !== 'function') return;
            var anchor = lastPointerDate || (dates.length ? dates[dates.length - 1] : '');
            var sec = String(section || '');
            if (!anchor) {
                showRibbonEmptyPanel('Current slice', '', 'No hierarchy data available yet.');
                return;
            }
            if (ribbonTreeBank) {
                ribbonExpandedPaths = {};
                ribbonTreeBank = '';
            }
            ribbonTreeAnchorYmd = anchor;

            var prodsAtAnchor = [];
            (ribbonCanvasModel.flat || []).forEach(function (prod) {
                var v = prod.byDate[anchor];
                if (v == null || !Number.isFinite(v) || v <= 0) return;
                if (sec === 'savings' && v < 1.0) return;
                prodsAtAnchor.push(prod);
            });
            prodsAtAnchor.sort(function (a, b) {
                var va = a.byDate[anchor];
                var vb = b.byDate[anchor];
                return (Number.isFinite(vb) ? vb : 0) - (Number.isFinite(va) ? va : 0);
            });
            if (!prodsAtAnchor.length) {
                showRibbonEmptyPanel('Current slice', fmtReportDateYmd(anchor), 'No products available for this slice.');
                return;
            }

            clearRibbonHoverScopes();
            var tree = buildRibbonTierTree(prodsAtAnchor, ribbonInitialTierFieldsForSection(sec), 0);
            if (!tree || tree.kind === 'empty') {
                showRibbonEmptyPanel('Current slice', fmtReportDateYmd(anchor), 'No hierarchy available for this slice.');
                return;
            }
            ribbonCurrentTree = tree;
            ribbonTreeHadBranches = tree.kind !== 'leaves';
            var mm = minMaxRibbonNodeRates(tree, anchor, sec);
            var bestRate = ribbonScopedBestRate(tree, anchor, sec);
            setRibbonHierarchyLayoutActive(true);
            ribbonHierarchyPanel.show({
                heading: 'Current slice',
                meta: fmtReportDateYmd(anchor) + ' \u00b7 ' + ribbonRangeText(mm.min, mm.max) + ' \u00b7 ' + prodsAtAnchor.length + ' product' + (prodsAtAnchor.length !== 1 ? 's' : ''),
                compact: true,
                renderBody: function (wrap) {
                    renderRibbonBreadcrumbs(wrap, tree);
                    renderRibbonTreeDom(wrap, tree, '', 0, anchor, sec, {
                        ancestorValues: [],
                        ancestorFields: {},
                        bestRate: bestRate,
                    });
                },
            });
            applyRibbonBankHighlightState(ribbonChartHighlightBank());
            scheduleRibbonRedraw();
            syncInfoboxRowHighlight();
            syncRibbonTrayUi();
        }

        /**
         * Best rate for the currently-focused hierarchy scope. Uses the deepest
         * expanded branch when the user has drilled into a tier so that the
         * green "best rate" marker refers to the best within the visible slice
         * rather than the whole tree.
         */
        function ribbonScopedBestRate(tree, anchorYmd, secStr) {
            if (!tree) return null;
            var deep = deepestExpandedRibbonPath();
            var scopeNode = deep ? (ribbonNodeAtPath(tree, deep) || tree) : tree;
            var mm = minMaxRibbonNodeRates(scopeNode, anchorYmd, secStr);
            var bestMode = ribbonBestRateForSection(secStr);
            return mm && Number.isFinite(mm[bestMode]) ? mm[bestMode] : null;
        }

        function currentScopedProductKeys() {
            if (ribbonListHoverKeys && ribbonListHoverKeys.length) {
                return ribbonListHoverKeys.slice();
            }
            if (ribbonCurrentTree) {
                var deep = deepestExpandedRibbonPath();
                var node = deep ? ribbonNodeAtPath(ribbonCurrentTree, deep) : ribbonCurrentTree;
                if (node) {
                    var keys = collectRibbonNodeKeys(node);
                    if (keys.length) return keys;
                }
            }
            var out = [];
            (ribbonCanvasModel.flat || []).forEach(function (p) {
                if (p && p.key) out.push(p.key);
            });
            return out;
        }

        function applyRibbonBankHighlightState() {
            if (!isBandsMode) return;
            var keys = currentScopedProductKeys();
            var keySet = {};
            keys.forEach(function (k) { keySet[k] = true; });
            var prods = (ribbonCanvasModel.flat || []).filter(function (p) {
                return p && p.key && keySet[p.key];
            });
            var minData = [], maxData = [], deltaData = [], meanData = [], lineData = [];
            var sec = String(section || '');
            dates.forEach(function (d) {
                var vs = [];
                for (var pi = 0; pi < prods.length; pi++) {
                    var v = prods[pi].byDate[d];
                    if (v == null || !Number.isFinite(v) || v <= 0) continue;
                    if (sec === 'savings' && v < 1.0) continue;
                    vs.push(v);
                }
                if (!vs.length) {
                    minData.push([d, null]);
                    maxData.push([d, null]);
                    deltaData.push([d, null]);
                    meanData.push([d, null]);
                    lineData.push([d, null]);
                    return;
                }
                var lo = vs[0], hi = vs[0], sum = 0;
                for (var i = 0; i < vs.length; i++) {
                    if (vs[i] < lo) lo = vs[i];
                    if (vs[i] > hi) hi = vs[i];
                    sum += vs[i];
                }
                var mean = sum / vs.length;
                minData.push([d, lo]);
                maxData.push([d, hi]);
                deltaData.push([d, Math.max(0, hi - lo)]);
                meanData.push([d, mean]);
                lineData.push([d, prods.length === 1 ? mean : null]);
            });
            var single = prods.length === 1;
            var utilsRibbon = window.AR && window.AR.utils;
            var ribbonColor = utilsRibbon && typeof utilsRibbon.resolveSectionRibbonAccentHex === 'function'
                ? utilsRibbon.resolveSectionRibbonAccentHex()
                : '#3b82f6';
            var lineColor = single && prods[0] && prods[0].baseHex ? prods[0].baseHex : ribbonColor;
            var rsScoped = getRibbonStyleResolved();
            var scopedFillStyle;
            if (single) {
                scopedFillStyle = { opacity: 0 };
            } else if (rsScoped.ribbon_rate_quintile_fill && ribbonQuintileThresholds) {
                var optSc = chart.getOption();
                var yaxSc = optSc.yAxis && optSc.yAxis[0];
                var yMinSc = Number.isFinite(Number(yaxSc && yaxSc.min)) ? Number(yaxSc.min) : (bandsOnlyYExtent ? bandsOnlyYExtent.min : NaN);
                var yMaxSc = Number.isFinite(Number(yaxSc && yaxSc.max)) ? Number(yaxSc.max) : (bandsOnlyYExtent ? bandsOnlyYExtent.max : NaN);
                var refSc = dates.length ? dates[Math.floor(dates.length / 2)] : '';
                var gSc = buildRibbonGlobalQuintileFillColor(chart, ribbonColor, ribbonQuintileThresholds, yMinSc, yMaxSc, ribbonAxisFinder, refSc);
                scopedFillStyle = gSc
                    ? ribbonAreaStyleMerged({ color: gSc })
                    : ribbonAreaStyleMerged({ color: hexToRgba(ribbonColor, 0.5) });
            } else {
                scopedFillStyle = ribbonAreaStyleMerged({ color: hexToRgba(ribbonColor, 0.5) });
            }
            var scopedUpdates = [
                {
                    id: 'scoped_min',
                    data: single ? [] : minData,
                    lineStyle: { color: ribbonColor, width: single ? 0 : 0.6, opacity: single ? 0 : 0.35, cap: 'round', join: 'round' },
                    areaStyle: { opacity: 0 },
                },
                {
                    id: 'scoped_fill',
                    data: single ? [] : deltaData,
                    lineStyle: { width: 0, opacity: 0 },
                    areaStyle: scopedFillStyle,
                },
                {
                    id: 'scoped_max',
                    data: single ? [] : maxData,
                    lineStyle: { color: ribbonColor, width: single ? 0 : 0.6, opacity: single ? 0 : 0.35, cap: 'round', join: 'round' },
                },
                {
                    id: 'scoped_mean',
                    data: single ? [] : meanData,
                    lineStyle: { color: ribbonColor, width: single ? 0 : 1.4, opacity: single ? 0 : 0.7, cap: 'round', join: 'round' },
                },
                {
                    id: 'scoped_line',
                    data: single ? lineData : [],
                    smooth: true,
                    lineStyle: {
                        color: lineColor,
                        width: single ? 2.4 : 0,
                        opacity: single ? 1 : 0,
                        cap: 'round',
                        join: 'round',
                    },
                },
            ];
            try { chart.setOption({ series: scopedUpdates }, { lazyUpdate: false, silent: true }); } catch (_e) {}
            lastRibbonVisualSig = keys.length + ':' + (single ? lineColor : ribbonColor);
        }

        var ribbonTreeBank = '';

        /** Best (lowest for mortgages, highest for savings/TDs) rate across the tree at the anchor date. */
        function ribbonBestRateForSection(secStr) {
            var cfg = window.AR && window.AR.chartConfig;
            var dir = cfg && typeof cfg.rankDirection === 'function'
                ? cfg.rankDirection('interest_rate')
                : (String(secStr || '') === 'home-loans' ? 'asc' : 'desc');
            return dir === 'desc' ? 'max' : 'min';
        }

        /** Format a rate-range string but mark the best value with .ar-ribbon-best for green styling. */
        function ribbonRenderRateRange(targetEl, mm, bestRef, secStr) {
            if (!targetEl) return;
            targetEl.textContent = '';
            if (!mm || !Number.isFinite(mm.min) || !Number.isFinite(mm.max)) return;
            var bestMode = ribbonBestRateForSection(secStr);
            var a = mm.min.toFixed(2);
            var b = mm.max.toFixed(2);
            var bestVal = Number.isFinite(bestRef) ? bestRef.toFixed(2) : (bestMode === 'max' ? b : a);
            if (a === b) {
                var span = document.createElement('span');
                span.textContent = a + '%';
                if (a === bestVal) span.className = 'ar-ribbon-best';
                targetEl.appendChild(span);
                return;
            }
            var loSpan = document.createElement('span');
            loSpan.textContent = a + '%';
            if (a === bestVal) loSpan.className = 'ar-ribbon-best';
            var sep = document.createElement('span');
            sep.textContent = '\u2013';
            sep.className = 'ar-ribbon-rate-sep';
            var hiSpan = document.createElement('span');
            hiSpan.textContent = b + '%';
            if (b === bestVal) hiSpan.className = 'ar-ribbon-best';
            targetEl.appendChild(loSpan);
            targetEl.appendChild(sep);
            targetEl.appendChild(hiSpan);
        }

        /**
         * Find a short label that distinguishes a leaf product from its
         * siblings when bank + product are already ancestors (e.g. feature_set
         * or a product_id suffix). Returns '' when nothing informative exists.
         */
        function ribbonLeafDistinguisher(p, ancestorFields) {
            var row = (p && p.row && typeof p.row === 'object') ? p.row : {};
            var candidates = ['feature_set', 'rate_type', 'lvr_tier', 'term_months', 'deposit_tier', 'interest_payment', 'repayment_type', 'rate_structure'];
            for (var i = 0; i < candidates.length; i += 1) {
                var field = candidates[i];
                if (ancestorFields[field]) continue;
                var value = formatRibbonTierValue(row, field);
                if (value && value !== '\u2014') {
                    var compact = ribbonCompactTierValue(field, value);
                    if (compact && compact !== '\u2014') return String(compact);
                }
            }
            var idRaw = String((row && (row.product_id || row.series_key)) || (p && p.key) || '').trim();
            if (idRaw) {
                var trail = idRaw.split(/[|_\-:]+/).filter(Boolean).pop();
                if (trail && trail.length <= 24) return trail;
            }
            return '';
        }

        /** Strip ancestor field values (bank, security_purpose, etc.) from product/row labels. */
        function ribbonStripAncestorWords(raw, ancestorValues) {
            var s = String(raw || '').trim();
            if (!s) return s;
            (ancestorValues || []).forEach(function (val) {
                var v = String(val || '').trim();
                if (!v || v.length < 3) return;
                var esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                s = s.replace(new RegExp('\\s*[-\u2013\u2014\u00b7\\|]?\\s*\\(?' + esc + '\\)?\\s*', 'gi'), ' ');
            });
            return s.replace(/\s+/g, ' ').trim();
        }

        function renderRibbonTreeDom(container, node, path, depth, anchorYmd, secStr, ctx) {
            if (!node || node.kind === 'empty') return;
            ctx = ctx || { ancestorValues: [], ancestorFields: {}, bestRate: null };
            var bestRate = ctx.bestRate;
            if (node.kind === 'leaves') {
                var leaves = node.products.slice().sort(function (a, b) {
                    var va = a.byDate[anchorYmd];
                    var vb = b.byDate[anchorYmd];
                    return (Number.isFinite(vb) ? vb : 0) - (Number.isFinite(va) ? va : 0);
                });
                // Build leaf rows with per-product labels first so we can dedupe
                // redundant rows where every visible descriptor is already an
                // ancestor (avoids the bank > product > '--' dash cascade).
                var leafEntries = [];
                leaves.forEach(function (p) {
                    var v = ribbonRateAtAnchorForHierarchy(p, anchorYmd, secStr);
                    if (v == null) return;
                    var productNameRaw = ribbonTrimProductName(p.productName || '');
                    var ancestorValues = ctx.ancestorValues.slice();
                    if (!ctx.ancestorFields.bank_name && p.bankName) ancestorValues.push(String(p.bankName));
                    var compactProduct = ribbonStripAncestorWords(productNameRaw, ancestorValues);
                    var showBank = !ctx.ancestorFields.bank_name;
                    var showProduct = !!compactProduct && !ctx.ancestorFields.product_name;
                    var distinguisher = '';
                    if (!showBank && !showProduct) {
                        distinguisher = ribbonLeafDistinguisher(p, ctx.ancestorFields);
                    }
                    leafEntries.push({
                        product: p, rate: v,
                        showBank: showBank,
                        showProduct: showProduct,
                        compactProduct: compactProduct,
                        distinguisher: distinguisher,
                    });
                });
                var skipRedundant = leaves.length === 1 && leafEntries.length === 1
                    && !leafEntries[0].showBank && !leafEntries[0].showProduct
                    && !leafEntries[0].distinguisher;
                if (skipRedundant) return;
                leafEntries.forEach(function (entry) {
                    var p = entry.product;
                    var v = entry.rate;
                    var scopeId = registerRibbonHoverScope([p.key]);
                    var row = document.createElement('div');
                    row.className = 'ar-report-infobox-trow ar-report-infobox-trow--leaf ar-report-infobox-row';
                    row.style.setProperty('--ar-ribbon-depth', String(depth));
                    row.setAttribute('data-ribbon-scope', scopeId);
                    row.setAttribute('data-ribbon-tree-path', String(path || ''));
                    row.setAttribute('data-ribbon-prod-key', p.key);
                    var sw = document.createElement('span');
                    sw.className = 'ar-report-infobox-tsw';
                    sw.style.setProperty('--ar-swatch-color', String(p.baseHex || '#666').replace(/[<>"']/g, ''));
                    var mid = document.createElement('span');
                    mid.className = 'ar-report-infobox-tlabel';
                    if (entry.showBank) {
                        var bn = document.createElement('span');
                        bn.className = 'ar-ribbon-tleaf-bank';
                        bn.textContent = p.bankName || '';
                        mid.appendChild(bn);
                        if (entry.showProduct) {
                            var sep = document.createElement('span');
                            sep.className = 'ar-ribbon-tleaf-sep';
                            sep.textContent = ' \u00b7 ';
                            mid.appendChild(sep);
                        }
                    }
                    if (entry.showProduct) {
                        var pn = document.createElement('span');
                        pn.className = 'ar-ribbon-tleaf-product';
                        pn.textContent = entry.compactProduct;
                        mid.appendChild(pn);
                    }
                    if (!entry.showBank && !entry.showProduct) {
                        var dist = document.createElement('span');
                        dist.className = 'ar-ribbon-tleaf-product';
                        dist.textContent = entry.distinguisher || '\u2014';
                        mid.appendChild(dist);
                    }
                    var rateEl = document.createElement('span');
                    rateEl.className = 'ar-report-infobox-trate';
                    ribbonRenderRateRange(rateEl, { min: v, max: v }, bestRate, secStr);
                    row.appendChild(sw);
                    row.appendChild(mid);
                    row.appendChild(rateEl);
                    container.appendChild(row);
                });
                return;
            }
            var focusedChildIdx = ribbonFocusedChildIndex(path);
            (node.groups || []).forEach(function (g, idx) {
                if (focusedChildIdx >= 0 && idx !== focusedChildIdx) return;
                var subPath = path ? path + '>' + idx : String(idx);
                var expanded = !!ribbonExpandedPaths[subPath];
                var keys = collectRibbonNodeKeys(g.child);
                if (!keys.length) return;
                var scopeId = registerRibbonHoverScope(keys);
                var mm = minMaxRibbonNodeRates(g.child, anchorYmd, secStr);
                var rawLabel = String(g.label || '');
                var preStripped = node.field === 'product_name'
                    ? ribbonTrimProductName(rawLabel)
                    : rawLabel;
                var compactValueRaw = ribbonStripAncestorWords(preStripped, ctx.ancestorValues) || preStripped;
                var branchLabel = ribbonFieldLabel(node.field) + ': ' + rawLabel;
                var branchText = ribbonCompactBranchLabel(node.field, compactValueRaw, 'row');
                var brow = document.createElement('div');
                brow.className = 'ar-report-infobox-trow ar-report-infobox-trow--branch';
                brow.style.setProperty('--ar-ribbon-depth', String(depth));
                brow.setAttribute('data-ribbon-scope', scopeId);
                brow.setAttribute('data-ribbon-tree-path', subPath);
                brow.setAttribute('role', 'button');
                brow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                brow.setAttribute('aria-label', (expanded ? 'Collapse tier, ' : 'Expand tier, ') + branchLabel);
                brow.setAttribute('title', expanded ? 'Collapse tier' : 'Expand tier');
                brow.tabIndex = 0;
                var twist = document.createElement('span');
                twist.className = 'ar-report-infobox-twist';
                twist.setAttribute('aria-hidden', 'true');
                twist.textContent = expanded ? '\u25bc' : '\u25b6';
                var lab = document.createElement('span');
                lab.className = 'ar-report-infobox-tlabel';
                lab.textContent = branchText;
                lab.title = branchLabel;
                var rateSpan = document.createElement('span');
                rateSpan.className = 'ar-report-infobox-trate';
                ribbonRenderRateRange(rateSpan, mm, bestRate, secStr);
                brow.appendChild(twist);
                brow.appendChild(lab);
                brow.appendChild(rateSpan);
                function toggleBranch() {
                    var nextOpen = !expanded;
                    setRibbonExpandedBranchPath(subPath, nextOpen);
                    clientLog('info', nextOpen ? 'Chart product hierarchy expand' : 'Chart product hierarchy collapse', {
                        section: String(section || ''),
                        path: chartLogClip(subPath, 40),
                        label: chartLogClip(branchLabel, 72),
                    });
                    refreshRibbonUnderChartPanel();
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    scheduleRibbonRedraw();
                }
                brow.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    toggleBranch();
                });
                brow.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        toggleBranch();
                    }
                });
                container.appendChild(brow);
                if (expanded) {
                    var nest = document.createElement('div');
                    nest.className = 'ar-report-infobox-tnest';
                    var childCtx = {
                        ancestorValues: ctx.ancestorValues.concat([rawLabel]),
                        ancestorFields: Object.assign({}, ctx.ancestorFields),
                        bestRate: bestRate,
                    };
                    childCtx.ancestorFields[node.field] = rawLabel;
                    renderRibbonTreeDom(nest, g.child, subPath, depth + 1, anchorYmd, secStr, childCtx);
                    container.appendChild(nest);
                }
            });
        }

        function renderRibbonBreadcrumbs(container, tree) {
            var crumbs = buildRibbonBreadcrumbItems(tree);
            if (!crumbs.length) return;
            var bar = document.createElement('div');
            bar.className = 'ar-report-underchart-tree-breadcrumbs';
            var rootBtn = document.createElement('button');
            rootBtn.type = 'button';
            rootBtn.className = 'ar-report-underchart-tree-crumb secondary';
            rootBtn.textContent = 'All';
            rootBtn.title = 'All tiers';
            rootBtn.addEventListener('click', function () {
                setRibbonExpandedBranchPath('', false);
                refreshRibbonUnderChartPanel();
            });
            bar.appendChild(rootBtn);
            crumbs.forEach(function (crumb, idx) {
                var sep = document.createElement('span');
                sep.className = 'ar-report-underchart-tree-crumb-sep';
                sep.setAttribute('aria-hidden', 'true');
                sep.textContent = '>';
                bar.appendChild(sep);
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ar-report-underchart-tree-crumb secondary';
                if (idx === crumbs.length - 1) btn.classList.add('is-current');
                btn.title = crumb.label;
                btn.textContent = crumb.compactLabel || crumb.label;
                btn.addEventListener('click', function () {
                    setRibbonExpandedBranchPath(crumb.path, true);
                    refreshRibbonUnderChartPanel();
                });
                bar.appendChild(btn);
            });
            container.appendChild(bar);
        }

        function refreshRibbonUnderChartPanel() {
            if (!ribbonHierarchyPanel || typeof ribbonHierarchyPanel.show !== 'function') return;
            var pbPanel = ribbonPanelBank();
            if (!pbPanel) {
                showRibbonIdlePanel();
                return;
            }
            var anchor = lastPointerDate || (dates.length ? dates[dates.length - 1] : '');
            if (!anchor) {
                showRibbonIdlePanel();
                return;
            }
            if (ribbonTreeBank !== pbPanel) {
                ribbonExpandedPaths = {};
                ribbonTreeHadBranches = false;
                ribbonTreeBank = pbPanel;
            }
            ribbonTreeAnchorYmd = anchor;
            var sec = String(section || '');
            var tierFields = ribbonTierFieldsForSection(sec);
            var cachedTree = ribbonTreeForAnchor(pbPanel, anchor, tierFields);
            var prodsAtAnchor = cachedTree && Array.isArray(cachedTree.prodsAtAnchor)
                ? cachedTree.prodsAtAnchor
                : [];
            if (!prodsAtAnchor.length) {
                showRibbonEmptyPanel(pbPanel, fmtReportDateYmd(anchor), 'No products available for this lender.');
                return;
            }
            clearRibbonHoverScopes();
            var tree = cachedTree ? cachedTree.tree : null;
            if (!tree || tree.kind === 'empty') {
                showRibbonEmptyPanel(pbPanel, fmtReportDateYmd(anchor), 'No hierarchy available for this lender.');
                return;
            }
            ribbonCurrentTree = tree;
            ribbonTreeHadBranches = tree.kind !== 'leaves';
            var n = prodsAtAnchor.length;
            var ibBandPt = bandByDateByBank[pbPanel] && bandByDateByBank[pbPanel][anchor];
            var ibRateStr = '';
            if (ibBandPt) {
                var ibLo = positiveRibbonRateOrNull(ibBandPt.min_rate);
                var ibHi = positiveRibbonRateOrNull(ibBandPt.max_rate);
                if (ibLo != null && ibHi != null) {
                    ibRateStr = ibLo !== ibHi
                        ? ibLo.toFixed(2) + '\u2013' + ibHi.toFixed(2) + '%'
                        : ibLo.toFixed(2) + '%';
                }
            }
            var mmTree = minMaxRibbonNodeRates(tree, anchor, sec);
            var bestRateB = ribbonScopedBestRate(tree, anchor, sec);
            setRibbonHierarchyLayoutActive(true);
            ribbonHierarchyPanel.show({
                heading: pbPanel,
                meta: fmtReportDateYmd(anchor) + (ibRateStr ? ' \u00b7 ' + ibRateStr : '') + ' \u00b7 ' + n + ' product' + (n !== 1 ? 's' : ''),
                compact: true,
                renderBody: function (wrap) {
                    renderRibbonBreadcrumbs(wrap, tree);
                    renderRibbonTreeDom(wrap, tree, '', 0, anchor, sec, {
                        ancestorValues: [],
                        ancestorFields: { bank_name: pbPanel },
                        bestRate: bestRateB,
                    });
                },
            });
            applyRibbonBankHighlightState(ribbonChartHighlightBank());
            scheduleRibbonRedraw();
            syncInfoboxRowHighlight();
            syncRibbonTrayUi();
        }

        var tooltipConfig = isBandsMode
            ? { show: false }
            : { trigger: 'axis', axisPointer: { type: 'line' } };

        if (options.infoBox && options.infoBox.el) {
            wrapper.appendChild(options.infoBox.el);
        }

        chart.setOption({
            animation: false,
            grid: { top: 14, right: reportGridRight, bottom: 36, left: 8, containLabel: true },
            tooltip: tooltipConfig,
            legend: { show: false },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { lineStyle: { color: theme.axis } },
                axisLabel: { color: theme.muted, hideOverlap: true, fontSize: 10 },
                splitLine: { show: false },
            },
            yAxis: [
                (function () {
                    var y0 = {
                        type: 'value',
                        position: 'left',
                        axisLine: { lineStyle: { color: theme.axis } },
                        axisLabel: {
                            color: theme.muted,
                            fontSize: 10,
                            formatter: function (value) {
                                var n = Number(value);
                                if (!Number.isFinite(n)) return '';
                                return (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)) + '%';
                            },
                        },
                        splitLine: { lineStyle: { color: theme.grid } },
                    };
                    if (bandsOnlyYExtent) {
                        y0.min = bandsOnlyYExtent.min;
                        y0.max = bandsOnlyYExtent.max;
                        y0.scale = false;
                    }
                    return y0;
                })(),
                {
                    type: 'value',
                    show: !!(plotPayload && plotPayload.mode === 'moves'),
                    name: plotPayload && plotPayload.mode === 'moves' ? 'Count' : '',
                    position: 'right',
                    min: function (value) { return Math.min(value.min, 0); },
                    max: function (value) { return Math.max(value.max, 0); },
                    axisLine: { lineStyle: { color: theme.axis } },
                    axisLabel: { color: theme.muted },
                    splitLine: { show: false },
                },
            ],
            series: series,
        });

        if (isBandsMode) {
            var macroRow = document.createElement('div');
            macroRow.className = 'lwc-report-macro-bar';
            function mkMacroBtn(label) {
                var b = document.createElement('button');
                b.type = 'button';
                b.textContent = label;
                b.className = 'lwc-report-macro-toggle';
                b.setAttribute('aria-pressed', 'false');
                return b;
            }
            function syncMacroBtnStyle(btn, on) {
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.classList.toggle('is-active', !!on);
            }
            var rbaMacroBtn = mkMacroBtn('RBA');
            var cpiMacroBtn = mkMacroBtn('CPI');
            function applyRibbonMacroDisplay() {
                var merged = bandsOnlyYExtent;
                if (showRbaMacroLine) {
                    merged = mergeRateExtents(merged, extentFromDailyRows(dates, rbaDaily, 'value'));
                }
                if (showCpiMacroLine) {
                    merged = mergeRateExtents(merged, extentFromDailyRows(dates, cpiDaily, 'value'));
                }
                if (showRbaMacroLine || showCpiMacroLine) merged = merged ? padExtent(merged) : bandsOnlyYExtent;
                else merged = bandsOnlyYExtent;
                if (!merged) merged = bandsOnlyYExtent;
                chart.setOption(
                    {
                        animation: true,
                        animationDuration: 220,
                        animationEasing: 'cubicOut',
                        yAxis: [{ min: merged.min, max: merged.max, scale: false }],
                        series: [
                            { name: 'RBA', lineStyle: { opacity: showRbaMacroLine ? 1 : 0 }, silent: !showRbaMacroLine },
                            { name: 'CPI', lineStyle: { opacity: showCpiMacroLine ? 1 : 0 }, silent: !showCpiMacroLine },
                        ],
                    },
                    { lazyUpdate: false, silent: true }
                );
                window.requestAnimationFrame(function () {
                    syncRibbonQuintileFillGradients();
                });
                if (useRibbonCanvas) scheduleRibbonRedraw();
            }
            rbaMacroBtn.addEventListener('click', function () {
                showRbaMacroLine = !showRbaMacroLine;
                container._ribbonMacroRba = showRbaMacroLine;
                syncMacroBtnStyle(rbaMacroBtn, showRbaMacroLine);
                applyRibbonMacroDisplay();
            });
            cpiMacroBtn.addEventListener('click', function () {
                showCpiMacroLine = !showCpiMacroLine;
                container._ribbonMacroCpi = showCpiMacroLine;
                syncMacroBtnStyle(cpiMacroBtn, showCpiMacroLine);
                applyRibbonMacroDisplay();
            });
            syncMacroBtnStyle(rbaMacroBtn, showRbaMacroLine);
            syncMacroBtnStyle(cpiMacroBtn, showCpiMacroLine);
            if (showRbaMacroLine || showCpiMacroLine) applyRibbonMacroDisplay();
            var macroLab = document.createElement('span');
            macroLab.className = 'lwc-report-macro-label';
            macroLab.textContent = 'Macro';
            macroRow.appendChild(macroLab);
            macroRow.appendChild(rbaMacroBtn);
            macroRow.appendChild(cpiMacroBtn);
            wrapper.insertBefore(macroRow, mount);
        }

        if (!isBandsMode) {
            var reportAxisPtrLogAt = 0;
            chart.on('updateAxisPointer', function (ev) {
                var tPtr = Date.now();
                if (tPtr - reportAxisPtrLogAt < 320) return;
                reportAxisPtrLogAt = tPtr;
                var ax0 = ev && ev.axesInfo && ev.axesInfo[0];
                if (!ax0) return;
                var vRaw = ax0.value;
                var vOut = vRaw;
                if (Array.isArray(vRaw)) vOut = vRaw.slice(0, 4);
                else if (vRaw != null && typeof vRaw === 'object') vOut = '[axis value]';
                clientLog('info', 'Chart report axis pointer', {
                    section: String(section || ''),
                    mode: plotPayload && plotPayload.mode,
                    axisDim: ax0.axisDim,
                    axisIndex: ax0.axisIndex,
                    value: vOut,
                });
            });
        }

        if (isBandsMode) {
            applyRibbonBankHighlightState(ribbonChartHighlightBank());
        }

        if (isBandsMode && useRibbonCanvas) {
            ribbonCanvas = document.createElement('canvas');
            ribbonCanvas.className = 'lwc-ribbon-products-canvas';
            ribbonCanvas.setAttribute('aria-hidden', 'true');
            ribbonCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4;';
            mount.appendChild(ribbonCanvas);
            ribbonCanvasCtx = ribbonCanvas.getContext('2d');
        }

        if (isBandsMode) {
            function ribbonAnchorYmdOrLast() {
                var cur = String(lastPointerDate || '').slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(cur) && dates.indexOf(cur) >= 0) return cur;
                return dates.length ? dates[dates.length - 1] : '';
            }

            /** Walk tree and return path string '0>2>1' that ends at leaf whose row matches bank+product. */
            function findTreePathForProduct(tree, bankName, productName) {
                if (!tree) return '';
                var wantBank = String(bankName || '').trim().toLowerCase();
                var wantProduct = String(productName || '').trim().toLowerCase();
                function walk(node, path) {
                    if (!node || node.kind === 'empty') return '';
                    if (node.kind === 'leaves') {
                        var found = (node.products || []).some(function (p) {
                            var pb = String(p.bankName || '').toLowerCase();
                            var pp = String(p.productName || '').toLowerCase();
                            return (!wantBank || pb === wantBank) && (!wantProduct || pp.indexOf(wantProduct) >= 0 || wantProduct.indexOf(pp) >= 0);
                        });
                        return found ? path : '';
                    }
                    var groups = node.groups || [];
                    for (var i = 0; i < groups.length; i++) {
                        var subPath = path ? path + '>' + i : String(i);
                        var result = walk(groups[i].child, subPath);
                        if (result) return result;
                    }
                    return '';
                }
                return walk(tree, '');
            }

            function focusOnLeaderProduct(detail) {
                if (!detail) return;
                var bankRaw = String(detail.bankName || '').trim();
                if (!bankRaw) return;
                var bn = canonicalBandsBankFromUi(bankRaw);
                if (!bn) bn = bankRaw;
                var plist = ribbonCanvasModel.byBank[bn];
                if (!plist || !plist.length) {
                    clientLog('info', 'Chart leader focus bank not in scope', {
                        section: String(section || ''),
                        requested: chartLogClip(bankRaw, 48),
                        canonical: chartLogClip(bn, 48),
                    });
                    return;
                }
                ribbonTrayHoverBank = '';
                ribbonProductBank = bn;
                hoveredBank = bn;
                setRibbonAnchorDate(ribbonAnchorYmdOrLast());
                refreshRibbonUnderChartPanel();
                if (ribbonCurrentTree && detail.productName) {
                    var path = findTreePathForProduct(ribbonCurrentTree, bn, detail.productName);
                    if (path) {
                        setRibbonExpandedBranchPath(path, true);
                        refreshRibbonUnderChartPanel();
                    }
                }
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                clientLog('info', 'Chart leader focus jump', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                    product: chartLogClip(detail.productName || '', 60),
                });
            }

            leaderFocusListener = function (ev) {
                var detail = ev && ev.detail;
                if (!detail) return;
                if (detail.section && String(detail.section) !== String(section)) return;
                focusOnLeaderProduct(detail);
            };
            window.addEventListener('ar:leader-focus', leaderFocusListener);

            ribbonChromeHandlers.onChipClick = function (fullName) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (!bn) return;
                if (
                    ribbonProductBank &&
                    normRibbonBankName(bn) === normRibbonBankName(ribbonProductBank)
                ) {
                    ribbonTrayHoverBank = '';
                    ribbonProductBank = '';
                    hoveredBank = '';
                    hideRibbonInfoBox();
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    refreshRibbonUnderChartPanel();
                    scheduleRibbonRedraw();
                    syncRibbonTrayUi();
                    clientLog('info', 'Chart lender tray chip deselect', {
                        section: String(section || ''),
                        bank: chartLogClip(bn, 48),
                    });
                    return;
                }
                ribbonTrayHoverBank = '';
                ribbonProductBank = bn;
                hoveredBank = bn;
                setRibbonAnchorDate(ribbonAnchorYmdOrLast());
                syncRibbonPinnedPanelState();
                window.requestAnimationFrame(function () {
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    if (useRibbonCanvas) scheduleRibbonRedraw();
                });
                clientLog('info', 'Chart lender tray chip click', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                    anchorDate: lastPointerDate || null,
                });
            };

            ribbonChromeHandlers.onChipPointerEnter = function (fullName) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (!bn) return;
                hoveredBank = '';
                ribbonTrayHoverBank = bn;
                if (!lastPointerDate && dates.length) lastPointerDate = dates[dates.length - 1];
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                window.requestAnimationFrame(function () {
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    if (useRibbonCanvas) scheduleRibbonRedraw();
                });
                clientLog('info', 'Chart lender tray logo hover', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                });
            };
            ribbonChromeHandlers.onChipPointerLeave = function (fullName, ev) {
                var bn = canonicalBandsBankFromUi(String(fullName || '').trim());
                if (normRibbonBankName(ribbonTrayHoverBank) !== normRibbonBankName(bn)) return;
                var toEl = ev && ev.relatedTarget;
                if (toEl && ribbonHierarchyPanel && ribbonHierarchyPanel.el && ribbonHierarchyPanel.el.contains(toEl)) {
                    return;
                }
                ribbonTrayHoverBank = '';
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                updateProductVisibility();
                refreshRibbonUnderChartPanel();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
                clientLog('info', 'Chart lender tray logo hover end', {
                    section: String(section || ''),
                    bank: chartLogClip(bn, 48),
                });
            };

            (function attachRibbonHierarchyHover() {
                var panelEl = ribbonHierarchyPanel && ribbonHierarchyPanel.el;
                if (!panelEl) return;
                if (panelEl._arRibbonListOver) {
                    try { panelEl.removeEventListener('mouseover', panelEl._arRibbonListOver); } catch (_e) {}
                    try { panelEl.removeEventListener('mouseout', panelEl._arRibbonListOut); } catch (_e2) {}
                }
                panelEl._arRibbonListOver = function (ev) {
                    var row = ev.target.closest('[data-ribbon-scope]');
                    if (!row || !panelEl.contains(row)) return;
                    var sid = row.getAttribute('data-ribbon-scope');
                    var keys = sid ? ribbonHoverScopeMap[sid] : null;
                    if (!keys || !keys.length) return;
                    ribbonListHoverKeys = keys.slice();
                    ribbonListHoverPath = String(row.getAttribute('data-ribbon-tree-path') || '');
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    syncInfoboxRowHighlight();
                    syncRibbonTrayUi();
                    var rowIsLeaf = row.classList && row.classList.contains('ar-report-infobox-trow--leaf');
                    var preview = keys.length === 1 ? chartLogProductParts(keys[0]) : null;
                    clientLog('info', rowIsLeaf ? 'Chart hierarchy product row hover' : 'Chart hierarchy tier row hover', {
                        section: String(section || ''),
                        keys: keys.length,
                        bank: preview ? preview.bank : null,
                        product: preview ? preview.product : null,
                    });
                };
                panelEl._arRibbonListOut = function (ev) {
                    var toEl = ev.relatedTarget;
                    if (toEl && panelEl.contains(toEl)) return;
                    if (!ribbonListHoverKeys) return;
                    var n = ribbonListHoverKeys.length;
                    ribbonListHoverKeys = null;
                    ribbonListHoverPath = '';
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    scheduleRibbonRedraw();
                    syncInfoboxRowHighlight();
                    syncRibbonTrayUi();
                    clientLog('info', 'Chart hierarchy row hover clear', { section: String(section || ''), keys: n });
                };
                panelEl.addEventListener('mouseover', panelEl._arRibbonListOver);
                panelEl.addEventListener('mouseout', panelEl._arRibbonListOut);
            })();

            if (ribbonWorkspace) {
                if (ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn) {
                    try {
                        ribbonWorkspace.removeEventListener('pointerleave', ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn);
                    } catch (_e) {}
                    ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn = null;
                }
                var onRibbonWorkspacePointerLeave = function (ev) {
                    var to = ev && ev.relatedTarget;
                    if (to && ribbonWorkspace.contains(to)) return;
                    if (ribbonProductBank) return;
                    if (!ribbonTrayHoverBank) return;
                    ribbonTrayHoverBank = '';
                    applyRibbonBankHighlightState(ribbonChartHighlightBank());
                    updateProductVisibility();
                    refreshRibbonUnderChartPanel();
                    scheduleRibbonRedraw();
                    syncRibbonTrayUi();
                };
                ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn = onRibbonWorkspacePointerLeave;
                ribbonWorkspace.addEventListener('pointerleave', onRibbonWorkspacePointerLeave);
            }

            chart.on('finished', function () {
                applyRibbonBankHighlightState();
                syncRibbonQuintileFillGradients();
                if (!ribbonUnderchartSyncedOnFinish) {
                    ribbonUnderchartSyncedOnFinish = true;
                    refreshRibbonUnderChartPanel();
                }
            });

            siteUiRibbonListener = function () {
                var tu = Date.now();
                if (tu - lastSiteUiRibbonLogAt >= 800) {
                    lastSiteUiRibbonLogAt = tu;
                    clientLog('info', 'Chart ribbon style refresh (site UI)', { section: String(section || '') });
                }
                applyRibbonBankHighlightState(ribbonChartHighlightBank());
                syncRibbonQuintileFillGradients();
                updateProductVisibility();
                scheduleRibbonRedraw();
                syncRibbonTrayUi();
            };
            window.addEventListener('ar:site-ui-settings', siteUiRibbonListener);
            syncRibbonTrayUi();
            refreshRibbonUnderChartPanel();
        }

        return {
            mount: mount,
            chart: {
                resize: function (width, height) {
                    chart.resize({ width: width, height: height });
                    chartWidth = width || mount.clientWidth || container.clientWidth || window.innerWidth || chart.getWidth() || 0;
                    showRibbonEdgeLabels = chartWidth >= 1080;
                    reportGridRight = showRibbonEdgeLabels ? 144 : (chartWidth >= 760 ? 28 : 18);
                    chart.setOption({ grid: { right: reportGridRight } }, { lazyUpdate: false, silent: true });
                    if (isBandsMode) {
                        applyRibbonBankHighlightState(ribbonChartHighlightBank());
                        syncRibbonQuintileFillGradients();
                    }
                    if (useRibbonCanvas) {
                        recomputeRibbonLod();
                        scheduleRibbonRedraw();
                    }
                },
            },
            kind: options.reportViewKind || 'report-plot',
            dispose: function () {
                if (ribbonRaf != null) {
                    try { window.cancelAnimationFrame(ribbonRaf); } catch (_) {}
                    ribbonRaf = null;
                }
                if (zrRibbonSubs.length) {
                    try {
                        var zr2 = chart.getZr();
                        zrRibbonSubs.forEach(function (sub) {
                            try { zr2.off(sub.type, sub.fn); } catch (_) {}
                        });
                    } catch (_) {}
                }
                zrRibbonSubs = [];
                if (siteUiRibbonListener) {
                    try { window.removeEventListener('ar:site-ui-settings', siteUiRibbonListener); } catch (_) {}
                    siteUiRibbonListener = null;
                }
                if (leaderFocusListener) {
                    try { window.removeEventListener('ar:leader-focus', leaderFocusListener); } catch (_) {}
                    leaderFocusListener = null;
                }
                if (ribbonWorkspace && ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn) {
                    try {
                        ribbonWorkspace.removeEventListener('pointerleave', ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn);
                    } catch (_e5) {}
                    ribbonWorkspace._arRibbonTrayWorkspaceLeaveFn = null;
                }
                if (options.infoBox && options.infoBox.el) {
                    var ibx = options.infoBox.el;
                    ibx._arOnClose = null;
                }
                if (ribbonHierarchyPanel && ribbonHierarchyPanel.el) {
                    var panelEl = ribbonHierarchyPanel.el;
                    if (panelEl._arRibbonListOver) {
                        try { panelEl.removeEventListener('mouseover', panelEl._arRibbonListOver); } catch (_e3) {}
                        panelEl._arRibbonListOver = null;
                    }
                    if (panelEl._arRibbonListOut) {
                        try { panelEl.removeEventListener('mouseout', panelEl._arRibbonListOut); } catch (_e4) {}
                        panelEl._arRibbonListOut = null;
                    }
                    if (panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
                }
                try { chart.dispose(); } catch (_) {}
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
            },
        };
    }

    var chartReportPlotPayloadUtils = window.AR.chartReportPlotPayloadUtils || {};

    window.AR.chartReportPlot = {
        createMovesStrip: createMovesStrip,
        prepareLwcMovesHistogram: prepareLwcMovesHistogram,
        attachLwcMovesPane: attachLwcMovesPane,
        payloadDateRange: chartReportPlotPayloadUtils.payloadDateRange,
        fallbackSeriesDateBoundsFromModel: chartReportPlotPayloadUtils.fallbackSeriesDateBoundsFromModel,
        bankTrayEntriesFromBandsPayload: chartReportPlotPayloadUtils.bankTrayEntriesFromBandsPayload,
        render: render,
    };
})();
