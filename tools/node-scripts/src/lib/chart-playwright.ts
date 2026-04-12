import type { JSHandle, Page } from 'playwright'

export async function waitForChartReady(page: Page, timeout = 30_000): Promise<void> {
  const handle: JSHandle<{ fatal?: string } | { ok: true } | null> = await page.waitForFunction(
    () => {
      const output = document.getElementById('chart-output')
      if (!output) return null
      const statusEl = document.getElementById('chart-status')
      const statusRaw = String((statusEl && statusEl.textContent) || '').trim()
      const status = statusRaw.toLowerCase()

      if (statusRaw && /\berror\b/i.test(statusRaw)) return { fatal: statusRaw }

      // ar-charts setPendingState('LOAD') sets exact "LOAD" before progress "LOAD 1/10 …".
      if (/^load\s|^load$|^loading$|^wait$/i.test(status)) return null

      const engine = String(output.getAttribute('data-chart-engine') || '')
      const rendered =
        engine === 'echarts' ||
        engine === 'lightweight' ||
        output.getAttribute('data-chart-rendered') === 'true' ||
        !!output.querySelector('canvas') ||
        !!output.querySelector('svg')
      if (rendered) return { ok: true as const }

      // finishChartPaint sets status like "1,234 rows | 50 banks".
      if (status && /\d[\d,]*\s+rows/i.test(status)) return { ok: true as const }

      const empty = output.querySelector('.chart-output-empty')
      if (!empty || !status) return null
      if (
        /^(no data|no curve data|no time ribbon data|no term vs time data|no lender match|no slope data|no ladder data|no distribution data|no numeric values)$/.test(
          status,
        )
      ) {
        return { ok: true as const }
      }
      return null
    },
    null,
    { timeout },
  )

  const val = await handle.jsonValue()
  await handle.dispose().catch(() => {})

  if (val && typeof val === 'object' && 'fatal' in val && val.fatal) {
    throw new Error(`Chart terminal error: ${val.fatal}`)
  }

  await page.waitForTimeout(400)
}

export async function ensureChartReady(page: Page, timeout = 30_000): Promise<void> {
  const button = page.locator('#draw-chart')
  const count = await button.count().catch(() => 0)
  const visible = count > 0 && (await button.isVisible().catch(() => false))
  if (visible) {
    await button.scrollIntoViewIfNeeded().catch(() => undefined)
    await button.click({ force: true }).catch(() => undefined)
  } else {
    // Public workspace HTML has no #draw-chart; tab changes only call refreshFromCache.
    await page.evaluate(() => {
      const w = window as Window & { AR?: { charts?: { drawChart?: () => void } } }
      const charts = w.AR && w.AR.charts
      if (charts && typeof charts.drawChart === 'function') {
        void charts.drawChart()
      }
    })
  }
  await waitForChartReady(page, timeout)
}
