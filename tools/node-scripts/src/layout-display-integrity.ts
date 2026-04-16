/**
 * Production layout/display checks: overflow, landmark clipping, blocked controls,
 * text clipped in overflow:hidden containers, broken images, chart surface size, header overlay.
 * Run locally: npm run test:layout-integrity (not suitable for GitHub-hosted CI vs Cloudflare).
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { chromium } from 'playwright'

const require = createRequire(join(process.cwd(), 'package.json'))
const layoutCheckInPage = require('./tools/node-scripts/src/layout-display-integrity-browser.cjs') as (workspace: boolean) => {
  failures: string[]
  warnings: string[]
}

const DEFAULT_ORIGIN = 'https://www.australianrates.com'
const VIEWPORTS = [
  { height: 667, name: 'mobile', width: 375 },
  { height: 1024, name: 'tablet', width: 768 },
  { height: 1080, name: 'desktop', width: 1920 },
] as const

type RouteDef = { name: string; path: string; workspace: boolean }

const ROUTES: RouteDef[] = [
  { name: 'Home Loans', path: '/', workspace: true },
  { name: 'Savings', path: '/savings/', workspace: true },
  { name: 'Term Deposits', path: '/term-deposits/', workspace: true },
  { name: 'Economic data', path: '/economic-data/', workspace: false },
  { name: 'About', path: '/about/', workspace: false },
]

function baseOrigin(): string {
  const raw = String(process.env.TEST_URL || `${DEFAULT_ORIGIN}/`).trim()
  try {
    return new URL(raw).origin
  } catch {
    return DEFAULT_ORIGIN
  }
}

function urlForPath(path: string): string {
  return `${baseOrigin()}${path.startsWith('/') ? path : `/${path}`}`
}

async function gotoStable(page: import('playwright').Page, url: string, workspace: boolean): Promise<void> {
  await page.goto(url, { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#main-content', { timeout: 20_000 })
  await page.waitForSelector('.site-header .site-brand', { timeout: 20_000 })
  await page.waitForTimeout(workspace ? 2200 : 1200)
}

async function prepareWorkspace(page: import('playwright').Page): Promise<void> {
  const chartActiveOnLoad = await page.locator('#tab-chart.active').count().then((n) => n > 0).catch(() => false)
  if (!chartActiveOnLoad) {
    await page.locator('#tab-chart').click({ timeout: 15_000 }).catch(() => {})
  }
  await page.waitForTimeout(400)
  await page.locator('#tab-explorer').click({ timeout: 15_000 }).catch(() => {})
  await page.waitForFunction(
    () => {
      const panel = document.getElementById('panel-explorer')
      return !!(panel && !panel.hidden)
    },
    { timeout: 12_000 },
  ).catch(() => {})
  await page.waitForFunction(
    () => document.querySelectorAll('#rate-table .tabulator-row').length > 0,
    { timeout: 25_000 },
  ).catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('#tab-chart').click({ timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(900)
}

async function run(): Promise<number> {
  const origin = baseOrigin()
  console.log(`[layout-display-integrity] base ${origin}`)

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' })
  const allFailures: string[] = []

  try {
    for (const route of ROUTES) {
      const url = urlForPath(route.path)
      for (const vp of VIEWPORTS) {
        const context = `${route.name} / ${vp.name} (${vp.width}x${vp.height})`
        const contextLabel = `[${context}]`

        const page = await browser.newPage({ viewport: { height: vp.height, width: vp.width } })
        try {
          await gotoStable(page, url, route.workspace)
          if (route.workspace) await prepareWorkspace(page)

          const payload = await page.evaluate(layoutCheckInPage, route.workspace)

          for (const w of payload.warnings) {
            console.warn(`${contextLabel} WARN ${w}`)
          }
          for (const f of payload.failures) {
            allFailures.push(`${contextLabel} ${f}`)
            console.error(`${contextLabel} FAIL ${f}`)
          }
          if (payload.failures.length === 0) {
            console.log(`${contextLabel} PASS`)
          }
        } finally {
          await page.close().catch(() => {})
        }
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  console.log('\n========================================')
  console.log(`layout-display-integrity: ${allFailures.length} failure(s) across ${ROUTES.length} routes x ${VIEWPORTS.length} viewports`)
  console.log('========================================\n')

  return allFailures.length > 0 ? 1 : 0
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[layout-display-integrity] fatal:', err)
    process.exit(1)
  })
