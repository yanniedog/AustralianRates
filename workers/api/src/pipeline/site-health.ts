import { attachEconomicCoverageProbes, runEconomicCoverageAudit, type EconomicCoverageProbe, type EconomicCoverageReport } from '../db/economic-coverage-audit'
import { runIntegrityChecks } from '../db/integrity-checks'
import { ECONOMIC_SERIES_DEFINITIONS } from '../economic/registry'
import { getIngestPauseConfig } from '../db/app-config'
import { buildLatestAllProbePath, LATEST_ALL_DATASETS } from './latest-all-probe'
import { runE2ECheck } from './e2e-alignment'
import { dispatchInternalPublicApiRequest } from './internal-public-api-request'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log, queryProblemLogs } from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'
import { shouldIgnoreStatusActionableLog } from '../utils/status-actionable-filter'
import { captureProbePayload, type ProbeCapturePolicy } from './probe-capture'
import { resolveProbeCapturePolicy } from './probe-capture-policy'
import { isJsonObject, parseJsonText, parseRowsPayload } from './probe-payloads'
import { detectUpstreamBlock } from '../utils/upstream-block'

type ComponentStatus = {
  key: string
  ok: boolean
  status: number
  duration_ms: number
  detail?: string
  fetch_event_id?: number | null
}

type ProbeValidation = 'none' | 'json_object' | 'rows_payload' | 'economic_series_payload'
const ACTIONABLE_LOG_LOOKBACK_MINUTES = 30
const ECONOMIC_SERIES_PROBE_BATCH_SIZE = 12

function isEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export type SiteHealthRunResult = {
  runId: string
  checkedAt: string
  overallOk: boolean
  durationMs: number
  origin: string
  components: ComponentStatus[]
  integrity: Awaited<ReturnType<typeof runIntegrityChecks>>
  economic: EconomicCoverageReport
  e2e: Awaited<ReturnType<typeof runE2ECheck>>
  failures: string[]
  actionableIssues: ReturnType<typeof toActionableIssueSummaries>
}

export function logSiteHealthOutcome(result: SiteHealthRunResult): void {
  const s = result.economic.summary
  const findingCodes = result.economic.findings.slice(0, 20).map((f) => f.code)
  const failedProbes = result.economic.probes
    .filter((p) => !p.ok)
    .map((p) => ({
      key: p.key,
      status: p.status,
      detail: String(p.detail || '').slice(0, 240),
      fetch_event_id: p.fetch_event_id ?? null,
    }))
  const failedDatasets = result.e2e.datasets
    .filter((d) => !d.ok)
    .map((d) => ({
      dataset: d.dataset,
      failure_code: d.failureCode,
      detail: String(d.detail || '').slice(0, 320),
      fetch_event_ids: d.fetchEventIds,
    }))
  const attention =
    !result.overallOk || hasEconomicFailureSignal(result.economic) || !result.e2e.aligned
  const payload = {
    code: 'site_health_diagnostics' as const,
    runId: result.runId,
    context: {
      checked_at: result.checkedAt,
      overall_ok: result.overallOk,
      failures: result.failures,
      economic: {
        severity: s.severity,
        defined_series: s.defined_series,
        ok_series: s.ok_series,
        error_series: s.error_series,
        stale_series: s.stale_series,
        missing_series: s.missing_series,
        public_probe_failures: s.public_probe_failures,
        finding_codes: findingCodes,
        failed_probes: failedProbes,
      },
      e2e: {
        aligned: result.e2e.aligned,
        reason_code: result.e2e.reasonCode,
        reason_detail: String(result.e2e.reasonDetail || '').slice(0, 600),
        target_collection_date: result.e2e.targetCollectionDate,
        source_mode: result.e2e.sourceMode,
        criteria: result.e2e.criteria,
        failed_datasets: failedDatasets,
      },
    },
  }
  if (attention) {
    log.warn('pipeline', 'site_health_attention', payload)
  } else {
    log.info('pipeline', 'site_health_ok', {
      code: 'site_health_diagnostics',
      runId: result.runId,
      context: {
        checked_at: result.checkedAt,
        overall_ok: true,
        economic_severity: s.severity,
        e2e_aligned: result.e2e.aligned,
        e2e_reason_code: result.e2e.reasonCode,
      },
    })
  }
}

