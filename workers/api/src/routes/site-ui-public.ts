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

/** GET /site-ui — safe public UI prefs (no secrets). Cached briefly at the edge. */
export function registerSiteUiPublicRoute(routes: Hono<AppContext>): void {
  routes.get('/site-ui', async (c) => {
    withPublicCache(c, 60)
    const db = getReadDb(c)
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
    const chartRibbonStyle = resolveChartRibbonStyleFromDb(chartRibbonStyleRaw)
    const features = {
      all_rates_tab: isFeatureOn(featureAllRatesRaw),
      advanced_tab: isFeatureOn(featureAdvancedRaw),
      current_leaders: isFeatureOn(featureCurrentLeadersRaw),
      scenario: isFeatureOn(featureScenarioRaw),
      more_filters: isFeatureOn(featureMoreFiltersRaw),
    }
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
      chart_ribbon_style: chartRibbonStyle,
      features,
    })
  })
}

/** Feature flags default off; only the string '1' / 'true' / 'on' / 'yes' enables them. */
function isFeatureOn(raw: string | null | undefined): boolean {
  if (raw == null) return false
  const text = String(raw).trim().toLowerCase()
  return text === '1' || text === 'true' || text === 'on' || text === 'yes'
}
