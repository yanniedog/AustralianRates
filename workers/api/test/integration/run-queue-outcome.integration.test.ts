import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  buildInitialPerLenderSummary,
  createRunReport,
  isLenderQueueOutcomeRecorded,
  recordRunQueueOutcome,
  recordRunQueueOutcomeIfAbsent,
} from '../../src/db/run-reports'

const RUN_ID = 'daily:2026-06-25:queue-outcome-integration'

describe('run queue outcome idempotency', () => {
  it('records a missing lender outcome when idempotency duplicate ACKs after first worker crash', async () => {
    await env.DB.prepare('DELETE FROM run_reports WHERE run_id = ?1').bind(RUN_ID).run()
    await createRunReport(env.DB, {
      runId: RUN_ID,
      runType: 'daily',
      perLenderSummary: buildInitialPerLenderSummary({ anz: 1, cba: 1 }),
    })

    const summaryBefore = buildInitialPerLenderSummary({ anz: 1, cba: 1 })
    expect(isLenderQueueOutcomeRecorded(summaryBefore, 'anz')).toBe(false)

    const first = await recordRunQueueOutcomeIfAbsent(env.DB, {
      runId: RUN_ID,
      lenderCode: 'anz',
      success: true,
    })
    expect(first?.status).toBe('running')

    const afterFirst = await recordRunQueueOutcome(env.DB, {
      runId: RUN_ID,
      lenderCode: 'cba',
      success: true,
    })
    expect(afterFirst?.status).toBe('ok')

    const duplicateAck = await recordRunQueueOutcomeIfAbsent(env.DB, {
      runId: RUN_ID,
      lenderCode: 'anz',
      success: true,
    })
    expect(duplicateAck?.status).toBe('ok')

    const row = await env.DB
      .prepare('SELECT per_lender_json FROM run_reports WHERE run_id = ?1')
      .bind(RUN_ID)
      .first<{ per_lender_json: string }>()
    const summary = JSON.parse(String(row?.per_lender_json || '{}')) as {
      _meta: { processed_total: number }
      anz: { processed: number }
      cba: { processed: number }
    }
    expect(summary._meta.processed_total).toBe(2)
    expect(summary.anz.processed).toBe(1)
    expect(summary.cba.processed).toBe(1)
  })

  it('records outcome on duplicate path when the first worker never counted the lender', async () => {
    const runId = `${RUN_ID}:missing`
    await env.DB.prepare('DELETE FROM run_reports WHERE run_id = ?1').bind(runId).run()
    await createRunReport(env.DB, {
      runId,
      runType: 'daily',
      perLenderSummary: buildInitialPerLenderSummary({ wbc: 1 }),
    })

    const finalised = await recordRunQueueOutcomeIfAbsent(env.DB, {
      runId,
      lenderCode: 'wbc',
      success: true,
    })
    expect(finalised?.status).toBe('ok')
    expect(finalised?.finished_at).toBeTruthy()
  })
})
