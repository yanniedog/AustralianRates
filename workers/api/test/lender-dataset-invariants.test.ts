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
  it('reports detail_processing_incomplete when no details finished yet (finalize queue race vs product_detail)', () => {
    expect(
      isLenderDatasetReadyForFinalization({
        expected_detail_count: 1,
        index_fetch_succeeded: 1,
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 0,
        lineage_error_count: 0,
        completed_detail_count: 0,
        failed_detail_count: 0,
      }),
    ).toEqual({ ready: false, reason: 'detail_processing_incomplete' })
  })

  it('reports detail_processing_incomplete when one product is still in flight and no rows accepted yet (not zero_accepted)', () => {
    expect(
      isLenderDatasetReadyForFinalization({
        expected_detail_count: 5,
        index_fetch_succeeded: 1,
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 4,
        lineage_error_count: 0,
        completed_detail_count: 4,
        failed_detail_count: 0,
      }),
    ).toEqual({ ready: false, reason: 'detail_processing_incomplete' })
  })

  it('allows terminal finalization when all detail jobs completed but no rows were accepted', () => {
    expect(
      isLenderDatasetReadyForFinalization({
        expected_detail_count: 1,
        index_fetch_succeeded: 1,
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 1,
        lineage_error_count: 0,
        completed_detail_count: 1,
        failed_detail_count: 0,
      }),
    ).toEqual({ ready: true, reason: null })
  })

  it('allows terminal finalization for multi-detail runs when all details completed but no rows were accepted', () => {
    expect(
      isLenderDatasetReadyForFinalization({
        expected_detail_count: 3,
        index_fetch_succeeded: 1,
        accepted_row_count: 0,
        written_row_count: 0,
        detail_fetch_event_count: 3,
        lineage_error_count: 0,
        completed_detail_count: 3,
        failed_detail_count: 0,
      }),
    ).toEqual({ ready: true, reason: null })
  })

  it('treats terminal no-row completion as complete once finalized', () => {
    const terminalNoRow = {
      expected_detail_count: 1,
      index_fetch_succeeded: 1,
      accepted_row_count: 0,
      written_row_count: 0,
      detail_fetch_event_count: 1,
      lineage_error_count: 0,
      completed_detail_count: 1,
      failed_detail_count: 0,
      finalized_at: '2026-03-26T00:00:00.000Z',
    }
    expect(isLenderDatasetCollectionComplete(terminalNoRow)).toBe(true)
  })

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

  it('treats zero-expected rows as ready even when index was never marked (no detail work)', () => {
    const base = {
      expected_detail_count: 0,
      index_fetch_succeeded: 0,
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

  it('flags accepted-written mismatches as a coverage error', () => {
    const assessment = assessLenderDatasetCoverage({
      expected_detail_count: 2,
      index_fetch_succeeded: 1,
      accepted_row_count: 4,
      written_row_count: 2,
      detail_fetch_event_count: 2,
      lineage_error_count: 0,
      completed_detail_count: 2,
      failed_detail_count: 0,
      finalized_at: '2026-03-30T00:00:00.000Z',
    })

    expect(assessment.severity).toBe('error')
    expect(assessment.reasons).toContain('accepted_written_mismatch')
  })

  it('does not flag terminal no-row completion as zero-accepted coverage error', () => {
    const assessment = assessLenderDatasetCoverage({
      expected_detail_count: 1,
      index_fetch_succeeded: 1,
      accepted_row_count: 0,
      written_row_count: 0,
      detail_fetch_event_count: 1,
      lineage_error_count: 0,
      completed_detail_count: 1,
      failed_detail_count: 0,
      finalized_at: '2026-03-26T00:00:00.000Z',
    })

    expect(assessment.severity).toBe('ok')
    expect(assessment.reasons).not.toContain('zero_accepted_rows_for_nonzero_expected_details')
    expect(assessment.reasons).not.toContain('zero_written_rows_for_nonzero_expected_details')
  })

  it('does not flag multi-detail terminal no-row completion as a coverage error', () => {
    const assessment = assessLenderDatasetCoverage({
      expected_detail_count: 3,
      index_fetch_succeeded: 1,
      accepted_row_count: 0,
      written_row_count: 0,
      detail_fetch_event_count: 3,
      lineage_error_count: 0,
      completed_detail_count: 3,
      failed_detail_count: 0,
      finalized_at: '2026-03-26T00:00:00.000Z',
    })

    expect(assessment.severity).toBe('ok')
    expect(assessment.reasons).not.toContain('zero_accepted_rows_for_nonzero_expected_details')
    expect(assessment.reasons).not.toContain('zero_written_rows_for_nonzero_expected_details')
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

  it('does not classify allowed partial-finalization runs as coverage gaps', () => {
    const assessment = assessLenderDatasetCoverage({
      expected_detail_count: 13,
      index_fetch_succeeded: 1,
      accepted_row_count: 20,
      written_row_count: 20,
      detail_fetch_event_count: 17,
      lineage_error_count: 0,
      completed_detail_count: 12,
      failed_detail_count: 5,
      finalized_at: '2026-04-06T00:00:00.000Z',
    })

    expect(assessment.severity).toBe('ok')
    expect(assessment.reasons).not.toContain('failed_detail_fetches_present')
  })

  it('blocks finalization when even one detail is still missing', () => {
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
    expect(isLenderDatasetReadyForFinalization(snapshot)).toEqual({
      ready: false,
      reason: 'detail_processing_incomplete',
    })
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

  it('blocks finalization when accepted rows do not all persist', () => {
    const snapshot = {
      expected_detail_count: 4,
      index_fetch_succeeded: 1,
      accepted_row_count: 6,
      written_row_count: 4,
      detail_fetch_event_count: 4,
      lineage_error_count: 0,
      completed_detail_count: 4,
      failed_detail_count: 0,
    }
    expect(isLenderDatasetReadyForFinalization(snapshot)).toEqual({
      ready: false,
      reason: 'accepted_written_mismatch',
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
