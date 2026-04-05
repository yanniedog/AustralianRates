'use strict'

/**
 * Runs in the browser via Playwright page.evaluate (serialized from plain JS — no tsx __name).
 * @param {boolean} workspace
 * @returns {{ failures: string[], warnings: string[] }}
 */
module.exports = function layoutDisplayIntegrityInPage(workspace) {
  const failures = []
  const warnings = []
  const vw = window.innerWidth
  const vh = window.innerHeight
  const root = document.documentElement

  const chartPanel = document.getElementById('panel-chart')
  const chartPanelActive = !!(chartPanel && !chartPanel.hidden && chartPanel.classList.contains('active'))

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false
    if (el.getAttribute('hidden') !== null) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }

  if (root.scrollWidth > vw + 2) {
    failures.push(`document horizontal overflow (scrollWidth ${root.scrollWidth} > ${vw})`)
  }

  const landmarks = workspace
    ? ['.site-header', '#main-content', '.market-terminal', '#chart-output', '#rate-table', '.site-footer']
    : ['.site-header', '#main-content', '.site-footer', '.content-page']

  for (const sel of landmarks) {
    const el = document.querySelector(sel)
    if (!el || !isVisible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.left < -2 || r.right > vw + 2) {
      failures.push(
        `landmark clipped horizontally: ${sel} (left=${r.left.toFixed(0)} right=${r.right.toFixed(0)} vw=${vw})`,
      )
    }
    if (r.top < -2 && r.bottom > 4) {
      failures.push(`landmark clipped at top: ${sel}`)
    }
  }

  const tabSelectors = workspace ? ['#tab-chart', '#tab-explorer', '#tab-pivot'] : []
  for (const sel of tabSelectors) {
    const el = document.querySelector(sel)
    if (!el || !isVisible(el)) continue
    const r = el.getBoundingClientRect()
    const x = r.left + Math.min(14, Math.max(4, r.width / 2))
    const y = r.top + Math.min(14, Math.max(4, r.height / 2))
    const hit = document.elementFromPoint(x, y)
    if (!hit || (!el.contains(hit) && !hit.contains(el))) {
      failures.push(`control appears covered (hit-test): ${sel}`)
    }
  }

  const textRoots = workspace
    ? '#main-content .tab-btn, #main-content .site-header-segment-link, .terminal-stat, #chart-summary, .market-intro-title, #explorer-overview-title, #filter-live-status'
    : '#main-content h1, #main-content h2, #main-content p, #main-content a, .content-page'

  document.querySelectorAll(textRoots).forEach((node) => {
    if (!isVisible(node)) return
    const text = String(node.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 2) return
    const cs = window.getComputedStyle(node)
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll') return
    const lineClamp = cs.webkitLineClamp
    if (lineClamp && lineClamp !== 'none' && Number(lineClamp) > 0) return
    if (cs.textOverflow === 'ellipsis' || cs.textOverflow === 'fade') return
    const hiddenOverflow =
      cs.overflow === 'hidden' ||
      cs.overflow === 'clip' ||
      cs.overflowX === 'hidden' ||
      cs.overflowY === 'hidden'
    if (hiddenOverflow) {
      if (node.scrollWidth > node.clientWidth + 3) {
        failures.push(`text clipped (overflow hidden, width): <${node.tagName.toLowerCase()}> "${text.slice(0, 48)}..."`)
      }
      if (node.scrollHeight > node.clientHeight + 4 && !/textarea|input/i.test(node.tagName)) {
        failures.push(`text clipped (overflow hidden, height): <${node.tagName.toLowerCase()}> "${text.slice(0, 48)}..."`)
      }
    }
  })

  document.querySelectorAll('#main-content img').forEach((img) => {
    if (!isVisible(img)) return
    if (!img.complete) return
    if (img.naturalWidth === 0 && img.naturalHeight === 0) {
      failures.push(`broken image in main: ${img.getAttribute('src') || img.alt || 'no-src'}`)
    }
  })

  if (workspace && chartPanelActive) {
    const out = document.getElementById('chart-output')
    if (out && isVisible(out)) {
      const canvas = out.querySelector('canvas')
      const svg = out.querySelector('svg')
      let w = 0
      let h = 0
      if (canvas) {
        w = canvas.width
        h = canvas.height
      } else if (svg) {
        const br = svg.getBoundingClientRect()
        w = br.width
        h = br.height
      }
      const engine = out.getAttribute('data-chart-engine') || ''
      if ((engine === 'echarts' || engine === 'lightweight' || canvas || svg) && (w < 48 || h < 48)) {
        failures.push(`chart surface too small (${Math.round(w)}x${Math.round(h)}) with engine=${engine || 'unknown'}`)
      }
    }
  }

  const header = document.querySelector('.site-header')
  const main = document.getElementById('main-content')
  if (header && main && isVisible(header)) {
    const hs = window.getComputedStyle(header)
    if (hs.position === 'fixed' || hs.position === 'sticky') {
      const hr = header.getBoundingClientRect()
      const probeX = Math.min(vw - 8, Math.max(8, vw / 2))
      const probeY = Math.min(vh - 8, Math.max(hr.bottom + 3, 8))
      const hhit = document.elementFromPoint(probeX, probeY)
      if (hhit && header.contains(hhit) && probeY > hr.bottom - 2) {
        failures.push('fixed/sticky header still captures hit-tests immediately below header band')
      }
    }
  }

  if (workspace) {
    const rows = document.querySelectorAll('#rate-table .tabulator-row').length
    if (rows === 0) {
      warnings.push('no tabulator rows; table-specific clipping not fully exercised')
    }
  }

  const maxReport = 35
  const extra = failures.length - maxReport
  const trimmed = failures.slice(0, maxReport)
  if (extra > 0) trimmed.push(`...and ${extra} more failure(s)`)

  return { failures: trimmed, warnings }
}
