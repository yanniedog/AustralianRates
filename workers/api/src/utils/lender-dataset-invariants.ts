export type LenderDatasetInvariantSnapshot = {
  expected_detail_count: number
  index_fetch_succeeded: number
  accepted_row_count: number
  written_row_count: number
  detail_fetch_event_count: number
  lineage_error_count: number
  completed_detail_count: number
  failed_detail_count: number
  finalized_at: string | null
}

export type LenderDatasetCoverageSeverity = 'ok' | 'warn' | 'error'

export type LenderDatasetCoverageAssessment = {
  severity: LenderDatasetCoverageSeverity
  reasons: string[]
  expectedDetails: number
  completedDetails: number
  failedDetails: number
  processedDetails: number
  writtenRows: number
  acceptedRows: number
  detailFetchEvents: number
}

function asCount(value: number | string | null | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

function hasIndexSuccess(snapshot: Pick<LenderDatasetInvariantSnapshot, 'index_fetch_succeeded'>): boolean {
  return asCount(snapshot.index_fetch_succeeded) > 0
}

export function assessLenderDatasetCoverage(
  snapshot: Pick<
    LenderDatasetInvariantSnapshot,
    | 'expected_detail_count'
    | 'index_fetch_succeeded'
    | 'accepted_row_count'
    | 'written_row_count'
    | 'detail_fetch_event_count'
    | 'lineage_error_count'
    | 'completed_detail_count'
    | 'failed_detail_count'
    | 'finalized_at'
  >,
): LenderDatasetCoverageAssessment {
  const expectedDetails = asCount(snapshot.expected_detail_count)
  const completedDetails = asCount(snapshot.completed_detail_count)
  const failedDetails = asCount(snapshot.failed_detail_count)
  const processedDetails = completedDetails + failedDetails
  const writtenRows = asCount(snapshot.written_row_count)
  const acceptedRows = asCount(snapshot.accepted_row_count)
  const detailFetchEvents = asCount(snapshot.detail_fetch_event_count)
  const reasons: string[] = []

  if (!hasIndexSuccess(snapshot)) {
    reasons.push('index_fetch_not_succeeded')
  }
  if (asCount(snapshot.lineage_error_count) > 0) {
    reasons.push('lineage_errors_present')
  }
  if (acceptedRows > writtenRows) {
    reasons.push('accepted_written_mismatch')
  }
  if (failedDetails > 0) {
    reasons.push('failed_detail_fetches_present')
  }
  if (processedDetails < expectedDetails) {
    reasons.push('detail_processing_incomplete')
  }
  const terminalNoAcceptedRows = isCompletedWithNoAcceptedRows(snapshot)
  if (expectedDetails > 0 && writtenRows <= 0 && !terminalNoAcceptedRows) {
    reasons.push('zero_written_rows_for_nonzero_expected_details')
  }
  if (expectedDetails > 0 && acceptedRows <= 0 && !terminalNoAcceptedRows) {
    reasons.push('zero_accepted_rows_for_nonzero_expected_details')
  }
  if (expectedDetails > 0 && detailFetchEvents <= 0) {
    reasons.push('detail_fetch_events_missing')
  }
  if (!snapshot.finalized_at) {
    reasons.push('dataset_not_finalized')
  }

  let severity: LenderDatasetCoverageSeverity = 'ok'
  if (reasons.length > 0) {
    severity =
      reasons.length === 1 && reasons[0] === 'dataset_not_finalized'
        ? 'warn'
        : 'error'
  }

  return {
    severity,
    reasons,
    expectedDetails,
    completedDetails,
    failedDetails,
    processedDetails,
    writtenRows,
    acceptedRows,
    detailFetchEvents,
  }
}

/** Minimum share of expected detail fetches that must complete to allow finalization when some failed (e.g. bank returns 400 for a few product IDs). */
const MIN_COMPLETED_RATIO_FOR_PARTIAL_FINALIZATION = 0.75

function isCompletedWithNoAcceptedRows(
  snapshot: Pick<
    LenderDatasetInvariantSnapshot,
    | 'expected_detail_count'
    | 'accepted_row_count'
    | 'written_row_count'
    | 'detail_fetch_event_count'
    | 'completed_detail_count'
    | 'failed_detail_count'
  >,
): boolean {
  const expectedDetails = asCount(snapshot.expected_detail_count)
  const acceptedRows = asCount(snapshot.accepted_row_count)
  const writtenRows = asCount(snapshot.written_row_count)
  const detailFetchEvents = asCount(snapshot.detail_fetch_event_count)
  const completedDetails = asCount(snapshot.completed_detail_count)
  const failedDetails = asCount(snapshot.failed_detail_count)
  const processedDetails = completedDetails + failedDetails
  if (expectedDetails <= 0) return false
  if (processedDetails < expectedDetails) return false
  if (failedDetails > 0) return false
  if (detailFetchEvents < expectedDetails) return false
  return acceptedRows <= 0 && writtenRows <= 0
}

export function isLenderDatasetReadyForFinalization(
  snapshot: Pick<
    LenderDatasetInvariantSnapshot,
    | 'expected_detail_count'
    | 'index_fetch_succeeded'
    | 'accepted_row_count'
    | 'written_row_count'
    | 'detail_fetch_event_count'
    | 'lineage_error_count'
    | 'completed_detail_count'
    | 'failed_detail_count'
  >,
): { ready: boolean; reason: string | null } {
  if (asCount(snapshot.lineage_error_count) > 0) {
    return { ready: false, reason: 'lineage_errors_present' }
  }
  const expectedDetails = asCount(snapshot.expected_detail_count)
  const completedDetails = asCount(snapshot.completed_detail_count)
  const failedDetails = asCount(snapshot.failed_detail_count)
  const processedDetails = completedDetails + failedDetails

  if (expectedDetails <= 0) {
    return { ready: true, reason: null }
  }
  if (!hasIndexSuccess(snapshot)) {
    return { ready: false, reason: 'index_fetch_not_succeeded' }
  }
  // Before data checks: if detail jobs are still in the queue, report incomplete — not "zero accepted".
  // Otherwise lender_finalize (enqueued with product_detail) races ahead and falsely signals validation failure.
  // The "one short" bypass is only for the known-stuck case where some rows already landed; if accepted is
  // still zero, one product may still be in flight — keep reporting incomplete, not zero_accepted.
  if (processedDetails < expectedDetails) {
    return { ready: false, reason: 'detail_processing_incomplete' }
  }
  // Some CDR product details legitimately contain no ingestible rate rows (e.g. business-only shells).
  // If all expected detail jobs completed and none failed, allow finalization as a terminal no-row outcome.
  if (isCompletedWithNoAcceptedRows(snapshot)) {
    return { ready: true, reason: null }
  }
  if (asCount(snapshot.accepted_row_count) > asCount(snapshot.written_row_count)) {
    return { ready: false, reason: 'accepted_written_mismatch' }
  }
  if (asCount(snapshot.accepted_row_count) <= 0) {
    return { ready: false, reason: 'zero_accepted_rows_for_nonzero_expected_details' }
  }
  if (asCount(snapshot.written_row_count) <= 0) {
    return { ready: false, reason: 'zero_written_rows_for_nonzero_expected_details' }
  }
  if (asCount(snapshot.detail_fetch_event_count) <= 0) {
    return { ready: false, reason: 'detail_fetch_events_missing' }
  }
  if (processedDetails < expectedDetails) return { ready: false, reason: 'detail_processing_incomplete' }
  if (failedDetails > 0) {
    const minCompleted = Math.ceil(expectedDetails * MIN_COMPLETED_RATIO_FOR_PARTIAL_FINALIZATION)
    if (completedDetails < minCompleted) {
      return { ready: false, reason: 'failed_detail_fetches_present' }
    }
  }
  return { ready: true, reason: null }
}

export function isLenderDatasetCollectionComplete(
  snapshot: Pick<LenderDatasetInvariantSnapshot, keyof LenderDatasetInvariantSnapshot>,
): boolean {
  const readiness = isLenderDatasetReadyForFinalization(snapshot)
  if (!readiness.ready) return false
  if (!snapshot.finalized_at) return false
  if (
    asCount(snapshot.expected_detail_count) > 0 &&
    asCount(snapshot.written_row_count) <= 0 &&
    !isCompletedWithNoAcceptedRows(snapshot)
  ) {
    return false
  }
  return true
}
