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

    function clipSteppedWindow(points, startYmd, endYmd, valueKey) {
        var source = Array.isArray(points) ? points : [];
        var start = String(startYmd || '').slice(0, 10);
        var end = String(endYmd || '').slice(0, 10);
        var key = valueKey || 'value';
        if (!start || !end) return [];

        var carry = null;
        var windowPoints = [];
        source.forEach(function (point) {
            var date = String(point && point.date || '').slice(0, 10);
            if (!date) return;
            if (date < start) carry = point;
            else if (date <= end) windowPoints.push(point);
        });

        var rows = [];
        if (carry) {
            var carryValue = Number(carry[key]);
            if (Number.isFinite(carryValue)) rows.push({ date: start, value: carryValue });
        }
        windowPoints.forEach(function (point) {
            var pointValue = Number(point && point[key]);
            if (!Number.isFinite(pointValue)) return;
            rows.push({ date: String(point.date).slice(0, 10), value: pointValue });
        });

        if (!rows.length) return rows;
        var last = rows[rows.length - 1];
        if (last.date < end) rows.push({ date: end, value: last.value });
        return rows;
    }

    function minDateValue(current, candidate) {
        var next = String(candidate || '').slice(0, 10);
        if (!next) return current || '';
        if (!current) return next;
        return next < current ? next : current;
    }

    function earliestPointDate(rows, dateField) {
        var next = '';
        var field = dateField || 'date';
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
            var date = String(row && row[field] || '').slice(0, 10);
            if (!date) return;
            next = minDateValue(next, date);
        });
        return next;
    }

    function earliestOverlayDate(seriesRows) {
        var next = '';
        (Array.isArray(seriesRows) ? seriesRows : []).forEach(function (series) {
            next = minDateValue(next, earliestPointDate(series && series.points, 'date'));
        });
        return next;
    }

    /**
     * Clip RBA/CPI to the chart context while preserving the active step at the window start.
     */
    function prepareRbaCpiForReport(rbaHistory, cpiData, ctxMin, ctxMax) {
        var rawRba = buildRbaSeries(rbaHistory || []);
        var rawCpi = buildCpiSeries(cpiData || []);
        var start = String(ctxMin || '').slice(0, 10);
        var end = String(ctxMax || '').slice(0, 10);
        var rbaPoints = clipSteppedWindow(rawRba.points, start, end, 'rate').map(function (point) {
            return { date: point.date, rate: point.value };
        });
        var cpiPoints = clipSteppedWindow(rawCpi, start, end, 'value').map(function (point) {
            return { date: point.date, value: point.value };
        });

        return {
            rbaData: { points: rbaPoints, decisions: rawRba.decisions.slice() },
            cpiPoints: cpiPoints,
            chartStart: start,
        };
    }

    function resolveReportDataMin(bankMin, rbaHistory, cpiData, economicOverlaySeries) {
        var next = String(bankMin || '').slice(0, 10);
        next = minDateValue(next, earliestPointDate(buildRbaSeries(rbaHistory || []).points, 'date'));
        next = minDateValue(next, earliestPointDate(buildCpiSeries(cpiData || []), 'date'));
        next = minDateValue(next, earliestOverlayDate(economicOverlaySeries || []));
        return next;
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
    function mergeWinningDeposit(byDateCell, v, productName, row) {
        var pn = String(productName || '');
        if (byDateCell == null) return { value: v, productName: pn, row: row || null };
        if (v > byDateCell.value + 1e-9) return { value: v, productName: pn, row: row || null };
        if (Math.abs(v - byDateCell.value) <= 1e-9 && pn.localeCompare(byDateCell.productName) < 0) {
            return { value: v, productName: pn, row: row || null };
        }
        return byDateCell;
    }

    /** Best-per-bank merge: min rate; tie → lexicographically smaller product name. */
    function mergeWinningMortgage(byDateCell, v, productName, row) {
        var pn = String(productName || '');
        if (byDateCell == null) return { value: v, productName: pn, row: row || null };
        if (v < byDateCell.value - 1e-9) return { value: v, productName: pn, row: row || null };
        if (Math.abs(v - byDateCell.value) <= 1e-9 && pn.localeCompare(byDateCell.productName) < 0) {
            return { value: v, productName: pn, row: row || null };
        }
        return byDateCell;
    }

    function normalizeViewMode(mode) {
        var value = String(mode || '').trim().toLowerCase();
        if (value === 'moves') return 'bank';
        if (value === 'bank') return 'bank';
        if (value === 'bands') return 'bands';
        if (value === 'products') return 'products';
        if (value === 'focus') return 'focus';
        return 'products';
    }

    function preloadBankIcons(bankList) {
        var BB = window.AR.bankBrand;
        if (!BB || typeof BB.preloadIcons !== 'function') return;
        BB.preloadIcons((Array.isArray(bankList) ? bankList : []).map(function (bank) {
            return bank && bank.full ? bank.full : '';
        }));
    }

    /**
     * View mode bar: Ribbon | product dropdown (Products / Best) | horizontal bank logo tray (focus).
     */
    function createReportViewModeBar(opts) {
        var section = opts.section;
        var vm = opts.vm;
        var bankList = opts.bankList || [];
        var onReRender = opts.onReRender;
        preloadBankIcons(bankList);

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

        var btnBands = mkTab('Ribbon', vm.mode === 'bands', 'lwc-report-viewmode-tab--first');
        btnBands.addEventListener('click', function () {
            setViewMode(section, 'bands');
            onReRender();
        });

        var selectWrap = document.createElement('div');
        selectWrap.className = 'lwc-report-viewmode-select-wrap' + (vm.mode !== 'bands' ? ' is-active' : '');

        var select = document.createElement('select');
        select.className = 'lwc-report-viewmode-select';
        select.setAttribute('aria-label', 'Products view');

        var productsOption = document.createElement('option');
        productsOption.value = 'products';
        productsOption.textContent = 'All products';
        select.appendChild(productsOption);

        var bestOption = document.createElement('option');
        bestOption.value = 'bank';
        bestOption.textContent = 'Best';
        select.appendChild(bestOption);

        select.value = vm.mode === 'products' || vm.mode === 'focus' ? 'products' : 'bank';
        select.addEventListener('change', function () {
            setViewMode(section, select.value === 'products' ? 'products' : 'bank');
            onReRender();
        });
        selectWrap.appendChild(select);

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
            setViewMode(section, 'products');
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
                img.loading = 'eager';
                img.decoding = 'sync';
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
        bar.appendChild(btnBands);
        bar.appendChild(selectWrap);
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

    function trackingModeOptions(L) {
        var exitMode = L && L.TrackingModeExitMode;
        if (!exitMode) return null;
        if (exitMode.OnNextTap != null) return { exitMode: exitMode.OnNextTap };
        if (exitMode.OnTouchEnd != null) return { exitMode: exitMode.OnTouchEnd };
        return null;
    }

    function reportChartOptions(L, theme, hasLeftScale) {
        var lineStyle = (L && L.LineStyle) || { Dashed: 2 };
        var options = {
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
        var trackingMode = trackingModeOptions(L);
        if (trackingMode) options.trackingMode = trackingMode;
        return options;
    }

    /**
     * Arrow + absolute change after "%" for legend: deposit = green up / red down; mortgage = red up / green down.
     * fractionDigits defaults to 2 (RBA / mortgage); use 1 for CPI-style values.
     */
    function rateLegendArrowHtml(current, previous, semantics, goodColor, badColor, fractionDigits) {
        var cur = Number(current);
        var prev = previous == null ? null : Number(previous);
        var fd = fractionDigits == null ? 2 : Number(fractionDigits);
        if (!Number.isFinite(fd) || fd < 0) fd = 2;
        if (prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return '';
        if (Math.abs(cur - prev) < 1e-6) return '';
        var up = cur > prev;
        var absChg = Math.abs(cur - prev);
        var amt = absChg.toFixed(fd);
        var stArrow = 'font-size:7px;line-height:1;margin-left:1px;display:inline-block;vertical-align:0.08em;filter:brightness(var(--ar-chart-legend-text-brightness,1));';
        var stAmt = 'font-size:7px;line-height:1;margin-left:2px;display:inline-block;vertical-align:0.08em;font-variant-numeric:tabular-nums;filter:brightness(var(--ar-chart-legend-text-brightness,1));';
        var g = goodColor || '#059669';
        var b = badColor || '#dc2626';
        var c;
        if (semantics === 'mortgage') c = up ? b : g;
        else c = up ? g : b;
        var arrow = up ? '\u25b2' : '\u25bc';
        return '<span style="' + stArrow + 'color:' + c + ';">' + arrow + '</span>' +
            '<span style="' + stAmt + 'color:' + c + ';">' + amt + '%</span>';
    }

    // ── View mode state for report charts ────────────────────────────────────
    var _viewModeBySection = {};

    function getViewMode(section) {
        var state = _viewModeBySection[section] || { mode: 'bands', focusBank: '' };
        return {
            mode: normalizeViewMode(state.mode),
            focusBank: String(state.focusBank || ''),
        };
    }

    function setViewMode(section, mode, focusBank) {
        _viewModeBySection[section] = {
            mode: normalizeViewMode(mode),
            focusBank: focusBank || '',
        };
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

    function legendTextStyle(extraCss) {
        return 'filter:brightness(var(--ar-chart-legend-text-brightness,1));' + String(extraCss || '');
    }

    var BANK_ACRONYM = {
        'commonwealth bank of australia': 'CBA',
        'westpac banking corporation': 'WBC',
        'anz': 'ANZ',
        'national australia bank': 'NAB',
        'macquarie bank': 'MQG',
        'ing': 'ING',
        'ubank': 'UBank',
        'bankwest': 'BWT',
        'bank of queensland': 'BOQ',
        'suncorp bank': 'SUN',
        'great southern bank': 'GSB',
        'amp bank': 'AMP',
        'bendigo and adelaide bank': 'BEN',
        'bank of melbourne': 'BoM',
        'st. george bank': 'STG',
        'hsbc australia': 'HSBC',
        'teachers mutual bank': 'TMB',
        'beyond bank australia': 'BBA',
        'me bank': 'MEB',
        'mystate bank': 'MYS',
    };

    function bankAcronym(name) {
        var key = String(name || '').trim().toLowerCase();
        if (BANK_ACRONYM[key]) return BANK_ACRONYM[key];
        var clean = String(name || '').trim().replace(/[^A-Za-z0-9 ]+/g, ' ');
        if (!clean) return '';
        var words = clean.split(/\s+/).filter(Boolean);
        if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
        return words.slice(0, 3).map(function (word) { return word.charAt(0).toUpperCase(); }).join('');
    }

    function titleToken(word) {
        var clean = String(word || '').replace(/[^A-Za-z0-9]/g, '');
        if (!clean) return '';
        if (clean.length <= 4 && clean === clean.toUpperCase()) return clean;
        return clean.charAt(0).toUpperCase() + clean.slice(1, 4).toLowerCase();
    }

    function purposeAbbr(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'owner_occupied') return 'OO';
        if (normalized === 'investment') return 'Inv';
        return '';
    }

    function repaymentAbbr(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'principal_and_interest') return 'PI';
        if (normalized === 'interest_only') return 'IO';
        return '';
    }

    function structureAbbr(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'variable') return 'Var';
        var fixed = normalized.match(/^fixed_(\d+)yr$/);
        if (fixed) return fixed[1] + 'Y';
        return '';
    }

    function accountTypeAbbr(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'savings') return 'Sav';
        if (normalized === 'transaction') return 'Txn';
        if (normalized === 'at_call') return 'Call';
        return '';
    }

    function rateTypeAbbr(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'total') return 'Tot';
        if (normalized === 'base') return 'Base';
        if (normalized === 'bonus') return 'Bonus';
        if (normalized === 'introductory' || normalized === 'intro') return 'Intro';
        if (normalized === 'bundle') return 'Bndl';
        return '';
    }

    function termMonthsAbbr(value) {
        var months = Number(value);
        return Number.isFinite(months) && months > 0 ? String(Math.round(months)) + 'M' : '';
    }

    function interestPaymentAbbr(value) {
        var normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'at_maturity') return 'Mat';
        if (normalized === 'monthly') return 'Mth';
        if (normalized === 'quarterly') return 'Qtr';
        if (normalized === 'annually') return 'Yr';
        return '';
    }

    function compactProductToken(row, fallbackName, bankName) {
        var source = row && row.product_name ? row.product_name : fallbackName;
        var lowerBank = String(bankName || '').trim().toLowerCase();
        var words = String(source || '')
            .replace(/[^A-Za-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .filter(function (word) {
                var lower = word.toLowerCase();
                if (!lower) return false;
                if (lowerBank && lowerBank.indexOf(lower) >= 0) return false;
                return [
                    'home', 'loan', 'loans', 'mortgage', 'savings', 'saving', 'account', 'accounts',
                    'deposit', 'deposits', 'term', 'rate', 'rates', 'variable', 'fixed', 'owner',
                    'occupied', 'occupier', 'investment', 'investor', 'principal', 'interest',
                    'only', 'and', 'the', 'standard', 'basic', 'premium', 'plus', 'offset',
                ].indexOf(lower) < 0;
            });
        if (!words.length) return '';
        return words.slice(0, 2).map(titleToken).filter(Boolean).join('');
    }

    function uniqueParts(parts) {
        var seen = {};
        return (Array.isArray(parts) ? parts : []).filter(function (part) {
            var key = String(part || '').trim();
            if (!key || seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function rowLegendParts(row, section) {
        if (!row || typeof row !== 'object') return [];
        if (section === 'home-loans') {
            return [purposeAbbr(row.security_purpose), repaymentAbbr(row.repayment_type), structureAbbr(row.rate_structure)];
        }
        if (section === 'savings') {
            return [accountTypeAbbr(row.account_type), rateTypeAbbr(row.rate_type)];
        }
        if (section === 'term-deposits') {
            return [termMonthsAbbr(row.term_months), interestPaymentAbbr(row.interest_payment)];
        }
        return [];
    }

    function legendSliceLabelHtml(line, stepPoints, ymd, ctxMax) {
        var dt = ymd || ctxMax;
        var activeRow = stepPoints && stepPoints.length ? stepFieldAtDate(stepPoints, dt, 'row') : null;
        var productName = stepPoints && stepPoints.length ? stepFieldAtDate(stepPoints, dt, 'productName') : null;
        var section = String(line && line.section || (window.AR && window.AR.section) || '').trim();
        var bankName = String(line && (line.bankName || line.short) || (activeRow && activeRow.bank_name) || '').trim();
        var parts = [bankAcronym(bankName)].concat(rowLegendParts(activeRow || (line && line.latestRow), section));
        var token = compactProductToken(activeRow || (line && line.latestRow), productName || (line && line.productName) || '', bankName);
        if (token) parts.push(token);
        parts = uniqueParts(parts);
        if (!parts.length) return escHtml(line && line.legendLabel || '');
        return escHtml(parts.join(' '));
    }

    function parseColor(color) {
        var value = String(color || '').trim();
        if (!value) return null;
        var rgba = value.match(/^rgba?\(([^)]+)\)$/i);
        if (rgba) {
            var parts = rgba[1].split(',').map(function (part) { return Number(String(part).trim()); });
            if (parts.length >= 3 && parts.every(function (part, index) { return index > 2 || Number.isFinite(part); })) {
                return {
                    r: parts[0],
                    g: parts[1],
                    b: parts[2],
                    a: Number.isFinite(parts[3]) ? parts[3] : 1,
                };
            }
        }
        var hex = value.replace('#', '');
        if (/^[0-9a-f]{6}$/i.test(hex)) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: 1,
            };
        }
        if (/^[0-9a-f]{3}$/i.test(hex)) {
            return {
                r: parseInt(hex.charAt(0) + hex.charAt(0), 16),
                g: parseInt(hex.charAt(1) + hex.charAt(1), 16),
                b: parseInt(hex.charAt(2) + hex.charAt(2), 16),
                a: 1,
            };
        }
        return null;
    }

    function colorWithAlpha(color, alpha) {
        var parsed = parseColor(color);
        if (!parsed) return String(color || '');
        var nextAlpha = Math.max(0, Math.min(1, Number(alpha)));
        return 'rgba(' + Math.round(parsed.r) + ', ' + Math.round(parsed.g) + ', ' + Math.round(parsed.b) + ', ' + nextAlpha.toFixed(3) + ')';
    }

    function applySeriesSelectionState(seriesApis, activeKeys) {
        var wanted = {};
        (Array.isArray(activeKeys) ? activeKeys : []).forEach(function (key) {
            var normalized = String(key || '').trim();
            if (normalized) wanted[normalized] = true;
        });
        var hasActive = Object.keys(wanted).length > 0;
        (Array.isArray(seriesApis) ? seriesApis : []).forEach(function (entry) {
            if (!entry || !entry.api || typeof entry.api.applyOptions !== 'function') return;
            var baseColor = String(entry.baseColor || (entry.line && entry.line.color) || '#64748b');
            var baseLineWidth = Number(entry.baseLineWidth || 2);
            var selected = hasActive && wanted[String(entry.selectionKey || (entry.line && entry.line.selectionKey) || '').trim()];
            var nextState = hasActive ? (selected ? 'selected' : 'dimmed') : 'normal';
            if (entry._selectionVisualState === nextState
                && entry._selectionBaseColor === baseColor
                && entry._selectionBaseLineWidth === baseLineWidth) {
                return;
            }
            entry._selectionVisualState = nextState;
            entry._selectionBaseColor = baseColor;
            entry._selectionBaseLineWidth = baseLineWidth;
            try {
                entry.api.applyOptions({
                    color: nextState === 'dimmed' ? colorWithAlpha(baseColor, 0.24) : baseColor,
                    lineWidth: nextState === 'selected' ? baseLineWidth + 1 : baseLineWidth,
                });
            } catch (_e) { /* LWC can throw if series is disposed */ }
        });
    }

    function clearSeriesSelectionState(seriesApis) {
        applySeriesSelectionState(seriesApis, []);
    }

    function rbaDecisionLabel(decisions, index) {
        if (!Array.isArray(decisions) || index < 0 || index >= decisions.length) return 'RBA';
        var current = decisions[index];
        var previous = index > 0 ? decisions[index - 1] : null;
        var deltaBps = previous ? Math.round((Number(current.rate) - Number(previous.rate)) * 100) : 0;
        if (!previous || !Number.isFinite(deltaBps) || deltaBps === 0) return 'RBA';
        return 'RBA ' + (deltaBps > 0 ? '+' : '') + String(deltaBps) + 'bp';
    }

    function ensureDecisionLayer(mount) {
        if (!mount) return null;
        var layer = mount.querySelector('.lwc-report-decision-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'lwc-report-decision-layer';
            layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
            mount.appendChild(layer);
        }
        return layer;
    }

    function renderRbaDecisionLines(mount, chart, decisions, options) {
        var layer = ensureDecisionLayer(mount);
        if (!layer) return;
        layer.innerHTML = '';
        if (!chart || !Array.isArray(decisions) || !decisions.length) return;
        var start = String(options && options.startYmd || '').slice(0, 10);
        var end = String(options && options.endYmd || '').slice(0, 10);
        var lineColor = String(options && options.lineColor || '#f59e0b');
        var labelBg = String(options && options.labelBg || 'rgba(15,23,42,0.92)');
        var labelColor = String(options && options.labelColor || lineColor);
        var timeScale = chart.timeScale && chart.timeScale();
        if (!timeScale || typeof timeScale.timeToCoordinate !== 'function') return;
        var lastLabelX = -Infinity;
        decisions.forEach(function (decision, index) {
            var date = String(decision && decision.date || '').slice(0, 10);
            if (!date || (start && date < start) || (end && date > end)) return;
            var x = timeScale.timeToCoordinate(ymdToUtc(date));
            if (!Number.isFinite(Number(x))) return;
            var rail = document.createElement('div');
            rail.style.cssText = 'position:absolute;top:22px;bottom:20px;left:' + Math.round(Number(x)) + 'px;border-left:1px dashed ' + colorWithAlpha(lineColor, 0.55) + ';';
            layer.appendChild(rail);
            if (Math.abs(Number(x) - lastLabelX) < 54) return;
            lastLabelX = Number(x);
            var label = document.createElement('div');
            label.textContent = rbaDecisionLabel(decisions, index);
            label.style.cssText =
                'position:absolute;top:4px;left:' + Math.round(Number(x) + 4) + 'px;' +
                'padding:1px 5px;border-radius:999px;border:1px solid ' + colorWithAlpha(lineColor, 0.35) + ';' +
                'background:' + labelBg + ';color:' + labelColor + ';font:700 9px/1.3 "Space Grotesk",system-ui,sans-serif;white-space:nowrap;';
            layer.appendChild(label);
        });
    }

    /** Last finite normalized_value along an economic overlay point list (chronological). */
    function lastFiniteNormalizedOverlay(points) {
        var last = null;
        (Array.isArray(points) ? points : []).forEach(function (p) {
            if (p && Number.isFinite(Number(p.normalized_value))) last = Number(p.normalized_value);
        });
        return last;
    }

    function resolveChartProductLimit(defaultLimit) {
        var fallback = Number(defaultLimit);
        if (!Number.isFinite(fallback) || fallback < 1) fallback = 1;
        var siteUi = window.AR && window.AR.chartSiteUi;
        var mode = siteUi && typeof siteUi.getChartMaxProductsMode === 'function'
            ? String(siteUi.getChartMaxProductsMode() || '').toLowerCase()
            : '';
        if (mode === 'unlimited') return Number.MAX_SAFE_INTEGER;
        var cap = siteUi && typeof siteUi.getChartMaxProducts === 'function'
            ? siteUi.getChartMaxProducts()
            : null;
        if (!Number.isFinite(Number(cap)) || Number(cap) < 1) return fallback;
        return Math.max(1, Math.floor(Number(cap)));
    }

    function seriesValueAtClick(param, api) {
        var point = param && param.seriesData && api ? param.seriesData.get(api) : null;
        if (point && Number.isFinite(Number(point.value))) return Number(point.value);
        if (point && Number.isFinite(Number(point.close))) return Number(point.close);
        return null;
    }

    function selectionMetaText(cluster) {
        if (!cluster || !Array.isArray(cluster.entries) || !cluster.entries.length) return '';
        var count = cluster.entries.length;
        var noun = count === 1 ? 'product' : 'products';
        return count + ' ' + noun + ' at ' + Number(cluster.rate).toFixed(2) + '%';
    }

    function findOverlappingSelectionEntries(seriesApis, param) {
        if (!param || !param.point || param.time == null) return null;
        var pointerY = Number(param.point.y);
        if (!Number.isFinite(pointerY)) return null;
        var bestDist = Infinity;
        var bestEntry = null;
        (Array.isArray(seriesApis) ? seriesApis : []).forEach(function (entry) {
            var value = seriesValueAtClick(param, entry.api);
            if (!Number.isFinite(value)) return;
            var coord = entry.api && typeof entry.api.priceToCoordinate === 'function'
                ? entry.api.priceToCoordinate(value)
                : null;
            if (coord == null || !Number.isFinite(Number(coord))) return;
            var dist = Math.abs(Number(coord) - pointerY);
            if (dist < bestDist) {
                bestDist = dist;
                bestEntry = { entry: entry, value: value };
            }
        });
        if (!bestEntry || bestDist >= 30) return null;
        var selectionYmd = utcToYmd(param.time);
        var anchorValue = bestEntry.value;
        var matches = [];
        (Array.isArray(seriesApis) ? seriesApis : []).forEach(function (entry) {
            var value = seriesValueAtClick(param, entry.api);
            if (!Number.isFinite(value)) return;
            if (Math.abs(value - anchorValue) > 1e-6) return;
            var line = entry.line || {};
            var productAtDate = stepFieldAtDate(entry.stepPoints, selectionYmd, 'productName');
            matches.push({
                selectionKey: String(entry.selectionKey || line.selectionKey || ''),
                bankName: line.bankName || line.short || '',
                productName: productAtDate != null && String(productAtDate) !== '' ? String(productAtDate) : (line.productName || ''),
                rate: value,
                subtitle: line.subtitle || '',
                color: line.color || '#64748b',
            });
        });
        matches.sort(function (left, right) {
            var bank = String(left.bankName || '').localeCompare(String(right.bankName || ''));
            if (bank !== 0) return bank;
            return String(left.productName || '').localeCompare(String(right.productName || ''));
        });
        return {
            selectionYmd: selectionYmd,
            rate: anchorValue,
            entries: matches,
        };
    }

    function createReportSelectionInfoBox(t) {
        var el = document.createElement('div');
        el.style.cssText = 'display:none;padding:8px 10px;font:11px/1.5 "Space Grotesk",system-ui,sans-serif;color:' + t.ttText + ';background:' + t.ttBg + ';border:1px solid ' + t.ttBorder + ';border-radius:6px;margin-top:4px;flex-shrink:0;position:relative;max-height:240px;overflow:auto;';
        var close = document.createElement('button');
        close.type = 'button';
        close.innerHTML = '&times;';
        close.style.cssText = 'position:absolute;top:3px;right:7px;background:none;border:none;color:inherit;cursor:pointer;font-size:14px;opacity:0.45;padding:0;line-height:1;';
        close.addEventListener('click', function () { el.style.display = 'none'; });
        el.appendChild(close);
        var body = document.createElement('div');
        el.appendChild(body);
        return {
            el: el,
            show: function (input) {
                var items = Array.isArray(input && input.items) ? input.items : [];
                if (!items.length) {
                    el.style.display = 'none';
                    return;
                }
                var heading = input && input.heading ? '<div style="font-weight:700;margin-bottom:4px;padding-right:16px;">' + escHtml(input.heading) + '</div>' : '';
                var meta = input && input.meta ? '<div style="font-size:10px;color:' + t.muted + ';margin-bottom:6px;">' + escHtml(input.meta) + '</div>' : '';
                var rows = items.map(function (item) {
                    var titleBits = [
                        '<span style="width:8px;height:8px;border-radius:2px;background:' + escHtml(item.color || '#666') + ';flex-shrink:0;display:inline-block;"></span>',
                        '<span style="font-weight:600;">' + escHtml(item.bankName || 'Unknown') + '</span>',
                    ];
                    if (item.productName) {
                        titleBits.push('<span style="opacity:0.35;">\u00b7</span>');
                        titleBits.push('<span>' + escHtml(item.productName) + '</span>');
                    }
                    var metaBits = [];
                    if (item.rate != null && Number.isFinite(Number(item.rate))) metaBits.push(Number(item.rate).toFixed(2) + '%');
                    if (item.subtitle) metaBits.push(String(item.subtitle));
                    return ''
                        + '<div style="display:grid;gap:2px;padding:5px 0;border-top:1px solid rgba(148,163,184,0.16);">'
                        +   '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' + titleBits.join('') + '</div>'
                        +   '<div style="font-size:10px;color:' + t.muted + ';padding-left:14px;">' + escHtml(metaBits.join(' \u00b7 ')) + '</div>'
                        + '</div>';
                }).join('');
                body.innerHTML = heading + meta + rows;
                el.style.display = 'block';
            },
            hide: function () { el.style.display = 'none'; },
        };
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
            '<span style="' + legendTextStyle('opacity:0.75;color:' + c + ';') + '">' + lbl + '</span>' +
            '<span style="' + legendTextStyle('font-variant-numeric:tabular-nums;font-weight:600;color:' + c + ';') + '">' + v + '</span></span>';
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
        resolveReportDataMin: resolveReportDataMin,
        resolveReportRangeStart: resolveReportRangeStart,
        reportChartOptions: reportChartOptions,
        rateLegendArrowHtml: rateLegendArrowHtml,
        getViewMode: getViewMode,
        setViewMode: setViewMode,
        productColorVariant: productColorVariant,
        shortProductName: shortProductName,
        escHtml: escHtml,
        legendTextStyle: legendTextStyle,
        bankAcronym: bankAcronym,
        lastFiniteNormalizedOverlay: lastFiniteNormalizedOverlay,
        resolveChartProductLimit: resolveChartProductLimit,
        selectionMetaText: selectionMetaText,
        findOverlappingSelectionEntries: findOverlappingSelectionEntries,
        findOverlappingClickEntries: findOverlappingSelectionEntries,
        createReportSelectionInfoBox: createReportSelectionInfoBox,
        economicOverlayLegendItemHtml: economicOverlayLegendItemHtml,
        applySeriesSelectionState: applySeriesSelectionState,
        clearSeriesSelectionState: clearSeriesSelectionState,
        renderRbaDecisionLines: renderRbaDecisionLines,
    };
})();
