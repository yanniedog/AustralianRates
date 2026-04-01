import type { HistoricalQualityBaselineConfidence, HistoricalQualitySeverity } from './historical-quality-types'

export const HISTORICAL_QUALITY_SEVERITY_WEIGHTS: Record<HistoricalQualitySeverity, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  severe: 1,
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  return denominator > 0 ? numerator / denominator : fallback
}

export function average(values: Array<number | null | undefined>, fallback = 0): number {
  const filtered = values.filter((value): value is number => Number.isFinite(Number(value)))
  if (filtered.length === 0) return fallback
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

export function countDeviationScore(current: number, baseline: number | null, minTolerance: number, ratioTolerance: number): number {
  if (!Number.isFinite(baseline ?? Number.NaN) || (baseline ?? 0) <= 0) return 0.5
  const tolerance = Math.max(minTolerance, (baseline as number) * ratioTolerance)
  return clamp01(1 - Math.abs(current - (baseline as number)) / tolerance)
}

export function structuralScore(input: {
  rowCount: number
  duplicateRows: number
  missingRequiredRows: number
  invalidValueRows: number
  crossTableConflictRows: number
}): {
  uniqueness: number
  requiredField: number
  domainValidity: number
  crossTableConsistency: number
  score: number
} {
  const denominator = Math.max(input.rowCount, 1)
  const uniqueness = clamp01(1 - input.duplicateRows / denominator)
  const requiredField = clamp01(1 - input.missingRequiredRows / denominator)
  const domainValidity = clamp01(1 - input.invalidValueRows / denominator)
  const crossTableConsistency = clamp01(1 - input.crossTableConflictRows / denominator)
  return {
    uniqueness,
    requiredField,
    domainValidity,
    crossTableConsistency,
    score: average([uniqueness, requiredField, domainValidity, crossTableConsistency]),
  }
}

export function provenanceScore(input: {
  exact: number
  reconstructed: number
  legacy: number
  quarantined: number
  unclassified: number
}): number {
  const total = input.exact + input.reconstructed + input.legacy + input.quarantined + input.unclassified
  if (total <= 0) return 0
  return safeDivide(
    input.exact * 1 + input.reconstructed * 0.8 + input.legacy * 0.4 + input.unclassified * 0.2,
    total,
  )
}

export function anomalyPressureScore(weightedAffectedSeries: number, activeSeriesCount: number): number {
  return clamp01(1 - safeDivide(weightedAffectedSeries, Math.max(activeSeriesCount * 0.2, 20), 0))
}

export function continuityScore(unexplainedAppearances: number, unexplainedDisappearances: number, activeSeriesCount: number): number {
  return clamp01(1 - safeDivide(unexplainedAppearances + unexplainedDisappearances, Math.max(activeSeriesCount, 1), 0))
}

export function countStabilityScore(seriesCount: number, prevSeriesCount: number | null): number {
  if (!Number.isFinite(prevSeriesCount ?? Number.NaN) || (prevSeriesCount ?? 0) <= 0) return 0.5
  return clamp01(1 - Math.abs(seriesCount - (prevSeriesCount as number)) / Math.max((prevSeriesCount as number) * 0.2, 25))
}

export function rateFlowScore(weightedRateFlowFlags: number, changedSeriesCount: number): number {
  return clamp01(1 - safeDivide(weightedRateFlowFlags, Math.max(changedSeriesCount, 1), 0))
}

export function runStateObservabilityScore(input: {
  rawRunStatePresent: boolean
  permanentEvidencePresent: boolean
  rawRunStateExpected: boolean
}): number {
  if (input.rawRunStatePresent || input.permanentEvidencePresent) return 1
  if (!input.rawRunStateExpected) return 0.35
  return 0
}

export function evidenceConfidenceScore(provenance: number, runStateObservability: number): number {
  return average([provenance, runStateObservability])
}

export function intraDayScore(structural: number, provenance: number, coverage: number, anomalyPressure: number): number {
  return 0.3 * structural + 0.3 * provenance + 0.25 * coverage + 0.15 * anomalyPressure
}

export function transitionScore(continuity: number, countStability: number, rateFlow: number): number {
  return average([continuity, countStability, rateFlow])
}

export function baselineConfidence(priorReferences: number, futureReferences: number): HistoricalQualityBaselineConfidence {
  if (priorReferences >= 3) return 'high'
  if (futureReferences >= 3) return 'bootstrap_forward'
  return 'low'
}
