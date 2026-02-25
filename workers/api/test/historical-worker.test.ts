import { describe, expect, it } from 'vitest'
import { buildBatchRequests, chunkRows, parseRunId } from '../src/tools/historical-worker'

describe('historical worker helpers', () => {
  it('parses run id from cli args', () => {
    expect(parseRunId(['--run-id', 'run-123'])).toBe('run-123')
    expect(parseRunId(['--foo', 'x'])).toBe('')
  })

  it('chunks rows with safe minimum size', () => {
    expect(chunkRows([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(chunkRows([1, 2, 3], 0)).toEqual([[1], [2], [3]])
  })

  it('builds deterministic batch requests across product types', () => {
    const mortgageRows = Array.from({ length: 75 }, (_, i) => ({ id: `m-${i}` }))
    const savingsRows = [{ id: 's-0' }]
    const tdRows = Array.from({ length: 51 }, (_, i) => ({ id: `t-${i}` }))

    const batches = buildBatchRequests({
      runId: 'run-x',
      workerId: 'worker-1',
      taskId: 42,
      hadSignals: true,
      mortgageRows,
      savingsRows,
      tdRows,
    })

    expect(batches).toHaveLength(5)
    expect(batches.map((x) => x.batch_id)).toEqual([
      'run-x:42:m:1',
      'run-x:42:m:2',
      'run-x:42:s:3',
      'run-x:42:t:4',
      'run-x:42:t:5',
    ])
    expect(batches[0].mortgage_rows).toHaveLength(50)
    expect(batches[1].mortgage_rows).toHaveLength(25)
    expect(batches[2].savings_rows).toHaveLength(1)
    expect(batches[3].td_rows).toHaveLength(50)
    expect(batches[4].td_rows).toHaveLength(1)
    expect(batches.every((x) => x.had_signals)).toBe(true)
  })
})
