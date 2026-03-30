/**
 * Visual verify: chart status line (TradingView-style) appears when hovering the chart.
 * Run from repo root: node -e "require('./tools/node-scripts/runner.cjs').runTsScript(process.cwd(), 'chart-status-line-verify.ts', [])"
 * Or: npx tsx tools/node-scripts/src/chart-status-line-verify.ts
 */
// @ts-nocheck
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureChartReady } = require('./lib/chart-playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const SCREENSHOT_DIR = path.join(process.cwd(), 'test-screenshots');
const VIEWPORT = { width: 1280, height: 900 };

function readHoverFeedback() {
    const output = document.getElementById('chart-output');
    const legacyEl = output ? output.querySelector('.chart-status-line') : null;
    const legacyVisible = !!legacyEl && legacyEl.classList.contains('visible');
    const legacyText = legacyEl ? String(legacyEl.textContent || '').trim() : '';
    var legendText = '';
    if (output) {
        var legendCandidates = Array.from(output.querySelectorAll('div'))
            .filter(function (node) {
                var style = window.getComputedStyle(node);
                var rect = node.getBoundingClientRect();
                var top = parseFloat(style.top || '');
                var left = parseFloat(style.left || '');
                return (
                    style.position === 'absolute' &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    Number.isFinite(top) &&
                    Number.isFinite(left) &&
                    top <= 12 &&
                    left <= 12
                );
            })
            .map(function (node) {
                return String(node.textContent || '').trim();
            })
            .filter(Boolean)
            .sort(function (a, b) {
                return b.length - a.length;
            });
        legendText = legendCandidates[0] || '';
    }
    return {
        engine: output ? String(output.getAttribute('data-chart-engine') || '') : '',
        legendText: legendText,
        legacyHasEl: !!legacyEl,
        legacyText: legacyText,
        legacyVisible: legacyVisible,
    };
}

async function main() {
    let exitCode = 1;
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#main-content', { timeout: 15000 });
        await page.waitForTimeout(2000);

        await ensureChartReady(page, 90000);
        const before = await page.evaluate(readHoverFeedback);

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

        const result = await page.evaluate(readHoverFeedback);

        if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const screenshotPath = path.join(SCREENSHOT_DIR, 'chart-status-line-verify.png');
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log('Screenshot:', screenshotPath);

        const legacyPass = result.legacyHasEl && result.legacyVisible && result.legacyText.length > 0;
        const legendChanged = result.legendText.length > 0 && result.legendText !== before.legendText;
        if (legacyPass) {
            console.log('PASS: Chart status line visible with text:', result.legacyText.slice(0, 60) + (result.legacyText.length > 60 ? '...' : ''));
            exitCode = 0;
        } else if (legendChanged) {
            console.log('PASS: Chart hover legend updated with text:', result.legendText.slice(0, 80) + (result.legendText.length > 80 ? '...' : ''));
            exitCode = 0;
        } else {
            console.error(
                'FAIL: Hover feedback not detected.',
                'engine=', result.engine,
                'legacyHasEl=', result.legacyHasEl,
                'legacyVisible=', result.legacyVisible,
                'legacyTextLength=', result.legacyText.length,
                'legendBeforeLength=', before.legendText.length,
                'legendAfterLength=', result.legendText.length,
                'legendChanged=', legendChanged,
            );
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
