import { describe, expect, it } from 'vitest'
import type { CoverageGapAuditReport } from '../src/pipeline/coverage-gap-audit'
import {
  groupCoverageGapRowsForRemediation,
  resolveCoverageGapReconcileAction,
} from '../src/pipeline/coverage-gap-remediation'

function gapRow(
  input: Partial<CoverageGapAuditReport['rows'][number]> & {
    lender_code: string
    dataset_kind: 'home_loans' | 'savings' | 'term_deposits'
    collection_date: string
  },
): CoverageGapAuditReport['rows'][number] {
  return {
    run_id: input.run_id || `run:${input.lender_code}:${input.dataset_kind}`,
    lender_code: input.lender_code,
    bank_name: input.bank_name || input.lender_code.toUpperCase(),
    dataset_kind: input.dataset_kind,
    collection_date: input.collection_date,
    severity: input.severity || 'error',
    reasons: input.reasons || ['detail_processing_incomplete'],
    expected_detail_count: input.expected_detail_count || 4,
    processed_detail_count: input.processed_detail_count || 1,
    completed_detail_count: input.completed_detail_count || 1,
    failed_detail_count: input.failed_detail_count || 0,
    written_row_count: input.written_row_count || 0,
    finalized_at: input.finalized_at || null,
    updated_at: input.updated_at || '2026-03-14T08:00:00.000Z',
  }
}

describe('coverage gap remediation grouping', () => {
  it('groups error rows by lender and collection date and merges datasets and reasons', () => {
    const scopes = groupCoverageGapRowsForRemediation([
      gapRow({
        lender_code: 'alpha',
        dataset_kind: 'home_loans',
        collection_date: '2026-03-14',
        reasons: ['detail_processing_incomplete'],
      }),
      gapRow({
        lender_code: 'alpha',
        dataset_kind: 'savings',
        collection_date: '2026-03-14',
        reasons: ['failed_detail_fetches_present'],
      }),
      gapRow({
        lender_code: 'beta',
        dataset_kind: 'term_deposits',
        collection_date: '2026-03-14',
        reasons: ['lineage_errors_present'],
      }),
    ])

    expect(scopes).toHaveLength(2)
    expect(scopes.find((scope) => scope.lender_code === 'alpha')).toMatchObject({
      lender_code: 'alpha',
      collection_date: '2026-03-14',
      datasets: ['home_loans', 'savings'],
      reasons: ['detail_processing_incomplete', 'failed_detail_fetches_present'],
      row_count: 2,
    })
    expect(scopes.find((scope) => scope.lender_code === 'beta')).toMatchObject({
      lender_code: 'beta',
      collection_date: '2026-03-14',
      datasets: ['term_deposits'],
      reasons: ['lineage_errors_present'],
      row_count: 1,
    })
  })

  it('ignores warn rows and respects the scope limit', () => {
    const scopes = groupCoverageGapRowsForRemediation([
      gapRow({
        lender_code: 'gamma',
        dataset_kind: 'home_loans',
        collection_date: '2026-03-13',
        severity: 'warn',
        reasons: ['dataset_not_finalized'],
      }),
      gapRow({
        lender_code: 'delta',
        dataset_kind: 'home_loans',
        collection_date: '2026-03-14',
      }),
      gapRow({
        lender_code: 'epsilon',
        dataset_kind: 'savings',
        collection_date: '2026-03-12',
      }),
    ], 1)

    expect(scopes).toHaveLength(1)
    expect(scopes[0].lender_code).toBe('delta')
  })
})

describe('coverage gap remediation action resolution', () => {
  it('defers manual reconcile when a scheduled daily run is already active', () => {
    const action = resolveCoverageGapReconcileAction(
      ['detail_processing_incomplete'],
      {
        ok: true,
        skipped: false,
        reason: null,
        runId: 'daily:2026-03-30:2026-03-29T18:00:26.000Z',
        enqueued: 42,
      } as never,
    )

    expect(action).toMatchObject({
      action: 'scheduled_retry_pending',
      status: 'pending',
    })
    expect(action.note).toContain('Scheduled daily retry is already enqueuing')
  })

  it('still allows reconcile when there is no active scheduled run', () => {
    const action = resolveCoverageGapReconcileAction(['detail_processing_incomplete'], null)

    expect(action).toMatchObject({
      action: 'reconcile',
      status: 'ok',
    })
  })
})