function hasEconomicFailureSignal(report: EconomicCoverageReport): boolean {
  const definedSeries = Number(report.summary?.defined_series ?? 0)
  const statusRows = Number(report.summary?.status_rows ?? 0)
  const observedSeries = Number(report.summary?.observed_series ?? 0)
  const probeFailures = Number(report.summary?.public_probe_failures ?? 0)
  const findingsCount = Array.isArray(report.findings) ? report.findings.length : 0
  const perSeriesCount = Array.isArray(report.per_series) ? report.per_series.length : 0

  // Older/placeholder payloads can have a red default severity with no actual coverage evidence.
  const hasCoverageEvidence =
    definedSeries > 0 || statusRows > 0 || observedSeries > 0 || perSeriesCount > 0
  if (!hasCoverageEvidence && findingsCount === 0 && probeFailures === 0) return false

  if (probeFailures > 0) return true
  if (report.findings.some((finding) => finding.severity === 'error')) return true
  return report.summary.severity === 'red'
}

function normalizeOrigin(origin: string): string {
  return String(origin || '').replace(/\/+$/, '')
}

async function finalizeProbeResponse(
  env: EnvBindings,
  input: {
    path: string
    sourceType: string
    sourceUrl: string
    validation: ProbeValidation
    capturePolicy: ProbeCapturePolicy
    expectedSeriesIds?: string[]
  },
  response: Response,
  durationMs: number,
): Promise<{
  ok: boolean
  status: number
  durationMs: number
  detail?: string
  fetchEventId: number | null
  requestedIds?: string[]
  returnedIds?: string[]
}> {
  const bodyText = await response.text()

  if (!response.ok) {
    const captured = await captureProbePayload(env, {
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      reason: 'api_unreachable',
      policy: input.capturePolicy,
      payload: bodyText,
      status: response.status,
      headers: response.headers,
      durationMs,
      note: `site_health_probe non_2xx path=${input.path}`,
    })
    return {
      ok: false,
      status: response.status,
      durationMs,
      detail: `HTTP ${response.status}`,
      fetchEventId: captured.fetchEventId,
      requestedIds: input.expectedSeriesIds,
    }
  }

  let validationError: string | null = null
  let returnedIds: string[] | undefined
  if (input.validation !== 'none') {
    const parsed = parseJsonText(bodyText)
    if (!parsed.ok) {
      validationError = parsed.reason
    } else if (input.validation === 'json_object' && !isJsonObject(parsed.value)) {
      validationError = 'payload_not_object'
    } else if (input.validation === 'rows_payload') {
      const rowsResult = parseRowsPayload(parsed.value)
      if (!rowsResult.ok) validationError = rowsResult.reason
    } else if (input.validation === 'economic_series_payload') {
      if (!isJsonObject(parsed.value)) {
        validationError = 'payload_not_object'
      } else {
        const series = Array.isArray(parsed.value.series) ? parsed.value.series : []
        returnedIds = series
          .map((row) => (isJsonObject(row) ? String(row.id || '').trim() : ''))
          .filter(Boolean)
        const requestedIds = input.expectedSeriesIds ?? []
        if (
          returnedIds.length !== requestedIds.length ||
          returnedIds.some((id, index) => id !== requestedIds[index])
        ) {
          validationError = `series_id_mismatch expected=${requestedIds.join(',')} returned=${returnedIds.join(',')}`
        }
      }
    }
  }

  if (validationError) {
    const block = detectUpstreamBlock({
      status: response.status,
      body: bodyText,
      headers: response.headers,
    })
    const captured = await captureProbePayload(env, {
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      reason: 'api_invalid_payload',
      policy: input.capturePolicy,
      payload: bodyText,
      status: response.status,
      headers: response.headers,
      durationMs,
      note: `site_health_probe invalid_payload path=${input.path} reason=${validationError}`,
    })
    return {
      ok: false,
      status: response.status,
      durationMs,
      detail: `invalid_payload:${validationError}${block.reasonCode ? `:${block.reasonCode}` : ''}`,
      fetchEventId: captured.fetchEventId,
      requestedIds: input.expectedSeriesIds,
      returnedIds,
    }
  }

  const captured = await captureProbePayload(env, {
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    reason: 'success',
    policy: input.capturePolicy,
    payload: bodyText,
    status: response.status,
    headers: response.headers,
    durationMs,
    note: `site_health_probe ok path=${input.path}`,
  })
  return {
    ok: true,
    status: response.status,
    durationMs,
    fetchEventId: captured.fetchEventId,
    requestedIds: input.expectedSeriesIds,
    returnedIds,
  }
}

