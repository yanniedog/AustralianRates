import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvBindings } from '../src/types'

const mocks = vi.hoisted(() => ({
  ensureAppConfigTable: vi.fn(),
  getAppConfig: vi.fn(),
  setAppConfig: vi.fn(),
  runAutoBackfillTick: vi.fn(),
  triggerDailyRun: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('../src/db/app-config', () => ({
  ensureAppConfigTable: mocks.ensureAppConfigTable,
  getAppConfig: mocks.getAppConfig,
  setAppConfig: mocks.setAppConfig,
}))

vi.mock('../src/pipeline/auto-backfill', () => ({
  runAutoBackfillTick: mocks.runAutoBackfillTick,
}))

vi.mock('../src/pipeline/bootstrap-jobs', () => ({
  triggerDailyRun: mocks.triggerDailyRun,
}))

vi.mock('../src/utils/logger', () => ({
  log: {
    info: mocks.logInfo,
    error: mocks.logError,
  },
}))

vi.mock('../src/utils/time', () => ({
  getMelbourneNowParts: vi.fn(() => ({
    date: '2026-02-24',
    hour: 17,
    minute: 0,
    second: 0,
    timeZone: 'Australia/Melbourne',
    iso: '2026-02-24T06:00:00.000Z',
  })),
}))

import { handleScheduledDaily } from '../src/pipeline/scheduled'

function makeEnv(): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<never>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
    MELBOURNE_TIMEZONE: 'Australia/Melbourne',
  }
}

describe('scheduled pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureAppConfigTable.mockResolvedValue(undefined)
    mocks.setAppConfig.mockResolvedValue(undefined)
    mocks.getAppConfig.mockImplementation(async (_db: unknown, key: string) => {
      if (key === 'rate_check_interval_minutes') return '60'
      if (key === 'rate_check_last_run_iso') return '2026-02-23T00:00:00.000Z'
      return null
    })
    mocks.runAutoBackfillTick.mockResolvedValue({
      ok: true,
      enqueued: 2,
      cap: 16,
      considered: 16,
    })
  })

  it('uses a per-cron run id so each hourly tick can enqueue work', async () => {
    mocks.triggerDailyRun.mockResolvedValue({
      ok: true,
      skipped: false,
      runId: 'daily:2026-02-24:2026-02-24T06:00:00.000Z',
      collectionDate: '2026-02-24',
      enqueued: 12,
    })

    await handleScheduledDaily(
      { scheduledTime: Date.parse('2026-02-24T06:00:00.000Z') } as ScheduledController,
      makeEnv(),
    )

    expect(mocks.triggerDailyRun).toHaveBeenCalledTimes(1)
    expect(mocks.triggerDailyRun).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: 'scheduled',
        runIdOverride: 'daily:2026-02-24:2026-02-24T06:00:00.000Z',
      }),
    )

    expect(mocks.setAppConfig).toHaveBeenCalledWith(
      expect.anything(),
      'rate_check_last_run_iso',
      '2026-02-24T06:00:00.000Z',
    )
  })

  it('does NOT update rate_check_last_run_iso when run is skipped', async () => {
    mocks.triggerDailyRun.mockResolvedValue({
      ok: true,
      skipped: true,
      reason: 'run_already_exists',
      runId: 'daily:2026-02-24:2026-02-24T06:00:00.000Z',
      collectionDate: '2026-02-24',
    })

    const result = await handleScheduledDaily(
      { scheduledTime: Date.parse('2026-02-24T06:00:00.000Z') } as ScheduledController,
      makeEnv(),
    )

    expect(result.skipped).toBe(true)
    expect(mocks.setAppConfig).not.toHaveBeenCalled()
  })

  it('uses event.scheduledTime for interval comparison to avoid timing drift', async () => {
    mocks.getAppConfig.mockImplementation(async (_db: unknown, key: string) => {
      if (key === 'rate_check_interval_minutes') return '60'
      if (key === 'rate_check_last_run_iso') return '2026-02-24T00:00:00.000Z'
      return null
    })

    mocks.triggerDailyRun.mockResolvedValue({
      ok: true,
      skipped: false,
      runId: 'daily:2026-02-24:2026-02-24T06:00:00.000Z',
      collectionDate: '2026-02-24',
      enqueued: 12,
    })

    await handleScheduledDaily(
      { scheduledTime: Date.parse('2026-02-24T06:00:00.000Z') } as ScheduledController,
      makeEnv(),
    )

    expect(mocks.triggerDailyRun).toHaveBeenCalledTimes(1)
  })

  it('continues historical auto-backfill on scheduled ticks when daily data is already fresh', async () => {
    mocks.triggerDailyRun.mockResolvedValue({
      ok: true,
      skipped: true,
      reason: 'already_fresh_for_date',
      runId: 'daily:2026-02-24:2026-02-24T12:00:00.000Z',
      collectionDate: '2026-02-24',
    })

    await handleScheduledDaily(
      { scheduledTime: Date.parse('2026-02-24T12:00:00.000Z') } as ScheduledController,
      makeEnv(),
    )

    expect(mocks.runAutoBackfillTick).toHaveBeenCalledTimes(1)
    expect(mocks.runAutoBackfillTick).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runId: 'daily:2026-02-24:2026-02-24T12:00:00.000Z',
        collectionDate: '2026-02-24',
        runSource: 'scheduled',
      }),
    )
  })
})
