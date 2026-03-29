import { describe, expect, it } from 'vitest'
import {
  pickCurrentCollectionStatusRow,
  summarizeCurrentCollectionRoster,
} from '../src/db/current-collection-integrity'
import type { DailyLenderDatasetStatusRow } from '../src/db/lender-dataset-status'

function makeStatusRow(overrides: Partial<DailyLenderDatasetStatusRow>): DailyLenderDatasetStatusRow {
  return {
    run_id: 'daily:2026-03-30:scheduled',
    run_source: 'scheduled',
    lender_code: 'bankofmelbourne',
    dataset_kind: 'home_loans',
    bank_name: 'Bank of Melbourne',
    collection_date: '2026-03-30',
    expected_detail_count: 5,
    index_fetch_succeeded: 1,
    accepted_row_count: 147,
    written_row_count: 147,
    detail_fetch_event_count: 5,
    lineage_error_count: 0,
    completed_detail_count: 5,
    failed_detail_count: 0,
    finalized_at: '2026-03-29T19:40:06.557Z',
    updated_at: '2026-03-29T19:40:06.557Z',
    ...overrides,
  }
}

describe('summarizeCurrentCollectionRoster', () => {
  it('treats successful detail fetches as accounted product outcomes', () => {
    const summary = summarizeCurrentCollectionRoster({
      expectedProductIds: ['p1', 'p2'],
      storedProductIds: ['p1'],
      successfulDetailFetchProductIds: ['p2'],
    })

    expect(summary.accountedProductIds).toEqual(['p1', 'p2'])
    expect(summary.missingExpectedProductIds).toEqual([])
    expect(summary.unexpectedStoredProductIds).toEqual([])
  })

  it('treats quarantined anomaly products as accounted outcomes without hiding unexpected stored rows', () => {
    const summary = summarizeCurrentCollectionRoster({
      expectedProductIds: ['p1', 'p2'],
      storedProductIds: ['p1', 'rogue'],
      anomalyProductIds: ['p2'],
    })

    expect(summary.accountedProductIds).toEqual(['p1', 'p2', 'rogue'])
    expect(summary.missingExpectedProductIds).toEqual([])
    expect(summary.unexpectedStoredProductIds).toEqual(['rogue'])
  })

  it('reports genuinely missing expected products when no explicit outcome exists', () => {
    const summary = summarizeCurrentCollectionRoster({
      expectedProductIds: ['p1', 'p2', 'p3'],
      storedProductIds: ['p1'],
      successfulDetailFetchProductIds: ['p2'],
    })

    expect(summary.accountedProductIds).toEqual(['p1', 'p2'])
    expect(summary.missingExpectedProductIds).toEqual(['p3'])
  })
})

describe('pickCurrentCollectionStatusRow', () => {
  it('prefers a healthy finalized daily row over a newer incomplete reconcile row', () => {
    const selected = pickCurrentCollectionStatusRow([
      makeStatusRow({
        run_id: 'daily:2026-03-30:reconcile:84c7',
        run_source: 'manual',
        accepted_row_count: 125,
        written_row_count: 125,
        detail_fetch_event_count: 4,
        completed_detail_count: 4,
        finalized_at: null,
        updated_at: '2026-03-29T19:51:39.690Z',
      }),
      makeStatusRow({}),
    ])

    expect(selected?.run_id).toBe('daily:2026-03-30:scheduled')
  })
})
