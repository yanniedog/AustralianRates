type QueryRow = Record<string, unknown>

export type DatasetKey = 'home_loans' | 'savings' | 'term_deposits'

export type DatasetMeta = {
  key: DatasetKey
  label: string
  table: string
  stateSignatureSql: string
}

export type DatasetCoverageDay = {
  collection_date: string
  status: 'full' | 'partial' | 'empty'
  banks_present: number
  total_banks: number
  missing_bank_count: number
  missing_banks: string[]
  total_rows: number
  total_series: number
  coverage_ratio: number
  overlapping_series_dates: number
  conflicting_series_dates: number
  exact_duplicate_series_dates: number
}

export type GapBankSummary = {
  bank_name: string
  missing_observed_dates: number
  observed_dates: number
  missing_ratio: number
  missing_dates: string[]
}

export type DatasetCoverageReport = {
  key: DatasetKey
  label: string
  total_banks: number
  total_dates_in_range: number
  observed_dates: number
  full_dates: string[]
  partial_dates: string[]
  empty_dates: string[]
  always_missing_on_observed_days: string[]
  recurring_gap_banks: GapBankSummary[]
  date_coverage: DatasetCoverageDay[]
}

export const DATASETS: DatasetMeta[] = [
  {
    key: 'home_loans',
    label: 'Home loans',
    table: 'historical_loan_rates',
    stateSignatureSql:
      "printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(comparison_rate,''), COALESCE(annual_fee,''))",
  },
  {
    key: 'savings',
    label: 'Savings',
    table: 'historical_savings_rates',
    stateSignatureSql:
      "printf('%s|%s|%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_balance,''), COALESCE(max_balance,''), COALESCE(monthly_fee,''), COALESCE(conditions,''))",
  },
  {
    key: 'term_deposits',
    label: 'Term deposits',
    table: 'historical_term_deposit_rates',
    stateSignatureSql:
      "printf('%s|%s|%s', COALESCE(interest_rate,''), COALESCE(min_deposit,''), COALESCE(max_deposit,''))",
  },
]

export type AuditReport = {
  ok: true
  phase: 'audit'
  generated_at: string
  target_db: string
  executed_commands: Array<{ label: string; command: string; exit_code: number }>
  retry: unknown[] | null
  dataset_stats: QueryRow[]
  dataset_coverage_state: QueryRow[]
  overlap_summary: QueryRow[]
  raw_backlog_by_source: QueryRow[]
  integrity: QueryRow[]
  datasets: DatasetCoverageReport[]
  canonical_rule_set: string[]
  recommendations: string[]
  sql_pack: Record<string, string>
}

function asText(value: unknown): string {
  return String(value ?? '').trim()
}

function asNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function addUtcDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() + days)
  return cursor.toISOString().slice(0, 10)
}

function listDateRange(minDate: string, maxDate: string): string[] {
  const dates: string[] = []
  let cursor = minDate
  while (cursor <= maxDate) {
    dates.push(cursor)
    cursor = addUtcDays(cursor, 1)
  }
  return dates
}

