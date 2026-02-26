import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvBindings, IngestMessage } from '../src/types'

const mocks = vi.hoisted(() => ({
  getCachedEndpoint: vi.fn(),
  discoverProductsEndpoint: vi.fn(),
  fetchResidentialMortgageProductIds: vi.fn(),
  fetchProductDetailRows: vi.fn(),
  extractLenderRatesFromHtml: vi.fn(),
  persistRawPayload: vi.fn(),
  upsertHistoricalRateRows: vi.fn(),
  recordRunQueueOutcome: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('../src/db/endpoint-cache', () => ({
  getCachedEndpoint: mocks.getCachedEndpoint,
}))

vi.mock('../src/ingest/cdr', async () => {
  const actual = await vi.importActual<typeof import('../src/ingest/cdr')>('../src/ingest/cdr')
  return {
    ...actual,
    discoverProductsEndpoint: mocks.discoverProductsEndpoint,
    fetchResidentialMortgageProductIds: mocks.fetchResidentialMortgageProductIds,
    fetchProductDetailRows: mocks.fetchProductDetailRows,
  }
})

vi.mock('../src/ingest/html-rate-parser', () => ({
  extractLenderRatesFromHtml: mocks.extractLenderRatesFromHtml,
}))

vi.mock('../src/db/raw-payloads', () => ({
  persistRawPayload: mocks.persistRawPayload,
}))

vi.mock('../src/db/historical-rates', () => ({
  upsertHistoricalRateRows: mocks.upsertHistoricalRateRows,
}))

vi.mock('../src/db/run-reports', async () => {
  const actual = await vi.importActual<typeof import('../src/db/run-reports')>('../src/db/run-reports')
  return {
    ...actual,
    recordRunQueueOutcome: mocks.recordRunQueueOutcome,
  }
})

vi.mock('../src/utils/logger', () => ({
  log: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
  },
}))

import { consumeIngestQueue } from '../src/queue/consumer'

function makeMockD1(): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => null as unknown,
        all: async () => ({ results: [], meta: { duration: 0 } }),
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      }),
      first: async () => null as unknown,
      all: async () => ({ results: [], meta: { duration: 0 } }),
      run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database
}

function makeEnv(): EnvBindings {
  return {
    DB: makeMockD1(),
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    MAX_QUEUE_ATTEMPTS: '3',
  }
}

describe('queue daily lender no-data handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><body>No mortgage rates</body></html>', { status: 200 })),
    )
    mocks.getCachedEndpoint.mockResolvedValue(null)
    mocks.discoverProductsEndpoint.mockResolvedValue(null)
    mocks.fetchResidentialMortgageProductIds.mockResolvedValue({
      productIds: [],
      rawPayloads: [],
    })
    mocks.fetchProductDetailRows.mockResolvedValue({
      rows: [],
      rawPayload: { sourceUrl: 'https://example.com', status: 200, body: '{}' },
    })
    mocks.extractLenderRatesFromHtml.mockReturnValue({
      rows: [],
      inspected: 0,
      dropped: 0,
    })
    mocks.persistRawPayload.mockResolvedValue(undefined)
    mocks.upsertHistoricalRateRows.mockResolvedValue(0)
    mocks.recordRunQueueOutcome.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('acks queue message and records success when no mortgage signals are found', async () => {
    const ack = vi.fn()
    const retry = vi.fn()

    await consumeIngestQueue(
      {
        messages: [
          {
            body: {
              kind: 'daily_lender_fetch',
              runId: 'daily:2026-02-26:test',
              runSource: 'scheduled',
              lenderCode: 'amp',
              collectionDate: '2026-02-26',
              attempt: 0,
              idempotencyKey: 'daily:2026-02-26:test:amp',
            },
            attempts: 1,
            ack,
            retry,
          },
        ],
      } as unknown as MessageBatch<IngestMessage>,
      makeEnv(),
    )

    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(mocks.upsertHistoricalRateRows).not.toHaveBeenCalled()
    expect(mocks.persistRawPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        httpStatus: 204,
        notes: 'daily_no_data lender=amp',
      }),
    )
    expect(mocks.recordRunQueueOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: 'daily:2026-02-26:test',
        lenderCode: 'amp',
        success: true,
      }),
    )
    expect(mocks.logError).not.toHaveBeenCalledWith(
      'consumer',
      expect.stringContaining('queue_message_failed'),
      expect.anything(),
    )
  })
})
