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
    expect(html).toContain('RBA Watchlist')
    expect(html).toContain('id="chart"')
    expect(html).toContain('id="scenario"')
    expect(html).toContain('id="details"')
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
    expect(js).toContain('clientLog')
    expect(js).toContain("apiBase + '/debug-log'")
    expect(js).toContain('ar.economicData =')
    expect(js).toContain("window.addEventListener('unhandledrejection'")
  })
})
