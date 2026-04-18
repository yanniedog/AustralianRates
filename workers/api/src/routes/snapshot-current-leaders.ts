type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

type SnapshotRow = Record<string, unknown>
type SnapshotLeaderEntry = {
  scenarioLabel?: string
  row: SnapshotRow | null
}

const QUICK_COMPARE_LIMIT = 5
const HOME_LOAN_SCENARIOS: Array<{ label: string; params: Record<string, string> }> = [
  {
    label: 'OO P&I variable 80-85%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_80-85%' },
  },
  {
    label: 'OO P&I variable 70-80%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_70-80%' },
  },
  {
    label: 'OO P&I variable 60-70%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_60-70%' },
  },
  {
    label: 'OO P&I variable <=60%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_=60%' },
  },
  {
    label: 'OO P&I variable 85-90%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_85-90%' },
  },
  {
    label: 'OO P&I variable 90-95%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_90-95%' },
  },
  {
    label: 'OO P&I fixed 1y 80-85%',
    params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'fixed_1yr', lvr_tier: 'lvr_80-85%' },
  },
  {
    label: 'Investment P&I variable 80-85%',
    params: { security_purpose: 'investment', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_80-85%' },
  },
]

function numberValue(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : Number.NaN
}

function sortRows(section: DatasetKind, rows: SnapshotRow[]): SnapshotRow[] {
  const bestIsLowest = section === 'home_loans'
  return rows.slice().sort((left, right) => {
    const leftRate = numberValue(left?.interest_rate)
    const rightRate = numberValue(right?.interest_rate)
    if (!Number.isFinite(leftRate) && !Number.isFinite(rightRate)) return 0
    if (!Number.isFinite(leftRate)) return 1
    if (!Number.isFinite(rightRate)) return -1
    return bestIsLowest ? leftRate - rightRate : rightRate - leftRate
  })
}

function rowMatchesParams(row: SnapshotRow, params: Record<string, string>): boolean {
  const minRate = numberValue(row?.interest_rate)
  if (Number.isFinite(minRate) && minRate < 0.01) return false
  return Object.keys(params).every((key) => String(row?.[key] ?? '').trim() === String(params[key] ?? '').trim())
}

function buildHomeLoanScenarioLeaders(rows: SnapshotRow[]): SnapshotLeaderEntry[] {
  return HOME_LOAN_SCENARIOS.map((scenario) => {
    const match = sortRows('home_loans', rows.filter((row) => rowMatchesParams(row, scenario.params)))[0] || null
    return {
      scenarioLabel: scenario.label,
      row: match,
    }
  }).filter((entry) => !!entry.row)
}

export function buildSnapshotCurrentLeaders(section: DatasetKind, rows: SnapshotRow[]): Record<string, unknown> {
  const sortedRows = sortRows(section, Array.isArray(rows) ? rows : [])
  return {
    ok: true,
    rows: sortedRows.slice(0, QUICK_COMPARE_LIMIT),
    scenarios: section === 'home_loans' ? buildHomeLoanScenarioLeaders(sortedRows) : [],
  }
}
