(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartUi = window.AR.chartUi || {};
    var COLOR_PALETTE = [
        '#145af2', '#0f766e', '#ea580c', '#0284c7', '#dc2626',
        '#16a34a', '#b45309', '#0f3d8f', '#be123c', '#0891b2',
        '#4f46e5', '#3f6212', '#7c3aed', '#0f172a',
    ];
    var DASH_PATTERNS = ['solid', 'solid', 'solid', 'dot', 'dash', 'dashdot', 'longdash'];

    function labelFor(field) {
        return chartUi && chartUi.fieldLabel ? chartUi.fieldLabel(field) : String(field || '');
    }

    function formatValue(field, value) {
        return chartUi && chartUi.formatFieldValue
            ? chartUi.formatFieldValue(field, value)
            : String(value == null ? '' : value);
    }

    function isDateField(field) {
        return chartUi && chartUi.isDateField
            ? chartUi.isDateField(field)
            : /date|_at$/i.test(String(field || ''));
    }

    function isMoneyField(field) {
        return chartUi && chartUi.isMoneyField
            ? chartUi.isMoneyField(field)
            : /fee|deposit/i.test(String(field || ''));
    }

    function isPercentField(field) {
        return chartUi && chartUi.isPercentField
            ? chartUi.isPercentField(field)
            : /rate/i.test(String(field || ''));
    }

    function traceColor(traceIndex) {
        return COLOR_PALETTE[traceIndex % COLOR_PALETTE.length];
    }

    function traceDash(traceIndex) {
        return DASH_PATTERNS[Math.floor(traceIndex / COLOR_PALETTE.length) % DASH_PATTERNS.length];
    }

    function isTimelineChart(fields) {
        return fields && fields.chartType === 'scatter' && isDateField(fields.xField);
    }

    function compareXValues(a, b) {
        if (a === b) return 0;
        var numA = Number(a);
        var numB = Number(b);
        if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
        return String(a).localeCompare(String(b));
    }

    function sortPoints(points) {
        return points.sort(function (left, right) {
            return compareXValues(left.x, right.x);
        });
    }

    function buildPoint(row, fields) {
        var y = Number(row[fields.yField]);
        if (!Number.isFinite(y)) return null;
        return {
            x: row[fields.xField],
            y: y,
            row: row,
        };
    }

    function samplePoints(points, maxPoints) {
        if (!Array.isArray(points) || points.length <= maxPoints) {
            return { points: Array.isArray(points) ? points : [], sampled: false };
        }
        var sampled = [];
        var step = points.length / maxPoints;
        for (var i = 0; i < maxPoints; i++) {
            sampled.push(points[Math.min(points.length - 1, Math.floor(i * step))]);
        }
        var last = points[points.length - 1];
        if (sampled[sampled.length - 1] !== last) sampled[sampled.length - 1] = last;
        return { points: sampled, sampled: true };
    }

    function buildGroupName(groupField, key, firstRow) {
        if (groupField === 'product_key' && firstRow) {
            return [
                firstRow.bank_name,
                firstRow.product_name,
            ].filter(Boolean).join(' | ');
        }
        return formatValue(groupField, key);
    }

    function buildEntryDisambiguator(firstRow, key) {
        if (!firstRow || typeof firstRow !== 'object') return String(key || '');
        var parts = [
            firstRow.term_months ? String(firstRow.term_months) + 'm' : '',
            firstRow.security_purpose,
            firstRow.repayment_type,
            firstRow.lvr_tier,
            firstRow.rate_structure,
            firstRow.account_type,
        ].filter(Boolean);
        if (parts.length) return parts.slice(0, 3).join(' | ');
        if (firstRow.product_id) return 'ID ' + String(firstRow.product_id);
        return String(key || '');
    }

    function shortKeyHash(value) {
        var raw = String(value || '');
        var hash = 0;
        for (var i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        var normalized = (hash >>> 0).toString(16);
        while (normalized.length < 8) normalized = '0' + normalized;
        return normalized.slice(0, 8);
    }

    function buildStableSeriesId(firstRow, key) {
        return 'K' + shortKeyHash(key);
    }

    function disambiguateEntries(entries) {
        var counts = {};
        entries.forEach(function (entry) {
            counts[entry.name] = (counts[entry.name] || 0) + 1;
        });
        var renamed = entries.map(function (entry) {
            if ((counts[entry.name] || 0) < 2) return entry;
            var suffix = buildEntryDisambiguator(entry.firstRow, entry.key);
            return {
                key: entry.key,
                firstRow: entry.firstRow,
                name: entry.name + ' | ' + suffix,
                points: entry.points,
                pointCount: entry.pointCount,
                latestValue: entry.latestValue,
                delta: entry.delta,
            };
        });
        var renamedCounts = {};
        renamed.forEach(function (entry) {
            renamedCounts[entry.name] = (renamedCounts[entry.name] || 0) + 1;
        });
        return renamed.map(function (entry) {
            if ((renamedCounts[entry.name] || 0) < 2) return entry;
            return {
                key: entry.key,
                firstRow: entry.firstRow,
                name: entry.name + ' | ' + buildStableSeriesId(entry.firstRow, entry.key),
                points: entry.points,
                pointCount: entry.pointCount,
                latestValue: entry.latestValue,
                delta: entry.delta,
            };
        });
    }

    function buildGroupedEntries(rows, fields) {
        var groups = {};
        rows.forEach(function (row) {
            var point = buildPoint(row, fields);
            if (!point) return;
            var key = String(row[fields.groupField] || 'Unknown');
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    firstRow: row,
                    points: [],
                };
            }
            groups[key].points.push(point);
        });

        return disambiguateEntries(Object.keys(groups).map(function (key) {
            var entry = groups[key];
            var points = sortPoints(entry.points.slice());
            var first = points[0] || null;
            var last = points[points.length - 1] || null;
            return {
                key: key,
                firstRow: entry.firstRow,
                name: buildGroupName(fields.groupField, key, entry.firstRow),
                points: points,
                pointCount: points.length,
                latestValue: last ? last.y : null,
                delta: first && last ? last.y - first.y : null,
            };
        }).filter(function (entry) {
            return entry.pointCount > 0;
        }));
    }

    function compareEntries(left, right) {
        if (right.pointCount !== left.pointCount) return right.pointCount - left.pointCount;
        return String(left.name).localeCompare(String(right.name));
    }

    function allocateSampleBudgets(entries, maxPoints) {
        var budgets = [];
        var totalPoints = entries.reduce(function (sum, entry) {
            return sum + entry.points.length;
        }, 0);
        var totalGroups = entries.length;
        if (totalGroups === 0) return budgets;

        if (totalGroups >= maxPoints) {
            entries.slice(0, maxPoints).forEach(function (entry) {
                budgets.push({ entry: entry, budget: 1, remainder: 0 });
            });
            return budgets;
        }

        var reserved = maxPoints - totalGroups;
        entries.forEach(function (entry) {
            var extraCapacity = Math.max(0, entry.points.length - 1);
            var proportional = totalPoints > 0 ? (entry.points.length / totalPoints) * reserved : 0;
            var extra = Math.min(extraCapacity, Math.floor(proportional));
            budgets.push({
                entry: entry,
                budget: 1 + extra,
                remainder: proportional - Math.floor(proportional),
            });
        });

        var allocated = budgets.reduce(function (sum, budget) {
            return sum + budget.budget;
        }, 0);

        while (allocated < maxPoints) {
            budgets.sort(function (left, right) {
                if (right.remainder !== left.remainder) return right.remainder - left.remainder;
                return right.entry.pointCount - left.entry.pointCount;
            });
            var advanced = false;
            for (var i = 0; i < budgets.length && allocated < maxPoints; i++) {
                if (budgets[i].budget >= budgets[i].entry.pointCount) continue;
                budgets[i].budget += 1;
                budgets[i].remainder = 0;
                allocated += 1;
                advanced = true;
            }
            if (!advanced) break;
        }

        budgets.sort(function (left, right) {
            return compareEntries(left.entry, right.entry);
        });
        return budgets;
    }

    function sampleVisibleEntries(entries, maxPoints) {
        var totalPoints = entries.reduce(function (sum, entry) {
            return sum + entry.points.length;
        }, 0);
        if (totalPoints <= maxPoints) {
            return { entries: entries, sampled: false, sourcePoints: totalPoints };
        }

        var budgets = allocateSampleBudgets(entries, maxPoints);
        return {
            entries: budgets.map(function (budget) {
                return {
                    key: budget.entry.key,
                    firstRow: budget.entry.firstRow,
                    name: budget.entry.name,
                    pointCount: budget.entry.pointCount,
                    latestValue: budget.entry.latestValue,
                    delta: budget.entry.delta,
                    points: samplePoints(budget.entry.points, budget.budget).points,
                };
            }),
            sampled: true,
            sourcePoints: totalPoints,
        };
    }

    function hoverTemplate(fields, includeTraceName) {
        var xLine = labelFor(fields.xField) + ': %{x}';
        var yLine = labelFor(fields.yField) + ': ';
        if (isMoneyField(fields.yField)) yLine += '$%{y:.2f}';
        else if (isPercentField(fields.yField)) yLine += '%{y:.3f}%';
        else yLine += '%{y:.3f}';
        return (includeTraceName ? '<b>%{fullData.name}</b><br>' : '') + xLine + '<br>' + yLine + '<extra></extra>';
    }

    function buildTrace(entry, fields, traceIndex, options) {
        var color = traceColor(traceIndex);
        var dash = traceDash(traceIndex);
        var visibleSeries = options && Number.isFinite(Number(options.visibleSeries))
            ? Number(options.visibleSeries)
            : 1;
        var denseScatter = fields.chartType === 'scatter' && visibleSeries >= 8;
        var trace = {
            x: entry.points.map(function (point) { return point.x; }),
            y: entry.points.map(function (point) { return point.y; }),
            type: fields.chartType,
            name: entry.name,
            hovertemplate: hoverTemplate(fields, !!fields.groupField),
            opacity: denseScatter ? 0.88 : 0.96,
            showlegend: false,
            legendgroup: entry.key || entry.name,
        };

        if (fields.chartType === 'scatter') {
            trace.mode = 'lines+markers';
            trace.connectgaps = false;
            trace.line = {
                color: color,
                width: denseScatter ? 2.2 : 2.8,
                dash: dash,
                shape: 'linear',
                simplify: true,
            };
            trace.marker = {
                color: color,
                size: entry.points.length > 1 ? (denseScatter ? 4.5 : 6.5) : 9,
                line: { width: denseScatter ? 0.9 : 1.2, color: '#ffffff' },
                opacity: denseScatter ? 0.78 : 0.94,
                symbol: entry.points.length > 1 ? 'circle' : 'diamond',
            };
        } else if (fields.chartType === 'bar') {
            trace.marker = {
                color: color,
                line: { color: '#ffffff', width: 0.8 },
                opacity: 0.92,
            };
        } else if (fields.chartType === 'box') {
            trace.marker = { color: color };
            trace.line = { color: color, width: 1.8 };
            trace.fillcolor = color;
            trace.boxmean = true;
        }

        return {
            trace: trace,
            rows: entry.points.map(function (point) { return point.row; }),
            summary: {
                traceIndex: traceIndex,
                name: entry.name,
                latestValue: entry.latestValue,
                delta: entry.delta,
                pointCount: entry.pointCount,
                metricField: fields.yField,
                color: color,
                dash: dash,
            },
        };
    }

    function buildGroupedChart(rows, fields, maxPoints) {
        var entries = buildGroupedEntries(rows, fields).sort(compareEntries);
        var visibleLimit = chartUi && chartUi.parseSeriesLimit
            ? chartUi.parseSeriesLimit(fields.seriesLimit)
            : Number.POSITIVE_INFINITY;
        var visibleEntries = visibleLimit === Number.POSITIVE_INFINITY
            ? entries.slice()
            : entries.slice(0, visibleLimit);
        var sampleResult = sampleVisibleEntries(visibleEntries, maxPoints);
        var traces = [];
        var rowsByTrace = [];
        var traceSummaries = [];

        sampleResult.entries.forEach(function (entry, index) {
            var built = buildTrace(entry, fields, index, {
                visibleSeries: sampleResult.entries.length,
            });
            traces.push(built.trace);
            rowsByTrace.push(built.rows);
            traceSummaries.push(built.summary);
        });

        return {
            traces: traces,
            rowsByTrace: rowsByTrace,
            meta: {
                renderedPoints: sampleResult.entries.reduce(function (sum, entry) {
                    return sum + entry.points.length;
                }, 0),
                sourcePoints: sampleResult.sourcePoints,
                sampled: sampleResult.sampled,
                totalSeries: entries.length,
                visibleSeries: sampleResult.entries.length,
                hiddenSeries: Math.max(0, entries.length - sampleResult.entries.length),
                traceSummaries: traceSummaries,
            },
        };
    }

    function buildUngroupedChart(rows, fields, maxPoints) {
        var points = rows.map(function (row) {
            return buildPoint(row, fields);
        }).filter(Boolean);
        var sortedPoints = sortPoints(points);
        var sampleResult = samplePoints(sortedPoints, maxPoints);
        var built = buildTrace({
            name: labelFor(fields.yField),
            points: sampleResult.points,
            pointCount: sortedPoints.length,
            latestValue: sampleResult.points.length ? sampleResult.points[sampleResult.points.length - 1].y : null,
            delta: sampleResult.points.length > 1
                ? sampleResult.points[sampleResult.points.length - 1].y - sampleResult.points[0].y
                : null,
        }, fields, 0, {
            visibleSeries: 1,
        });

        return {
            traces: [built.trace],
            rowsByTrace: [built.rows],
            meta: {
                renderedPoints: sampleResult.points.length,
                sourcePoints: sortedPoints.length,
                sampled: sampleResult.sampled,
                totalSeries: 1,
                visibleSeries: 1,
                hiddenSeries: 0,
                traceSummaries: [built.summary],
            },
        };
    }

    function buildLayout(fields, chartData) {
        var wideScreen = window.innerWidth > 980;
        var timelineChart = isTimelineChart(fields);
        var visibleSeries = chartData && chartData.meta && Number.isFinite(Number(chartData.meta.visibleSeries))
            ? Number(chartData.meta.visibleSeries)
            : 1;
        var chartHeight = timelineChart
            ? Math.max(520, Math.min(wideScreen ? 760 : 660, window.innerHeight - 110 + Math.min(140, visibleSeries * 10)))
            : Math.max(420, Math.min(680, window.innerHeight - 180));
        var categoryCount = chartData && chartData.traces && chartData.traces[0] && chartData.traces[0].x
            ? chartData.traces[0].x.length
            : 0;
        return {
            title: {
                text: labelFor(fields.yField) + ' by ' + labelFor(fields.xField),
                x: 0,
                xanchor: 'left',
                font: { size: wideScreen ? 22 : 18, color: '#10233b' },
            },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(248, 251, 255, 0.94)',
            font: { color: '#1c3551', size: 12 },
            hovermode: timelineChart ? 'x unified' : 'closest',
            hoverdistance: timelineChart ? 48 : 20,
            spikedistance: timelineChart ? 1000 : -1,
            showlegend: false,
            dragmode: timelineChart ? 'pan' : 'zoom',
            margin: wideScreen
                ? { t: timelineChart ? 88 : 64, l: 68, r: 28, b: timelineChart ? 110 : 76 }
                : { t: timelineChart ? 84 : 56, l: 56, r: 16, b: timelineChart ? 108 : 72 },
            height: chartHeight,
            uirevision: [fields.xField, fields.yField, fields.groupField, fields.chartType].join('|'),
            xaxis: {
                title: { text: labelFor(fields.xField), standoff: 12 },
                automargin: true,
                type: isDateField(fields.xField) ? 'date' : undefined,
                linecolor: '#d8e2ef',
                gridcolor: isDateField(fields.xField) ? 'rgba(136, 167, 216, 0.18)' : 'rgba(136, 167, 216, 0.10)',
                tickcolor: 'rgba(130, 151, 177, 0.38)',
                tickfont: { color: '#36506e', size: wideScreen ? 12 : 11 },
                showspikes: timelineChart,
                spikemode: 'across+marker',
                spikesnap: 'cursor',
                spikethickness: 1,
                spikecolor: 'rgba(15, 91, 216, 0.34)',
                tickangle: categoryCount > 6 ? -18 : 0,
                rangeselector: timelineChart
                    ? {
                        x: 0,
                        xanchor: 'left',
                        y: 1.17,
                        yanchor: 'top',
                        bgcolor: 'rgba(255, 255, 255, 0.84)',
                        activecolor: '#dbeafe',
                        bordercolor: 'rgba(16, 35, 59, 0.10)',
                        borderwidth: 1,
                        font: { size: 11, color: '#18334f' },
                        buttons: [
                            { count: 7, label: '7D', step: 'day', stepmode: 'backward' },
                            { count: 1, label: '1M', step: 'month', stepmode: 'backward' },
                            { step: 'all', label: 'All' },
                        ],
                    }
                    : undefined,
                rangeslider: timelineChart
                    ? {
                        visible: true,
                        thickness: 0.09,
                        bgcolor: 'rgba(238, 244, 255, 0.92)',
                        bordercolor: '#d8e2ef',
                    }
                    : undefined,
            },
            yaxis: {
                title: { text: labelFor(fields.yField), standoff: 12 },
                automargin: true,
                zeroline: false,
                linecolor: '#d8e2ef',
                gridcolor: 'rgba(136, 167, 216, 0.18)',
                tickcolor: 'rgba(130, 151, 177, 0.38)',
                tickfont: { color: '#36506e', size: 12 },
                separatethousands: true,
                tickprefix: isMoneyField(fields.yField) ? '$' : '',
                ticksuffix: isPercentField(fields.yField) ? '%' : '',
                hoverformat: isMoneyField(fields.yField) ? '.2f' : '.3f',
            },
            hoverlabel: {
                bgcolor: '#10233b',
                bordercolor: 'rgba(15, 91, 216, 0.42)',
                font: { color: '#ffffff', size: 12 },
            },
        };
    }

    function buildPlotConfig() {
        return {
            responsive: true,
            displaylogo: false,
            scrollZoom: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'hoverClosestCartesian', 'toggleSpikelines'],
            toImageButtonOptions: {
                format: 'png',
                filename: 'australianrates-chart',
                height: 900,
                width: 1600,
                scale: 2,
            },
        };
    }

    function buildChart(rows, fields, maxPoints) {
        return fields.groupField
            ? buildGroupedChart(rows, fields, maxPoints)
            : buildUngroupedChart(rows, fields, maxPoints);
    }

    window.AR.chartRenderer = {
        buildChart: buildChart,
        buildLayout: buildLayout,
        buildPlotConfig: buildPlotConfig,
    };
})();
