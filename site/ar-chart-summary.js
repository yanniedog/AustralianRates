(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom || {};
    var utils = window.AR.utils || {};
    var chartConfig = window.AR.chartConfig || {};
    var els = dom.els || {};
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };

    function emptyState(message) {
        if (!els.chartDataSummary) return;
        els.chartDataSummary.innerHTML = '<p class="chart-data-summary-empty">' + esc(message || 'Draw a chart to populate the summary table.') + '</p>';
    }

    function hrefValue(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatMetric(field, value) {
        if (value == null || value === '') return '-';
        return chartConfig.formatMetricValue ? chartConfig.formatMetricValue(field, value) : String(value);
    }

    function formatDate(value, row) {
        if (value == null || value === '') return '-';
        return chartConfig.formatFieldValue ? chartConfig.formatFieldValue('collection_date', value, row || null) : String(value);
    }

    function productLink(row) {
        var href = row && /^https?:\/\//i.test(String(row.product_url || '')) ? String(row.product_url) : '';
        if (!href) return '<span class="chart-summary-link is-muted">No product page</span>';
        return '<a class="chart-summary-link" href="' + hrefValue(href) + '" target="_blank" rel="noopener noreferrer">Open</a>';
    }

    function tableMarkup(title, description, headers, rows) {
        if (!rows.length) {
            emptyState(description || 'No summary rows are available for this view.');
            return;
        }

        var headerHtml = headers.map(function (header) {
            return '<th scope="col">' + esc(header) + '</th>';
        }).join('');

        var rowsHtml = rows.map(function (cells) {
            return '<tr>' + cells.map(function (cell) {
                return '<td>' + cell + '</td>';
            }).join('') + '</tr>';
        }).join('');

        els.chartDataSummary.innerHTML = '' +
            '<div class="chart-data-summary-header">' +
                '<div>' +
                    '<p class="chart-data-summary-kicker">Chart summary</p>' +
                    '<h3>' + esc(title) + '</h3>' +
                '</div>' +
                '<p class="chart-data-summary-note">' + esc(description) + '</p>' +
            '</div>' +
            '<div class="chart-data-summary-wrap">' +
                '<table class="chart-data-summary-table">' +
                    '<thead><tr>' + headerHtml + '</tr></thead>' +
                    '<tbody>' + rowsHtml + '</tbody>' +
                '</table>' +
            '</div>';
    }

    function renderSeriesTable(model, fields) {
        var list = fields.view === 'compare' && Array.isArray(model.compareSeries) && model.compareSeries.length
            ? model.compareSeries
            : (Array.isArray(model.visibleSeries) ? model.visibleSeries : []);
        var title = fields.view === 'compare' ? 'Compare summary' : 'Visible series summary';
        var description = fields.view === 'compare'
            ? 'The selected comparison lines are listed here with their latest values.'
            : 'Visible product series are listed here with their latest values.';
        var rows = list.map(function (series) {
            var row = series.latestRow || null;
            return [
                esc(series.name || '-'),
                esc(formatMetric(fields.yField, series.latestValue)),
                esc(formatDate(series.latestDate, row)),
                esc(series.delta == null ? '-' : formatMetric(fields.yField, series.delta)),
                esc(Number(series.pointCount || 0).toLocaleString()),
                productLink(row),
            ];
        });
        tableMarkup(title, description, ['Series', 'Latest', 'Latest date', 'Delta', 'Points', 'Product'], rows);
    }

    function renderLenderTable(model, fields) {
        var ranking = model && model.lenderRanking && Array.isArray(model.lenderRanking.entries)
            ? model.lenderRanking.entries
            : [];
        var rows = ranking.map(function (entry) {
            return [
                esc(entry.bankName || '-'),
                esc(entry.productName || '-'),
                esc(formatMetric(fields.yField, entry.value)),
                esc(formatDate(entry.latestDate, entry.row || null)),
                esc(Number(entry.pointCount || 0).toLocaleString()),
            ];
        });
        tableMarkup(
            'Lender ranking summary',
            'Each row shows the best matching product for the current lender slice.',
            ['Lender', 'Best product', 'Latest', 'Latest date', 'Points'],
            rows
        );
    }

    function renderDistributionTable(model, fields) {
        var distribution = model && model.distribution ? model.distribution : null;
        var rows = [];
        if (distribution && Array.isArray(distribution.categories)) {
            for (var i = 0; i < distribution.categories.length; i++) {
                var box = Array.isArray(distribution.boxes) ? distribution.boxes[i] || [] : [];
                rows.push([
                    esc(distribution.categories[i] || '-'),
                    esc(formatMetric(fields.yField, distribution.means && distribution.means[i])),
                    esc(formatMetric(fields.yField, box[2])),
                    esc(formatMetric(fields.yField, box[0])),
                    esc(formatMetric(fields.yField, box[4])),
                    esc(Number(distribution.counts && distribution.counts[i] || 0).toLocaleString()),
                ]);
            }
        }
        tableMarkup(
            'Distribution summary',
            'Category-level summary statistics for the current slice.',
            ['Category', 'Mean', 'Median', 'Min', 'Max', 'Count'],
            rows
        );
    }

    function render(model, fields) {
        if (!els.chartDataSummary) return;
        if (!model) {
            emptyState();
            return;
        }

        if (fields && fields.view === 'lenders') {
            renderLenderTable(model, fields);
            return;
        }
        if (fields && fields.view === 'distribution') {
            renderDistributionTable(model, fields);
            return;
        }
        renderSeriesTable(model, fields || {});
    }

    window.AR.chartSummary = {
        clear: emptyState,
        render: render,
    };
})();
