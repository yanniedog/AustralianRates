'use strict';
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1600, height: 1000 });
    page.on('console', msg => { if (msg.type() === 'error') console.log('[ERR]', msg.text()); });

    console.log('Loading live site...');
    await page.goto('https://www.australianrates.com/savings/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const btnState = await page.evaluate(function () {
        var btn = document.querySelector('[data-chart-view="economicReport"]');
        return btn ? { found: true, text: btn.textContent.trim() } : { found: false };
    });
    console.log('Button:', JSON.stringify(btnState));

    if (btnState.found) {
        var isActive = await page.evaluate(function () {
            var btn = document.querySelector('[data-chart-view="economicReport"]');
            return btn && btn.classList.contains('is-active');
        });
        if (!isActive) {
            await page.click('[data-chart-view="economicReport"]');
            await page.waitForTimeout(400);
        }
        await page.click('#draw-chart');
        try {
            await page.waitForFunction(function () {
                var el = document.getElementById('chart-output');
                return el && el.getAttribute('data-chart-rendered') === 'true';
            }, { timeout: 30000 });
        } catch (e) { console.log('render timeout'); }
        await page.waitForTimeout(2000);
    }

    fs.mkdirSync('test-screenshots', { recursive: true });
    const chartOut = await page.$('#chart-output');
    if (chartOut) {
        const bb = await chartOut.boundingBox();
        if (bb) {
            const pad = 32;
            await page.screenshot({
                path: 'test-screenshots/savings-live-verify.png',
                clip: { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad), width: bb.width + pad * 2, height: bb.height + pad * 2 },
            });
            console.log('Chart size:', bb.width, 'x', bb.height);
        }
    }
    await browser.close();
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
