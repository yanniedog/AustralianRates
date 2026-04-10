import type { Page } from 'playwright'

export async function waitForChartReady(page: Page, timeout = 18_000): Promise<void> {
  await page.waitForFunction(() => {
    const output = document.getElementById('chart-output')
    if (!output) return false
    const status = String((document.getElementById('chart-status') || {}).textContent || '')
      .trim()
      .toLowerCase()
    // Word-boundary "error" only — substring "err" matches "preferred" and stalls until timeout.
    if (status && /\berror\b/i.test(status)) return false
    if (/^load\s|^loading$|^wait$/i.test(status)) return false

    const engine = String(output.getAttribute('data-chart-engine') || '')
    const rendered =
      engine === 'echarts' ||
      engine === 'lightweight' ||
      output.getAttribute('data-chart-rendered') === 'true' ||
      !!output.querySelector('canvas') ||
      !!output.querySelector('svg')
    if (rendered) return true

    // Report views can finish with clearOutput('No data') — no engine/canvas, only .chart-output-empty.
    const empty = output.querySelector('.chart-output-empty')
    if (!empty || !status) return false
    return /^(no data|no curve data|no time ribbon data|no term vs time data|no lender match|no slope data|no ladder data|no distribution data|no numeric values)$/.test(
      status,
    )
  }, null, { timeout })
  await page.waitForTimeout(1200)
}

export async function ensureChartReady(page: Page, timeout = 18_000): Promise<void> {
  const button = page.locator('#draw-chart')
  const visible = await button.isVisible().catch(() => false)
  if (visible) {
    await button.scrollIntoViewIfNeeded().catch(() => undefined)
    await button.click({ force: true }).catch(() => undefined)
  }
  await waitForChartReady(page, timeout)
}
