import type { Hono } from 'hono'
import {
  CHART_LEGEND_OPACITY_DESKTOP_KEY,
  CHART_LEGEND_OPACITY_KEY,
  CHART_LEGEND_OPACITY_MOBILE_KEY,
} from '../constants'
import { getAppConfig } from '../db/app-config'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { resolveChartLegendOpacitySetFromDb } from '../utils/chart-site-ui'
import { withPublicCache } from '../utils/http'

/** GET /site-ui — safe public UI prefs (no secrets). Cached briefly at the edge. */
export function registerSiteUiPublicRoute(routes: Hono<AppContext>): void {
  routes.get('/site-ui', async (c) => {
    withPublicCache(c, 60)
    const db = getReadDb(c.env)
    const [legacyRaw, desktopRaw, mobileRaw] = await Promise.all([
      getAppConfig(db, CHART_LEGEND_OPACITY_KEY),
      getAppConfig(db, CHART_LEGEND_OPACITY_DESKTOP_KEY),
      getAppConfig(db, CHART_LEGEND_OPACITY_MOBILE_KEY),
    ])
    const opacities = resolveChartLegendOpacitySetFromDb({
      legacyRaw,
      desktopRaw,
      mobileRaw,
    })
    return c.json({
      ok: true,
      chart_legend_opacity: opacities.desktop,
      chart_legend_opacity_desktop: opacities.desktop,
      chart_legend_opacity_mobile: opacities.mobile,
    })
  })
}
