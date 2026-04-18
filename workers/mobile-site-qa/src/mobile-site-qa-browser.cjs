'use strict'

function refreshMobileNavInPage() {
  window.dispatchEvent(new Event('resize'))
}

/**
 * In-page checks for narrow viewports: viewport meta, touch targets, chart workspace.
 * Serialized by Playwright from plain CJS (no tsx __name).
 * @param {{ workspace: boolean, phase: 'chart' }} opts
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
    for (const id of ['tab-chart']) {
      const tab = document.getElementById(id)
      if (!tab || !isVisible(tab)) continue
      const r = tab.getBoundingClientRect()
      if (r.width < 32 || r.height < 32) {
        failures.push(`workspace tab #${id} touch target small (${Math.round(r.width)}x${Math.round(r.height)})`)
      }
    }
  }

  return { failures, warnings }
}

module.exports = {
  mobileSiteQaInPage,
  refreshMobileNavInPage,
}
