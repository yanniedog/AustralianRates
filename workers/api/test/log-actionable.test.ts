import { describe, expect, it } from 'vitest'
import { toActionableIssueSummaries } from '../src/utils/log-actionable'

describe('toActionableIssueSummaries', () => {
  it('does not surface replay_queue_dispatched as an actionable issue', () => {
    const issues = toActionableIssueSummaries([
      {
        ts: '2026-03-29T05:45:19.864Z',
        level: 'warn',
        source: 'consumer',
        message: 'replay_queue_dispatched',
        code: 'replay_queue_dispatched',
      },
    ])

    expect(issues).toEqual([])
  })

  it('suppresses an earlier replay_queue_dispatch_failed when a later dispatch succeeds', () => {
    const issues = toActionableIssueSummaries([
      {
        ts: '2026-03-29T05:30:49.851Z',
        level: 'error',
        source: 'scheduler',
        message: 'Replay queue dispatch failed',
        code: 'replay_queue_dispatch_failed',
      },
      {
        ts: '2026-03-29T05:45:19.864Z',
        level: 'warn',
        source: 'consumer',
        message: 'replay_queue_dispatched',
        code: 'replay_queue_dispatched',
      },
    ])

    expect(issues).toEqual([])
  })
})
