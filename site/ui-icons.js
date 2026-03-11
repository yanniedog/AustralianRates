(function () {
    'use strict';

    window.AR = window.AR || {};

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    var ICONS = {
        admin: '<path d="M12 3 4 7v5c0 4.3 3 8.3 8 9 5-0.7 8-4.7 8-9V7z" /><path d="M9.5 12h5" /><path d="M12 9.5v5" />',
        apply: '<path d="M5 12h14" /><path d="m13 6 6 6-6 6" />',
        bank: '<path d="m4 9 8-5 8 5" /><path d="M6 10v7" /><path d="M10 10v7" /><path d="M14 10v7" /><path d="M18 10v7" /><path d="M4 19h16" />',
        brand: '<path d="M4 18h16" /><path d="m6 18 2-7h8l2 7" /><path d="M8.5 9.5 12 6l3.5 3.5" /><path d="m9.5 13.5 5-5" />',
        calendar: '<rect x="4" y="6" width="16" height="14" rx="2" /><path d="M8 4v4" /><path d="M16 4v4" /><path d="M4 10h16" />',
        changes: '<path d="M4 17h4l3-5 3 3 6-8" /><path d="M16 7h4v4" />',
        chart: '<path d="M4 18V6" /><path d="M4 18h16" /><path d="m7 14 3-3 3 2 5-6" />',
        compare: '<path d="M6 6h5v12H6z" /><path d="M13 6h5v8h-5z" /><path d="M13 17h5" />',
        continuity: '<path d="M10 14 8 16a3 3 0 1 1-4-4l2-2" /><path d="m14 10 2-2a3 3 0 1 1 4 4l-2 2" /><path d="M9 15 15 9" />',
        close: '<path d="M6 6l12 12" /><path d="M18 6 6 18" />',
        download: '<path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 19h14" />',
        distribution: '<path d="M6 7v10" /><path d="M12 5v14" /><path d="M18 8v8" /><path d="M4 10h4" /><path d="M10 8h4" /><path d="M16 11h4" /><path d="M10 16h4" />',
        filter: '<path d="M5 6h14" /><path d="M8 6v12" /><path d="M16 6v12" /><circle cx="8" cy="10" r="2" /><circle cx="16" cy="14" r="2" />',
        focus: '<circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /><path d="M12 3v2" /><path d="M12 19v2" /><path d="M3 12h2" /><path d="M19 12h2" />',
        github: '<path d="M9 18c-3 1-3-1.5-4-2" /><path d="M15 18v-2.7c0-.8.3-1.5.8-2-2.7-.3-5.6-1.3-5.6-5.9 0-1.3.5-2.5 1.3-3.3-.1-.3-.6-1.6.1-3.3 0 0 1.1-.3 3.5 1.3a12 12 0 0 1 6.4 0c2.4-1.6 3.5-1.3 3.5-1.3.7 1.7.2 3 .1 3.3.8.8 1.3 2 1.3 3.3 0 4.6-2.9 5.6-5.6 5.9.5.5.8 1.2.8 2V18" />',
        help: '<circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 1 1 5.7 1.3c-.8 1.2-1.8 1.8-1.8 3" /><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />',
        history: '<path d="M5 5v5h5" /><path d="M6.4 17.6A8 8 0 1 0 4 12" />',
        home: '<path d="m4 11 8-6 8 6" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" />',
        ladder: '<path d="M4 19h16" /><path d="M6 19v-6h3v6" /><path d="M10.5 19V8h3v11" /><path d="M15 19v-3h3v3" />',
        link: '<path d="M10 13 6 17" /><path d="m14 11 4-4" /><path d="M8 13a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1" /><path d="M16 11a4 4 0 0 1 0 6l-2 2a4 4 0 1 1-6-6l1-1" />',
        menu: '<path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />',
        movement: '<path d="M4 17 8 11l3 3 4-7 5 3" /><path d="M4 19h16" />',
        nav: '<path d="M12 3 5 6v6c0 4.5 2.8 7.7 7 9 4.2-1.3 7-4.5 7-9V6z" /><path d="m10 14 1.5-4 4-1.5-1.5 4z" />',
        notes: '<path d="M8 4h6l4 4v12H8z" /><path d="M14 4v4h4" /><path d="M10 12h6" /><path d="M10 16h6" />',
        pivot: '<rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="4" rx="1.5" /><rect x="13" y="10" width="7" height="10" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" />',
        reference: '<path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H19v17H8.5A2.5 2.5 0 0 0 6 22" /><path d="M6 5.5V22" />',
        refresh: '<path d="M20 11a8 8 0 1 0 2 5.3" /><path d="M20 4v7h-7" />',
        reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 5v5h5" />',
        rows: '<path d="M6 7h12" /><path d="M6 12h12" /><path d="M6 17h12" /><circle cx="4" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="17" r="1" fill="currentColor" stroke="none" />',
        search: '<circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" />',
        series: '<path d="M5 9 12 5l7 4-7 4-7-4Z" /><path d="M5 13l7 4 7-4" /><path d="M5 17l7 4 7-4" />',
        settings: '<circle cx="12" cy="12" r="3" /><path d="M12 3v2.5" /><path d="M12 18.5V21" /><path d="M3 12h2.5" /><path d="M18.5 12H21" /><path d="m5.6 5.6 1.8 1.8" /><path d="m16.6 16.6 1.8 1.8" /><path d="m5.6 18.4 1.8-1.8" /><path d="m16.6 7.4 1.8-1.8" />',
        snapshot: '<path d="M5 17V9l4-3h10v11Z" /><path d="M9 6v4" /><path d="M12 12h4" /><path d="M14 10v4" />',
        stats: '<path d="M4 14h3l2-4 3 6 2-3h4" /><path d="M4 19h16" />',
        summary: '<path d="M5 18h14" /><path d="M7 15v-3" /><path d="M12 15V8" /><path d="M17 15v-5" />',
        surface: '<path d="M5 17 9 9l3 4 3-5 4 9" /><path d="M4 19h16" />',
        table: '<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16" /><path d="M10 5v14" /><path d="M15 5v14" />',
        tech: '<path d="M8 7 4 12l4 5" /><path d="M16 7 20 12l-4 5" /><path d="m13 5-2 14" />'
    };

    function icon(name, label, className) {
        var body = ICONS[name] || ICONS.chart;
        var classes = ['ar-icon'];
        if (className) classes.push(className);
        return '' +
            '<span class="' + classes.join(' ') + '" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
                    body +
                    (label ? '<title>' + esc(label) + '</title>' : '') +
                '</svg>' +
            '</span>';
    }

    function text(name, label, className, textClassName) {
        var classes = ['ar-icon-label'];
        if (className) classes.push(className);
        return '' +
            '<span class="' + classes.join(' ') + '">' +
                icon(name, label) +
                '<span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span>' +
            '</span>';
    }

    function panel(name, label, className) {
        var classes = ['panel-code'];
        if (className) classes.push(className);
        return '' +
            '<span class="' + classes.join(' ') + '" aria-hidden="true">' +
                icon(name, label) +
            '</span>';
    }

    window.AR.uiIcons = {
        icon: icon,
        text: text,
        panel: panel,
    };
})();
