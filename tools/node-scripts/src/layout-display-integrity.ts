/**
 * Production layout/display checks: overflow, landmark clipping, blocked controls,
 * text clipped in overflow:hidden containers, broken images, chart surface size, header overlay.
 * Run locally: npm run test:layout-integrity (not suitable for GitHub-hosted CI vs Cloudflare).
 */
import { chromium } from 'playwright'

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
  await page.locator('#tab-chart').click({ timeout: 15_000 }).catch(() => {})
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

          const payload = await page.evaluate(
            ({ workspace }) => {
              const failures: string[] = []
              const warnings: string[] = []
              const vw = window.innerWidth
              const vh = window.innerHeight
              const root = document.documentElement

              const chartPanel = document.getElementById('panel-chart')
              const chartPanelActive = !!(chartPanel && !chartPanel.hidden && chartPanel.classList.contains('active'))

              function isVisible(el: Element | null): el is HTMLElement {
                if (!el || !(el instanceof HTMLElement)) return false
                if (el.getAttribute('hidden') !== null) return false
                const style = getComputedStyle(el)
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
                const rect = el.getBoundingClientRect()
                return rect.width > 1 && rect.height > 1
              }

              if (root.scrollWidth > vw + 2) {
                failures.push(`document horizontal overflow (scrollWidth ${root.scrollWidth} > ${vw})`)
              }

              const landmarks = workspace
                ? ['.site-header', '#main-content', '.market-terminal', '#chart-output', '#rate-table', '.site-footer']
                : ['.site-header', '#main-content', '.site-footer', '.content-page']

              for (const sel of landmarks) {
                const el = document.querySelector(sel)
                if (!el || !isVisible(el)) continue
                const r = el.getBoundingClientRect()
                if (r.left < -2 || r.right > vw + 2) {
                  failures.push(
                    `landmark clipped horizontally: ${sel} (left=${r.left.toFixed(0)} right=${r.right.toFixed(0)} vw=${vw})`,
                  )
                }
                if (r.top < -2 && r.bottom > 4) {
                  failures.push(`landmark clipped at top: ${sel}`)
                }
              }

              const tabSelectors = workspace ? ['#tab-chart', '#tab-explorer', '#tab-pivot'] : []
              for (const sel of tabSelectors) {
                const el = document.querySelector(sel)
                if (!el || !isVisible(el)) continue
                const r = el.getBoundingClientRect()
                const x = r.left + Math.min(14, Math.max(4, r.width / 2))
                const y = r.top + Math.min(14, Math.max(4, r.height / 2))
                const hit = document.elementFromPoint(x, y)
                if (!hit || (!el.contains(hit) && !hit.contains(el))) {
                  failures.push(`control appears covered (hit-test): ${sel}`)
                }
              }

              const textRoots = workspace
                ? '#main-content .tab-btn, #main-content .site-header-segment-link, .terminal-stat, #chart-summary, .market-intro-title, #explorer-overview-title, #filter-live-status'
                : '#main-content h1, #main-content h2, #main-content p, #main-content a, .content-page'

              document.querySelectorAll(textRoots).forEach((el) => {
                if (!(el instanceof HTMLElement) || !isVisible(el)) return
                const text = String(el.textContent || '')
                  .replace(/\s+/g, ' ')
                  .trim()
                if (text.length < 2) return
                const cs = getComputedStyle(el)
                if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll')
                  return
                const lineClamp = cs.webkitLineClamp
                if (lineClamp && lineClamp !== 'none' && Number(lineClamp) > 0) return
                if (cs.textOverflow === 'ellipsis' || cs.textOverflow === 'fade') return
                const hiddenOverflow =
                  cs.overflow === 'hidden' ||
                  cs.overflow === 'clip' ||
                  cs.overflowX === 'hidden' ||
                  cs.overflowY === 'hidden'
                if (hiddenOverflow) {
                  if (el.scrollWidth > el.clientWidth + 3) {
                    failures.push(`text clipped (overflow hidden, width): <${el.tagName.toLowerCase()}> "${text.slice(0, 48)}…"`)
                  }
                  if (el.scrollHeight > el.clientHeight + 4 && !/textarea|input/i.test(el.tagName)) {
                    failures.push(`text clipped (overflow hidden, height): <${el.tagName.toLowerCase()}> "${text.slice(0, 48)}…"`)
                  }
                }
              })

              document.querySelectorAll('#main-content img').forEach((img) => {
                if (!(img instanceof HTMLImageElement) || !isVisible(img)) return
                if (!img.complete) return
                if (img.naturalWidth === 0 && img.naturalHeight === 0) {
                  failures.push(`broken image in main: ${img.getAttribute('src') || img.alt || 'no-src'}`)
                }
              })

              if (workspace && chartPanelActive) {
                const out = document.getElementById('chart-output')
                if (out && isVisible(out)) {
                  const canvas = out.querySelector('canvas')
                  const svg = out.querySelector('svg')
                  let w = 0
                  let h = 0
                  if (canvas) {
                    w = canvas.width
                    h = canvas.height
                  } else if (svg) {
                    const br = svg.getBoundingClientRect()
                    w = br.width
                    h = br.height
                  }
                  const engine = out.getAttribute('data-chart-engine') || ''
                  if ((engine === 'echarts' || engine === 'lightweight' || canvas || svg) && (w < 48 || h < 48)) {
                    failures.push(`chart surface too small (${Math.round(w)}x${Math.round(h)}) with engine=${engine || 'unknown'}`)
                  }
                }
              }

              const header = document.querySelector('.site-header')
              const main = document.getElementById('main-content')
              if (header && main && isVisible(header)) {
                const hs = getComputedStyle(header)
                if (hs.position === 'fixed' || hs.position === 'sticky') {
                  const hr = header.getBoundingClientRect()
                  const probeX = Math.min(vw - 8, Math.max(8, vw / 2))
                  const probeY = Math.min(vh - 8, Math.max(hr.bottom + 3, 8))
                  const hit = document.elementFromPoint(probeX, probeY)
                  if (hit && header.contains(hit) && probeY > hr.bottom - 2) {
                    failures.push('fixed/sticky header still captures hit-tests immediately below header band')
                  }
                }
              }

              if (workspace) {
                const rows = document.querySelectorAll('#rate-table .tabulator-row').length
                if (rows === 0) {
                  warnings.push('no tabulator rows; table-specific clipping not fully exercised')
                }
              }

              const maxReport = 35
              const extra = failures.length - maxReport
              const trimmed = failures.slice(0, maxReport)
              if (extra > 0) trimmed.push(`…and ${extra} more failure(s)`)

              return { failures: trimmed, warnings }
            },
            { workspace: route.workspace },
          )

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
