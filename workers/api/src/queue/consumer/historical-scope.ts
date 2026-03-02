import type { CoverageDataset } from '../../db/dataset-coverage'

export type HistoricalScope = 'all' | 'mortgage' | 'savings' | 'term_deposits'

export function asHistoricalScope(value: unknown): HistoricalScope {
  if (value === 'mortgage' || value === 'savings' || value === 'term_deposits') return value
  return 'all'
}

export function scopeCoverageDataset(scope: HistoricalScope): CoverageDataset | null {
  if (scope === 'mortgage') return 'mortgage'
  if (scope === 'savings') return 'savings'
  if (scope === 'term_deposits') return 'term_deposits'
  return null
}

export function rowsWrittenForScope(scope: HistoricalScope, run: { mortgage_rows: number; savings_rows: number; td_rows: number }): number {
  if (scope === 'mortgage') return Math.max(0, Number(run.mortgage_rows || 0))
  if (scope === 'savings') return Math.max(0, Number(run.savings_rows || 0))
  if (scope === 'term_deposits') return Math.max(0, Number(run.td_rows || 0))
  return Math.max(0, Number(run.mortgage_rows || 0)) + Math.max(0, Number(run.savings_rows || 0)) + Math.max(0, Number(run.td_rows || 0))
}
