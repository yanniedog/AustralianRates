import { SELF } from '@cloudflare/workers-test'
import { describe, expect, it } from 'vitest'

describe('public security compatibility', () => {
  it('returns stable 403 payload for public log routes', async () => {
    for (const path of ['/api/home-loan-rates/logs', '/api/home-loan-rates/logs/stats']) {
      const response = await SELF.fetch(`https://example.com${path}`)
      expect(response.status).toBe(403)
      const json = (await response.json()) as {
        ok?: boolean
        error?: { code?: string }
      }
      expect(json.ok).toBe(false)
      expect(json.error?.code).toBe('PUBLIC_LOGS_DISABLED')
    }
  })

  it('requires admin authentication for admin routes', async () => {
    const response = await SELF.fetch('https://example.com/api/home-loan-rates/admin/runs')
    expect(response.status).toBe(401)
  })
}
)