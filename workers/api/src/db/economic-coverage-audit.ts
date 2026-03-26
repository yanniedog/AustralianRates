import { addDays } from '../economic/parser-utils'
import { ECONOMIC_SERIES_DEFINITIONS, type EconomicSeriesDefinition, type EconomicSeriesId } from '../economic/registry'

type EconomicStatusDbRow = {
  series_id: string
  last_checked_at: string
  last_success_at: string | null
  last_observation_date: string | null
  last_value: number | null
  status: 'ok' | 'stale' | 'error' | string
  message: string | null
  source_url: string
  proxy_flag: number
}

type ObservationAggregateRow = {
  observation_count: number | null
  latest_observation_date: string | null
  future_observation_count: number | null
  release_before_observation_count: number | null
  proxy_mismatch_count: number | null
  frequency_mismatch_count: number | null
  source_mismatch_count: number | null
}

type LatestObservationRow = {
  observation_date: string
  value: number
}

type SeriesCountRow = {
  series_id: string
  row_count: number | null
}

type InvalidSampleRow = {
  series_id: string
  observation_date: string
  release_date: string | null
}

export type EconomicCoverageSeverity = 'green' | 'yellow' | 'red'

export type EconomicCoverageProbe = {
  key: string
  ok: boolean
  status: number
  requested_ids?: string[]
  returned_ids?: string[]
  detail?: string
  fetch_event_id?: number | null
}

export type EconomicCoverageFinding = {
  code: string
  severity: 'warn' | 'error'
  message: string
  count: number
  sample: Array<Record<string, unknown>>
}

export type EconomicSeriesCoverageRow = {
  series_id: EconomicSeriesId
  label: string
  category: string
  status_row_present: boolean
  observation_row_count: number
  stored_status: string | null
  computed_status: 'missing' | 'ok' | 'stale' | 'error'
  severity: EconomicCoverageSeverity
  last_checked_at: string | null
  last_success_at: string | null
  last_observation_date: string | null
  latest_observation_date: string | null
  last_value: number | null
  latest_value: number | null
  status_message: string | null
  source_url: string | null
  frequency: string | null
  proxy: boolean | null
  issues: string[]
}

export type EconomicCoverageSummary = {
  defined_series: number
  status_rows: number
  observed_series: number
  ok_series: number
  stale_series: number
  error_series: number
  missing_series: number
  invalid_rows: number
  orphan_rows: number
  public_probe_failures: number
  severity: EconomicCoverageSeverity
}

export type EconomicCoverageReport = {
  checked_at: string
  summary: EconomicCoverageSummary
  probes: EconomicCoverageProbe[]
  findings: EconomicCoverageFinding[]
  per_series: EconomicSeriesCoverageRow[]
}

function issueSeverity(issues: string[], computedStatus: EconomicSeriesCoverageRow['computed_status']): EconomicCoverageSeverity {
  if (issues.some((issue) => issue !== 'stale_status')) return 'red'
  if (computedStatus === 'stale' || issues.includes('stale_status')) return 'yellow'
  return 'green'
}

function storedProxyFlagMatches(definition: EconomicSeriesDefinition, row: EconomicStatusDbRow | null): boolean {
  if (!row) return true
  return Boolean(row.proxy_flag) === definition.proxy
}

function storedSourceUrlMatches(definition: EconomicSeriesDefinition, row: EconomicStatusDbRow | null): boolean {
  if (!row) return true
  return row.source_url === definition.sourceUrl
}

function computedStatusForRow(
  definition: EconomicSeriesDefinition,
  row: EconomicStatusDbRow | null,
  latestObservationDate: string | null,
): EconomicSeriesCoverageRow['computed_status'] {
  if (!row) return 'missing'
  if (row.status === 'error') return 'error'
  const checkedDate = String(row.last_checked_at || '').slice(0, 10)
  if (!latestObservationDate || !checkedDate) return 'stale'
  return addDays(latestObservationDate, definition.staleAfterDays) < checkedDate ? 'stale' : 'ok'
}

