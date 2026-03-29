import type { Hono } from 'hono'
import { CHART_LEGEND_OPACITY_KEY } from '../constants'
import { getAppConfig } from '../db/app-config'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { resolveChartLegendOpacityFromDb } from '../utils/chart-site-ui'
import { withPublicCache } from '../utils/http'

/** GET /site-ui — safe public UI prefs (no secrets). Cached briefly at the edge. */
export function registerSiteUiPublicRoute(routes: Hono<AppContext>): void {
  routes.get('/site-ui', async (c) => {
    withPublicCache(c, 60)
    const db = getReadDb(c.env)
    const raw = await getAppConfig(db, CHART_LEGEND_OPACITY_KEY)
    const chart_legend_opacity = resolveChartLegendOpacityFromDb(raw)
    return c.json({ ok: true, chart_legend_opacity })
  })
}
