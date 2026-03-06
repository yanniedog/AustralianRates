import { describe, expect, it } from 'vitest'
import { finalizeLenderDataset } from '../src/queue/consumer/finalization'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeEnv(): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
  }
}

describe('finalization ordering', () => {
  it('does not mark finalized when presence update throws', async () => {
    const order: string[] = []
    const deps = {
      getLenderDatasetRun: async () => ({
        run_id: 'run:1',
        lender_code: 'anz',
        dataset_kind: 'home_loans',
        bank_name: 'ANZ',
        collection_date: '2026-03-01',
        expected_detail_count: 1,
        completed_detail_count: 1,
        failed_detail_count: 0,
        finalized_at: null,
        last_error: null,
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
      finalizePresenceForRun: async () => {
        order.push('presence')
        throw new Error('presence_write_failed')
      },
      tryMarkLenderDatasetFinalized: async () => {
        order.push('mark_finalized')
        return true
      },
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    await expect(
      finalizeLenderDataset(
        makeEnv(),
        {
          runId: 'run:1',
          lenderCode: 'anz',
          dataset: 'home_loans',
        },
        { throwIfNotReady: false },
        deps,
      ),
    ).rejects.toThrow(/presence_write_failed/)

    expect(order).toEqual(['presence'])
  })

  it('marks finalized only after presence succeeds', async () => {
    const order: string[] = []
    const deps = {
      getLenderDatasetRun: async () => ({
        run_id: 'run:2',
        lender_code: 'anz',
        dataset_kind: 'home_loans',
        bank_name: 'ANZ',
        collection_date: '2026-03-01',
        expected_detail_count: 1,
        completed_detail_count: 1,
        failed_detail_count: 0,
        finalized_at: null,
        last_error: null,
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
      finalizePresenceForRun: async () => {
        order.push('presence')
        return {
          seenProducts: 1,
          removedProducts: 0,
          removedSeries: 0,
        }
      },
      tryMarkLenderDatasetFinalized: async () => {
        order.push('mark_finalized')
        return true
      },
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    const result = await finalizeLenderDataset(
      makeEnv(),
      {
        runId: 'run:2',
        lenderCode: 'anz',
        dataset: 'home_loans',
      },
      { throwIfNotReady: false },
      deps,
    )

    expect(result).toBe(true)
    expect(order).toEqual(['presence', 'mark_finalized'])
  })

  it('finalizes zero-expected runs without presence removal', async () => {
    const order: string[] = []
    const deps = {
      getLenderDatasetRun: async () => ({
        run_id: 'run:3',
        lender_code: 'ubank',
        dataset_kind: 'home_loans',
        bank_name: 'ubank',
        collection_date: '2026-03-01',
        expected_detail_count: 0,
        completed_detail_count: 0,
        failed_detail_count: 0,
        finalized_at: null,
        last_error: null,
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
      finalizePresenceForRun: async () => {
        order.push('presence')
        return {
          seenProducts: 0,
          removedProducts: 0,
          removedSeries: 0,
        }
      },
      tryMarkLenderDatasetFinalized: async () => {
        order.push('mark_finalized')
        return true
      },
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    const result = await finalizeLenderDataset(
      makeEnv(),
      {
        runId: 'run:3',
        lenderCode: 'ubank',
        dataset: 'home_loans',
      },
      { throwIfNotReady: false },
      deps,
    )

    expect(result).toBe(true)
    expect(order).toEqual(['mark_finalized'])
  })
})
