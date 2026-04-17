import type { Hono } from 'hono'
import {
  CHART_LEGEND_OPACITY_DESKTOP_KEY,
  CHART_LEGEND_OPACITY_KEY,
  CHART_LEGEND_OPACITY_MOBILE_KEY,
  CHART_LEGEND_TEXT_BRIGHTNESS_DESKTOP_KEY,
  CHART_LEGEND_TEXT_BRIGHTNESS_KEY,
  CHART_LEGEND_TEXT_BRIGHTNESS_MOBILE_KEY,
  CHART_MAX_PRODUCTS_KEY,
  CHART_RIBBON_STYLE_KEY,
  FEATURE_ADVANCED_TAB_KEY,
  FEATURE_ALL_RATES_TAB_KEY,
  FEATURE_CHART_MODEL_SERVER_SIDE_KEY,
  FEATURE_CURRENT_LEADERS_KEY,
  FEATURE_MORE_FILTERS_KEY,
  FEATURE_SCENARIO_KEY,
} from '../constants'
import { getAppConfig } from '../db/app-config'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import {
  resolveChartLegendOpacitySetFromDb,
  resolveChartLegendTextBrightnessSetFromDb,
  resolveChartMaxProductsFromDb,
  resolveChartMaxProductsModeFromDb,
  resolveChartRibbonStyleFromDb,
} from '../utils/chart-site-ui'
import { withPublicCache } from '../utils/http'

/** Build the public site-ui payload directly from D1. Shared by GET /site-ui and the snapshot bundle. */
export async function buildSiteUiPayload(db: D1Database): Promise<Record<string, unknown>> {
  const [
    legacyRaw,
    desktopRaw,
    mobileRaw,
    brightnessLegacyRaw,
    brightnessDesktopRaw,
    brightnessMobileRaw,
    chartMaxProductsRaw,
    chartRibbonStyleRaw,
    featureAllRatesRaw,
    featureAdvancedRaw,
    featureCurrentLeadersRaw,
    featureScenarioRaw,
    featureMoreFiltersRaw,
    featureChartModelServerSideRaw,
  ] = await Promise.all([
    getAppConfig(db, CHART_LEGEND_OPACITY_KEY),
    getAppConfig(db, CHART_LEGEND_OPACITY_DESKTOP_KEY),
    getAppConfig(db, CHART_LEGEND_OPACITY_MOBILE_KEY),
    getAppConfig(db, CHART_LEGEND_TEXT_BRIGHTNESS_KEY),
    getAppConfig(db, CHART_LEGEND_TEXT_BRIGHTNESS_DESKTOP_KEY),
    getAppConfig(db, CHART_LEGEND_TEXT_BRIGHTNESS_MOBILE_KEY),
    getAppConfig(db, CHART_MAX_PRODUCTS_KEY),
    getAppConfig(db, CHART_RIBBON_STYLE_KEY),
    getAppConfig(db, FEATURE_ALL_RATES_TAB_KEY),
    getAppConfig(db, FEATURE_ADVANCED_TAB_KEY),
    getAppConfig(db, FEATURE_CURRENT_LEADERS_KEY),
    getAppConfig(db, FEATURE_SCENARIO_KEY),
    getAppConfig(db, FEATURE_MORE_FILTERS_KEY),
    getAppConfig(db, FEATURE_CHART_MODEL_SERVER_SIDE_KEY),
  ])
  const opacities = resolveChartLegendOpacitySetFromDb({ legacyRaw, desktopRaw, mobileRaw })
  const textBrightness = resolveChartLegendTextBrightnessSetFromDb({
    legacyRaw: brightnessLegacyRaw,
    desktopRaw: brightnessDesktopRaw,
    mobileRaw: brightnessMobileRaw,
  })
  return {
    ok: true,
    chart_legend_opacity: opacities.desktop,
    chart_legend_opacity_desktop: opacities.desktop,
    chart_legend_opacity_mobile: opacities.mobile,
    chart_legend_text_brightness: textBrightness.desktop,
    chart_legend_text_brightness_desktop: textBrightness.desktop,
    chart_legend_text_brightness_mobile: textBrightness.mobile,
    chart_max_products: resolveChartMaxProductsFromDb(chartMaxProductsRaw),
    chart_max_products_mode: resolveChartMaxProductsModeFromDb(chartMaxProductsRaw),
    chart_ribbon_style: resolveChartRibbonStyleFromDb(chartRibbonStyleRaw),
    features: {
      all_rates_tab: isFeatureOn(featureAllRatesRaw),
      advanced_tab: isFeatureOn(featureAdvancedRaw),
      current_leaders: isFeatureOn(featureCurrentLeadersRaw),
      scenario: isFeatureOn(featureScenarioRaw),
      more_filters: isFeatureOn(featureMoreFiltersRaw),
      chart_model_server_side: isFeatureOn(featureChartModelServerSideRaw),
    },
  }
}

/** GET /site-ui — safe public UI prefs (no secrets). Cached briefly at the edge. */
export function registerSiteUiPublicRoute(routes: Hono<AppContext>): void {
  routes.get('/site-ui', async (c) => {
    withPublicCache(c, 60)
    const payload = await buildSiteUiPayload(getReadDb(c))
    return c.json(payload)
  })
}

/** Feature flags default off; only the string '1' / 'true' / 'on' / 'yes' enables them. */
function isFeatureOn(raw: string | null | undefined): boolean {
  if (raw == null) return false
  const text = String(raw).trim().toLowerCase()
  return text === '1' || text === 'true' || text === 'on' || text === 'yes'
}
