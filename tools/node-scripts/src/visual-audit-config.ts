import type { AuditRoute, AuditState, ViewportKey } from './visual-audit-types'

export const DEFAULT_TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/'
export const CURRENT_ORIGIN = new URL(DEFAULT_TEST_URL).origin
export const BASELINE_COMMIT = process.env.VISUAL_AUDIT_BASELINE_COMMIT || '091cff0'

export const VIEWPORTS: Record<ViewportKey, { width: number; height: number; isMobile?: boolean; hasTouch?: boolean }> = {
  desktop: { width: 1440, height: 1200 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
}

export const DATA_ROUTES: AuditRoute[] = [
  { key: 'home-loans', label: 'Home loans', path: '/', kind: 'data' },
  { key: 'savings', label: 'Savings', path: '/savings/', kind: 'data' },
  { key: 'term-deposits', label: 'Term deposits', path: '/term-deposits/', kind: 'data' },
]

export const LEGAL_ROUTES: AuditRoute[] = [
  { key: 'about', label: 'About', path: '/about/', kind: 'legal' },
  { key: 'privacy', label: 'Privacy', path: '/privacy/', kind: 'legal' },
  { key: 'terms', label: 'Terms', path: '/terms/', kind: 'legal' },
  { key: 'contact', label: 'Contact', path: '/contact/', kind: 'legal' },
]

export const ADMIN_LOGIN_ROUTE: AuditRoute = {
  key: 'admin-login',
  label: 'Admin login',
  path: '/admin/',
  kind: 'admin-login',
}

export const ADMIN_GUARD_PATHS = ['dashboard', 'status', 'database', 'clear', 'config', 'runs', 'logs']

export const DESKTOP_DATA_STATES: AuditState[] = [
  { key: 'rates-full', label: 'Rates full', viewportKey: 'desktop', screenshotName: 'desktop-rates-full.png', pairWithBaseline: true },
  {
    key: 'analyst-advanced-full',
    label: 'Analyst advanced full',
    viewportKey: 'desktop',
    screenshotName: 'desktop-analyst-advanced-full.png',
    pairWithBaseline: true,
  },
  {
    key: 'table-settings-open',
    label: 'Table settings open',
    viewportKey: 'desktop',
    screenshotName: 'desktop-table-settings-open.png',
    pairWithBaseline: true,
  },
  { key: 'pivot-full', label: 'Pivot full', viewportKey: 'desktop', screenshotName: 'desktop-pivot-full.png', pairWithBaseline: true },
  {
    key: 'chart-default-report',
    label: 'Chart default report',
    viewportKey: 'desktop',
    screenshotName: 'desktop-chart-default-report.png',
    pairWithBaseline: true,
  },
  {
    key: 'chart-term-extra',
    label: 'Chart term deposit extra view',
    viewportKey: 'desktop',
    screenshotName: 'desktop-chart-term-extra.png',
    pairWithBaseline: true,
  },
  {
    key: 'market-notes-open',
    label: 'Market notes open',
    viewportKey: 'desktop',
    screenshotName: 'desktop-market-notes-open.png',
    pairWithBaseline: true,
  },
  {
    key: 'footer-technical-open',
    label: 'Footer technical open',
    viewportKey: 'desktop',
    screenshotName: 'desktop-footer-technical-open.png',
    pairWithBaseline: true,
  },
]

export const RESPONSIVE_DATA_STATES: AuditState[] = [
  { key: 'rates-full', label: 'Rates full', viewportKey: 'tablet', screenshotName: 'tablet-rates-full.png', pairWithBaseline: true },
  { key: 'pivot-full', label: 'Pivot full', viewportKey: 'tablet', screenshotName: 'tablet-pivot-full.png', pairWithBaseline: true },
  { key: 'chart-default-report', label: 'Chart default report', viewportKey: 'tablet', screenshotName: 'tablet-chart-default-report.png', pairWithBaseline: true },
  { key: 'rates-full', label: 'Rates full', viewportKey: 'mobile', screenshotName: 'mobile-rates-full.png', pairWithBaseline: true },
  { key: 'pivot-full', label: 'Pivot full', viewportKey: 'mobile', screenshotName: 'mobile-pivot-full.png', pairWithBaseline: true },
  { key: 'chart-default-report', label: 'Chart default report', viewportKey: 'mobile', screenshotName: 'mobile-chart-default-report.png', pairWithBaseline: true },
]

export const LEGAL_STATES: AuditState[] = [
  { key: 'legal-full', label: 'Legal full', viewportKey: 'desktop', screenshotName: 'desktop-full.png', pairWithBaseline: true },
  { key: 'legal-full', label: 'Legal full', viewportKey: 'mobile', screenshotName: 'mobile-full.png', pairWithBaseline: true },
]

export const ADMIN_LOGIN_STATES: AuditState[] = [
  { key: 'admin-login-full', label: 'Admin login full', viewportKey: 'desktop', screenshotName: 'desktop-full.png', pairWithBaseline: false },
  { key: 'admin-login-full', label: 'Admin login full', viewportKey: 'mobile', screenshotName: 'mobile-full.png', pairWithBaseline: false },
]

export const GEOMETRY_SELECTORS = [
  '.site-header',
  '#main-content',
  '.hero',
  '.workspace',
  '.workspace-rail',
  '#workspace-summary-panel',
  '#scenario',
  '#rate-table-details',
  '#rate-table',
  '#panel-pivot .panel',
  '#pivot-output',
  '#panel-charts .panel',
  '#chart-output',
  '#chart-point-details',
  '#chart-data-summary',
  '#market-notes',
  '#footer-technical',
  '.site-footer',
  '.content-page',
  '.admin-login-card',
]

export const BASE_CLICK_TARGETS = ['#tab-explorer', '#tab-pivot', '#tab-charts']
export const EXPLORER_CLICK_TARGETS = ['#apply-filters', '#download-format']
export const ANALYST_CLICK_TARGETS = ['#mode-analyst', '#table-settings-btn']
export const PIVOT_CLICK_TARGETS = ['#load-pivot']
export const CHART_CLICK_TARGETS = ['#draw-chart', '[data-chart-view="timeRibbon"]', '[data-chart-view="tdTermTime"]']
