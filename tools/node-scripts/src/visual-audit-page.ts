import type { Page } from 'playwright'
import {
  ANALYST_CLICK_TARGETS,
  BASE_CLICK_TARGETS,
  CHART_CLICK_TARGETS,
  GEOMETRY_SELECTORS,
  PIVOT_CLICK_TARGETS,
} from './visual-audit-config'
import type { AuditRoute, AuditState, CaptureCheck, CaptureIssue, GeometryEvidence, ViewportKey } from './visual-audit-types'

function pushCheck(checks: CaptureCheck[], label: string, passed: boolean, details?: string): void {
  checks.push({ details, label, passed })
}

function pushIssue(issues: CaptureIssue[], code: string, message: string, severity: 'error' | 'warning' = 'error'): void {
  issues.push({ code, message, severity })
}

async function waitForDataReady(page: Page): Promise<void> {
  await page.waitForSelector('#main-content', { timeout: 45_000 })
  await page.waitForSelector('.hero', { timeout: 45_000 }).catch(() => undefined)
  await page.waitForFunction(
    () => {
      const stat = document.querySelector('#stat-records .hero-stat-value')
      return !!stat && String(stat.textContent || '').trim().length > 0 && !String(stat.textContent || '').includes('...')
    },
    { timeout: 45_000 },
  ).catch(() => undefined)
  await page.waitForFunction(() => document.querySelectorAll('#rate-table .tabulator-row').length > 0, { timeout: 45_000 }).catch(() => undefined)
  await page.waitForTimeout(900)
}

async function switchAnalyst(page: Page): Promise<void> {
  await page.locator('#mode-analyst').click().catch(() => undefined)
  await page.waitForTimeout(600)
}

async function openDetails(page: Page, selector: string): Promise<void> {
  const details = page.locator(selector).first()
  if (!(await details.count().catch(() => 0))) return
  const isOpen = await details.evaluate((node) => node instanceof HTMLDetailsElement && node.open).catch(() => false)
  if (!isOpen) {
    await page.locator(`${selector} > summary`).click().catch(() => undefined)
    await page.waitForTimeout(300)
  }
}

async function waitForChartView(page: Page, view: string): Promise<void> {
  await page.locator('#tab-charts').click().catch(() => undefined)
  await page.waitForTimeout(300)
  await page.locator('#draw-chart').click().catch(() => undefined)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('chart-output')
      return !!el && (el.getAttribute('data-chart-engine') === 'echarts' || !!el.querySelector('canvas') || !!el.querySelector('svg'))
    },
    { timeout: 45_000 },
  )
  if (view !== 'lenders') {
    await page.locator(`[data-chart-view="${view}"]`).click().catch(() => undefined)
    await page.waitForTimeout(900)
  }
}

async function waitForPivot(page: Page): Promise<void> {
  await page.locator('#tab-pivot').click().catch(() => undefined)
  await page.waitForTimeout(300)
  await page.locator('#load-pivot').click().catch(() => undefined)
  await page.waitForFunction(() => !!document.querySelector('#pivot-output .pvtUi'), { timeout: 45_000 })
  await page.waitForTimeout(700)
}

async function evaluatePivotLayout(page: Page, viewportKey: ViewportKey, checks: CaptureCheck[], issues: CaptureIssue[]): Promise<void> {
  const layout = await page.evaluate((mode) => {
    const viewportWidth = window.innerWidth
    const selectInfo = Array.from(document.querySelectorAll('#pivot-output select')).map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
      }
    })
    const enoughWidth =
      selectInfo.length > 0 &&
      selectInfo.every((info) =>
        mode === 'desktop'
          ? info.width >= 150
          : info.left >= 0 && info.right <= viewportWidth - 8 && info.width >= 180,
      )
    return {
      enoughWidth,
      widths: selectInfo.map((info) => Math.round(info.width)),
    }
  }, viewportKey)
  pushCheck(checks, 'pivot controls readable', layout.enoughWidth, layout.widths.join(', '))
  if (!layout.enoughWidth) pushIssue(issues, 'PIVOT_CONTROL_WIDTH', 'Pivot controls collapsed below the readable width threshold.')

  if (viewportKey === 'desktop') return
  const triangle = page.locator('#pivot-output .pvtUnused .pvtTriangle').first()
  if (!(await triangle.count().catch(() => 0))) return
  await triangle.click().catch(() => undefined)
  await page.waitForTimeout(300)
  const onScreen = await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll('#pivot-output .pvtFilterBox')).find((node) => {
      const style = window.getComputedStyle(node)
      return style.display !== 'none'
    })
    if (!box) return false
    const rect = box.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= window.innerWidth - 8
  })
  pushCheck(checks, 'pivot filter menu on-screen', onScreen)
  if (!onScreen) pushIssue(issues, 'PIVOT_FILTER_OFFSCREEN', 'Pivot filter menu opened outside the viewport.')
  await page.keyboard.press('Escape').catch(() => undefined)
}