function pushFinding(
  findings: EconomicCoverageFinding[],
  input: {
    code: string
    severity: 'warn' | 'error'
    message: string
    count: number
    sample?: Array<Record<string, unknown>>
  },
) {
  if (input.count <= 0) return
  findings.push({
    code: input.code,
    severity: input.severity,
    message: input.message,
    count: input.count,
    sample: (input.sample ?? []).slice(0, 5),
  })
}

function countBySeverity(findings: EconomicCoverageFinding[], probes: EconomicCoverageProbe[]): EconomicCoverageSeverity {
  if (probes.some((probe) => !probe.ok)) return 'red'
  if (findings.some((finding) => finding.severity === 'error')) return 'red'
  if (findings.some((finding) => finding.severity === 'warn')) return 'yellow'
  return 'green'
}

async function getObservationAggregate(
  db: D1Database,
  definition: EconomicSeriesDefinition,
  todayIso: string,
): Promise<ObservationAggregateRow> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS observation_count,
         MAX(observation_date) AS latest_observation_date,
         SUM(CASE WHEN observation_date > ?2 THEN 1 ELSE 0 END) AS future_observation_count,
         SUM(CASE WHEN release_date IS NOT NULL AND release_date < observation_date THEN 1 ELSE 0 END) AS release_before_observation_count,
         SUM(CASE WHEN proxy_flag != ?3 THEN 1 ELSE 0 END) AS proxy_mismatch_count,
         SUM(CASE WHEN frequency != ?4 THEN 1 ELSE 0 END) AS frequency_mismatch_count,
         SUM(CASE WHEN source_url != ?5 THEN 1 ELSE 0 END) AS source_mismatch_count
       FROM economic_series_observations
       WHERE series_id = ?1`,
    )
    .bind(
      definition.id,
      todayIso,
      definition.proxy ? 1 : 0,
      definition.frequency,
      definition.sourceUrl,
    )
    .first<ObservationAggregateRow>()

  return row ?? {
    observation_count: 0,
    latest_observation_date: null,
    future_observation_count: 0,
    release_before_observation_count: 0,
    proxy_mismatch_count: 0,
    frequency_mismatch_count: 0,
    source_mismatch_count: 0,
  }
}

async function getLatestObservation(db: D1Database, seriesId: string): Promise<LatestObservationRow | null> {
  return (
    (await db
      .prepare(
        `SELECT observation_date, value
         FROM economic_series_observations
         WHERE series_id = ?1
         ORDER BY observation_date DESC
         LIMIT 1`,
      )
      .bind(seriesId)
      .first<LatestObservationRow>()) ?? null
  )
}

async function getSeriesCountMap(db: D1Database, tableName: 'economic_series_status' | 'economic_series_observations') {
  const rows = await db
    .prepare(`SELECT series_id, COUNT(*) AS row_count FROM ${tableName} GROUP BY series_id`)
    .all<SeriesCountRow>()
  return new Map((rows.results ?? []).map((row) => [row.series_id, Number(row.row_count ?? 0)]))
}

async function getFutureObservationSamples(db: D1Database, todayIso: string): Promise<InvalidSampleRow[]> {
  const rows = await db
    .prepare(
      `SELECT series_id, observation_date, release_date
       FROM economic_series_observations
       WHERE observation_date > ?1
       ORDER BY observation_date ASC
       LIMIT 5`,
    )
    .bind(todayIso)
    .all<InvalidSampleRow>()
  return rows.results ?? []
}

async function getReleaseOrderingSamples(db: D1Database): Promise<InvalidSampleRow[]> {
  const rows = await db
    .prepare(
      `SELECT series_id, observation_date, release_date
       FROM economic_series_observations
       WHERE release_date IS NOT NULL
         AND release_date < observation_date
       ORDER BY observation_date DESC
       LIMIT 5`,
    )
    .all<InvalidSampleRow>()
  return rows.results ?? []
}

function reportWithProbes(report: EconomicCoverageReport, probes: EconomicCoverageProbe[]): EconomicCoverageReport {
  const findings = report.findings.slice()
  const failedProbeCount = probes.filter((probe) => !probe.ok).length
  pushFinding(findings, {
    code: 'economic_public_probe_failures',
    severity: 'error',
    message: 'Economic public probes failed.',
    count: failedProbeCount,
    sample: probes
      .filter((probe) => !probe.ok)
      .map((probe) => ({
        key: probe.key,
        status: probe.status,
        detail: probe.detail ?? null,
        requested_ids: probe.requested_ids ?? [],
        returned_ids: probe.returned_ids ?? [],
        fetch_event_id: probe.fetch_event_id ?? null,
      })),
  })

  const summary: EconomicCoverageSummary = {
    ...report.summary,
    public_probe_failures: failedProbeCount,
    severity: countBySeverity(findings, probes),
  }

  return {
    ...report,
    probes,
    findings,
    summary,
  }
}

export async function runEconomicCoverageAudit(db: D1Database, input?: { checkedAt?: string }): Promise<EconomicCoverageReport> {
  const checkedAt = input?.checkedAt ?? new Date().toISOString()
  const todayIso = checkedAt.slice(0, 10)
  const definitions = ECONOMIC_SERIES_DEFINITIONS
  const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]))
  const findings: EconomicCoverageFinding[] = []

  const [statusResult, statusCounts, observationCounts, futureSamples, releaseSamples] = await Promise.all([
    db.prepare('SELECT * FROM economic_series_status ORDER BY series_id ASC').all<EconomicStatusDbRow>(),
    getSeriesCountMap(db, 'economic_series_status'),
    getSeriesCountMap(db, 'economic_series_observations'),
    getFutureObservationSamples(db, todayIso),
    getReleaseOrderingSamples(db),
  ])

  const statusRows = statusResult.results ?? []
  const statusMap = new Map(statusRows.map((row) => [row.series_id, row]))

  const unknownStatusRows = statusRows.filter((row) => !definitionMap.has(row.series_id))
  const unknownObservationRows = Array.from(observationCounts.entries())
    .filter(([seriesId]) => !definitionMap.has(seriesId))
    .map(([series_id, row_count]) => ({ series_id, row_count }))

  pushFinding(findings, {
    code: 'economic_unknown_status_rows',
    severity: 'error',
    message: 'economic_series_status contains unknown series ids.',
    count: unknownStatusRows.length,
    sample: unknownStatusRows.map((row) => ({
      series_id: row.series_id,
      status: row.status,
      last_checked_at: row.last_checked_at,
    })),
  })
  pushFinding(findings, {
    code: 'economic_unknown_observation_rows',
    severity: 'error',
    message: 'economic_series_observations contains unknown series ids.',
    count: unknownObservationRows.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
    sample: unknownObservationRows.map((row) => ({
      series_id: row.series_id,
      row_count: row.row_count,
    })),
  })

  const perSeries: EconomicSeriesCoverageRow[] = []
  let invalidRows = 0

  for (const definition of definitions) {
    const statusRow = statusMap.get(definition.id) ?? null
    const observationAggregate = await getObservationAggregate(db, definition, todayIso)
    const latestObservation = observationAggregate.observation_count
      ? await getLatestObservation(db, definition.id)
      : null

    const issues: string[] = []
    const observationCount = Number(observationAggregate.observation_count ?? 0)
    const latestObservationDate = latestObservation?.observation_date ?? observationAggregate.latest_observation_date ?? null
    const latestValue = latestObservation?.value ?? null

    if (!statusRow) {
      issues.push('missing_status')
      invalidRows += 1
    } else {
      if (!storedProxyFlagMatches(definition, statusRow)) {
        issues.push('status_proxy_mismatch')
        invalidRows += 1
      }
      if (!storedSourceUrlMatches(definition, statusRow)) {
        issues.push('status_source_url_mismatch')
        invalidRows += 1
      }
      if (statusRow.last_success_at && statusRow.last_checked_at && statusRow.last_success_at > statusRow.last_checked_at) {
        issues.push('status_success_after_checked')
        invalidRows += 1
      }
      if (statusRow.status !== 'error') {
        if ((statusRow.last_observation_date ?? null) !== latestObservationDate) {
          issues.push('status_last_observation_mismatch')
          invalidRows += 1
        }
        if ((statusRow.last_value ?? null) !== latestValue) {
          issues.push('status_last_value_mismatch')
          invalidRows += 1
        }
      }
    }

    if (observationCount === 0 && statusRow?.status !== 'error') {
      issues.push('missing_observations')
      invalidRows += 1
    }
    if (Number(observationAggregate.proxy_mismatch_count ?? 0) > 0) {
      issues.push('observation_proxy_mismatch')
      invalidRows += Number(observationAggregate.proxy_mismatch_count ?? 0)
    }
    if (Number(observationAggregate.frequency_mismatch_count ?? 0) > 0) {
      issues.push('observation_frequency_mismatch')
      invalidRows += Number(observationAggregate.frequency_mismatch_count ?? 0)
    }
    if (Number(observationAggregate.source_mismatch_count ?? 0) > 0) {
      issues.push('observation_source_url_mismatch')
      invalidRows += Number(observationAggregate.source_mismatch_count ?? 0)
    }
    if (Number(observationAggregate.future_observation_count ?? 0) > 0) {
      issues.push('future_observation_dates')
      invalidRows += Number(observationAggregate.future_observation_count ?? 0)
    }
    if (Number(observationAggregate.release_before_observation_count ?? 0) > 0) {
      issues.push('release_before_observation')
      invalidRows += Number(observationAggregate.release_before_observation_count ?? 0)
    }

    const computedStatus = computedStatusForRow(definition, statusRow, latestObservationDate)
    if (statusRow?.status === 'error') {
      issues.push('error_status')
    } else if (computedStatus === 'stale') {
      issues.push('stale_status')
    }
    if (statusRow && statusRow.status !== 'error' && statusRow.status !== computedStatus) {
      issues.push('stored_status_mismatch')
      invalidRows += 1
    }

    perSeries.push({
      series_id: definition.id,
      label: definition.label,
      category: definition.category,
      status_row_present: Boolean(statusRow),
      observation_row_count: observationCount,
      stored_status: statusRow?.status ?? null,
      computed_status: computedStatus,
      severity: issueSeverity(issues, computedStatus),
      last_checked_at: statusRow?.last_checked_at ?? null,
      last_success_at: statusRow?.last_success_at ?? null,
      last_observation_date: statusRow?.last_observation_date ?? null,
      latest_observation_date: latestObservationDate,
      last_value: statusRow?.last_value ?? null,
      latest_value: latestValue,
      status_message: statusRow?.message ?? null,
      source_url: statusRow?.source_url ?? definition.sourceUrl,
      frequency: definition.frequency,
      proxy: statusRow ? Boolean(statusRow.proxy_flag) : definition.proxy,
      issues,
    })
  }

  const missingStatusRows = perSeries.filter((row) => row.issues.includes('missing_status'))
  const missingObservationRows = perSeries.filter((row) => row.issues.includes('missing_observations'))
  const errorStatusRows = perSeries.filter((row) => row.issues.includes('error_status'))
  const staleStatusRows = perSeries.filter((row) => row.issues.includes('stale_status') && !row.issues.includes('error_status'))
  const statusFieldMismatchRows = perSeries.filter((row) =>
    row.issues.some((issue) => issue === 'status_proxy_mismatch' || issue === 'status_source_url_mismatch'),
  )
  const observationFieldMismatchRows = perSeries.filter((row) =>
    row.issues.some((issue) =>
      issue === 'observation_proxy_mismatch' ||
      issue === 'observation_frequency_mismatch' ||
      issue === 'observation_source_url_mismatch',
    ),
  )
  const statusValueMismatchRows = perSeries.filter((row) =>
    row.issues.some((issue) =>
      issue === 'status_last_observation_mismatch' ||
      issue === 'status_last_value_mismatch' ||
      issue === 'stored_status_mismatch' ||
      issue === 'status_success_after_checked',
    ),
  )

  pushFinding(findings, {
    code: 'economic_missing_status_rows',
    severity: 'error',
    message: 'Registry-defined economic series are missing status rows.',
    count: missingStatusRows.length,
    sample: missingStatusRows.map((row) => ({ series_id: row.series_id, label: row.label })),
  })
  pushFinding(findings, {
    code: 'economic_missing_observation_rows',
    severity: 'error',
    message: 'Non-error economic series are missing observation rows.',
    count: missingObservationRows.length,
    sample: missingObservationRows.map((row) => ({ series_id: row.series_id, stored_status: row.stored_status })),
  })
  pushFinding(findings, {
    code: 'economic_error_status_rows',
    severity: 'error',
    message: 'Economic series currently report error status.',
    count: errorStatusRows.length,
    sample: errorStatusRows.map((row) => ({
      series_id: row.series_id,
      status_message: row.status_message,
      last_checked_at: row.last_checked_at,
    })),
  })
  pushFinding(findings, {
    code: 'economic_stale_status_rows',
    severity: 'warn',
    message: 'Economic series are stale but not broken.',
    count: staleStatusRows.length,
    sample: staleStatusRows.map((row) => ({
      series_id: row.series_id,
      latest_observation_date: row.latest_observation_date,
      last_checked_at: row.last_checked_at,
    })),
  })
  pushFinding(findings, {
    code: 'economic_status_field_mismatches',
    severity: 'error',
    message: 'economic_series_status fields do not match the registry definition.',
    count: statusFieldMismatchRows.length,
    sample: statusFieldMismatchRows.map((row) => ({
      series_id: row.series_id,
      issues: row.issues.filter((issue) => issue.indexOf('status_') === 0),
    })),
  })
  pushFinding(findings, {
    code: 'economic_observation_field_mismatches',
    severity: 'error',
    message: 'economic_series_observations fields do not match the registry definition.',
    count: observationFieldMismatchRows.length,
    sample: observationFieldMismatchRows.map((row) => ({
      series_id: row.series_id,
      issues: row.issues.filter((issue) => issue.indexOf('observation_') === 0),
    })),
  })
  pushFinding(findings, {
    code: 'economic_status_value_mismatches',
    severity: 'error',
    message: 'Stored status values do not match the observation data.',
    count: statusValueMismatchRows.length,
    sample: statusValueMismatchRows.map((row) => ({
      series_id: row.series_id,
      issues: row.issues.filter((issue) =>
        issue === 'status_last_observation_mismatch' ||
        issue === 'status_last_value_mismatch' ||
        issue === 'stored_status_mismatch' ||
        issue === 'status_success_after_checked',
      ),
    })),
  })
  pushFinding(findings, {
    code: 'economic_future_observation_dates',
    severity: 'error',
    message: 'Economic observations contain future dates.',
    count: futureSamples.length > 0
      ? perSeries.reduce((sum, row) => sum + (row.issues.includes('future_observation_dates') ? 1 : 0), 0)
      : 0,
    sample: futureSamples.map((row) => ({
      series_id: row.series_id,
      observation_date: row.observation_date,
      release_date: row.release_date,
    })),
  })
  pushFinding(findings, {
    code: 'economic_release_before_observation',
    severity: 'error',
    message: 'Economic observations contain release dates before observation dates.',
    count: releaseSamples.length > 0
      ? perSeries.reduce((sum, row) => sum + (row.issues.includes('release_before_observation') ? 1 : 0), 0)
      : 0,
    sample: releaseSamples.map((row) => ({
      series_id: row.series_id,
      observation_date: row.observation_date,
      release_date: row.release_date,
    })),
  })

  const summary: EconomicCoverageSummary = {
    defined_series: definitions.length,
    status_rows: statusRows.length,
    observed_series: perSeries.filter((row) => row.observation_row_count > 0).length,
    ok_series: perSeries.filter((row) => row.computed_status === 'ok' && row.severity === 'green').length,
    stale_series: staleStatusRows.length,
    error_series: errorStatusRows.length,
    missing_series: missingStatusRows.length,
    invalid_rows: invalidRows,
    orphan_rows:
      unknownStatusRows.length +
      unknownObservationRows.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
    public_probe_failures: 0,
    severity: countBySeverity(findings, []),
  }

  return {
    checked_at: checkedAt,
    summary,
    probes: [],
    findings,
    per_series,
  }
}

export function attachEconomicCoverageProbes(
  report: EconomicCoverageReport,
  probes: EconomicCoverageProbe[],
): EconomicCoverageReport {
  return reportWithProbes(report, probes)
}
