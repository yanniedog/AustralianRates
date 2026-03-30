import type { Page } from 'playwright'

export async function waitForChartReady(page: Page, timeout = 90_000): Promise<void> {
  await page.waitForFunction(() => {
    const output = document.getElementById('chart-output')
    if (!output) return false
    const rendered =
      output.getAttribute('data-chart-engine') === 'echarts' ||
      !!output.querySelector('canvas') ||
      !!output.querySelector('svg')
    if (!rendered) return false
    const status = String((document.getElementById('chart-status') || {}).textContent || '')
      .trim()
      .toLowerCase()
    return status.indexOf('err') === -1
  }, null, { timeout })
  await page.waitForTimeout(1200)
}

export async function ensureChartReady(page: Page, timeout = 90_000): Promise<void> {
  const button = page.locator('#draw-chart')
  const visible = await button.isVisible().catch(() => false)
  if (visible) {
    await button.scrollIntoViewIfNeeded().catch(() => undefined)
    await button.click({ force: true }).catch(() => undefined)
  }
  await waitForChartReady(page, timeout)
}