async function evaluateTableState(page: Page, checks: CaptureCheck[], issues: CaptureIssue[]): Promise<void> {
  const table = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('#rate-table .tabulator-col-title')).map((node) => String(node.textContent || '').trim())
    const rowCount = document.querySelectorAll('#rate-table .tabulator-row').length
    const badCells = Array.from(document.querySelectorAll('#rate-table .tabulator-cell'))
      .map((node) => String(node.textContent || '').trim())
      .filter((text) => /\b(undefined|NaN|error|failed|null|EXPLORER_TABLE_ABNORMALITY)\b/i.test(text))
    return { badCells, headers, rowCount }
  })
  pushCheck(checks, 'table rows present', table.rowCount > 0, `rows=${table.rowCount}`)
  if (table.rowCount === 0) pushIssue(issues, 'TABLE_EMPTY', 'Rate table did not render any visible rows.')
  pushCheck(checks, 'table contains Found at header', table.headers.includes('Found at'))
  if (!table.headers.includes('Found at')) pushIssue(issues, 'TABLE_HEADER_MISSING', 'Rate table is missing the Found at header.')
  pushCheck(checks, 'table has no abnormal error text', table.badCells.length === 0, table.badCells.slice(0, 3).join(' | '))
  if (table.badCells.length > 0) pushIssue(issues, 'TABLE_ABNORMAL_TEXT', 'Rate table contains abnormal error-like text.')
}

async function evaluateChartState(page: Page, expectedView: string, checks: CaptureCheck[], issues: CaptureIssue[]): Promise<void> {
  const chart = await page.evaluate(() => {
    const output = document.getElementById('chart-output')
    const view = output?.getAttribute('data-chart-view') || ''
    const rendered = !!output && (output.getAttribute('data-chart-engine') === 'echarts' || !!output.querySelector('canvas') || !!output.querySelector('svg'))
    const summaryRows = document.querySelectorAll('#chart-data-summary tbody tr').length
    const spotlightText = String(document.getElementById('chart-point-details')?.textContent || '').trim()
    return { rendered, spotlightText, summaryRows, view }
  })
  pushCheck(checks, 'chart rendered', chart.rendered, chart.view)
  if (!chart.rendered) pushIssue(issues, 'CHART_NOT_RENDERED', 'Chart surface did not render.')
  pushCheck(checks, 'chart view matches state', chart.view === expectedView, chart.view)
  if (chart.view !== expectedView) pushIssue(issues, 'CHART_VIEW_MISMATCH', `Expected chart view ${expectedView} but rendered ${chart.view || 'none'}.`)
  pushCheck(checks, 'chart summary table populated', chart.summaryRows > 0, `rows=${chart.summaryRows}`)
  if (chart.summaryRows === 0) pushIssue(issues, 'CHART_SUMMARY_EMPTY', 'Chart summary table did not populate.')
  pushCheck(checks, 'chart spotlight populated', chart.spotlightText.length > 0)
  if (chart.spotlightText.length === 0) pushIssue(issues, 'CHART_SPOTLIGHT_EMPTY', 'Chart spotlight panel is empty.')
}

