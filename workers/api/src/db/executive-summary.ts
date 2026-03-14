import {
  queryHomeLoanRateChangesForWindow,
  querySavingsRateChangesForWindow,
  queryTdRateChangesForWindow,
  type HomeLoanRateChangeRow,
  type SavingsRateChangeRow,
  type TdRateChangeRow,
} from './rate-change-log'

export type ExecutiveSummaryExample = {
  bank_name: string
  product_name: string
  product_key: string
  collection_date: string
  previous_collection_date: string | null
  previous_rate: number
  new_rate: number
  delta_bps: number
  descriptor: string
}

export type ExecutiveSummarySection = {
  dataset: 'home_loans' | 'savings' | 'term_deposits'
  title: 'Home Loans' | 'Savings' | 'Term Deposits'
  window_days: number
  window_start: string
  window_end: string
  partial: boolean
  metrics: {
    total_changes: number
    lender_coverage: number
    up_count: number
    down_count: number
    unchanged_count: number
    mean_move_bps: number | null
    median_move_bps: number | null
  }
  concentration: {
    top_lender: { bank_name: string; change_count: number; share_pct: number } | null
    top_lenders: Array<{ bank_name: string; change_count: number; share_pct: number }>
    top3_share_pct: number
  }
  standouts: {
    largest_increase: ExecutiveSummaryExample | null
    largest_decrease: ExecutiveSummaryExample | null
  }
  narrative: string
}

export type ExecutiveSummaryReport = {
  generated_at: string
  window_days: number
  sections: [ExecutiveSummarySection, ExecutiveSummarySection, ExecutiveSummarySection]
}

type GenericChangeRow = HomeLoanRateChangeRow | SavingsRateChangeRow | TdRateChangeRow

type DatasetDescriptor = {
  dataset: ExecutiveSummarySection['dataset']
  title: ExecutiveSummarySection['title']
}

const SUMMARY_LIMIT = 50000
const FIXED_WINDOW_DAYS = 30

function normalizeWindowDays(inputWindowDays: number | undefined): number {
  const requested = Number(inputWindowDays)
  if (!Number.isFinite(requested)) return FIXED_WINDOW_DAYS
  return FIXED_WINDOW_DAYS
}

