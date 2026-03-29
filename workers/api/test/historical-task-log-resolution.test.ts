import { describe, expect, it } from 'vitest'
import {
  filterResolvedHistoricalTaskFailureLogEntriesWithResolvedTaskIds,
  parseHistoricalTaskIdFromLogEntry,
} from '../src/db/historical-task-log-resolution'

describe('historical task log resolution', () => {
  it('parses task ids from historical task failure logs', () => {
    expect(
      parseHistoricalTaskIdFromLogEntry({
        code: 'historical_task_execute_failed',
        message: 'historical_task_execute failed',
        context: 'task_id=109003 date=2019-12-21 error=Network connection lost.',
      }),
    ).toBe(109003)
  })

  it('filters stale failure logs once the task is known completed', () => {
    const entries = [
      {
        code: 'historical_task_execute_failed',
        message: 'historical_task_execute failed',
        context: 'task_id=109003 date=2019-12-21 error=Network connection lost.',
      },
      {
        code: 'historical_task_execute_failed',
        message: 'historical_task_execute failed',
        context: 'task_id=109004 date=2019-12-22 error=Network connection lost.',
      },
    ]

    expect(
      filterResolvedHistoricalTaskFailureLogEntriesWithResolvedTaskIds(entries, new Set([109003])),
    ).toEqual([entries[1]])
  })
})
