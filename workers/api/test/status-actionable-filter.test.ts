import { describe, expect, it } from 'vitest'
import { shouldIgnoreStatusActionableLog } from '../src/utils/status-actionable-filter'

describe('shouldIgnoreStatusActionableLog', () => {
  it('ignores resolved ingest-paused warnings outside repair mode', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          code: 'ingest_paused',
          level: 'warn',
          source: 'scheduler',
          message: 'Scheduled daily ingest paused by app config',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores known ubank upstream-block noise in status summaries', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          lender_code: 'ubank',
          source: 'consumer',
          message: 'daily_savings_lender_fetch empty_result',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores cdr audit gaps in status summaries because the audit has its own panel', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'admin',
          message: 'cdr_audit_detected_gaps',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('keeps the same warning actionable for other lenders', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          lender_code: 'cba',
          source: 'consumer',
          message: 'daily_savings_lender_fetch empty_result',
        },
        'active',
      ),
    ).toBe(false)
  })
})
