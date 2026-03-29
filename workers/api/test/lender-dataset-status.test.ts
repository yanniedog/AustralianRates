import { describe, expect, it } from 'vitest'
import {
  pickBestDailyLenderDatasetStatusRows,
  type DailyLenderDatasetStatusRow,
} from '../src/db/lender-dataset-status'

function makeRow(overrides: Partial<DailyLenderDatasetStatusRow>): DailyLenderDatasetStatusRow {
  return {
    run_id: 'run:1',
    run_source: 'scheduled',
    lender_code: 'westpac',
    dataset_kind: 'home_loans',
    bank_name: 'Westpac Banking Corporation',
    collection_date: '2026-03-29',
    expected_detail_count: 11,
    index_fetch_succeeded: 1,
    accepted_row_count: 11,
    written_row_count: 11,
    detail_fetch_event_count: 11,
    lineage_error_count: 0,
    completed_detail_count: 11,
    failed_detail_count: 0,
    finalized_at: '2026-03-29T00:10:00.000Z',
    updated_at: '2026-03-29T00:10:00.000Z',
    ...overrides,
  }
}

describe('pickBestDailyLenderDatasetStatusRows', () => {
  it('prefers an older complete run over a newer incomplete reconcile attempt', () => {
    const rows = pickBestDailyLenderDatasetStatusRows([
      makeRow({
        run_id: 'run:older-complete',
        updated_at: '2026-03-29T00:10:00.000Z',
      }),
      makeRow({
        run_id: 'run:newer-incomplete',
        run_source: 'manual',
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 0,
        completed_detail_count: 0,
        finalized_at: null,
        updated_at: '2026-03-29T16:40:00.000Z',
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].run_id).toBe('run:older-complete')
  })

  it('prefers an older healthy complete run over a newer complete row with accepted-written mismatch', () => {
    const rows = pickBestDailyLenderDatasetStatusRows([
      makeRow({
        run_id: 'run:older-healthy',
        updated_at: '2026-03-29T00:10:00.000Z',
      }),
      makeRow({
        run_id: 'run:newer-tainted-complete',
        run_source: 'manual',
        accepted_row_count: 37,
        written_row_count: 35,
        finalized_at: '2026-03-29T16:40:00.000Z',
        updated_at: '2026-03-29T16:40:00.000Z',
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].run_id).toBe('run:older-healthy')
  })

  it('prefers the newest finalized row when no complete row exists', () => {
    const rows = pickBestDailyLenderDatasetStatusRows([
      makeRow({
        run_id: 'run:older-finalized',
        expected_detail_count: 0,
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 0,
        completed_detail_count: 0,
        finalized_at: '2026-03-29T00:10:00.000Z',
        updated_at: '2026-03-29T00:10:00.000Z',
      }),
      makeRow({
        run_id: 'run:newer-finalized',
        expected_detail_count: 0,
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 0,
        completed_detail_count: 0,
        finalized_at: '2026-03-29T16:44:00.000Z',
        updated_at: '2026-03-29T16:44:00.000Z',
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].run_id).toBe('run:newer-finalized')
  })
})
