import { describe, expect, it } from 'vitest'
import { runWithD1Retry } from '../src/db/d1-retry'

describe('runWithD1Retry', () => {
  it('retries transient D1 failures and returns the successful result', async () => {
    let attempts = 0

    const result = await runWithD1Retry(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error('D1_ERROR: Internal error in D1 DB storage caused object to be reset.')
      }
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })
})
