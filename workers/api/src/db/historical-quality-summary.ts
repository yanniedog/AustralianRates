import type { HistoricalQualityDailyRow } from './historical-quality-types'

type CutoffCandidate = {
  start_date: string | null
  reason: string
}

type ProjectionInput = {
  projectionsMb: Record<7 | 14 | 30, number>
  currentDbSizeMb: number
  hasPermanentEvidenceBackfill: boolean
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function catastrophic(row: HistoricalQualityDailyRow): boolean {
  return (
    row.duplicate_rows > 0 ||
    row.provenance_quarantined_count > row.row_count * 0.01 ||
    row.unexplained_appearances + row.unexplained_disappearances > row.active_series_count * 0.05
  )
}

function findCandidate(
  rows: HistoricalQualityDailyRow[],
  thresholds: { structural: number; provenance: number; continuity: number; coverage: number; catastrophicPer30: number },
): CutoffCandidate {
  for (let index = 0; index < rows.length; index += 1) {
    const trailing = rows.slice(index)
    let catastrophicCount = 0
    let valid = true
    for (let start = 0; start < trailing.length; start += 7) {
      const window = trailing.slice(start, start + 7)
      if (window.length === 0) continue
      catastrophicCount += window.filter(catastrophic).length
      if (
        median(window.map((row) => Number(row.structural_score_v1 ?? 0))) < thresholds.structural ||
        median(window.map((row) => Number(row.provenance_score_v1 ?? 0))) < thresholds.provenance ||
        median(window.map((row) => Number(row.continuity_score_v1 ?? 0))) < thresholds.continuity ||
        median(window.map((row) => Number(row.coverage_score_v1 ?? 0))) < thresholds.coverage
      ) {
        valid = false
        break
      }
    }
    const per30 = trailing.length === 0 ? 0 : (catastrophicCount / trailing.length) * 30
    if (valid && per30 <= thresholds.catastrophicPer30) {
      return { start_date: trailing[0]?.collection_date ?? null, reason: 'thresholds_satisfied' }
    }
  }
  return { start_date: null, reason: 'no_clean_cutoff' }
}

export function computeHistoricalQualityCutoffs(rows: HistoricalQualityDailyRow[]): {
  conservative: CutoffCandidate
  balanced: CutoffCandidate
  aggressive: CutoffCandidate
} {
  const overallRows = rows.filter((row) => row.scope === 'overall').sort((a, b) => a.collection_date.localeCompare(b.collection_date))
  return {
    conservative: findCandidate(overallRows, {
      structural: 0.98,
      provenance: 0.8,
      continuity: 0.8,
      coverage: 0.85,
      catastrophicPer30: 0,
    }),
    balanced: findCandidate(overallRows, {
      structural: 0.96,
      provenance: 0.7,
      continuity: 0.7,
      coverage: 0.8,
      catastrophicPer30: 1,
    }),
    aggressive: findCandidate(overallRows, {
      structural: 0.94,
      provenance: 0.6,
      continuity: 0.6,
      coverage: 0.75,
      catastrophicPer30: 2,
    }),
  }
}

export function chooseOperationalRetentionDays(input: ProjectionInput): {
  recommended_days: 7 | 14 | 30
  allowed: boolean
  reason: string
} {
  if (!input.hasPermanentEvidenceBackfill) {
    return { recommended_days: 7, allowed: false, reason: 'daily_evidence_not_backfilled' }
  }
  if (input.projectionsMb[30] <= 100 && input.projectionsMb[30] <= input.currentDbSizeMb * 0.15) {
    return { recommended_days: 30, allowed: true, reason: 'projection_within_30_day_threshold' }
  }
  if (input.projectionsMb[14] <= 50 && input.projectionsMb[14] <= input.currentDbSizeMb * 0.08) {
    return { recommended_days: 14, allowed: true, reason: 'projection_within_14_day_threshold' }
  }
  return { recommended_days: 7, allowed: true, reason: 'projection_requires_7_day_cap' }
}
