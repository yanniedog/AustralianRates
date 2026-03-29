import { describe, expect, it } from 'vitest'
import { filterResolvedScheduledDispatchFailureLogEntriesWithLatestSuccessTs } from '../src/db/scheduled-log-resolution'

describe('filterResolvedScheduledDispatchFailureLogEntriesWithLatestSuccessTs', () => {
  it('drops stale scheduler dispatch failures after a later scheduled success', async () => {
    const result = filterResolvedScheduledDispatchFailureLogEntriesWithLatestSuccessTs([
      {
        source: 'scheduler',
        message: 'Scheduled run failed',
        ts: '2026-03-29T17:02:10.792Z',
      },
      {
        source: 'scheduler',
        message: 'Coverage + site health cron dispatch failed',
        ts: '2026-03-29T17:02:10.775Z',
      },
      {
        source: 'pipeline',
        message: 'site_health_attention',
        ts: '2026-03-29T17:45:38.669Z',
      },
    ], '2026-03-29T17:46:59.817Z')

    expect(result).toEqual([
      {
        source: 'pipeline',
        message: 'site_health_attention',
        ts: '2026-03-29T17:45:38.669Z',
      },
    ])
  })
})
