(function () {
    'use strict';
    window.AR = window.AR || {};
    var U = window.AR.chartReportPlotUtils || {};
    var buildDateRange = U.buildDateRange;
    var isHomeLoan = U.isHomeLoan;

    var REPORT_MOVES_PANE_HEIGHT = 84;
    var REPORT_MOVES_SCALE_ID = 'ar-report-moves';

    function createMovesStrip(options) {
        var plotPayload = options && options.plotPayload;
        var range = options && options.range || {};
        var theme = options && options.theme || {};
        var section = options && options.section;
        if (!plotPayload || plotPayload.mode !== 'moves') return null;
        var dates = buildDateRange(range.viewStart, range.ctxMax);
        if (!dates.length) return null;

        var byDate = {};
        (plotPayload.points || []).forEach(function (point) {
            byDate[String(point.date || '').slice(0, 10)] = point;
        });

        var points = dates.map(function (date) {
            var point = byDate[date] || {};
            return {
                date: date,
                up: Math.max(0, Number(point.up_count || 0)),
                down: Math.max(0, Number(point.down_count || 0)),
            };
        });
        var maxCount = 0;
        points.forEach(function (point) {
            maxCount = Math.max(maxCount, point.up, point.down);
        });
        if (!maxCount) return null;

        var upColor = isHomeLoan(section) ? theme.bad : theme.good;
        var downColor = isHomeLoan(section) ? theme.good : theme.bad;
        var wrap = document.createElement('div');
        wrap.className = 'lwc-report-moves-strip';

        var labelRow = document.createElement('div');
        labelRow.className = 'lwc-report-moves-strip-header';
        labelRow.innerHTML =
            '<span>Moves</span>' +
            '<span>' + String(maxCount) + '</span>';
        wrap.appendChild(labelRow);

        var plot = document.createElement('div');
        plot.className = 'lwc-report-moves-strip-plot';
        wrap.appendChild(plot);

        points.forEach(function (point) {
            var column = document.createElement('div');
            column.className = 'lwc-report-moves-strip-col';
            column.title = point.date + '  Up ' + String(point.up) + '  Down ' + String(point.down);

            var upLane = document.createElement('div');
            upLane.className = 'lwc-report-moves-strip-lane is-up';
            var upBar = document.createElement('span');
            upBar.className = 'lwc-report-moves-strip-bar is-up';
            upBar.style.height = (point.up > 0 ? Math.max(6, (point.up / maxCount) * 100) : 0) + '%';
            upBar.style.background = upColor;
            if (point.up > 0) upLane.appendChild(upBar);

            var downLane = document.createElement('div');
            downLane.className = 'lwc-report-moves-strip-lane is-down';
            var downBar = document.createElement('span');
            downBar.className = 'lwc-report-moves-strip-bar is-down';
            downBar.style.height = (point.down > 0 ? Math.max(6, (point.down / maxCount) * 100) : 0) + '%';
            downBar.style.background = downColor;
            if (point.down > 0) downLane.appendChild(downBar);

            column.appendChild(upLane);
            column.appendChild(downLane);
            plot.appendChild(column);
        });

        return wrap;
    }

    /**
     * Data for LWC HistogramSeries on a report chart moves pane (above the time scale, inside the chart mount).
     * Requires window.AR.chartMacroLwcShared.ymdToUtc.
     */
    function prepareLwcMovesHistogram(section, plotPayload, viewStart, ctxMax, theme) {
        var M = window.AR.chartMacroLwcShared;
        if (!plotPayload || plotPayload.mode !== 'moves' || !M || typeof M.ymdToUtc !== 'function') return null;
        var dates = buildDateRange(viewStart, ctxMax);
        if (!dates.length) return null;
        var byDate = {};
        (plotPayload.points || []).forEach(function (point) {
            byDate[String(point.date || '').slice(0, 10)] = point;
        });
        var upColor = isHomeLoan(section) ? theme.bad : theme.good;
        var downColor = isHomeLoan(section) ? theme.good : theme.bad;
        var maxCount = 0;
        var upData = [];
        var downData = [];
        dates.forEach(function (date) {
            var point = byDate[date] || {};
            var up = Math.max(0, Number(point.up_count || 0));
            var down = Math.max(0, Number(point.down_count || 0));
            maxCount = Math.max(maxCount, up, down);
            var tm = M.ymdToUtc(date);
            upData.push({ time: tm, value: up, color: upColor });
            downData.push({ time: tm, value: down > 0 ? -down : 0, color: downColor });
        });
        if (!maxCount) return null;
        return { upData: upData, downData: downData, upColor: upColor, downColor: downColor, maxCount: maxCount };
    }

    /** Second LWC pane: histogram above shared time scale. No-op if data or HistogramSeries missing. */
    function attachLwcMovesPane(chart, L, movesPaneData) {
        if (!chart || !L || !L.HistogramSeries || !movesPaneData) return;
        chart.addPane(false);
        try {
            chart.panes()[1].setHeight(REPORT_MOVES_PANE_HEIGHT);
        } catch (_ph) {}
        var Hist = L.HistogramSeries;
        var upApi = chart.addSeries(Hist, {
            priceScaleId: REPORT_MOVES_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false,
            color: movesPaneData.upColor,
        }, 1);
        var downApi = chart.addSeries(Hist, {
            priceScaleId: REPORT_MOVES_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false,
            color: movesPaneData.downColor,
        }, 1);
        try {
            chart.priceScale(REPORT_MOVES_SCALE_ID, 1).applyOptions({
                borderColor: 'rgba(148, 163, 184, 0.22)',
                scaleMargins: { top: 0.08, bottom: 0.05 },
            });
        } catch (_ps) {}
        upApi.setData(movesPaneData.upData);
        downApi.setData(movesPaneData.downData);
    }

    window.AR.chartReportPlotMovesPane = {
        createMovesStrip: createMovesStrip,
        prepareLwcMovesHistogram: prepareLwcMovesHistogram,
        attachLwcMovesPane: attachLwcMovesPane,
        REPORT_MOVES_PANE_HEIGHT: REPORT_MOVES_PANE_HEIGHT,
        REPORT_MOVES_SCALE_ID: REPORT_MOVES_SCALE_ID,
    };
})();
