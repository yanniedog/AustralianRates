import { describe, expect, it } from 'vitest'
import { dispatchInternalPublicApiRequest, isInternalPublicApiUrl } from '../src/pipeline/internal-public-api-request'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeEnv(): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    PUBLIC_API_BASE_PATH: '/api/home-loan-rates',
    WORKER_VERSION: 'test-version',
    MELBOURNE_TIMEZONE: 'Australia/Melbourne',
    FEATURE_PROSPECTIVE_ENABLED: 'true',
    FEATURE_BACKFILL_ENABLED: 'true',
    PUBLIC_HISTORICAL_MAX_RANGE_DAYS: '30',
    MELBOURNE_TARGET_HOUR: '6',
  }
}

describe('internal public API request dispatch', () => {
  it('recognizes official public API hosts', () => {
    expect(isInternalPublicApiUrl('https://www.australianrates.com/api/home-loan-rates/health')).toBe(true)
    expect(isInternalPublicApiUrl('https://australianrates.com/api/savings-rates/health')).toBe(true)
    expect(isInternalPublicApiUrl('https://www.australianrates.com/')).toBe(false)
    expect(isInternalPublicApiUrl('https://probe.example.com/api/home-loan-rates/health')).toBe(false)
  })

  it('dispatches health probes through the matching internal route', async () => {
    const response = await dispatchInternalPublicApiRequest({
      url: 'https://www.australianrates.com/api/home-loan-rates/health',
      env: makeEnv(),
    })

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    const body = await response?.json() as { ok: boolean; service: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('australianrates-api')
  })

  it('returns null for non-API URLs', async () => {
    const response = await dispatchInternalPublicApiRequest({
      url: 'https://www.australianrates.com/',
      env: makeEnv(),
    })

    expect(response).toBeNull()
  })
})
