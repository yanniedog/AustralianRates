import type { Hono } from 'hono'
import {
  CHART_LEGEND_OPACITY_DESKTOP_KEY,
  CHART_LEGEND_OPACITY_KEY,
  CHART_LEGEND_OPACITY_MOBILE_KEY,
  CHART_LEGEND_TEXT_BRIGHTNESS_DESKTOP_KEY,
  CHART_LEGEND_TEXT_BRIGHTNESS_KEY,
  CHART_LEGEND_TEXT_BRIGHTNESS_MOBILE_KEY,
  CHART_MAX_PRODUCTS_KEY,
} from '../constants'
import { getAppConfig } from '../db/app-config'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import {
  resolveChartLegendOpacitySetFromDb,
  resolveChartLegendTextBrightnessSetFromDb,
  resolveChartMaxProductsFromDb,
  resolveChartMaxProductsModeFromDb,
} from '../utils/chart-site-ui'
import { withPublicCache } from '../utils/http'

/** GET /site-ui — safe public UI prefs (no secrets). Cached briefly at the edge. */
export function registerSiteUiPublicRoute(routes: Hono<AppContext>): void {
  routes.get('/site-ui', async (c) => {
    withPublicCache(c, 60)
    const db = getReadDb(c.env)
    const [legacyRaw, desktopRaw, mobileRaw, brightnessLegacyRaw, brightnessDesktopRaw, brightnessMobileRaw, chartMaxProductsRaw] = await Promise.all([
      getAppConfig(db, CHART_LEGEND_OPACITY_KEY),
      getAppConfig(db, CHART_LEGEND_OPACITY_DESKTOP_KEY),
      getAppConfig(db, CHART_LEGEND_OPACITY_MOBILE_KEY),
      getAppConfig(db, CHART_LEGEND_TEXT_BRIGHTNESS_KEY),
      getAppConfig(db, CHART_LEGEND_TEXT_BRIGHTNESS_DESKTOP_KEY),
      getAppConfig(db, CHART_LEGEND_TEXT_BRIGHTNESS_MOBILE_KEY),
      getAppConfig(db, CHART_MAX_PRODUCTS_KEY),
    ])
    const opacities = resolveChartLegendOpacitySetFromDb({
      legacyRaw,
      desktopRaw,
      mobileRaw,
    })
    const textBrightness = resolveChartLegendTextBrightnessSetFromDb({
      legacyRaw: brightnessLegacyRaw,
      desktopRaw: brightnessDesktopRaw,
      mobileRaw: brightnessMobileRaw,
    })
    const chartMaxProducts = resolveChartMaxProductsFromDb(chartMaxProductsRaw)
    const chartMaxProductsMode = resolveChartMaxProductsModeFromDb(chartMaxProductsRaw)
    return c.json({
      ok: true,
      chart_legend_opacity: opacities.desktop,
      chart_legend_opacity_desktop: opacities.desktop,
      chart_legend_opacity_mobile: opacities.mobile,
      chart_legend_text_brightness: textBrightness.desktop,
      chart_legend_text_brightness_desktop: textBrightness.desktop,
      chart_legend_text_brightness_mobile: textBrightness.mobile,
      chart_max_products: chartMaxProducts,
      chart_max_products_mode: chartMaxProductsMode,
    })
  })
}