export async function prepareState(page: Page, route: AuditRoute, state: AuditState, checks: CaptureCheck[], issues: CaptureIssue[]): Promise<string[]> {
  const interactiveSelectors = [...BASE_CLICK_TARGETS]
  if (route.kind === 'legal' || route.kind === 'admin-login') return interactiveSelectors
  await waitForDataReady(page)
  await evaluateTableState(page, checks, issues)

  if (state.key === 'analyst-advanced-full') {
    await switchAnalyst(page)
    await openDetails(page, '#filter-bar')
    return [...interactiveSelectors, ...ANALYST_CLICK_TARGETS]
  }
  if (state.key === 'table-settings-open') {
    await switchAnalyst(page)
    await page.locator('#table-settings-btn').click().catch(() => undefined)
    await page.waitForTimeout(400)
    const visible = await page.locator('#table-settings-popover').evaluate((node) => !(node as HTMLElement).hidden).catch(() => false)
    pushCheck(checks, 'table settings popover visible', visible)
    if (!visible) pushIssue(issues, 'TABLE_SETTINGS_HIDDEN', 'Table settings popover did not stay visible.')
    return [...interactiveSelectors, ...ANALYST_CLICK_TARGETS]
  }
  if (state.key === 'pivot-full') {
    await switchAnalyst(page)
    await waitForPivot(page)
    await evaluatePivotLayout(page, state.viewportKey, checks, issues)
    return [...interactiveSelectors, ...ANALYST_CLICK_TARGETS, ...PIVOT_CLICK_TARGETS]
  }
  if (state.key.startsWith('chart-')) {
    await switchAnalyst(page)
    const view = state.key.replace('chart-', '')
    await waitForChartView(page, view)
    await evaluateChartState(page, view, checks, issues)
    return [...interactiveSelectors, ...ANALYST_CLICK_TARGETS, ...CHART_CLICK_TARGETS]
  }
  if (state.key === 'market-notes-open') {
    await openDetails(page, '#market-notes')
    pushCheck(checks, 'market notes expanded', await page.locator('#market-notes').evaluate((node) => node instanceof HTMLDetailsElement && node.open).catch(() => false))
    return interactiveSelectors
  }
  if (state.key === 'footer-technical-open') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await openDetails(page, '#footer-technical')
    pushCheck(checks, 'footer technical expanded', await page.locator('#footer-technical').evaluate((node) => node instanceof HTMLDetailsElement && node.open).catch(() => false))
    return interactiveSelectors
  }
  return interactiveSelectors
}

export async function collectGeometry(page: Page, interactiveSelectors: string[]): Promise<GeometryEvidence> {
  return await page.evaluate(
    ({ selectors, targets }) => {
      const viewport = { height: window.innerHeight, width: window.innerWidth }
      const root = document.documentElement
      const selectorMetrics = selectors.map((selector) => {
        const node = document.querySelector(selector)
        const style = node ? window.getComputedStyle(node) : null
        const rect = node ? node.getBoundingClientRect() : null
        const isVisible =
          !!node &&
          !!style &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          !!rect &&
          rect.width > 0 &&
          rect.height > 0
        if (!isVisible || !rect) return { selector, visible: false }
        return {
          bottom: Number(rect.bottom.toFixed(2)),
          clippedHorizontally: rect.left < -1 || rect.right > viewport.width + 1,
          clippedLeft: rect.left < -1,
          clippedRight: rect.right > viewport.width + 1,
          height: Number(rect.height.toFixed(2)),
          left: Number(rect.left.toFixed(2)),
          right: Number(rect.right.toFixed(2)),
          selector,
          top: Number(rect.top.toFixed(2)),
          visible: true,
          width: Number(rect.width.toFixed(2)),
        }
      })
      const blockedSelectors = targets.filter((selector) => {
        const node = document.querySelector(selector)
        const style = node ? window.getComputedStyle(node) : null
        const rect = node ? node.getBoundingClientRect() : null
        const isVisible =
          !!node &&
          !!style &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          !!rect &&
          rect.width > 0 &&
          rect.height > 0
        if (!isVisible || !rect) return false
        const probe = document.elementFromPoint(rect.left + Math.min(20, rect.width / 2), rect.top + Math.min(20, rect.height / 2))
        return !!probe && probe !== node && !node!.contains(probe) && !probe.contains(node!)
      })
      const horizontalIssues = selectorMetrics.filter((item) => item.visible && item.clippedHorizontally).map((item) => item.selector)
      return {
        blockedSelectors,
        horizontalIssues,
        pageOverflowX: root.scrollWidth > viewport.width + 2,
        pageOverflowY: root.scrollHeight > viewport.height + 2,
        selectorMetrics,
        viewport,
      }
    },
    { selectors: GEOMETRY_SELECTORS, targets: interactiveSelectors },
  )
}
