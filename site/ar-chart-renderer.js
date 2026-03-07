(function () {
    'use strict';
    window.AR = window.AR || {};

    var chartUi = window.AR.chartUi || {};
    var COLOR_PALETTE = [
        '#1d4ed8', '#0f766e', '#c2410c', '#7c3aed', '#0891b2',
        '#dc2626', '#4f46e5', '#059669', '#db2777', '#b45309',
        '#2563eb', '#0d9488', '#9333ea', '#ea580c', '#0f172a',
    ];

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
                firstRow.lvr_tier,
                firstRow.rate_structure,
                firstRow.account_type,
                firstRow.term_months ? String(firstRow.term_months) + 'm' : '',
            ].filter(Boolean).join(' | ');
        }
        return formatValue(groupField, key);
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

        return Object.keys(groups).map(function (key) {
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
        });
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

    function buildTrace(entry, fields, traceIndex) {
        var color = COLOR_PALETTE[traceIndex % COLOR_PALETTE.length];
        var trace = {
            x: entry.points.map(function (point) { return point.x; }),
            y: entry.points.map(function (point) { return point.y; }),
            type: fields.chartType,
            name: entry.name,
            hovertemplate: hoverTemplate(fields, !!fields.groupField),
            opacity: 0.94,
        };

        if (fields.chartType === 'scatter') {
            trace.mode = 'lines+markers';
            trace.line = { color: color, width: 2.6, shape: isDateField(fields.xField) ? 'spline' : 'linear', smoothing: isDateField(fields.xField) ? 0.6 : 0 };
            trace.marker = { color: color, size: entry.points.length > 1 ? 6 : 8, line: { width: 1, color: '#ffffff' } };
        } else if (fields.chartType === 'bar') {
            trace.marker = { color: color, line: { color: '#ffffff', width: 0.8 } };
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
            var built = buildTrace(entry, fields, index);
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
        }, fields, 0);

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
        var chartHeight = Math.max(360, Math.min(640, window.innerHeight - 180));
        var categoryCount = chartData && chartData.traces && chartData.traces[0] && chartData.traces[0].x
            ? chartData.traces[0].x.length
            : 0;
        return {
            title: {
                text: labelFor(fields.yField) + ' by ' + labelFor(fields.xField),
                x: 0,
                xanchor: 'left',
                font: { size: wideScreen ? 21 : 17, color: '#10233b' },
            },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: '#fbfdff',
            font: { color: '#1c3551', size: 12 },
            hovermode: isDateField(fields.xField) ? 'x unified' : 'closest',
            showlegend: false,
            dragmode: isDateField(fields.xField) ? 'pan' : 'zoom',
            margin: wideScreen
                ? { t: 64, l: 64, r: 28, b: 76 }
                : { t: 56, l: 52, r: 16, b: 70 },
            height: chartHeight,
            xaxis: {
                title: { text: labelFor(fields.xField), standoff: 12 },
                automargin: true,
                linecolor: '#d8e2ef',
                gridcolor: isDateField(fields.xField) ? '#edf2f8' : 'rgba(0,0,0,0)',
                tickcolor: '#d8e2ef',
                showspikes: isDateField(fields.xField),
                spikemode: 'across',
                spikecolor: '#88a7d8',
                tickangle: categoryCount > 6 ? -24 : 0,
                rangeslider: isDateField(fields.xField)
                    ? { visible: true, thickness: 0.08, bgcolor: '#eef4ff', bordercolor: '#d8e2ef' }
                    : undefined,
            },
            yaxis: {
                title: { text: labelFor(fields.yField), standoff: 12 },
                automargin: true,
                zeroline: false,
                linecolor: '#d8e2ef',
                gridcolor: '#e7eef7',
                tickcolor: '#d8e2ef',
                tickprefix: isMoneyField(fields.yField) ? '$' : '',
                ticksuffix: isPercentField(fields.yField) ? '%' : '',
                hoverformat: isMoneyField(fields.yField) ? '.2f' : '.3f',
            },
            hoverlabel: {
                bgcolor: '#10233b',
                bordercolor: '#10233b',
                font: { color: '#ffffff', size: 12 },
            },
        };
    }

    function buildPlotConfig() {
        return {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
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
