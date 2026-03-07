import { runIntegrityChecks } from '../db/integrity-checks'
import { buildLatestAllProbePath, LATEST_ALL_DATASETS } from './latest-all-probe'
import { runE2ECheck } from './e2e-alignment'
import type { EnvBindings } from '../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../utils/fetch-with-timeout'
import { log, queryLogs } from '../utils/logger'
import { toActionableIssueSummaries } from '../utils/log-actionable'
import { captureProbePayload, type ProbeCapturePolicy } from './probe-capture'
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

type ProbeValidation = 'none' | 'json_object' | 'rows_payload'

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
  e2e: Awaited<ReturnType<typeof runE2ECheck>>
  failures: string[]
  actionableIssues: ReturnType<typeof toActionableIssueSummaries>
}

function normalizeOrigin(origin: string): string {
  return String(origin || '').replace(/\/+$/, '')
}

async function requestProbe(
  env: EnvBindings,
  input: {
    origin: string
    path: string
    sourceType: string
    validation: ProbeValidation
    capturePolicy: ProbeCapturePolicy
  },
): Promise<{ ok: boolean; status: number; durationMs: number; detail?: string; fetchEventId: number | null }> {
  const url = `${normalizeOrigin(input.origin)}${input.path}`
  const startedAt = Date.now()
  try {
    const fetched = await fetchWithTimeout(url, undefined, { env })
    const res = fetched.response
    const durationMs = Date.now() - startedAt
    const bodyText = await res.text()
    log.info('pipeline', 'upstream_fetch', {
      context:
        `source=${input.sourceType} host=${hostFromUrl(url)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? res.status}`,
    })

    if (!res.ok) {
      const captured = await captureProbePayload(env, {
        sourceType: input.sourceType,
        sourceUrl: url,
        reason: 'api_unreachable',
        policy: input.capturePolicy,
        payload: bodyText,
        status: res.status,
        headers: res.headers,
        durationMs,
        note: `site_health_probe non_2xx path=${input.path}`,
      })
      return {
        ok: false,
        status: res.status,
        durationMs,
        detail: `HTTP ${res.status}`,
        fetchEventId: captured.fetchEventId,
      }
    }

    let validationError: string | null = null
    if (input.validation !== 'none') {
      const parsed = parseJsonText(bodyText)
      if (!parsed.ok) {
        validationError = parsed.reason
      } else if (input.validation === 'json_object' && !isJsonObject(parsed.value)) {
        validationError = 'payload_not_object'
      } else if (input.validation === 'rows_payload') {
        const rowsResult = parseRowsPayload(parsed.value)
        if (!rowsResult.ok) validationError = rowsResult.reason
      }
    }

    if (validationError) {
      const block = detectUpstreamBlock({
        status: res.status,
        body: bodyText,
        headers: res.headers,
      })
      const captured = await captureProbePayload(env, {
        sourceType: input.sourceType,
        sourceUrl: url,
        reason: 'api_invalid_payload',
        policy: input.capturePolicy,
        payload: bodyText,
        status: res.status,
        headers: res.headers,
        durationMs,
        note: `site_health_probe invalid_payload path=${input.path} reason=${validationError}`,
      })
      return {
        ok: false,
        status: res.status,
        durationMs,
        detail: `invalid_payload:${validationError}${block.reasonCode ? `:${block.reasonCode}` : ''}`,
        fetchEventId: captured.fetchEventId,
      }
    }

    const captured = await captureProbePayload(env, {
      sourceType: input.sourceType,
      sourceUrl: url,
      reason: 'success',
      policy: input.capturePolicy,
      payload: bodyText,
      status: res.status,
      headers: res.headers,
      durationMs,
      note: `site_health_probe ok path=${input.path}`,
    })
    return {
      ok: true,
      status: res.status,
      durationMs,
      fetchEventId: captured.fetchEventId,
    }
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

export async function runSiteHealthChecks(
  env: EnvBindings,
  input: { triggerSource: 'scheduled' | 'manual'; origin: string },
): Promise<SiteHealthRunResult> {
  const checkedAt = new Date().toISOString()
  const runId = `health:${input.triggerSource}:${checkedAt}:${crypto.randomUUID()}`
  const startedAt = Date.now()
  const origin = normalizeOrigin(input.origin)
  const capturePolicy: ProbeCapturePolicy = input.triggerSource === 'manual' ? 'always' : 'sample_success'
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

  const [datasetComponents, homepage, integrity, e2e, logs] = await Promise.all([
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
    queryLogs(env.DB, { limit: 200 }),
  ])

  const components: ComponentStatus[] = [
    ...datasetComponents.flat(),
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
  if (!e2e.aligned) failures.push(`e2e_not_aligned:${e2e.reasonCode}`)

  const actionableIssues = toActionableIssueSummaries(
    logs.entries.filter((entry) => {
      const level = String(entry.level || '').toLowerCase()
      return level === 'warn' || level === 'error'
    }),
  )

  return {
    runId,
    checkedAt,
    overallOk: failures.length === 0,
    durationMs: Date.now() - startedAt,
    origin,
    components,
    integrity,
    e2e,
    failures,
    actionableIssues,
  }
}
