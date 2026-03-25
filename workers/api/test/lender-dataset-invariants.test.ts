import { describe, expect, it } from 'vitest'
import {
  assessLenderDatasetCoverage,
  isLenderDatasetCollectionComplete,
  isLenderDatasetReadyForFinalization,
} from '../src/utils/lender-dataset-invariants'
import westpacSavingsGap from './fixtures/real-westpac-savings-gap-lender-dataset-row.json'

function readinessSnapshotFromFixture(row: {
  expected_detail_count: number
  index_fetch_succeeded: number
  accepted_row_count: number
  written_row_count: number
  detail_fetch_event_count: number
  lineage_error_count: number
  completed_detail_count: number
  failed_detail_count: number
}) {
  return { ...row }
}

describe('lender dataset invariants', () => {
  it('treats successful zero-expected rows as ready and complete only after finalization', () => {
    const base = {
      expected_detail_count: 0,
      index_fetch_succeeded: 1,
      accepted_row_count: 0,
      written_row_count: 0,
      detail_fetch_event_count: 0,
      lineage_error_count: 0,
      completed_detail_count: 0,
      failed_detail_count: 0,
      finalized_at: null,
    }

    expect(isLenderDatasetReadyForFinalization(base)).toEqual({ ready: true, reason: null })
    expect(isLenderDatasetCollectionComplete(base)).toBe(false)
    expect(isLenderDatasetCollectionComplete({ ...base, finalized_at: '2026-03-14T00:00:00.000Z' })).toBe(true)
  })

  it('flags failed detail fetches and missing writes as coverage gaps', () => {
    const assessment = assessLenderDatasetCoverage({
      expected_detail_count: 2,
      index_fetch_succeeded: 1,
      accepted_row_count: 0,
      written_row_count: 0,
      detail_fetch_event_count: 2,
      lineage_error_count: 0,
      completed_detail_count: 1,
      failed_detail_count: 1,
      finalized_at: null,
    })

    expect(assessment.severity).toBe('error')
    expect(assessment.reasons).toContain('failed_detail_fetches_present')
    expect(assessment.reasons).toContain('zero_written_rows_for_nonzero_expected_details')
    expect(assessment.reasons).toContain('dataset_not_finalized')
  })

  it('allows finalization when majority of detail fetches completed (partial success)', () => {
    const snapshot = {
      expected_detail_count: 13,
      index_fetch_succeeded: 1,
      accepted_row_count: 20,
      written_row_count: 20,
      detail_fetch_event_count: 17,
      lineage_error_count: 0,
      completed_detail_count: 12,
      failed_detail_count: 5,
    }
    expect(isLenderDatasetReadyForFinalization(snapshot)).toEqual({ ready: true, reason: null })
  })

  it('allows finalization when exactly one detail is missing but at least one completed (e.g. one stuck message)', () => {
    const snapshot = {
      expected_detail_count: 5,
      index_fetch_succeeded: 1,
      accepted_row_count: 170,
      written_row_count: 170,
      detail_fetch_event_count: 4,
      lineage_error_count: 0,
      completed_detail_count: 4,
      failed_detail_count: 0,
    }
    expect(isLenderDatasetReadyForFinalization(snapshot)).toEqual({ ready: true, reason: null })
  })

  it('blocks finalization when completed share is below threshold despite some success', () => {
    const snapshot = {
      expected_detail_count: 10,
      index_fetch_succeeded: 1,
      accepted_row_count: 5,
      written_row_count: 5,
      detail_fetch_event_count: 10,
      lineage_error_count: 0,
      completed_detail_count: 5,
      failed_detail_count: 5,
    }
    expect(isLenderDatasetReadyForFinalization(snapshot)).toEqual({
      ready: false,
      reason: 'failed_detail_fetches_present',
    })
  })

  it('production Westpac savings gap fixture (real lender_dataset row) is not ready: stale force-close must skip', () => {
    expect(isLenderDatasetReadyForFinalization(readinessSnapshotFromFixture(westpacSavingsGap))).toEqual({
      ready: false,
      reason: 'detail_processing_incomplete',
    })
  })

  it('same real fixture with all 17 details completed is ready for finalization', () => {
    const complete = {
      ...westpacSavingsGap,
      completed_detail_count: 17,
      detail_fetch_event_count: 17,
    }
    expect(isLenderDatasetReadyForFinalization(readinessSnapshotFromFixture(complete))).toEqual({
      ready: true,
      reason: null,
    })
  })
})
