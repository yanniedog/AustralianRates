/**
 * Visual verify: chart status line (TradingView-style) appears when hovering the chart.
 * Run from repo root: node -e "require('./tools/node-scripts/runner.cjs').runTsScript(process.cwd(), 'chart-status-line-verify.ts', [])"
 * Or: npx tsx tools/node-scripts/src/chart-status-line-verify.ts
 */
// @ts-nocheck
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const SCREENSHOT_DIR = path.join(process.cwd(), 'test-screenshots');
const VIEWPORT = { width: 1280, height: 900 };

async function main() {
    let exitCode = 1;
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#main-content', { timeout: 15000 });
        await page.waitForTimeout(2000);

        const drawBtn = await page.$('#draw-chart');
        if (!drawBtn) {
            console.error('chart-status-line-verify: #draw-chart not found');
            await browser.close();
            process.exit(1);
        }
        await drawBtn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await drawBtn.click({ force: true });

        await page.waitForFunction(() => {
            const output = document.getElementById('chart-output');
            if (!output) return false;
            return output.getAttribute('data-chart-rendered') === 'true' && output.querySelector('canvas');
        }, null, { timeout: 90000 });
        await page.waitForTimeout(1500);

        const chartEl = await page.$('#chart-output');
        if (!chartEl) {
            console.error('chart-status-line-verify: #chart-output not found after draw');
            await browser.close();
            process.exit(1);
        }
        await chartEl.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const box = await chartEl.boundingBox();
        if (!box) {
            console.error('chart-status-line-verify: chart has no bounding box');
            await browser.close();
            process.exit(1);
        }
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height * 0.4;
        await page.mouse.move(centerX, centerY);
        await page.waitForTimeout(400);

        const result = await page.evaluate(() => {
            const el = document.querySelector('#chart-output .chart-status-line');
            const visible = el && el.classList.contains('visible');
            const text = el ? String(el.textContent || '').trim() : '';
            return { visible: !!visible, text: text, hasEl: !!el };
        });

        if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const screenshotPath = path.join(SCREENSHOT_DIR, 'chart-status-line-verify.png');
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log('Screenshot:', screenshotPath);

        if (result.hasEl && result.visible && result.text.length > 0) {
            console.log('PASS: Chart status line visible with text:', result.text.slice(0, 60) + (result.text.length > 60 ? '...' : ''));
            exitCode = 0;
        } else {
            console.error('FAIL: Status line not visible or empty. hasEl=', result.hasEl, 'visible=', result.visible, 'textLength=', result.text.length);
        }
    } finally {
        await browser.close();
    }
    process.exit(exitCode);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
