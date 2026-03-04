import { describe, expect, it } from 'vitest'
import { extractTraceback, normalizeLogEntryForStorage, parseLogContext } from '../src/utils/logger'

describe('logger traceback enrichment', () => {
  it('adds traceback and error metadata for warn/error logs with an Error object', () => {
    const normalized = normalizeLogEntryForStorage({
      level: 'error',
      source: 'api',
      message: 'request_failed',
      error: new Error('boom'),
      context: { route: '/api/home-loan-rates/admin/cdr-audit/run' },
    })

    expect(typeof normalized.context).toBe('string')
    const parsed = parseLogContext(normalized.context)
    expect(parsed).toMatchObject({
      context: { route: '/api/home-loan-rates/admin/cdr-audit/run' },
      error: { name: 'Error', message: 'boom' },
    })
    expect(typeof extractTraceback(normalized.context)).toBe('string')
    expect(String(extractTraceback(normalized.context))).toContain('Error: boom')
  })

  it('does not inject traceback into info logs without error objects', () => {
    const normalized = normalizeLogEntryForStorage({
      level: 'info',
      source: 'scheduler',
      message: 'tick_complete',
      context: { run_id: 'run:123' },
    })

    expect(normalized.traceback).toBeUndefined()
    expect(parseLogContext(normalized.context)).toEqual({ run_id: 'run:123' })
    expect(extractTraceback(normalized.context)).toBeNull()
  })
})
