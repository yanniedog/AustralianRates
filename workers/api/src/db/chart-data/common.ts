export type ChartEvent = {
  date: string
  type: 'RBA' | 'LENDER'
  label: string
  value?: number
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function assertChartDate(value: unknown, field: string): string {
  const text = String(value ?? '').trim()
  if (!isIsoDate(text)) throw new Error(`invalid_chart_date:${field}`)
  return text
}

export function assertChartRate(value: unknown, field: string): number {
  const rate = Number(value)
  if (!Number.isFinite(rate)) throw new Error(`invalid_chart_rate:${field}`)
  return rate
}

export async function queryRbaChartEvents(
  db: D1Database,
  startDate?: string,
  endDate?: string,
): Promise<ChartEvent[]> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (startDate) {
    where.push(`effective_date >= ?${binds.length + 1}`)
    binds.push(startDate)
  }
  if (endDate) {
    where.push(`effective_date <= ?${binds.length + 1}`)
    binds.push(endDate)
  }
  const result = await db
    .prepare(
      `SELECT effective_date, cash_rate
       FROM rba_cash_rates
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY effective_date
       ORDER BY effective_date ASC`,
    )
    .bind(...binds)
    .all<{ effective_date: string; cash_rate: number }>()

  return (result.results ?? []).map((row) => ({
    date: assertChartDate(row.effective_date, 'rba_effective_date'),
    type: 'RBA',
    label: `RBA cash rate ${Number(row.cash_rate).toFixed(2)}%`,
    value: assertChartRate(row.cash_rate, 'rba_cash_rate'),
  }))
}

export function sortChartEvents(events: ChartEvent[]): ChartEvent[] {
  return [...events].sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date)
    if (left.type !== right.type) return left.type.localeCompare(right.type)
    return left.label.localeCompare(right.label)
  })
}

export function formatRateChangeLabel(
  bankName: string,
  productName: string,
  changeJson: string,
  fallbackRate: number,
): { label: string; value?: number } {
  try {
    const parsed = JSON.parse(changeJson) as {
      interest_rate?: { from?: number | null; to?: number | null }
    }
    const from = parsed?.interest_rate?.from
    const to = parsed?.interest_rate?.to
    if (Number.isFinite(Number(from)) && Number.isFinite(Number(to))) {
      return {
        label: `${bankName} ${productName}: ${Number(from).toFixed(2)}% -> ${Number(to).toFixed(2)}%`,
        value: Number(to),
      }
    }
  } catch {}

  return {
    label: `${bankName} ${productName}: repriced to ${Number(fallbackRate).toFixed(2)}%`,
    value: Number(fallbackRate),
  }
}