async function requestProbe(
  env: EnvBindings,
  input: {
    origin: string
    path: string
    sourceType: string
    validation: ProbeValidation
    capturePolicy: ProbeCapturePolicy
    expectedSeriesIds?: string[]
  },
): Promise<{
  ok: boolean
  status: number
  durationMs: number
  detail?: string
  fetchEventId: number | null
  requestedIds?: string[]
  returnedIds?: string[]
}> {
  const url = `${normalizeOrigin(input.origin)}${input.path}`
  const startedAt = Date.now()
  try {
    const internalResponse = await dispatchInternalPublicApiRequest({
      url,
      env,
    })
    if (internalResponse) {
      const durationMs = Date.now() - startedAt
      log.info('pipeline', 'internal_probe', {
        context: `source=${input.sourceType} path=${input.path} elapsed_ms=${durationMs} status=${internalResponse.status}`,
      })
      return finalizeProbeResponse(
        env,
        {
          path: input.path,
          sourceType: input.sourceType,
          sourceUrl: url,
          validation: input.validation,
          capturePolicy: input.capturePolicy,
          expectedSeriesIds: input.expectedSeriesIds,
        },
        internalResponse,
        durationMs,
      )
    }

    const fetched = await fetchWithTimeout(url, undefined, { env })
    const res = fetched.response
    const durationMs = Date.now() - startedAt
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=${input.sourceType} host=${hostFromUrl(url)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? res.status}`,
    })
    return finalizeProbeResponse(
      env,
      {
        path: input.path,
        sourceType: input.sourceType,
        sourceUrl: url,
        validation: input.validation,
        capturePolicy: input.capturePolicy,
        expectedSeriesIds: input.expectedSeriesIds,
      },
      res,
      durationMs,
    )
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    const durationMs = Date.now() - startedAt
    log.warn('pipeline', 'upstream_fetch', {
      error,
      context:
        `source=${input.sourceType} host=${hostFromUrl(url)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })
    const captured = await captureProbePayload(env, {
      sourceType: input.sourceType,
      sourceUrl: url,
      reason: 'api_unreachable',
      policy: input.capturePolicy,
      payload: {
        error: (error as Error)?.message || String(error),
        path: input.path,
      },
      status: meta?.status ?? null,
      durationMs,
      note: `site_health_probe fetch_error path=${input.path}`,
    })
    return {
      ok: false,
      status: 0,
      durationMs,
      detail: (error as Error)?.message || String(error),
      fetchEventId: captured.fetchEventId,
      requestedIds: input.expectedSeriesIds,
    }
  }
}

function withProbeDetail(input: { detail?: string; fetchEventId: number | null }): string | undefined {
  if (!input.detail && input.fetchEventId == null) return undefined
  if (input.fetchEventId == null) return input.detail
  return `${input.detail || 'probe_captured'} fetch_event_id=${input.fetchEventId}`
}

async function checkDataset(
  env: EnvBindings,
  origin: string,
  key: string,
  basePath: string,
  capturePolicy: ProbeCapturePolicy,
): Promise<ComponentStatus[]> {
  const [health, filters, latestAll] = await Promise.all([
    requestProbe(env, {
      origin,
      path: `${basePath}/health`,
      sourceType: 'probe_site_health_dataset_health',
      validation: 'json_object',
      capturePolicy,
    }),
    requestProbe(env, {
      origin,
      path: `${basePath}/filters`,
      sourceType: 'probe_site_health_dataset_filters',
      validation: 'json_object',
      capturePolicy,
    }),
    requestProbe(env, {
      origin,
      path: buildLatestAllProbePath(basePath, { limit: 1 }),
      sourceType: 'probe_site_health_dataset_latest_all',
      validation: 'rows_payload',
      capturePolicy,
    }),
  ])
  return [
    {
      key: `${key}_health`,
      ok: health.ok,
      status: health.status,
      duration_ms: health.durationMs,
      detail: withProbeDetail(health),
      fetch_event_id: health.fetchEventId,
    },
    {
      key: `${key}_filters`,
      ok: filters.ok,
      status: filters.status,
      duration_ms: filters.durationMs,
      detail: withProbeDetail(filters),
      fetch_event_id: filters.fetchEventId,
    },
    {
      key: `${key}_latest_all`,
      ok: latestAll.ok,
      status: latestAll.status,
      duration_ms: latestAll.durationMs,
      detail: withProbeDetail(latestAll),
      fetch_event_id: latestAll.fetchEventId,
    },
  ]
}

function chunkSeriesIds(seriesIds: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < seriesIds.length; index += size) {
    chunks.push(seriesIds.slice(index, index + size))
  }
  return chunks
}