export function buildDatasetCoverageReport(
  dataset: DatasetMeta,
  datasetStatsRows: QueryRow[],
  bankRows: QueryRow[],
  presentRows: QueryRow[],
  overlapDateRows: QueryRow[],
  conflictDateRows: QueryRow[],
): DatasetCoverageReport {
  const stats = datasetStatsRows.find((row) => asText(row.dataset) === dataset.key)
  if (!stats) {
    return {
      key: dataset.key,
      label: dataset.label,
      total_banks: 0,
      total_dates_in_range: 0,
      observed_dates: 0,
      full_dates: [],
      partial_dates: [],
      empty_dates: [],
      always_missing_on_observed_days: [],
      recurring_gap_banks: [],
      date_coverage: [],
    }
  }

  const minDate = asText(stats.min_collection_date)
  const maxDate = asText(stats.max_collection_date)
  const allDates = minDate && maxDate ? listDateRange(minDate, maxDate) : []
  const banks = bankRows.map((row) => asText(row.bank_name)).filter(Boolean)
  const presentByDate = new Map<string, Map<string, { rows: number; series: number }>>()
  for (const row of presentRows) {
    const date = asText(row.collection_date)
    const bank = asText(row.bank_name)
    if (!date || !bank) continue
    const byBank = presentByDate.get(date) ?? new Map<string, { rows: number; series: number }>()
    byBank.set(bank, {
      rows: asNumber(row.row_count),
      series: asNumber(row.series_count),
    })
    presentByDate.set(date, byBank)
  }

  const overlapByDate = new Map<string, number>()
  for (const row of overlapDateRows.filter((item) => asText(item.dataset) === dataset.key)) {
    overlapByDate.set(asText(row.collection_date), asNumber(row.overlaps))
  }
  const conflictByDate = new Map<string, number>()
  for (const row of conflictDateRows.filter((item) => asText(item.dataset) === dataset.key)) {
    conflictByDate.set(asText(row.collection_date), asNumber(row.conflicts))
  }

  const dateCoverage = allDates.map<DatasetCoverageDay>((date) => {
    const byBank = presentByDate.get(date) ?? new Map<string, { rows: number; series: number }>()
    const presentBanks = [...byBank.keys()].sort((a, b) => a.localeCompare(b))
    const missingBanks = banks.filter((bank) => !byBank.has(bank))
    let totalRows = 0
    let totalSeries = 0
    for (const entry of byBank.values()) {
      totalRows += entry.rows
      totalSeries += entry.series
    }
    const overlaps = overlapByDate.get(date) ?? 0
    const conflicts = conflictByDate.get(date) ?? 0
    const status = presentBanks.length === 0 ? 'empty' : presentBanks.length === banks.length ? 'full' : 'partial'
    return {
      collection_date: date,
      status,
      banks_present: presentBanks.length,
      total_banks: banks.length,
      missing_bank_count: missingBanks.length,
      missing_banks: missingBanks,
      total_rows: totalRows,
      total_series: totalSeries,
      coverage_ratio: banks.length > 0 ? Number((presentBanks.length / banks.length).toFixed(4)) : 0,
      overlapping_series_dates: overlaps,
      conflicting_series_dates: conflicts,
      exact_duplicate_series_dates: Math.max(0, overlaps - conflicts),
    }
  })

  const observedDates = dateCoverage.filter((day) => day.banks_present > 0).map((day) => day.collection_date)
  const recurringGapBanks = banks
    .map<GapBankSummary>((bank) => {
      const missingDates = observedDates.filter((date) => !(presentByDate.get(date)?.has(bank) ?? false))
      return {
        bank_name: bank,
        missing_observed_dates: missingDates.length,
        observed_dates: observedDates.length,
        missing_ratio: observedDates.length > 0 ? Number((missingDates.length / observedDates.length).toFixed(4)) : 0,
        missing_dates: missingDates,
      }
    })
    .filter((bank) => bank.missing_observed_dates > 0)
    .sort((a, b) => b.missing_observed_dates - a.missing_observed_dates || a.bank_name.localeCompare(b.bank_name))

  return {
    key: dataset.key,
    label: dataset.label,
    total_banks: banks.length,
    total_dates_in_range: allDates.length,
    observed_dates: observedDates.length,
    full_dates: dateCoverage.filter((day) => day.status === 'full').map((day) => day.collection_date),
    partial_dates: dateCoverage.filter((day) => day.status === 'partial').map((day) => day.collection_date),
    empty_dates: dateCoverage.filter((day) => day.status === 'empty').map((day) => day.collection_date),
    always_missing_on_observed_days: recurringGapBanks
      .filter((bank) => bank.missing_observed_dates === observedDates.length && observedDates.length > 0)
      .map((bank) => bank.bank_name),
    recurring_gap_banks: recurringGapBanks,
    date_coverage: dateCoverage,
  }
}

function tableLine(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ]
}

