/**
 * Capture mobile viewport screenshots of the admin portal for visual review.
 * Saves to test-screenshots/mobile-admin-capture/<timestamp>/
 * Optional: set ADMIN_API_TOKEN or ADMIN_TEST_TOKEN to capture post-login pages.
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const ORIGIN = process.env.TEST_URL
  ? new URL(process.env.TEST_URL).origin
  : 'https://www.australianrates.com'
const ADMIN_BASE = `${ORIGIN}/admin`
const TOKEN =
  String(
    process.env.ADMIN_TEST_TOKEN ||
      process.env.ADMIN_API_TOKEN ||
      process.env.LOCAL_ADMIN_API_TOKEN ||
      '',
  ).trim() || ''

const MOBILE_VIEWPORT = { width: 390, height: 844 }
const CAPTURE_DIR = path.join(
  process.cwd(),
  'test-screenshots',
  'mobile-admin-capture',
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
)

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

async function main(): Promise<void> {
  ensureDir(CAPTURE_DIR)
  console.log('Capture dir:', CAPTURE_DIR)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await context.newPage()

  try {
    // 1. Admin login page
    await page.goto(`${ADMIN_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('#admin-token', { timeout: 10_000 }).catch(() => null)
    const loginPath = path.join(CAPTURE_DIR, '01-admin-login.png')
    await page.screenshot({ path: loginPath, fullPage: true })
    console.log('Saved:', loginPath)

    if (!TOKEN) {
      console.log('No ADMIN_API_TOKEN / ADMIN_TEST_TOKEN: skipping authenticated pages.')
      await browser.close()
      return
    }

    // 2. Login and go to dashboard
    await page.fill('#admin-token', TOKEN)
    await page.click('#login-btn')
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 25_000 })
    const dashboardPath = path.join(CAPTURE_DIR, '02-dashboard.png')
    await page.screenshot({ path: dashboardPath, fullPage: true })
    console.log('Saved:', dashboardPath)

    // 3. Status page (has sidebar + content)
    await page.goto(`${ADMIN_BASE}/status.html`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForSelector('#main-content', { timeout: 10_000 }).catch(() => null)
    await page.evaluate(() => window.scrollTo(0, 0))
    const statusPath = path.join(CAPTURE_DIR, '03-status.png')
    await page.screenshot({ path: statusPath, fullPage: true })
    console.log('Saved:', statusPath)

    // 4. Logs page (narrow shell)
    await page.goto(`${ADMIN_BASE}/logs.html`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForSelector('#main-content', { timeout: 10_000 }).catch(() => null)
    const logsPath = path.join(CAPTURE_DIR, '04-logs.png')
    await page.screenshot({ path: logsPath, fullPage: true })
    console.log('Saved:', logsPath)

    // 5. Database page (toolbar + table area)
    await page.goto(`${ADMIN_BASE}/database.html`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForSelector('#main-content', { timeout: 10_000 }).catch(() => null)
    const dbPath = path.join(CAPTURE_DIR, '05-database.png')
    await page.screenshot({ path: dbPath, fullPage: true })
    console.log('Saved:', dbPath)
  } finally {
    await browser.close()
  }

  console.log('Done. Review images in', CAPTURE_DIR)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
