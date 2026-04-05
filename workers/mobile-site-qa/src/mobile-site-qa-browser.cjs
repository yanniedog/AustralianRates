'use strict'

function refreshMobileNavInPage() {
  window.dispatchEvent(new Event('resize'))
  const ar = window.AR
  if (ar && ar.mobileTableNav && typeof ar.mobileTableNav.refresh === 'function') {
    ar.mobileTableNav.refresh()
  }
}

/**
 * In-page checks for narrow viewports: viewport meta, touch targets, explorer rail.
 * Serialized by Playwright from plain CJS (no tsx __name).
 * @param {{ workspace: boolean, phase: 'chart' | 'explorer' }} opts
 * @returns {{ failures: string[], warnings: string[] }}
 */
function mobileSiteQaInPage(opts) {
  const workspace = !!opts.workspace
  const phase = opts.phase || 'chart'
  const failures = []
  const warnings = []

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false
    if (el.getAttribute('hidden') !== null) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }

  const vpMeta = document.querySelector('meta[name="viewport"]')
  const vpContent = String(vpMeta?.getAttribute('content') || '')
  if (!vpMeta || !/width\s*=\s*device-width/i.test(vpContent)) {
    failures.push('viewport meta missing or not device-width')
  }

  const menu = document.querySelector('#site-menu-toggle')
  const help = document.querySelector('#site-help-btn')
  if (!menu || !isVisible(menu)) failures.push('mobile menu toggle missing or not visible')
  else {
    const r = menu.getBoundingClientRect()
    if (r.width < 36 || r.height < 36) failures.push(`menu toggle touch target small (${Math.round(r.width)}x${Math.round(r.height)})`)
  }
  if (!help || !isVisible(help)) failures.push('site help control missing or not visible')
  else {
    const r = help.getBoundingClientRect()
    if (r.width < 36 || r.height < 36) failures.push(`help control touch target small (${Math.round(r.width)}x${Math.round(r.height)})`)
  }

  if (workspace && phase === 'chart') {
    for (const id of ['tab-chart', 'tab-explorer', 'tab-pivot']) {
      const tab = document.getElementById(id)
      if (!tab || !isVisible(tab)) continue
      const r = tab.getBoundingClientRect()
      if (r.width < 32 || r.height < 32) {
        failures.push(`workspace tab #${id} touch target small (${Math.round(r.width)}x${Math.round(r.height)})`)
      }
    }
  }

  if (workspace && phase === 'explorer') {
    const explorer = document.getElementById('panel-explorer')
    const rail = document.getElementById('mobile-table-rail')
    const rows = document.querySelectorAll('#rate-table .tabulator-row').length
    const explorerActive = !!(explorer && !explorer.hidden && explorer.classList.contains('active'))
    if (!explorerActive) {
      failures.push('explorer panel not active for mobile rail check')
    } else if (rows === 0) {
      warnings.push('no table rows; skipping mobile rail visibility assertion')
    } else if (!rail) {
      failures.push('mobile-table-rail missing while explorer has rows')
    } else if (rail.hidden) {
      failures.push('mobile-table-rail hidden while explorer active with rows')
    } else {
      const rr = rail.getBoundingClientRect()
      if (rr.left < -2 || rr.right > window.innerWidth + 2) {
        failures.push('mobile-table-rail clipped horizontally')
      }
    }
  }

  return { failures, warnings }
}

module.exports = {
  mobileSiteQaInPage,
  refreshMobileNavInPage,
}
