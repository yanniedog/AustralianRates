import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvBindings, IngestMessage } from '../src/types'

const mocks = vi.hoisted(() => ({
  claimHistoricalTaskById: vi.fn(),
  getHistoricalRunById: vi.fn(),
  addHistoricalTaskBatchCounts: vi.fn(),
  finalizeHistoricalTask: vi.fn(),
  recordDatasetCoverageRunOutcome: vi.fn(),
  getCachedEndpoint: vi.fn(),
  discoverProductsEndpoint: vi.fn(),
  collectHistoricalDayFromWayback: vi.fn(),
  upsertHistoricalRateRows: vi.fn(),
  upsertSavingsRateRows: vi.fn(),
  upsertTdRateRows: vi.fn(),
  persistRawPayload: vi.fn(),
  validateNormalizedRow: vi.fn(),
  validateNormalizedSavingsRow: vi.fn(),
  validateNormalizedTdRow: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('../src/db/client-historical-runs', () => ({
  claimHistoricalTaskById: mocks.claimHistoricalTaskById,
  getHistoricalRunById: mocks.getHistoricalRunById,
  addHistoricalTaskBatchCounts: mocks.addHistoricalTaskBatchCounts,
  finalizeHistoricalTask: mocks.finalizeHistoricalTask,
}))

vi.mock('../src/db/dataset-coverage', () => ({
  recordDatasetCoverageRunOutcome: mocks.recordDatasetCoverageRunOutcome,
}))

vi.mock('../src/db/endpoint-cache', () => ({
  getCachedEndpoint: mocks.getCachedEndpoint,
}))

vi.mock('../src/ingest/cdr', async () => {
  const actual = await vi.importActual<typeof import('../src/ingest/cdr')>('../src/ingest/cdr')
  return {
    ...actual,
    discoverProductsEndpoint: mocks.discoverProductsEndpoint,
  }
})

vi.mock('../src/ingest/wayback-historical', () => ({
  collectHistoricalDayFromWayback: mocks.collectHistoricalDayFromWayback,
}))

vi.mock('../src/db/historical-rates', () => ({
  upsertHistoricalRateRows: mocks.upsertHistoricalRateRows,
}))

vi.mock('../src/db/savings-rates', () => ({
  upsertSavingsRateRows: mocks.upsertSavingsRateRows,
}))

vi.mock('../src/db/td-rates', () => ({
  upsertTdRateRows: mocks.upsertTdRateRows,
}))

vi.mock('../src/db/raw-payloads', () => ({
  persistRawPayload: mocks.persistRawPayload,
}))

vi.mock('../src/ingest/normalize', () => ({
  validateNormalizedRow: mocks.validateNormalizedRow,
}))

vi.mock('../src/ingest/normalize-savings', () => ({
  validateNormalizedSavingsRow: mocks.validateNormalizedSavingsRow,
  validateNormalizedTdRow: mocks.validateNormalizedTdRow,
}))

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
    HISTORICAL_TASK_CLAIM_TTL_SECONDS: '900',
  }
}

describe('queue historical task execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateNormalizedRow.mockReturnValue({ ok: true })
    mocks.validateNormalizedSavingsRow.mockReturnValue({ ok: true })
    mocks.validateNormalizedTdRow.mockReturnValue({ ok: true })
    mocks.persistRawPayload.mockResolvedValue(undefined)
    mocks.addHistoricalTaskBatchCounts.mockResolvedValue(undefined)
    mocks.finalizeHistoricalTask.mockResolvedValue({ status: 'completed' })
    mocks.recordDatasetCoverageRunOutcome.mockResolvedValue(true)
    mocks.getCachedEndpoint.mockResolvedValue({ endpointUrl: 'https://example.com/products' })
    mocks.discoverProductsEndpoint.mockResolvedValue({ endpointUrl: 'https://example.com/products' })
  })

  it('processes historical task end-to-end and applies product scope filtering', async () => {
    mocks.claimHistoricalTaskById.mockResolvedValue({
      task_id: 42,
      run_id: 'historical-run-1',
      lender_code: 'cba',
      collection_date: '2026-01-15',
      status: 'claimed',
      claimed_by: 'worker',
      claimed_at: '2026-01-15T00:00:00.000Z',
      claim_expires_at: '2026-01-15T00:15:00.000Z',
      completed_at: null,
      attempt_count: 1,
      mortgage_rows: 0,
      savings_rows: 0,
      td_rows: 0,
      had_signals: 0,
      last_error: null,
      updated_at: '2026-01-15T00:00:00.000Z',
    })
    mocks.getHistoricalRunById
      .mockResolvedValueOnce({
        run_id: 'historical-run-1',
        trigger_source: 'admin',
        product_scope: 'savings',
        run_source: 'scheduled',
        start_date: '2026-01-15',
        end_date: '2026-01-15',
        status: 'running',
        total_tasks: 1,
        pending_tasks: 0,
        claimed_tasks: 1,
        completed_tasks: 0,
        failed_tasks: 0,
        mortgage_rows: 0,
        savings_rows: 0,
        td_rows: 0,
        requested_by: 'scheduler',
        created_at: '2026-01-15T00:00:00.000Z',
        updated_at: '2026-01-15T00:00:00.000Z',
        started_at: '2026-01-15T00:00:00.000Z',
        finished_at: null,
      })
      .mockResolvedValueOnce({
        run_id: 'historical-run-1',
        trigger_source: 'admin',
        product_scope: 'savings',
        run_source: 'scheduled',
        start_date: '2026-01-15',
        end_date: '2026-01-15',
        status: 'completed',
        total_tasks: 1,
        pending_tasks: 0,
        claimed_tasks: 0,
        completed_tasks: 1,
        failed_tasks: 0,
        mortgage_rows: 0,
        savings_rows: 3,
        td_rows: 0,
        requested_by: 'scheduler',
        created_at: '2026-01-15T00:00:00.000Z',
        updated_at: '2026-01-15T00:02:00.000Z',
        started_at: '2026-01-15T00:00:00.000Z',
        finished_at: '2026-01-15T00:02:00.000Z',
      })
    mocks.collectHistoricalDayFromWayback.mockResolvedValue({
      mortgageRows: [{ productId: 'm-1' }],
      savingsRows: [{ productId: 's-1' }],
      tdRows: [{ productId: 't-1' }],
      hadSignals: true,
      payloads: [],
      counters: { cdx_requests: 1, snapshot_requests: 1, mortgage_rows: 1, savings_rows: 1, td_rows: 1 },
    })
    mocks.upsertHistoricalRateRows.mockResolvedValue(0)
    mocks.upsertSavingsRateRows.mockResolvedValue(3)
    mocks.upsertTdRateRows.mockResolvedValue(0)

    const ack = vi.fn()
    const retry = vi.fn()
    await consumeIngestQueue(
      {
        messages: [
          {
            body: {
              kind: 'historical_task_execute',
              runId: 'historical-run-1',
              runSource: 'scheduled',
              taskId: 42,
              attempt: 0,
              idempotencyKey: 'hist:1',
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
    expect(mocks.upsertSavingsRateRows).toHaveBeenCalledTimes(1)
    expect(mocks.upsertHistoricalRateRows).toHaveBeenCalledWith(expect.anything(), [])
    expect(mocks.upsertTdRateRows).toHaveBeenCalledWith(expect.anything(), [])
    expect(mocks.addHistoricalTaskBatchCounts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskId: 42,
        runId: 'historical-run-1',
        mortgageRows: 0,
        savingsRows: 3,
        tdRows: 0,
      }),
    )
    expect(mocks.recordDatasetCoverageRunOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dataset: 'savings',
        runId: 'historical-run-1',
        runStatus: 'completed',
        rowsWritten: 3,
      }),
    )
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'consumer',
      'historical_task_execute completed',
      expect.objectContaining({
        runId: 'historical-run-1',
      }),
    )
  })

  it('logs historical completion as warn when rows are parsed but nothing is written', async () => {
    mocks.claimHistoricalTaskById.mockResolvedValue({
      task_id: 43,
      run_id: 'historical-run-2',
      lender_code: 'cba',
      collection_date: '2026-01-16',
      status: 'claimed',
      claimed_by: 'worker',
      claimed_at: '2026-01-16T00:00:00.000Z',
      claim_expires_at: '2026-01-16T00:15:00.000Z',
      completed_at: null,
      attempt_count: 1,
      mortgage_rows: 0,
      savings_rows: 0,
      td_rows: 0,
      had_signals: 0,
      last_error: null,
      updated_at: '2026-01-16T00:00:00.000Z',
    })
    mocks.getHistoricalRunById.mockResolvedValue({
      run_id: 'historical-run-2',
      trigger_source: 'admin',
      product_scope: 'savings',
      run_source: 'scheduled',
      start_date: '2026-01-16',
      end_date: '2026-01-16',
      status: 'completed',
      total_tasks: 1,
      pending_tasks: 0,
      claimed_tasks: 0,
      completed_tasks: 1,
      failed_tasks: 0,
      mortgage_rows: 0,
      savings_rows: 0,
      td_rows: 0,
      requested_by: 'scheduler',
      created_at: '2026-01-16T00:00:00.000Z',
      updated_at: '2026-01-16T00:02:00.000Z',
      started_at: '2026-01-16T00:00:00.000Z',
      finished_at: '2026-01-16T00:02:00.000Z',
    })
    mocks.collectHistoricalDayFromWayback.mockResolvedValue({
      mortgageRows: [],
      savingsRows: [{ productId: 's-2' }],
      tdRows: [],
      hadSignals: true,
      payloads: [],
      counters: { cdx_requests: 1, snapshot_requests: 1, mortgage_rows: 0, savings_rows: 1, td_rows: 0 },
    })
    mocks.validateNormalizedSavingsRow.mockReturnValue({ ok: false, reason: 'missing_required_field' })
    mocks.upsertHistoricalRateRows.mockResolvedValue(0)
    mocks.upsertSavingsRateRows.mockResolvedValue(0)
    mocks.upsertTdRateRows.mockResolvedValue(0)

    const ack = vi.fn()
    const retry = vi.fn()
    await consumeIngestQueue(
      {
        messages: [
          {
            body: {
              kind: 'historical_task_execute',
              runId: 'historical-run-2',
              runSource: 'scheduled',
              taskId: 43,
              attempt: 0,
              idempotencyKey: 'hist:2',
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
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'consumer',
      'historical_task_execute completed',
      expect.objectContaining({
        runId: 'historical-run-2',
        context: expect.stringContaining('completion=warn_no_writes'),
      }),
    )
  })
})
