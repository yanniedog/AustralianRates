import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvBindings } from '../src/types'

const mocks = vi.hoisted(() => ({
  acquireRunLock: vi.fn(),
  releaseRunLock: vi.fn(),
  ensureDatasetCoverageRows: vi.fn(),
  getDatasetCoverageProgressRows: vi.fn(),
  getGlobalDatasetFirstCoverageDates: vi.fn(),
  setDatasetCoverageState: vi.fn(),
  startHistoricalPullRun: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

function addUtcDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map((part) => Number(part))
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() + days)
  return cursor.toISOString().slice(0, 10)
}

vi.mock('../src/durable/run-lock', () => ({
  acquireRunLock: mocks.acquireRunLock,
  releaseRunLock: mocks.releaseRunLock,
}))

vi.mock('../src/db/dataset-coverage', () => ({
  COVERAGE_DATASETS: ['mortgage', 'savings', 'term_deposits'],
  addUtcDays,
  ensureDatasetCoverageRows: mocks.ensureDatasetCoverageRows,
  getDatasetCoverageProgressRows: mocks.getDatasetCoverageProgressRows,
  getGlobalDatasetFirstCoverageDates: mocks.getGlobalDatasetFirstCoverageDates,
  setDatasetCoverageState: mocks.setDatasetCoverageState,
}))

vi.mock('../src/pipeline/client-historical', () => ({
  startHistoricalPullRun: mocks.startHistoricalPullRun,
}))

vi.mock('../src/utils/logger', () => ({
  log: {
    info: mocks.logInfo,
    error: mocks.logError,
  },
}))

import { handleScheduledHourlyWayback } from '../src/pipeline/hourly-wayback'

function makeEnv(): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<never>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    LOCK_TTL_SECONDS: '7200',
  }
}

describe('hourly wayback pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireRunLock.mockResolvedValue({ ok: true, acquired: true })
    mocks.releaseRunLock.mockResolvedValue({ ok: true, released: true })
    mocks.ensureDatasetCoverageRows.mockResolvedValue(undefined)
    mocks.setDatasetCoverageState.mockResolvedValue(undefined)
  })

  it('enqueues one date per dataset and decrements each cursor by one day', async () => {
    mocks.getGlobalDatasetFirstCoverageDates.mockResolvedValue({
      mortgage: '2026-02-20',
      savings: '2026-02-18',
      term_deposits: '2026-02-10',
    })
    mocks.getDatasetCoverageProgressRows.mockResolvedValue([
      { dataset_key: 'mortgage', cursor_date: null },
      { dataset_key: 'savings', cursor_date: null },
      { dataset_key: 'term_deposits', cursor_date: null },
    ])
    mocks.startHistoricalPullRun
      .mockResolvedValueOnce({ ok: true, value: { run_id: 'run-m', range_days: 1, tasks_queued: 15 } })
      .mockResolvedValueOnce({ ok: true, value: { run_id: 'run-s', range_days: 1, tasks_queued: 15 } })
      .mockResolvedValueOnce({ ok: true, value: { run_id: 'run-t', range_days: 1, tasks_queued: 15 } })

    const result = await handleScheduledHourlyWayback(
      { scheduledTime: Date.parse('2026-02-24T09:00:00.000Z') } as ScheduledController,
      makeEnv(),
    )

    expect(result).toMatchObject({ ok: true, skipped: false })
    expect(mocks.startHistoricalPullRun).toHaveBeenCalledTimes(3)
    expect(mocks.startHistoricalPullRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        productScope: 'mortgage',
        startDate: '2026-02-19',
        endDate: '2026-02-19',
        runSource: 'scheduled',
      }),
    )
    expect(mocks.startHistoricalPullRun).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        productScope: 'savings',
        startDate: '2026-02-17',
        endDate: '2026-02-17',
        runSource: 'scheduled',
      }),
    )
    expect(mocks.startHistoricalPullRun).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        productScope: 'term_deposits',
        startDate: '2026-02-09',
        endDate: '2026-02-09',
        runSource: 'scheduled',
      }),
    )

    expect(mocks.setDatasetCoverageState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dataset: 'mortgage',
        cursorDate: '2026-02-18',
        status: 'active',
      }),
    )
    expect(mocks.setDatasetCoverageState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dataset: 'savings',
        cursorDate: '2026-02-16',
        status: 'active',
      }),
    )
    expect(mocks.setDatasetCoverageState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dataset: 'term_deposits',
        cursorDate: '2026-02-08',
        status: 'active',
      }),
    )
  })

  it('marks dataset completed when cursor is below lower bound', async () => {
    mocks.getGlobalDatasetFirstCoverageDates.mockResolvedValue({
      mortgage: '1996-01-02',
      savings: null,
      term_deposits: null,
    })
    mocks.getDatasetCoverageProgressRows.mockResolvedValue([
      { dataset_key: 'mortgage', cursor_date: '1995-12-31' },
      { dataset_key: 'savings', cursor_date: null },
      { dataset_key: 'term_deposits', cursor_date: null },
    ])
    mocks.startHistoricalPullRun.mockResolvedValue({ ok: true, value: { run_id: 'unused', range_days: 1, tasks_queued: 1 } })

    await handleScheduledHourlyWayback(
      { scheduledTime: Date.parse('2026-02-24T09:00:00.000Z') } as ScheduledController,
      makeEnv(),
    )

    expect(mocks.startHistoricalPullRun).not.toHaveBeenCalled()
    expect(mocks.setDatasetCoverageState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dataset: 'mortgage',
        status: 'completed_lower_bound',
      }),
    )
  })
})
