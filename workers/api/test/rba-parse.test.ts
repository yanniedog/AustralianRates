import { describe, expect, it } from 'vitest'
import { parseCsvLines, parseHtmlDecisions } from '../src/ingest/rba'

describe('RBA CSV parser', () => {
  it('ignores non-finite and non-positive cash rates', () => {
    const csv = [
      'Date,Cash Rate Target',
      '03-Mar-2026,3.85',
      '04-Mar-2026,0',
      '05-Mar-2026,-0.10',
      '06-Mar-2026,NaN',
    ].join('\n')

    const points = parseCsvLines(csv)

    expect(points).toEqual([
      {
        date: '2026-03-03',
        cashRate: 3.85,
      },
    ])
  })
})

describe('RBA HTML decisions parser', () => {
  function makeTable(rows: string): string {
    return `<table id="datatable"><tbody>${rows}</tbody></table>`
  }

  function makeRow(date: string, change: string, rate: string): string {
    return `<tr><th scope="row">${date}</th><td>${change}</td><td>${rate}</td><td class="links"><a href="#">Statement</a></td></tr>`
  }

  it('parses a standard decisions table', () => {
    const html = makeTable(
      makeRow('18 Mar 2026', '+0.25', '4.10') +
      makeRow('4 Feb 2025', '-0.25', '4.10') +
      makeRow('7 Nov 2023', '-0.25', '4.35'),
    )
    const points = parseHtmlDecisions(html)
    expect(points).toEqual([
      { date: '2026-03-18', cashRate: 4.10 },
      { date: '2025-02-04', cashRate: 4.10 },
      { date: '2023-11-07', cashRate: 4.35 },
    ])
  })

  it('handles single-digit day without leading zero', () => {
    const html = makeTable(makeRow('4 Feb 2025', '-0.25', '4.10'))
    const points = parseHtmlDecisions(html)
    expect(points).toEqual([{ date: '2025-02-04', cashRate: 4.10 }])
  })

  it('ignores rows with no valid date in th[scope="row"]', () => {
    const html = makeTable(
      '<tr><td>Not a date</td><td>+0.25</td><td>4.10</td></tr>' +
      makeRow('18 Mar 2026', '+0.25', '4.10'),
    )
    const points = parseHtmlDecisions(html)
    expect(points).toHaveLength(1)
    expect(points[0].date).toBe('2026-03-18')
  })

  it('ignores rows with zero or negative rates', () => {
    const html = makeTable(
      makeRow('18 Mar 2026', '+0.25', '0') +
      makeRow('4 Feb 2025', '-0.25', '-0.10') +
      makeRow('7 Nov 2023', '-0.25', '4.35'),
    )
    const points = parseHtmlDecisions(html)
    expect(points).toEqual([{ date: '2023-11-07', cashRate: 4.35 }])
  })

  it('ignores rows with fewer than two td elements', () => {
    const html = makeTable(
      `<tr><th scope="row">18 Mar 2026</th><td>+0.25</td></tr>` +
      makeRow('7 Nov 2023', '-0.25', '4.35'),
    )
    const points = parseHtmlDecisions(html)
    expect(points).toEqual([{ date: '2023-11-07', cashRate: 4.35 }])
  })

  it('returns empty array when no tbody is present', () => {
    expect(parseHtmlDecisions('<table><tr><td>no tbody</td></tr></table>')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseHtmlDecisions('')).toEqual([])
  })
})
