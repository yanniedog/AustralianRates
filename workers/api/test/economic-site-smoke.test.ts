import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function siteFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), '..', '..', 'site', relativePath), 'utf8')
}

describe('economic site smoke', () => {
  it('adds economic data links to public shells', () => {
    expect(siteFile('index.html')).toContain('/economic-data/')
    expect(siteFile('savings/index.html')).toContain('/economic-data/')
    expect(siteFile('term-deposits/index.html')).toContain('/economic-data/')
    expect(siteFile('404.html')).toContain('/economic-data/')
  })

  it('ships the dedicated economic dashboard page with expected anchors and preset text', () => {
    const html = siteFile('economic-data/index.html')
    expect(html).toContain('data-ar-section="economic-data"')
    expect(html).toContain('RBA Signal Dashboard')
    expect(html).toContain('id="chart"')
    expect(html).toContain('id="scenario"')
    expect(html).toContain('id="economic-signal-bias"')
    expect(html).toContain('id="economic-chart-mode-row"')
    expect(html).toContain('id="economic-component-body"')
    expect(html).toContain('id="economic-series-list"')
    expect(html).toContain('id="economic-source-list"')
    expect(html).toContain('ar-chart-echarts-helpers.js')
  })

  it('wires economic section paths through shared shell files', () => {
    expect(siteFile('frame.js')).toContain("/economic-data/")
    expect(siteFile('frame.js')).toContain("#details")
    expect(siteFile('ar-section-config.js')).toContain("'economic-data'")
    expect(siteFile('ar-config.js')).toContain('/api/economic-data')
  })

  it('ships economic dashboard logging and debug hooks', () => {
    const js = siteFile('economic-data.js')
    const signalsJs = siteFile('economic-signals.js')
    expect(js).toContain('clientLog')
    expect(js).toContain("apiBase + '/debug-log'")
    expect(signalsJs).toContain("fetchJson('/signals')")
    expect(js).toContain("data-chart-mode")
    expect(js).toContain('ar.economicData =')
    expect(js).toContain("window.addEventListener('unhandledrejection'")
  })

  it('ships compact signal table and stale-source badge styles', () => {
    const css = siteFile('economic-data.css')
    expect(css).toContain('.economic-signal-strip')
    expect(css).toContain('.economic-component-table')
    expect(css).toContain('.economic-stale-chip')
  })
})