function toYmd(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function windowStartDate(windowDays: number): string {
  const now = Date.now()
  const daysBack = Math.max(0, windowDays - 1)
  const start = new Date(now - daysBack * 24 * 60 * 60 * 1000)
  return toYmd(start)
}

function round(value: number | null, decimals = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((acc, value) => acc + value, 0)
  return sum / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function toChangeExample(row: GenericChangeRow, descriptor: DatasetDescriptor): ExecutiveSummaryExample {
  return {
    bank_name: String(row.bank_name || ''),
    product_name: String(row.product_name || ''),
    product_key: String(row.product_key || ''),
    collection_date: String(row.collection_date || ''),
    previous_collection_date: row.previous_collection_date == null ? null : String(row.previous_collection_date),
    previous_rate: Number(row.previous_rate ?? 0),
    new_rate: Number(row.new_rate ?? 0),
    delta_bps: Number(row.delta_bps ?? 0),
    descriptor: describeRow(row, descriptor.dataset),
  }
}

function describeRow(row: GenericChangeRow, dataset: ExecutiveSummarySection['dataset']): string {
  if (dataset === 'home_loans') {
    const homeLoan = row as HomeLoanRateChangeRow
    return [homeLoan.security_purpose, homeLoan.repayment_type, homeLoan.lvr_tier, homeLoan.rate_structure].filter(Boolean).join(' | ')
  }
  if (dataset === 'savings') {
    const savings = row as SavingsRateChangeRow
    return [savings.account_type, savings.rate_type, savings.deposit_tier].filter(Boolean).join(' | ')
  }
  const td = row as TdRateChangeRow
  return [String(td.term_months ?? ''), td.deposit_tier, td.interest_payment].filter(Boolean).join(' | ')
}

function formatChangeWindow(example: ExecutiveSummaryExample): string {
  const current = String(example.collection_date || '').trim()
  const previous = String(example.previous_collection_date || '').trim()
  if (previous && current && previous > current) return `${current} -> ${previous}`
  if (previous && previous !== current) return `${previous} -> ${current}`
  if (current) return `through ${current}`
  return 'date unavailable'
}

function buildNarrative(
  descriptor: DatasetDescriptor,
  windowDays: number,
  totalChanges: number,
  lenderCoverage: number,
  upCount: number,
  downCount: number,
  meanMove: number | null,
  medianMove: number | null,
  topLender: ExecutiveSummarySection['concentration']['top_lender'],
  increase: ExecutiveSummaryExample | null,
  decrease: ExecutiveSummaryExample | null,
  partial: boolean,
  windowStart: string,
  windowEnd: string,
): string {
  if (totalChanges === 0) {
    return `No verified ${descriptor.title.toLowerCase()} rate changes were detected through ${windowEnd} in the last ${windowDays} days.`
  }

  const directionSentence = `${upCount} increases versus ${downCount} decreases were observed across ${lenderCoverage} lenders.`
  const moveSentence =
    meanMove == null || medianMove == null
      ? 'Average and median moves are unavailable for this window.'
      : `Average move was ${round(meanMove, 2)} bps and median move was ${round(medianMove, 2)} bps.`
  const concentrationSentence = topLender
    ? `${topLender.bank_name} accounted for ${topLender.change_count} changes (${topLender.share_pct}% of tracked moves).`
    : 'No single lender concentration signal is available.'
  const standoutParts: string[] = []
  if (increase) {
    standoutParts.push(
      `Largest increase: ${increase.bank_name} ${increase.product_name} (${round(increase.delta_bps, 2)} bps, ${formatChangeWindow(increase)}).`,
    )
  }
  if (decrease) {
    standoutParts.push(
      `Largest decrease: ${decrease.bank_name} ${decrease.product_name} (${round(decrease.delta_bps, 2)} bps, ${formatChangeWindow(decrease)}).`,
    )
  }
  if (standoutParts.length === 0) {
    standoutParts.push('No standout increase/decrease examples were found.')
  }
  const partialSentence = partial ? 'Metrics are based on a bounded sample window due to high change volume.' : ''
  return `${totalChanges} ${descriptor.title.toLowerCase()} changes were tracked from ${windowStart} through ${windowEnd}. ${directionSentence} ${moveSentence} ${concentrationSentence} ${standoutParts.join(' ')} ${partialSentence}`.trim()
}

function buildSection(
  descriptor: DatasetDescriptor,
  rows: GenericChangeRow[],
  totalChanges: number,
  windowDays: number,
  windowStart: string,
  windowEnd: string,
): ExecutiveSummarySection {
  const deltas = rows
    .map((row) => Number(row.delta_bps))
    .filter((value) => Number.isFinite(value))
  const upRows = rows.filter((row) => Number(row.delta_bps) > 0)
  const downRows = rows.filter((row) => Number(row.delta_bps) < 0)
  const unchangedRows = rows.filter((row) => Number(row.delta_bps) === 0)

  const lenderCounts = new Map<string, number>()
  for (const row of rows) {
    const lender = String(row.bank_name || '').trim()
    if (!lender) continue
    lenderCounts.set(lender, (lenderCounts.get(lender) ?? 0) + 1)
  }
  const lenderCoverage = lenderCounts.size
  const sortedLenders = [...lenderCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([bankName, count]) => ({
      bank_name: bankName,
      change_count: count,
      share_pct: totalChanges > 0 ? round((count / totalChanges) * 100, 1) ?? 0 : 0,
    }))

  const topLender = sortedLenders.length > 0 ? sortedLenders[0] : null
  const top3Share = sortedLenders.slice(0, 3).reduce((acc, lender) => acc + lender.share_pct, 0)
  const partial = totalChanges > rows.length

  let largestIncrease: GenericChangeRow | null = null
  let largestDecrease: GenericChangeRow | null = null
  for (const row of rows) {
    const delta = Number(row.delta_bps)
    if (!Number.isFinite(delta)) continue
    if (delta > 0 && (!largestIncrease || delta > Number(largestIncrease.delta_bps))) largestIncrease = row
    if (delta < 0 && (!largestDecrease || delta < Number(largestDecrease.delta_bps))) largestDecrease = row
  }

  const meanMove = round(mean(deltas), 2)
  const medianMove = round(median(deltas), 2)
  const increaseExample = largestIncrease ? toChangeExample(largestIncrease, descriptor) : null
  const decreaseExample = largestDecrease ? toChangeExample(largestDecrease, descriptor) : null

  return {
    dataset: descriptor.dataset,
    title: descriptor.title,
    window_days: windowDays,
    window_start: windowStart,
    window_end: windowEnd,
    partial,
    metrics: {
      total_changes: totalChanges,
      lender_coverage: lenderCoverage,
      up_count: upRows.length,
      down_count: downRows.length,
      unchanged_count: unchangedRows.length,
      mean_move_bps: meanMove,
      median_move_bps: medianMove,
    },
    concentration: {
      top_lender: topLender,
      top_lenders: sortedLenders.slice(0, 5),
      top3_share_pct: round(top3Share, 1) ?? 0,
    },
    standouts: {
      largest_increase: increaseExample,
      largest_decrease: decreaseExample,
    },
    narrative: buildNarrative(
      descriptor,
      windowDays,
      totalChanges,
      lenderCoverage,
      upRows.length,
      downRows.length,
      meanMove,
      medianMove,
      topLender,
      increaseExample,
      decreaseExample,
      partial,
      windowStart,
      windowEnd,
    ),
  }
}

export async function queryExecutiveSummaryReport(
  db: D1Database,
  input?: { windowDays?: number },
): Promise<ExecutiveSummaryReport> {
  const windowDays = normalizeWindowDays(input?.windowDays)
  const startDate = windowStartDate(windowDays)
  const endDate = toYmd(new Date())

  const [homeLoans, savings, termDeposits] = await Promise.all([
    queryHomeLoanRateChangesForWindow(db, {
      windowStartDate: startDate,
      limit: SUMMARY_LIMIT,
      offset: 0,
    }),
    querySavingsRateChangesForWindow(db, {
      windowStartDate: startDate,
      limit: SUMMARY_LIMIT,
      offset: 0,
    }),
    queryTdRateChangesForWindow(db, {
      windowStartDate: startDate,
      limit: SUMMARY_LIMIT,
      offset: 0,
    }),
  ])

  const homeSection = buildSection(
    { dataset: 'home_loans', title: 'Home Loans' },
    homeLoans.rows,
    homeLoans.total,
    windowDays,
    startDate,
    endDate,
  )
  const savingsSection = buildSection(
    { dataset: 'savings', title: 'Savings' },
    savings.rows,
    savings.total,
    windowDays,
    startDate,
    endDate,
  )
  const tdSection = buildSection(
    { dataset: 'term_deposits', title: 'Term Deposits' },
    termDeposits.rows,
    termDeposits.total,
    windowDays,
    startDate,
    endDate,
  )

  return {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    sections: [homeSection, savingsSection, tdSection],
  }
}
