/**
 * Shared RBA + CPI preparation for Economic / Home Loan / Term Deposit LWC report charts.
 * Single implementation so macro overlays match home loans everywhere.
 */
(function () {
    'use strict';
    window.AR = window.AR || {};

    function ymdToUtc(ymd) {
        var p = ymd.split('-');
        return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 1000;
    }

    function shiftUtcDate(ymd, adjuster) {
        var date = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z');
        if (!Number.isFinite(date.getTime())) return String(ymd || '').slice(0, 10);
        adjuster(date);
        return date.toISOString().slice(0, 10);
    }

    function shiftDays(ymd, days) {
        return shiftUtcDate(ymd, function (date) {
            date.setUTCDate(date.getUTCDate() + Number(days || 0));
        });
    }

    function shiftYears(ymd, years) {
        return shiftUtcDate(ymd, function (date) {
            date.setUTCFullYear(date.getUTCFullYear() + Number(years || 0));
        });
    }

    function utcToYmd(ts) {
        return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    }

    function fillForwardDaily(points, dateKey, valKey, startYmd, endYmd) {
        var result = [];
        var cur = new Date(startYmd + 'T00:00:00Z');
        var end = new Date(endYmd + 'T00:00:00Z');
        var last = null;
        var idx = 0;
        while (cur <= end) {
            var d = cur.toISOString().slice(0, 10);
            while (idx < points.length && points[idx][dateKey] <= d) {
                last = points[idx][valKey];
                idx++;
            }
            if (last !== null) result.push({ date: d, value: last });
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return result;
    }

    function buildRbaSeries(rbaHistory) {
        if (!Array.isArray(rbaHistory) || !rbaHistory.length) return { points: [], decisions: [] };
        var all = rbaHistory.map(function (row) {
            return {
                date: String(row.effective_date || row.date || '').slice(0, 10),
                rate: Number(row.cash_rate != null ? row.cash_rate : row.value),
            };
        }).filter(function (row) {
            return row.date && Number.isFinite(row.rate);
        }).sort(function (left, right) {
            return left.date.localeCompare(right.date);
        });

        var deduped = [];
        all.forEach(function (row) {
            if (!deduped.length || row.rate !== deduped[deduped.length - 1].rate) deduped.push(row);
        });

        return { points: deduped.slice(), decisions: deduped.slice() };
    }

    function buildCpiSeries(cpiData) {
        return (Array.isArray(cpiData) ? cpiData : []).map(function (row) {
            return {
                date: String(row.quarter_date || row.date || '').slice(0, 10),
                value: Number(row.annual_change != null ? row.annual_change : row.value),
            };
        }).filter(function (row) {
            return row.date && Number.isFinite(row.value);
        }).sort(function (left, right) {
            return left.date.localeCompare(right.date);
        });
    }

    function cpiAtDate(points, dateStr) {
        var value = null;
        for (var i = 0; i < points.length; i++) {
            if (String(points[i].date) <= dateStr) value = points[i].value;
        }
        return value;
    }

    /**
     * Match home-loan report: anchor RBA at first CPI quarter, clip to ctxMax, extend both to ctxMax.
     */
    function prepareRbaCpiForReport(rbaHistory, cpiData, ctxMax) {
        var rbaData = buildRbaSeries(rbaHistory || []);
        var cpiPoints = buildCpiSeries(cpiData || []);

        var rbaStart = cpiPoints.length ? cpiPoints[0].date : ctxMin;

        var carry = null;
        var inWindow = [];
        rbaData.points.forEach(function (point) {
            if (point.date < rbaStart) carry = point;
            else if (point.date <= ctxMax) inWindow.push(point);
        });
        var next = [];
        var carryRate = carry ? carry.rate : (inWindow.length ? inWindow[0].rate : null);
        if (carryRate != null) next.push({ date: rbaStart, rate: carryRate });
        next = next.concat(inWindow);
        if (next.length) {
            var last = next[next.length - 1];
            if (last.date < ctxMax) next.push({ date: ctxMax, rate: last.rate });
        }
        rbaData.points = next;

        if (cpiPoints.length) {
            var cpiLast = cpiPoints[cpiPoints.length - 1];
            if (cpiLast.date < ctxMax) {
                cpiPoints.push({ date: ctxMax, value: cpiLast.value });
            }
        }

        return { rbaData: rbaData, cpiPoints: cpiPoints, rbaStart: rbaStart };
    }

    /**
     * Value of the step immediately before the segment active at ymd (same semantics as LWC step lines).
     * rows: ascending { date, [valueKey] } (e.g. value or rate).
     */
    function prevStepValue(rows, ymd, valueKey) {
        if (!rows || !rows.length || !ymd) return null;
        var vk = valueKey || 'value';
        var y = String(ymd).slice(0, 10);
        var i = -1;
        for (var k = 0; k < rows.length; k++) {
            if (String(rows[k].date).slice(0, 10) <= y) i = k;
            else break;
        }
        if (i <= 0) return null;
        var prev = Number(rows[i - 1][vk]);
        return Number.isFinite(prev) ? prev : null;
    }

    /**
     * Field on the active step segment at ymd (last row with date <= ymd).
     * rows: ascending { date, ... }.
     */
    function stepFieldAtDate(rows, ymd, field) {
        if (!rows || !rows.length || !ymd) return null;
        var fk = field || 'value';
        var y = String(ymd).slice(0, 10);
        var i = -1;
        for (var k = 0; k < rows.length; k++) {
            if (String(rows[k].date).slice(0, 10) <= y) i = k;
            else break;
        }
        if (i < 0) return null;
        return rows[i][fk];
    }

    /** Best-per-bank merge: max rate; tie → lexicographically smaller product name. */
    function mergeWinningDeposit(byDateCell, v, productName) {
        var pn = String(productName || '');
        if (byDateCell == null) return { value: v, productName: pn };
        if (v > byDateCell.value + 1e-9) return { value: v, productName: pn };
        if (Math.abs(v - byDateCell.value) <= 1e-9 && pn.localeCompare(byDateCell.productName) < 0) {
            return { value: v, productName: pn };
        }
        return byDateCell;
    }

    /** Best-per-bank merge: min rate; tie → lexicographically smaller product name. */
    function mergeWinningMortgage(byDateCell, v, productName) {
        var pn = String(productName || '');
        if (byDateCell == null) return { value: v, productName: pn };
        if (v < byDateCell.value - 1e-9) return { value: v, productName: pn };
        if (Math.abs(v - byDateCell.value) <= 1e-9 && pn.localeCompare(byDateCell.productName) < 0) {
            return { value: v, productName: pn };
        }
        return byDateCell;
    }

    /**
     * Legend label HTML for a series row at a given date (bank aggregate uses productName on step points).
     */
    function legendSliceLabelHtml(line, stepPoints, ymd, ctxMax) {
        var dt = ymd || ctxMax;
        var pn = stepPoints && stepPoints.length ? stepFieldAtDate(stepPoints, dt, 'productName') : null;
        if (pn != null && String(pn) !== '') {
            var sh = line.short != null ? line.short : '';
            return escHtml(sh + ' \u00b7 ' + shortProductName(String(pn)));
        }
        return escHtml(line.legendLabel || '');
    }

    /**
     * View mode bar: Best per bank | All products | horizontal bank logo tray (focus).
     */
    function createReportViewModeBar(opts) {
        var section = opts.section;
        var vm = opts.vm;
        var bankList = opts.bankList || [];
        var onReRender = opts.onReRender;

        var bar = document.createElement('div');
        bar.className = 'lwc-report-viewmode';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Chart series view');

        function mkTab(label, isActive, tabClass) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'lwc-report-viewmode-tab' + (isActive ? ' is-active' : '') + (tabClass ? ' ' + tabClass : '');
            b.textContent = label;
            return b;
        }

        var btnBank = mkTab('Best per bank', vm.mode === 'bank', 'lwc-report-viewmode-tab--first');
        btnBank.addEventListener('click', function () {
            setViewMode(section, 'bank');
            onReRender();
        });

        var btnAll = mkTab('All products', vm.mode === 'products', '');
        btnAll.addEventListener('click', function () {
            setViewMode(section, 'products');
            onReRender();
        });

        var trayWrap = document.createElement('div');
        trayWrap.className = 'lwc-focus-bank-tray-wrap';

        var tray = document.createElement('div');
        tray.className = 'lwc-focus-bank-tray';
        tray.setAttribute('role', 'radiogroup');
        tray.setAttribute('aria-label', 'Focus bank');

        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'lwc-focus-bank-clear';
        clearBtn.textContent = '\u00d7';
        clearBtn.title = 'Clear bank focus';
        clearBtn.setAttribute('aria-label', 'Clear bank focus');
        clearBtn.disabled = vm.mode !== 'focus';
        clearBtn.addEventListener('click', function () {
            if (vm.mode !== 'focus') return;
            setViewMode(section, 'bank');
            onReRender();
        });

        tray.appendChild(clearBtn);

        var BB = window.AR.bankBrand;
        bankList.forEach(function (bn) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'lwc-focus-bank-chip';
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', vm.mode === 'focus' && bn.full === vm.focusBank ? 'true' : 'false');
            chip.title = bn.full;
            chip.setAttribute('aria-label', 'Focus ' + bn.full);
            if (vm.mode === 'focus' && bn.full === vm.focusBank) chip.classList.add('is-selected');

            var meta = BB && typeof BB.getMeta === 'function' ? BB.getMeta(bn.full) : { icon: '', short: bn.short };
            if (meta.icon) {
                var img = document.createElement('img');
                img.src = meta.icon;
                img.alt = '';
                img.className = 'lwc-focus-bank-chip-logo';
                img.width = 20;
                img.height = 20;
                img.loading = 'lazy';
                img.decoding = 'async';
                img.draggable = false;
                chip.appendChild(img);
            } else {
                var fb = document.createElement('span');
                fb.className = 'lwc-focus-bank-chip-fallback';
                fb.textContent = (meta.short || bn.short || '?').charAt(0);
                chip.appendChild(fb);
            }

            chip.addEventListener('click', function () {
                setViewMode(section, 'focus', bn.full);
                onReRender();
            });
            tray.appendChild(chip);
        });

        trayWrap.appendChild(tray);
        bar.appendChild(btnBank);
        bar.appendChild(btnAll);
        bar.appendChild(trayWrap);
        return bar;
    }

    var REPORT_RANGE_OPTIONS = [
        { value: '30D', label: '30D', unit: 'days', amount: 30 },
        { value: '90D', label: '90D', unit: 'days', amount: 90 },
        { value: '180D', label: '180D', unit: 'days', amount: 180 },
        { value: '1Y', label: '1Y', unit: 'years', amount: 1 },
        { value: 'All', label: 'All' },
    ];
    var _reportRangeBySection = {};

    function getReportRange(section) {
        return _reportRangeBySection[section] || '90D';
    }

    function setReportRange(section, range) {
        var next = String(range || '90D');
        var known = false;
        REPORT_RANGE_OPTIONS.forEach(function (option) {
            if (option.value === next) known = true;
        });
        _reportRangeBySection[section] = known ? next : '90D';
    }

    function formatRangeAnchor(ymd) {
        var value = String(ymd || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        return new Intl.DateTimeFormat('en-AU', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            timeZone: 'UTC',
        }).format(new Date(value + 'T00:00:00Z'));
    }

    function minDate(a, b) {
        if (!a) return String(b || '');
        if (!b) return String(a || '');
        return String(a) < String(b) ? String(a) : String(b);
    }

    function maxDate(a, b) {
        if (!a) return String(b || '');
        if (!b) return String(a || '');
        return String(a) > String(b) ? String(a) : String(b);
    }

    function resolveReportRangeStart(minYmd, maxYmd, range) {
        var floor = String(minYmd || '').slice(0, 10);
        var ceiling = String(maxYmd || '').slice(0, 10);
        if (!floor || !ceiling) return ceiling || floor || '';
        if (String(range || '') === 'All') return floor;
        var option = null;
        REPORT_RANGE_OPTIONS.forEach(function (entry) {
            if (entry.value === range) option = entry;
        });
        if (!option) return maxDate(floor, shiftDays(ceiling, -90));
        var next = ceiling;
        if (option.unit === 'days') next = shiftDays(ceiling, -option.amount);
        if (option.unit === 'years') next = shiftYears(ceiling, -option.amount);
        return maxDate(floor, next);
    }

    function buildReportRangeNote(range, minYmd, maxYmd) {
        var latest = formatRangeAnchor(maxYmd);
        if (String(range || '') === 'All') {
            return 'Visible window: full available history through ' + latest + '.';
        }
        return 'Visible window: last ' + String(range || '90D') + ' through ' + latest + '.';
    }

    function createReportRangeBar(opts) {
        var section = opts.section;
        var range = opts.range;
        var minDateValue = opts.minDate;
        var maxDateValue = opts.maxDate;
        var onChange = opts.onChange;

        var wrap = document.createElement('div');
        wrap.className = 'lwc-report-range';

        var row = document.createElement('div');
        row.className = 'lwc-report-range-row';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Chart timeframe');

        REPORT_RANGE_OPTIONS.forEach(function (option) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'chip-btn secondary' + (option.value === range ? ' active' : '');
            button.textContent = option.label;
            button.setAttribute('data-report-range', option.value);
            button.setAttribute('aria-pressed', option.value === range ? 'true' : 'false');
            button.addEventListener('click', function () {
                setReportRange(section, option.value);
                if (typeof onChange === 'function') onChange(option.value);
            });
            row.appendChild(button);
        });

        var note = document.createElement('p');
        note.className = 'lwc-report-range-note hint';
        note.textContent = buildReportRangeNote(range, minDateValue, maxDateValue);

        wrap.appendChild(row);
        wrap.appendChild(note);
        return wrap;
    }

    function reportChartOptions(L, theme, hasLeftScale) {
        var lineStyle = (L && L.LineStyle) || { Dashed: 2 };
        return {
            layout: {
                background: { type: L.ColorType.Solid, color: 'transparent' },
                textColor: theme.muted,
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
            },
            grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
            rightPriceScale: {
                borderColor: theme.axis,
                scaleMargins: { top: 0.06, bottom: 0.12 },
                lastValueVisible: false,
            },
            leftPriceScale: {
                visible: !!hasLeftScale,
                borderColor: theme.axis,
                scaleMargins: { top: 0.06, bottom: 0.12 },
                lastValueVisible: false,
            },
            timeScale: {
                borderColor: theme.axis,
                timeVisible: false,
                secondsVisible: false,
                rightOffset: 5,
            },
            crosshair: {
                mode: L.CrosshairMode.Normal,
                vertLine: {
                    color: theme.crosshairLine,
                    width: 1,
                    style: lineStyle.Dashed,
                    labelBackgroundColor: theme.crosshairLabelBg,
                },
                horzLine: {
                    color: theme.crosshairLine,
                    width: 1,
                    style: lineStyle.Dashed,
                    labelBackgroundColor: theme.crosshairLabelBg,
                },
            },
            handleScroll: {
                mouseWheel: false,
                pressedMouseMove: false,
                horzTouchDrag: false,
                vertTouchDrag: false,
            },
            handleScale: {
                axisPressedMouseMove: false,
                mouseWheel: false,
                pinch: false,
            },
        };
    }

    /**
     * Tiny arrow after "%" for legend: deposit = green up / red down; mortgage = red up / green down.
     */
    function rateLegendArrowHtml(current, previous, semantics, goodColor, badColor) {
        var cur = Number(current);
        var prev = previous == null ? null : Number(previous);
        if (prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return '';
        if (Math.abs(cur - prev) < 1e-6) return '';
        var up = cur > prev;
        var st = 'font-size:7px;line-height:1;margin-left:1px;display:inline-block;vertical-align:0.08em;';
        var g = goodColor || '#059669';
        var b = badColor || '#dc2626';
        if (semantics === 'mortgage') {
            if (up) return '<span style="' + st + 'color:' + b + ';">\u25b2</span>';
            return '<span style="' + st + 'color:' + g + ';">\u25bc</span>';
        }
        if (up) return '<span style="' + st + 'color:' + g + ';">\u25b2</span>';
        return '<span style="' + st + 'color:' + b + ';">\u25bc</span>';
    }

    // ── View mode state for report charts ────────────────────────────────────
    var _viewModeBySection = {};

    function getViewMode(section) {
        return _viewModeBySection[section] || { mode: 'bank', focusBank: '' };
    }

    function setViewMode(section, mode, focusBank) {
        _viewModeBySection[section] = { mode: mode || 'bank', focusBank: focusBank || '' };
    }

    function productColorVariant(baseHex, idx, total) {
        if (total <= 1 || idx === 0) return baseHex;
        var r = parseInt(baseHex.slice(1, 3), 16);
        var g = parseInt(baseHex.slice(3, 5), 16);
        var b = parseInt(baseHex.slice(5, 7), 16);
        var alpha = Math.max(0.35, 1 - idx * 0.22);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
    }

    function shortProductName(name) {
        var s = String(name || '').trim();
        if (s.length <= 20) return s;
        return s.slice(0, 19).trim() + '\u2026';
    }

    function escHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Last finite normalized_value along an economic overlay point list (chronological). */
    function lastFiniteNormalizedOverlay(points) {
        var last = null;
        (Array.isArray(points) ? points : []).forEach(function (p) {
            if (p && Number.isFinite(Number(p.normalized_value))) last = Number(p.normalized_value);
        });
        return last;
    }

    /**
     * HTML row for indexed economic overlay in the report legend (dashed swatch matches LWC overlay series).
     */
    function economicOverlayLegendItemHtml(color, label, value) {
        if (value == null || !Number.isFinite(Number(value))) return '';
        var c = String(color || '#64748b').replace(/[<>"'&]/g, '');
        var lbl = escHtml(String(label || ''));
        var v = Number(value).toFixed(1);
        return '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">' +
            '<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + c + ';flex-shrink:0;"></span>' +
            '<span style="opacity:0.75;color:' + c + ';">' + lbl + '</span>' +
            '<span style="font-variant-numeric:tabular-nums;font-weight:600;color:' + c + ';">' + v + '</span></span>';
    }

    window.AR.chartMacroLwcShared = {
        ymdToUtc: ymdToUtc,
        utcToYmd: utcToYmd,
        fillForwardDaily: fillForwardDaily,
        cpiAtDate: cpiAtDate,
        prepareRbaCpiForReport: prepareRbaCpiForReport,
        prevStepValue: prevStepValue,
        stepFieldAtDate: stepFieldAtDate,
        mergeWinningDeposit: mergeWinningDeposit,
        mergeWinningMortgage: mergeWinningMortgage,
        legendSliceLabelHtml: legendSliceLabelHtml,
        createReportViewModeBar: createReportViewModeBar,
        createReportRangeBar: createReportRangeBar,
        getReportRange: getReportRange,
        setReportRange: setReportRange,
        resolveReportRangeStart: resolveReportRangeStart,
        reportChartOptions: reportChartOptions,
        rateLegendArrowHtml: rateLegendArrowHtml,
        getViewMode: getViewMode,
        setViewMode: setViewMode,
        productColorVariant: productColorVariant,
        shortProductName: shortProductName,
        escHtml: escHtml,
        lastFiniteNormalizedOverlay: lastFiniteNormalizedOverlay,
        economicOverlayLegendItemHtml: economicOverlayLegendItemHtml,
    };
})();