function renderDatasetSection(dataset: DatasetCoverageReport): string[] {
  const lines: string[] = [`## ${dataset.label}`, '']
  lines.push(
    ...tableLine(
      ['Metric', 'Value'],
      [
        ['Total banks', String(dataset.total_banks)],
        ['Dates in range', String(dataset.total_dates_in_range)],
        ['Observed dates', String(dataset.observed_dates)],
        ['Full coverage dates', dataset.full_dates.join(', ') || '-'],
        ['Empty dates', dataset.empty_dates.join(', ') || '-'],
        ['Always missing on observed days', dataset.always_missing_on_observed_days.join(', ') || '-'],
      ],
    ),
    '',
    '### Date Coverage',
    '',
    ...tableLine(
      ['Date', 'Status', 'Banks', 'Missing', 'Missing banks', 'Rows', 'Series', 'Exact dupes', 'Conflicts'],
      dataset.date_coverage.map((day) => [
        day.collection_date,
        day.status,
        `${day.banks_present}/${day.total_banks}`,
        String(day.missing_bank_count),
        day.missing_banks.join(', ') || '-',
        String(day.total_rows),
        String(day.total_series),
        String(day.exact_duplicate_series_dates),
        String(day.conflicting_series_dates),
      ]),
    ),
    '',
    '### Recurring Gap Banks',
    '',
    ...tableLine(
      ['Bank', 'Missing observed dates', 'Observed dates', 'Missing ratio', 'Missing dates'],
      dataset.recurring_gap_banks.map((bank) => [
        bank.bank_name,
        String(bank.missing_observed_dates),
        String(bank.observed_dates),
        bank.missing_ratio.toFixed(4),
        bank.missing_dates.join(', '),
      ]),
    ),
    '',
  )
  return lines
}

export function renderMarkdownReport(report: AuditReport): string {
  const lines: string[] = [
    '# Production Coverage Audit',
    '',
    `- Generated at: \`${report.generated_at}\``,
    `- Target DB: \`${report.target_db}\``,
    '',
    '## Recommendation',
    '',
    ...report.recommendations.map((item) => `- ${item}`),
    '',
    '## Canonical Rule Set',
    '',
    ...report.canonical_rule_set.map((item) => `- ${item}`),
    '',
    '## Dataset Summary',
    '',
    ...tableLine(
      ['Dataset', 'Rows', 'Dates', 'First date', 'Last date', 'Distinct series', 'Distinct products'],
      report.dataset_stats.map((row) => [
        asText(row.dataset),
        String(asNumber(row.total_rows)),
        String(asNumber(row.distinct_dates)),
        asText(row.min_collection_date),
        asText(row.max_collection_date),
        String(asNumber(row.distinct_series)),
        String(asNumber(row.distinct_products)),
      ]),
    ),
    '',
    '## Coverage State',
    '',
    ...tableLine(
      ['Dataset', 'First coverage', 'Cursor', 'Status', 'Empty streak', 'Last tick status', 'Last tick message'],
      report.dataset_coverage_state.map((row) => [
        asText(row.dataset_key),
        asText(row.first_coverage_date),
        asText(row.cursor_date),
        asText(row.status),
        String(asNumber(row.empty_streak)),
        asText(row.last_tick_status),
        asText(row.last_tick_message),
      ]),
    ),
    '',
    '## Overlap Summary',
    '',
    ...tableLine(
      ['Dataset', 'Overlapping series-dates', 'Conflicting series-dates'],
      report.overlap_summary.map((row) => [
        asText(row.dataset),
        String(asNumber(row.overlapping_series_dates)),
        String(asNumber(row.overlapping_series_dates_with_conflicts)),
      ]),
    ),
    '',
  ]
  for (const dataset of report.datasets) lines.push(...renderDatasetSection(dataset))
  lines.push(
    '## Legacy Residue',
    '',
    ...tableLine(
      ['Source type', 'Orphan rows'],
      report.raw_backlog_by_source.map((row) => [asText(row.source_type), String(asNumber(row.orphan_rows))]),
    ),
    '',
    '## SQL Pack',
    '',
    ...Object.entries(report.sql_pack).flatMap(([name, sql]) => [`### ${name}`, '', '```sql', sql, '```', '']),
  )
  return `${lines.join('\n').trim()}\n`
}
