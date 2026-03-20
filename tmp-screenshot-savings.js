'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Capture console logs from page
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('rba') || msg.text().includes('RBA')) {
            console.log('[PAGE]', msg.type().toUpperCase(), msg.text());
        }
    });

    await page.goto('http://localhost:4173/savings/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3500);

    // Check state of Economic Report button
    const btnState = await page.evaluate(function () {
        var btn = document.querySelector('[data-chart-view="economicReport"]');
        return btn ? { found: true, active: btn.classList.contains('is-active'), text: btn.textContent } : { found: false };
    });
    console.log('Button state:', JSON.stringify(btnState));

    // Ensure it's active
    if (btnState.found && !btnState.active) {
        await page.click('[data-chart-view="economicReport"]');
        await page.waitForTimeout(400);
    }

    // Draw chart
    await page.click('#draw-chart');

    try {
        await page.waitForFunction(function () {
            var el = document.getElementById('chart-output');
            return el && el.getAttribute('data-chart-rendered') === 'true';
        }, { timeout: 30000 });
    } catch (e) {
        console.log('Chart render timeout');
    }
    await page.waitForTimeout(2000);

    fs.mkdirSync('test-screenshots', { recursive: true });

    const chartOut = await page.$('#chart-output');
    if (chartOut) {
        await chartOut.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const bb = await chartOut.boundingBox();
        if (bb) {
            const padding = 32;
            await page.screenshot({
                path: 'test-screenshots/savings-chart-v2-debug.png',
                clip: { x: Math.max(0, bb.x - padding), y: Math.max(0, bb.y - padding), width: bb.width + padding * 2, height: bb.height + padding * 2 },
            });
            console.log('Chart size:', bb.width, 'x', bb.height);
        }
    }

    // Full page screenshot too
    await page.screenshot({ path: 'test-screenshots/savings-full-latest.png', fullPage: false });

    await browser.close();
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