async function checkEconomicData(
  env: EnvBindings,
  origin: string,
  capturePolicy: ProbeCapturePolicy,
): Promise<{ components: ComponentStatus[]; probes: EconomicCoverageProbe[] }> {
  const allSeriesIds = ECONOMIC_SERIES_DEFINITIONS.map((definition) => definition.id)
  const batches = chunkSeriesIds(allSeriesIds, ECONOMIC_SERIES_PROBE_BATCH_SIZE)
  const probeResults = await Promise.all([
    requestProbe(env, {
      origin,
      path: '/api/economic-data/health',
      sourceType: 'probe_site_health_economic_health',
      validation: 'json_object',
      capturePolicy,
    }),
    requestProbe(env, {
      origin,
      path: '/api/economic-data/catalog',
      sourceType: 'probe_site_health_economic_catalog',
      validation: 'json_object',
      capturePolicy,
    }),
    ...batches.map((ids, index) =>
      requestProbe(env, {
        origin,
        path: `/api/economic-data/series?ids=${ids.join(',')}`,
        sourceType: `probe_site_health_economic_series_batch_${index + 1}`,
        validation: 'economic_series_payload',
        capturePolicy,
        expectedSeriesIds: ids,
      }),
    ),
  ])

  const [healthProbe, catalogProbe, ...seriesProbes] = probeResults
  const probes: EconomicCoverageProbe[] = [
    {
      key: 'economic_health',
      ok: healthProbe.ok,
      status: healthProbe.status,
      duration_ms: healthProbe.durationMs,
      detail: healthProbe.detail,
      fetch_event_id: healthProbe.fetchEventId,
    },
    {
      key: 'economic_catalog',
      ok: catalogProbe.ok,
      status: catalogProbe.status,
      duration_ms: catalogProbe.durationMs,
      detail: catalogProbe.detail,
      fetch_event_id: catalogProbe.fetchEventId,
    },
    ...seriesProbes.map((probe, index) => ({
      key: `economic_series_batch_${index + 1}`,
      ok: probe.ok,
      status: probe.status,
      duration_ms: probe.durationMs,
      detail: probe.detail,
      requested_ids: probe.requestedIds,
      returned_ids: probe.returnedIds,
      fetch_event_id: probe.fetchEventId,
    })),
  ]

  const components: ComponentStatus[] = probes.map((probe) => ({
    key: probe.key,
    ok: probe.ok,
    status: probe.status,
    duration_ms: probe.duration_ms || 0,
    detail: probe.detail,
    fetch_event_id: probe.fetch_event_id ?? null,
  }))

  return { components, probes }
}

