(function () {
    'use strict';
    window.AR = window.AR || {};

    function createRibbonHierarchyPanel(theme, escHtml) {
        var el = document.createElement('div');
        el.className = 'ar-report-infobox ar-report-infobox--compact ar-report-infobox--ribbon-tree ar-report-underchart-tree';
        el.style.setProperty('--ar-ribbon-tree-text', theme.ttText);
        el.style.setProperty('--ar-ribbon-tree-bg', theme.ttBg);
        el.style.setProperty('--ar-ribbon-tree-border', theme.ttBorder);
        el.style.setProperty('--ar-ribbon-tree-muted', theme.muted);
        var body = document.createElement('div');
        body.className = 'ar-report-underchart-tree-body';
        el.appendChild(body);
        return {
            el: el,
            show: function (input) {
                if (!input || typeof input.renderBody !== 'function') {
                    el.style.display = 'none';
                    body.innerHTML = '';
                    return;
                }
                var heading = input.heading
                    ? '<div class="ar-report-underchart-tree-heading">' + escHtml(input.heading) + '</div>'
                    : '';
                var meta = input.meta
                    ? '<div class="ar-report-underchart-tree-meta">' + escHtml(input.meta) + '</div>'
                    : '';
                body.innerHTML = '<div class="ar-report-underchart-tree-head">' + heading + meta + '</div>';
                var treeRoot = document.createElement('div');
                treeRoot.className = 'ar-report-infobox-ribbon-tree ar-report-underchart-tree-scroll';
                body.appendChild(treeRoot);
                try {
                    input.renderBody(treeRoot);
                } catch (_e) {}
                el.style.display = '';
            },
            hide: function () {
                body.innerHTML = '';
                el.style.display = 'none';
            },
        };
    }

    window.AR.chartReportPlotHierarchyPanel = {
        createRibbonHierarchyPanel: createRibbonHierarchyPanel,
    };
})();
