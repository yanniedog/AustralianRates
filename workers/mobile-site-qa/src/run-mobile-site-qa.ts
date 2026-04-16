/**
 * Mobile-oriented production QA: responsive site at phone viewports with touch + mobile UA,
 * reuses layout-display-integrity in-page checks, adds touch targets, explorer rail, overlay smoke.
 * Run: npm run test:mobile-site-qa (from repo root). Not for GitHub-hosted CI (Cloudflare challenge).
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'

/** mobile-site-qa/src -> repo root */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const require = createRequire(join(REPO_ROOT, 'package.json'))
const layoutCheckInPage = require(join(
  REPO_ROOT,
  'tools/node-scripts/src/layout-display-integrity-browser.cjs',
)) as (workspace: boolean) => { failures: string[]; warnings: string[] }

/** Playwright serializes arg as `{ phase: string }`; browser accepts chart | explorer. */
type MobileQaFn = (opts: { phase: string; workspace: boolean }) => { failures: string[]; warnings: string[] }
const mobileBrowser = require(join(REPO_ROOT, 'workers/mobile-site-qa/src/mobile-site-qa-browser.cjs')) as {
  mobileSiteQaInPage: MobileQaFn
  refreshMobileNavInPage: () => void
}
const { mobileSiteQaInPage, refreshMobileNavInPage } = mobileBrowser

const DEFAULT_ORIGIN = 'https://www.australianrates.com'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const MOBILE_VIEWPORTS = [
  { height: 667, name: 'iphone-se', width: 375 },
  { height: 844, name: 'iphone-14', width: 390 },
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

async function gotoStable(page: Page, url: string, workspace: boolean): Promise<void> {
  await page.goto(url, { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#main-content', { timeout: 20_000 })
  await page.waitForSelector('.site-header .site-brand', { timeout: 20_000 })
  await page.waitForTimeout(workspace ? 2200 : 1200)
}

async function prepareWorkspaceChart(page: Page): Promise<void> {
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
    { timeout: 35_000 },
  ).catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('#tab-chart').click({ timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(900)
}

async function openExplorerForRail(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = document.getElementById('table-details')
    if (d instanceof HTMLDetailsElement) d.open = true
  })
  await page.waitForTimeout(300)
  await page.locator('#tab-explorer').click({ timeout: 15_000 })
  await page.waitForSelector('#panel-explorer.active', { timeout: 10_000 }).catch(() => {})
  await page.waitForFunction(
    () => document.querySelectorAll('#rate-table .tabulator-row').length > 0,
    { timeout: 35_000 },
  )
  await page.evaluate(refreshMobileNavInPage)
  await page.waitForTimeout(600)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const visible = await page.evaluate(() => {
      const rail = document.getElementById('mobile-table-rail')
      return !!(rail && !rail.hidden)
    })
    if (visible) return
    await page.evaluate(refreshMobileNavInPage)
    await page.waitForTimeout(250)
  }
}

async function overlaySmoke(page: Page, label: string, failures: string[]): Promise<void> {
  const help = page.locator('#site-help-btn')
  const menu = page.locator('#site-menu-toggle')
  if ((await help.count()) === 0 || (await menu.count()) === 0) {
    failures.push(`${label}: help or menu control missing for overlay smoke`)
    return
  }
  await help.click({ timeout: 10_000 })
  await page.waitForTimeout(350)
  const helpOpen = await page.evaluate(() => {
    const sheet = document.getElementById('site-help-sheet')
    return !!(sheet && !sheet.hidden && sheet.querySelector('.site-help-panel'))
  })
  if (!helpOpen) failures.push(`${label}: help sheet did not open`)

  await menu.click({ timeout: 10_000 })
  await page.waitForTimeout(350)
  const menuOk = await page.evaluate(() => {
    const helpSheet = document.getElementById('site-help-sheet')
    const helpHidden = !helpSheet || helpSheet.hidden
    return document.body.classList.contains('is-nav-open') && helpHidden && document.body.classList.contains('has-overlay-open')
  })
  if (!menuOk) failures.push(`${label}: menu did not replace help or scrim state wrong`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const closed = await page.evaluate(() => {
    const helpSheet = document.getElementById('site-help-sheet')
    const scrim = document.getElementById('site-nav-scrim')
    return (
      !document.body.classList.contains('is-nav-open') &&
      !document.body.classList.contains('has-overlay-open') &&
      (!helpSheet || helpSheet.hidden) &&
      (!scrim || scrim.hidden)
    )
  })
  if (!closed) failures.push(`${label}: Escape did not close overlays`)
}

function mergePayload(
  contextLabel: string,
  payload: { failures: string[]; warnings: string[] },
  allFailures: string[],
): void {
  for (const w of payload.warnings) console.warn(`${contextLabel} WARN ${w}`)
  for (const f of payload.failures) {
    allFailures.push(`${contextLabel} ${f}`)
    console.error(`${contextLabel} FAIL ${f}`)
  }
}

async function runRouteViewport(
  page: Page,
  route: RouteDef,
  url: string,
  vpName: string,
  allFailures: string[],
): Promise<void> {
  const contextLabel = `[${route.name} / ${vpName}]`
  const failureCountBefore = allFailures.length

  await gotoStable(page, url, route.workspace)

  if (route.workspace) {
    await prepareWorkspaceChart(page)
    mergePayload(contextLabel, await page.evaluate(layoutCheckInPage, true), allFailures)
    mergePayload(contextLabel, await page.evaluate(mobileSiteQaInPage, { phase: 'chart', workspace: true }), allFailures)

    await openExplorerForRail(page)
    mergePayload(contextLabel, await page.evaluate(mobileSiteQaInPage, { phase: 'explorer', workspace: true }), allFailures)

    await overlaySmoke(page, contextLabel, allFailures)
  } else {
    mergePayload(contextLabel, await page.evaluate(layoutCheckInPage, false), allFailures)
    mergePayload(contextLabel, await page.evaluate(mobileSiteQaInPage, { phase: 'chart', workspace: false }), allFailures)
  }

  if (allFailures.length === failureCountBefore) console.log(`${contextLabel} PASS`)
}

async function run(): Promise<number> {
  console.log(`[mobile-site-qa] base ${baseOrigin()} (mobile viewports + touch + ${IPHONE_UA.slice(0, 48)}…)`)

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' })
  const allFailures: string[] = []

  try {
    for (const route of ROUTES) {
      const url = urlForPath(route.path)
      for (const vp of MOBILE_VIEWPORTS) {
        const context = await browser.newContext({
          deviceScaleFactor: 2,
          hasTouch: true,
          isMobile: true,
          userAgent: IPHONE_UA,
          viewport: { height: vp.height, width: vp.width },
        })
        const page = await context.newPage()
        try {
          await runRouteViewport(page, route, url, vp.name, allFailures)
        } finally {
          await page.close().catch(() => {})
          await context.close().catch(() => {})
        }
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  console.log('\n========================================')
  console.log(`mobile-site-qa: ${allFailures.length} failure(s); routes=${ROUTES.length} viewports=${MOBILE_VIEWPORTS.length}`)
  console.log('========================================\n')

  return allFailures.length > 0 ? 1 : 0
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[mobile-site-qa] fatal:', err)
    process.exit(1)
  })
