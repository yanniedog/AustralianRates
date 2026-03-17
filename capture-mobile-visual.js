'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const OUT_DIR = path.join(__dirname, 'test-screenshots', 'mobile-capture');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  try {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#main-content', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('.market-terminal, .market-intro, .panel', { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    await page.screenshot({ path: path.join(OUT_DIR, '01-homepage.png'), fullPage: true });

    const menuBtn = page.locator('#site-menu-toggle');
    if (await menuBtn.count() > 0) {
      await menuBtn.click();
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
      await page.screenshot({ path: path.join(OUT_DIR, '02-menu-open.png'), fullPage: false });
      await page.evaluate(() => document.body.classList.remove('is-nav-open'));
    }

    await context.close();
    await browser.close();
    console.log('Mobile screenshots saved to', OUT_DIR);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
