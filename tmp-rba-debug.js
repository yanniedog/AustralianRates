'use strict';
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1600, height: 1000 });
    page.on('console', msg => { if (msg.type() === 'error') console.log('[ERR]', msg.text()); });

    await page.goto('http://localhost:4173/savings/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3500);

    const result = await page.evaluate(function () {
        var cd = window.AR && window.AR.chartData;
        if (!cd) return { error: 'no chartData' };
        if (!cd.fetchRbaHistory) return { error: 'no fetchRbaHistory fn' };
        return cd.fetchRbaHistory()
            .then(function (rows) { return { count: rows.length, sample: rows.slice(0, 2) }; })
            .catch(function (e) { return { error: e.message }; });
    });
    console.log('fetchRbaHistory result:', JSON.stringify(result));

    // Also check what apiBase is configured to
    const apiBase = await page.evaluate(function () {
        try { return (window.AR && window.AR.config && window.AR.config.apiBase) || 'n/a'; } catch (e) { return 'error: ' + e.message; }
    });
    console.log('apiBase:', apiBase);

    await browser.close();
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
