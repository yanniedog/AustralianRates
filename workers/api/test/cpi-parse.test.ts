import { describe, expect, it } from 'vitest'
import { parseCpiCsv, parseMeasuresCpiHtml } from '../src/ingest/cpi'

describe('parseCpiCsv', () => {
  it('extracts All groups CPI by Title row column detection', () => {
    const csv = [
      'Series ID,GCPIAG,GCPIAGSSTE',
      'Title,All groups CPI,All groups CPI (seasonally adjusted)',
      'Description,,,',
      '',
      'Mar-2025,2.40,2.30',
      'Jun-2025,2.10,2.00',
    ].join('\n')

    const points = parseCpiCsv(csv)
    expect(points).toEqual([
      { quarterDate: '2025-01-01', annualChange: 2.4 },
      { quarterDate: '2025-04-01', annualChange: 2.1 },
    ])
  })

  it('defaults to column index 1 when Title row is absent', () => {
    const csv = ['Mar-2025,2.40,2.30', 'Jun-2025,2.10,2.00'].join('\n')
    const points = parseCpiCsv(csv)
    expect(points).toEqual([
      { quarterDate: '2025-01-01', annualChange: 2.4 },
      { quarterDate: '2025-04-01', annualChange: 2.1 },
    ])
  })

  it('skips non-finite values', () => {
    const csv = ['Mar-2025,NaN', 'Jun-2025,2.10'].join('\n')
    const points = parseCpiCsv(csv)
    expect(points).toEqual([{ quarterDate: '2025-04-01', annualChange: 2.1 }])
  })

  it('maps all four quarter labels to correct quarter-start dates', () => {
    const csv = ['Mar-2025,1', 'Jun-2025,2', 'Sep-2025,3', 'Dec-2025,4'].join('\n')
    const points = parseCpiCsv(csv)
    expect(points.map((p) => p.quarterDate)).toEqual([
      '2025-01-01',
      '2025-04-01',
      '2025-07-01',
      '2025-10-01',
    ])
  })
})

describe('parseMeasuresCpiHtml', () => {
  function makeYearEndedTable(rows: string): string {
    return `
      <table class="table-linear table-numeric width100">
        <caption>CPI, Year-ended percentage change</caption>
        <tbody>${rows}</tbody>
      </table>`
  }

  function yearHeader(fiscalYear: string, cols = 5): string {
    return `<tr class="tr-head"><th colspan="${cols}">${fiscalYear}</th></tr>`
  }

  function dataRow(quarter: string, allGroups: string | number, ...rest: (string | number)[]): string {
    const extra = rest.map((v) => `<td>${v}</td>`).join('')
    return `<tr><th>${quarter}</th><td>${allGroups}</td>${extra}</tr>`
  }

  it('parses a full fiscal year of quarterly data', () => {
    const html = makeYearEndedTable(
      yearHeader('2025/2026') +
        dataRow('Sep', 3.2, 3.4, 2.9, 3.0) +
        dataRow('Dec', 3.6, 3.8, 3.2, 3.4),
    )
    const points = parseMeasuresCpiHtml(html)
    expect(points).toEqual([
      { quarterDate: '2025-07-01', annualChange: 3.2 },
      { quarterDate: '2025-10-01', annualChange: 3.6 },
    ])
  })

  it('assigns Sep/Dec to first fiscal year and Mar/Jun to second', () => {
    const html = makeYearEndedTable(
      yearHeader('2024/2025') +
        dataRow('Sep', 2.9) +
        dataRow('Dec', 2.4) +
        dataRow('Mar', 2.4) +
        dataRow('Jun', 2.1),
    )
    const points = parseMeasuresCpiHtml(html)
    expect(points.map((p) => p.quarterDate)).toEqual([
      '2024-07-01', // Sep → first year 2024
      '2024-10-01', // Dec → first year 2024
      '2025-01-01', // Mar → second year 2025
      '2025-04-01', // Jun → second year 2025
    ])
  })

  it('spans multiple fiscal years correctly', () => {
    const html = makeYearEndedTable(
      yearHeader('2023/2024') +
        dataRow('Sep', 5.3) +
        dataRow('Dec', 4.1) +
        yearHeader('2024/2025') +
        dataRow('Sep', 2.9) +
        dataRow('Dec', 2.4),
    )
    const points = parseMeasuresCpiHtml(html)
    expect(points.map((p) => p.quarterDate)).toEqual([
      '2023-07-01',
      '2023-10-01',
      '2024-07-01',
      '2024-10-01',
    ])
  })

  it('uses only the first <td> (All groups) and ignores other columns', () => {
    const html = makeYearEndedTable(yearHeader('2025/2026') + dataRow('Sep', 3.2, 99, 99, 99))
    const points = parseMeasuresCpiHtml(html)
    expect(points).toEqual([{ quarterDate: '2025-07-01', annualChange: 3.2 }])
  })

  it('skips rows with non-finite rate values', () => {
    const html = makeYearEndedTable(
      yearHeader('2025/2026') + dataRow('Sep', 'NaN') + dataRow('Dec', 3.6),
    )
    const points = parseMeasuresCpiHtml(html)
    expect(points).toEqual([{ quarterDate: '2025-10-01', annualChange: 3.6 }])
  })

  it('skips data rows that appear before any fiscal year header', () => {
    const html = makeYearEndedTable(
      dataRow('Sep', 3.2) + yearHeader('2025/2026') + dataRow('Dec', 3.6),
    )
    const points = parseMeasuresCpiHtml(html)
    expect(points).toEqual([{ quarterDate: '2025-10-01', annualChange: 3.6 }])
  })

  it('returns empty array when caption is absent', () => {
    const html = '<table><tbody><tr><th>Sep</th><td>3.2</td></tr></tbody></table>'
    expect(parseMeasuresCpiHtml(html)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseMeasuresCpiHtml('')).toEqual([])
  })
})
