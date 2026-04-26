import { describe, expect, it } from 'vitest'
import { finalizeLenderDataset } from '../src/queue/consumer/finalization'
import type { LenderDatasetRunRow } from '../src/db/lender-dataset-runs'
import type { EnvBindings, IngestMessage } from '../src/types'

function makeEnv(): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<IngestMessage>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
  }
}

function makeRunRow(overrides: Partial<LenderDatasetRunRow>): LenderDatasetRunRow {
  return {
    run_id: 'run:fixture',
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
    index_fetch_succeeded: 1,
    accepted_row_count: 1,
    written_row_count: 1,
    dropped_row_count: 0,
    unchanged_row_count: 0,
    detail_fetch_event_count: 1,
    lineage_error_count: 0,
    ...overrides,
  }
}

describe('finalization ordering', () => {
  it('does not mark finalized when presence update throws', async () => {
    const order: string[] = []
    const deps = {
      getLenderDatasetRun: async () => makeRunRow({ run_id: 'run:1' }),
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
      getLenderDatasetRun: async () => makeRunRow({ run_id: 'run:2' }),
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
      getLenderDatasetRun: async () =>
        makeRunRow({
          run_id: 'run:3',
          lender_code: 'ubank',
          bank_name: 'ubank',
          expected_detail_count: 0,
          completed_detail_count: 0,
          index_fetch_succeeded: 1,
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

  it('does not finalize when index fetch did not succeed and detail work was expected', async () => {
    const deps = {
      getLenderDatasetRun: async () =>
        makeRunRow({
          run_id: 'run:4',
          expected_detail_count: 1,
          completed_detail_count: 0,
          index_fetch_succeeded: 0,
        }),
      finalizePresenceForRun: async () => ({
        seenProducts: 0,
        removedProducts: 0,
        removedSeries: 0,
      }),
      tryMarkLenderDatasetFinalized: async () => true,
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    const result = await finalizeLenderDataset(
      makeEnv(),
      {
        runId: 'run:4',
        lenderCode: 'anz',
        dataset: 'home_loans',
      },
      { throwIfNotReady: false },
      deps,
    )

    expect(result).toBe(false)
  })

  it('does not throw when throwIfNotReady and details still in queue (finalize races product_detail)', async () => {
    const deps = {
      getLenderDatasetRun: async () =>
        makeRunRow({
          run_id: 'run:race',
          expected_detail_count: 1,
          completed_detail_count: 0,
          failed_detail_count: 0,
          accepted_row_count: 0,
          written_row_count: 0,
          detail_fetch_event_count: 0,
        }),
      finalizePresenceForRun: async () => ({
        seenProducts: 0,
        removedProducts: 0,
        removedSeries: 0,
      }),
      tryMarkLenderDatasetFinalized: async () => true,
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    const result = await finalizeLenderDataset(
      makeEnv(),
      {
        runId: 'run:race',
        lenderCode: 'macquarie',
        dataset: 'term_deposits',
      },
      { throwIfNotReady: true },
      deps,
    )

    expect(result).toBe(false)
  })

  it('finalizes zero-expected runs without index success (no detail work to wait on)', async () => {
    const order: string[] = []
    const deps = {
      getLenderDatasetRun: async () =>
        makeRunRow({
          run_id: 'run:4b',
          expected_detail_count: 0,
          completed_detail_count: 0,
          index_fetch_succeeded: 0,
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
        runId: 'run:4b',
        lenderCode: 'ubank',
        dataset: 'home_loans',
      },
      { throwIfNotReady: false },
      deps,
    )

    expect(result).toBe(true)
    expect(order).toEqual(['mark_finalized'])
  })

  it('does not finalize when failed detail fetches remain', async () => {
    const deps = {
      getLenderDatasetRun: async () =>
        makeRunRow({
          run_id: 'run:5',
          expected_detail_count: 2,
          completed_detail_count: 1,
          failed_detail_count: 1,
        }),
      finalizePresenceForRun: async () => ({
        seenProducts: 0,
        removedProducts: 0,
        removedSeries: 0,
      }),
      tryMarkLenderDatasetFinalized: async () => true,
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    const result = await finalizeLenderDataset(
      makeEnv(),
      {
        runId: 'run:5',
        lenderCode: 'anz',
        dataset: 'home_loans',
      },
      { throwIfNotReady: false },
      deps,
    )

    expect(result).toBe(false)
  })

  it('finalizes terminal no-row runs when all expected detail work completed', async () => {
    const deps = {
      getLenderDatasetRun: async () =>
        makeRunRow({
          run_id: 'run:6',
          expected_detail_count: 2,
          completed_detail_count: 2,
          accepted_row_count: 0,
          written_row_count: 0,
          detail_fetch_event_count: 2,
        }),
      finalizePresenceForRun: async () => ({
        seenProducts: 0,
        removedProducts: 0,
        removedSeries: 0,
      }),
      tryMarkLenderDatasetFinalized: async () => true,
      markLenderDatasetDetailProcessed: async () => {},
    } as Parameters<typeof finalizeLenderDataset>[3]

    const result = await finalizeLenderDataset(
      makeEnv(),
      {
        runId: 'run:6',
        lenderCode: 'great_southern',
        dataset: 'home_loans',
      },
      { throwIfNotReady: false },
      deps,
    )

    expect(result).toBe(true)
  })
})
