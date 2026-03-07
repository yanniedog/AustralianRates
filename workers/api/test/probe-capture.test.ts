import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureProbePayload } from '../src/pipeline/probe-capture'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeEnv(): EnvBindings {
  let lastRowId = 900
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return this
          },
          async first() {
            if (sql.includes('FROM raw_objects')) return null
            return null
          },
          async run() {
            if (sql.includes('INSERT INTO fetch_events')) {
              lastRowId += 1
              return { meta: { last_row_id: lastRowId, changes: 1 } }
            }
            return { meta: { changes: 1 } }
          },
        }
      },
    } as unknown as D1Database,
    RAW_BUCKET: {
      async put() {},
    } as unknown as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('probe payload capture policy', () => {
  it('always captures successful probe payloads for manual checks', async () => {
    const env = makeEnv()

    const result = await captureProbePayload(env, {
      sourceType: 'probe_site_health_dataset_latest_all',
      sourceUrl: 'https://example.test/api/latest-all?source_mode=all',
      reason: 'success',
      policy: 'always',
      payload: { rows: [{ collection_date: '2026-03-07' }] },
      status: 200,
      note: 'manual_health_check',
    })

    expect(result.captured).toBe(true)
    expect(result.fetchEventId).toBe(901)
    expect(result.sampledSuccess).toBe(false)
  })

  it('skips successful capture when sampled success policy does not hit', async () => {
    const env = makeEnv()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const result = await captureProbePayload(env, {
      sourceType: 'probe_site_health_dataset_latest_all',
      sourceUrl: 'https://example.test/api/latest-all?source_mode=all',
      reason: 'success',
      policy: 'sample_success',
      payload: { rows: [] },
      status: 200,
    })

    expect(result.captured).toBe(false)
    expect(result.fetchEventId).toBeNull()
    expect(result.sampledSuccess).toBe(false)
  })
})