export async function runSiteHealthChecks(
  env: EnvBindings,
  input: { triggerSource: 'scheduled' | 'manual'; origin: string },
): Promise<SiteHealthRunResult> {
  const checkedAt = new Date().toISOString()
  const runId = `health:${input.triggerSource}:${checkedAt}:${crypto.randomUUID()}`
  const startedAt = Date.now()
  const origin = normalizeOrigin(input.origin)
  const capturePolicy: ProbeCapturePolicy = await resolveProbeCapturePolicy(env, input.triggerSource)
  const actionableSinceTs = new Date(Date.parse(checkedAt) - ACTIONABLE_LOG_LOOKBACK_MINUTES * 60 * 1000).toISOString()
  const pauseConfigPromise = getIngestPauseConfig(env.DB).catch(() => ({ mode: 'active' as const, reason: null }))
  const integrityPromise = runIntegrityChecks(env.DB, env.MELBOURNE_TIMEZONE || 'Australia/Melbourne', {
    includeAnomalyProbes: isEnabled(env.FEATURE_INTEGRITY_PROBES_ENABLED),
  }).catch((error) => ({
      ok: false,
      checked_at: new Date().toISOString(),
      checks: [
        {
          name: 'integrity_runtime_error',
          passed: false,
          detail: {
            error: (error as Error)?.message || String(error),
          },
        },
      ],
    }))
  const economicPromise = runEconomicCoverageAudit(env.DB, { checkedAt }).catch((error) => {
    // #region agent log
    fetch('http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a0a9c5'},body:JSON.stringify({sessionId:'a0a9c5',runId,hypothesisId:'H2',location:'site-health.ts:economicPromise.catch',message:'economic_audit_runtime_error',data:{error:(error as Error)?.message || String(error)},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    log.error('pipeline', 'site_health_economic_audit_failed', {
      error,
      context: `run_id=${runId}`,
    })
    return {
      checked_at: checkedAt,
      summary: {
        defined_series: ECONOMIC_SERIES_DEFINITIONS.length,
        status_rows: 0,
        observed_series: 0,
        ok_series: 0,
        stale_series: 0,
        error_series: 0,
        missing_series: ECONOMIC_SERIES_DEFINITIONS.length,
        invalid_rows: 0,
        orphan_rows: 0,
        public_probe_failures: 0,
        severity: 'red' as const,
      },
      probes: [],
      findings: [
        {
          code: 'economic_coverage_runtime_error',
          severity: 'error' as const,
          message: 'Economic coverage audit failed to execute.',
          count: 1,
          sample: [],
        },
      ],
      per_series: [],
    }
  })

  const [datasetComponents, homepage, integrity, e2e, logs, pauseConfig, economicCheck, economicCoverage] = await Promise.all([
    Promise.all(
      LATEST_ALL_DATASETS.map((dataset) =>
        checkDataset(env, origin, dataset.dataset, dataset.basePath, capturePolicy),
      ),
    ),
    requestProbe(env, {
      origin,
      path: '/',
      sourceType: 'probe_site_health_homepage',
      validation: 'none',
      capturePolicy,
    }),
    integrityPromise,
    runE2ECheck(env, { origin, capturePolicy }),
    queryProblemLogs(env.DB, { sinceTs: actionableSinceTs, limit: 500 }),
    pauseConfigPromise,
    checkEconomicData(env, origin, capturePolicy),
    economicPromise,
  ])
  const economic = attachEconomicCoverageProbes(economicCoverage, economicCheck.probes)
  // #region agent log
  fetch('http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a0a9c5'},body:JSON.stringify({sessionId:'a0a9c5',runId,hypothesisId:'H3',location:'site-health.ts:after_attachEconomicCoverageProbes',message:'economic_coverage_snapshot',data:{summary:economic.summary,findingsCount:Array.isArray(economic.findings)?economic.findings.length:-1,probeCount:Array.isArray(economic.probes)?economic.probes.length:-1,perSeriesCount:Array.isArray(economic.per_series)?economic.per_series.length:-1},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const components: ComponentStatus[] = [
    ...datasetComponents.flat(),
    ...economicCheck.components,
    {
      key: 'homepage',
      ok: homepage.ok,
      status: homepage.status,
      duration_ms: homepage.durationMs,
      detail: withProbeDetail(homepage),
      fetch_event_id: homepage.fetchEventId,
    },
  ]

  const failures = components
    .filter((c) => !c.ok)
    .map((c) => `${c.key}: status=${c.status}${c.detail ? ` detail=${c.detail}` : ''}`)

  if (!integrity.ok) failures.push('integrity_checks_failed')
  const economicFailureSignal = hasEconomicFailureSignal(economic)
  // #region agent log
  fetch('http://127.0.0.1:7387/ingest/df577db5-7ea2-489d-bc70-cbe35041c6be',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a0a9c5'},body:JSON.stringify({sessionId:'a0a9c5',runId,hypothesisId:'H4',location:'site-health.ts:hasEconomicFailureSignal',message:'economic_failure_signal_evaluated',data:{economicFailureSignal,severity:economic.summary?.severity ?? null,definedSeries:Number(economic.summary?.defined_series ?? 0),statusRows:Number(economic.summary?.status_rows ?? 0),observedSeries:Number(economic.summary?.observed_series ?? 0),publicProbeFailures:Number(economic.summary?.public_probe_failures ?? 0),findingsCount:Array.isArray(economic.findings)?economic.findings.length:-1,perSeriesCount:Array.isArray(economic.per_series)?economic.per_series.length:-1},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (economicFailureSignal) failures.push('economic_coverage_failed')
  if (!e2e.aligned) failures.push(`e2e_not_aligned:${e2e.reasonCode}`)

  const actionableIssues = toActionableIssueSummaries(
    logs.entries.filter((entry) => {
      const level = String(entry.level || '').toLowerCase()
      if (level !== 'warn' && level !== 'error') return false
      if (shouldIgnoreStatusActionableLog(entry, pauseConfig.mode)) return false
      return true
    }),
  )

  const runResult: SiteHealthRunResult = {
    runId,
    checkedAt,
    overallOk: failures.length === 0,
    durationMs: Date.now() - startedAt,
    origin,
    components,
    integrity,
    economic,
    e2e,
    failures,
    actionableIssues,
  }
  logSiteHealthOutcome(runResult)
  return runResult
}
