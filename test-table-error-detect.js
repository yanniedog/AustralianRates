/**
 * Detects errors in the Rate Explorer table on www.australianrates.com.
 * - Collects console errors and page errors
 * - Waits for table to load, then scans cell text for error-like values
 * - Reports EXPLORER_TABLE_ABNORMALITY from client log if present
 * - Expects first column header "Found at" (no double colon)
 * Any EXPLORER_TABLE_ABNORMALITY is also written to the client log (footer "Download client log").
 * Run: node test-table-error-detect.js
 */

const { chromium } = require('playwright');

const TARGET = process.env.TEST_URL || 'https://www.australianrates.com/';

const ERROR_PATTERNS = [
    /\bundefined\b/i,
    /\bNaN\b/,
    /\berror\b/i,
    /\bfailed\b/i,
    /\bnull\b/i,
    /EXPLORER_TABLE_ABNORMALITY/i,
];

function cellTextLooksErroneous(text) {
    if (text == null || String(text).trim() === '') return false;
    const s = String(text).trim();
    return ERROR_PATTERNS.some(function (p) { return p.test(s); });
}

async function run() {
    const consoleEntries = [];
    const pageErrors = [];
    const failedRequests = [];

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    page.on('console', function (msg) {
        const type = msg.type();
        const text = msg.text();
        consoleEntries.push({ type, text });
    });
    page.on('pageerror', function (err) {
        pageErrors.push(err.message);
    });
    page.on('requestfailed', function (req) {
        const failure = req.failure();
        failedRequests.push({
            url: req.url(),
            error: failure ? failure.errorText : '',
        });
    });

    console.log('Loading', TARGET, '...');
    const response = await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (response && response.status() !== 200) {
        console.log('HTTP status:', response.status());
    }

    await page.waitForSelector('#main-content', { timeout: 10000 }).catch(function () {});

    console.log('Waiting for hero stats...');
    await page.waitForFunction(
        function () {
            var el = document.getElementById('stat-records');
            return el && !el.textContent.includes('...');
        },
        { timeout: 15000 }
    ).catch(function () {});

    console.log('Waiting for Rate Explorer table and rows...');
    try {
        await page.waitForSelector('#rate-table .tabulator-row', { timeout: 25000 });
    } catch (e) {
        console.log('Table rows did not appear within 25s.');
    }
    await page.waitForTimeout(2000);

    var tableErrors = [];
    var cellScan = await page.evaluate(function (patternsJson) {
        var patterns = JSON.parse(patternsJson);
        var cells = document.querySelectorAll('#rate-table .tabulator-cell');
        var suspicious = [];
        cells.forEach(function (cell) {
            var text = (cell.textContent || '').trim();
            if (!text) return;
            var lower = text.toLowerCase();
            if (lower.indexOf('undefined') !== -1 || lower.indexOf('nan') !== -1 ||
                lower.indexOf('error') !== -1 || lower.indexOf('failed') !== -1 ||
                lower === 'null' || lower.indexOf('explorer_table_abnormality') !== -1) {
                suspicious.push({ text: text.slice(0, 120), col: (cell.getAttribute('tabulator-field') || cell.cellIndex) });
            }
        });
        return suspicious;
    }, JSON.stringify(ERROR_PATTERNS.map(function (p) { return p.source; })));

    if (Array.isArray(cellScan) && cellScan.length > 0) {
        tableErrors = cellScan;
    }

    var clientLogErrors = [];
    try {
        clientLogErrors = await page.evaluate(function () {
            if (typeof window.getSessionLogEntries !== 'function') return [];
            var entries = window.getSessionLogEntries();
            return entries
                .filter(function (e) { return (e.level === 'error' || (e.message && e.message.indexOf('EXPLORER_TABLE_ABNORMALITY') !== -1)); })
                .map(function (e) { return { level: e.level, message: e.message }; });
        });
    } catch (e) {
        // no client log
    }

    var tableRowCount = 0;
    var tablePlaceholderText = '';
    var firstRowSample = [];
    try {
        var counts = await page.evaluate(function () {
            var rows = document.querySelectorAll('#rate-table .tabulator-row');
            var placeholder = document.querySelector('#rate-table .tabulator-placeholder');
            return { rowCount: rows.length, placeholderText: placeholder ? (placeholder.textContent || '').trim() : '' };
        });
        tableRowCount = counts.rowCount || 0;
        tablePlaceholderText = counts.placeholderText || '';
    } catch (e) {}
    if (tableRowCount > 0) {
        try {
            firstRowSample = await page.evaluate(function () {
                var headers = [];
                document.querySelectorAll('#rate-table .tabulator-col-title').forEach(function (h) { headers.push((h.textContent || '').trim()); });
                var cells = document.querySelectorAll('#rate-table .tabulator-row:first-child .tabulator-cell');
                var out = [];
                cells.forEach(function (cell, i) {
                    var title = headers[i] || 'col' + i;
                    var text = (cell.textContent || '').trim();
                    out.push({ col: title, value: text.slice(0, 80) });
                });
                return out;
            });
        } catch (e2) {}
    }

    await browser.close();

    console.log('\n========== TABLE ERROR DETECTION REPORT ==========\n');

    var hasIssue = false;

    if (pageErrors.length > 0) {
        hasIssue = true;
        console.log('Page (runtime) errors:');
        pageErrors.forEach(function (m) { console.log('  -', m); });
        console.log('');
    }

    var consoleErrors = consoleEntries.filter(function (e) { return e.type === 'error'; });
    var ignorableConsoleErrors = consoleErrors.filter(function (e) {
        return e.text && (e.text.indexOf('ERR_NAME_NOT_RESOLVED') !== -1);
    });
    if (consoleErrors.length > 0 && consoleErrors.length > ignorableConsoleErrors.length) {
        hasIssue = true;
        console.log('Console errors (' + consoleErrors.length + '):');
        consoleErrors.forEach(function (e) { console.log('  -', (e.text || '').slice(0, 200)); });
        console.log('');
    } else if (ignorableConsoleErrors.length > 0) {
        console.log('Console: ' + ignorableConsoleErrors.length + ' ERR_NAME_NOT_RESOLVED (e.g. telemetry) - ignored.');
    }

    var abnormalityLogs = consoleEntries.filter(function (e) {
        return e.text && e.text.indexOf('EXPLORER_TABLE_ABNORMALITY') !== -1;
    });
    if (abnormalityLogs.length > 0) {
        hasIssue = true;
        console.log('EXPLORER_TABLE_ABNORMALITY in console:');
        abnormalityLogs.forEach(function (e) { console.log('  -', (e.text || '').slice(0, 300)); });
        console.log('');
    }

    if (clientLogErrors.length > 0) {
        hasIssue = true;
        console.log('Client log errors (EXPLORER_TABLE_ABNORMALITY or error level):');
        clientLogErrors.forEach(function (e) { console.log('  -', e.message || e); });
        console.log('');
    }

    if (tableErrors.length > 0) {
        hasIssue = true;
        console.log('Suspicious cell values in table (' + tableErrors.length + '):');
        tableErrors.forEach(function (c) { console.log('  -', c.text, '(col:', c.col, ')'); });
        console.log('');
    }

    var relevantFailures = failedRequests.filter(function (f) {
        return f.url.indexOf('australianrates.com') !== -1 && f.url.indexOf('/api/') !== -1;
    });
    console.log('Table row count:', tableRowCount);
    if (tablePlaceholderText) console.log('Table placeholder text:', tablePlaceholderText);

    if (firstRowSample.length > 0) {
        console.log('First row sample (visible columns):');
        firstRowSample.forEach(function (c) { console.log('  ', c.col + ':', c.value); });
        var firstCol = firstRowSample[0] && firstRowSample[0].col;
        if (firstCol !== 'Found at') {
            hasIssue = true;
            console.log('FAIL: First column header should be "Found at", got:', JSON.stringify(firstCol));
        }
    }

    if (relevantFailures.length > 0) {
        var abortedOnly = relevantFailures.every(function (f) { return f.error === 'net::ERR_ABORTED'; });
        if (abortedOnly && tableRowCount > 0) {
            console.log('Failed API requests: one or more requests aborted (often a duplicate request); table still has', tableRowCount, 'rows.');
        } else {
            hasIssue = true;
            console.log('Failed API requests:');
            relevantFailures.forEach(function (f) { console.log('  -', f.url, f.error); });
            console.log('');
        }
    }

    if (!hasIssue && tableRowCount > 0) {
        console.log('(Table has data; no table-related errors.)');
    }

    if (!hasIssue) {
        console.log('No table-related errors detected.');
    }

    console.log('========== END REPORT ==========\n');
    process.exit(hasIssue ? 1 : 0);
}

run().catch(function (err) {
    console.error('Script failed:', err);
    process.exit(1);
});
