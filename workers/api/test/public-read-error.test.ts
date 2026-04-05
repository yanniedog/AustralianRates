import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { handlePublicReadFailure } from '../src/routes/public-read-error'
import type { AppContext } from '../src/types'

describe('public read failure handler', () => {
  it('returns a stable 500 payload with no-store headers', async () => {
    const app = new Hono<AppContext>()
    app.get('/fail', (c) =>
      handlePublicReadFailure(
        c,
        'home_loan_rates_query_failed',
        'PUBLIC_RATES_QUERY_FAILED',
        'Failed to query home loan rates.',
        new Error('db_down'),
      ),
    )

    const response = await app.request('https://example.com/fail')
    const json = await response.json() as { ok?: boolean; error?: { code?: string; message?: string } }

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(json.ok).toBe(false)
    expect(json.error?.code).toBe('PUBLIC_RATES_QUERY_FAILED')
    expect(json.error?.message).toBe('Failed to query home loan rates.')
  })
})
