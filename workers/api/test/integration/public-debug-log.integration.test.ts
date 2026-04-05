import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

function uniqueSession(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function assertDebugLogRoundTrip(basePath: string, section: string, message: string) {
  const sessionId = uniqueSession(section)
  const postResponse = await SELF.fetch(`https://example.com${basePath}/debug-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      level: 'warn',
      message,
      url: `https://example.com${basePath.replace('/api', '')}/`,
      data: { section, code: 'chart_render_degraded' },
    }),
  })
  expect(postResponse.status).toBe(200)
  const postJson = await postResponse.json() as { ok: boolean; count: number }
  expect(postJson.ok).toBe(true)
  expect(postJson.count).toBeGreaterThan(0)

  const getResponse = await SELF.fetch(`https://example.com${basePath}/debug-log?session=${encodeURIComponent(sessionId)}`)
  expect(getResponse.status).toBe(200)
  const getJson = await getResponse.json() as {
    ok: boolean
    entries: Array<{ message?: string; data?: { code?: string; section?: string } }>
  }
  expect(getJson.ok).toBe(true)
  expect(getJson.entries.some((entry) => entry.message === message)).toBe(true)
  expect(getJson.entries.some((entry) => entry.data?.code === 'chart_render_degraded' && entry.data?.section === section)).toBe(true)
}

describe('public debug-log routes', () => {
  it('accepts debug-log traffic under the home-loan namespace', async () => {
    await assertDebugLogRoundTrip('/api/home-loan-rates', 'home-loans', 'Home loan chart render degraded')
  })

  it('accepts debug-log traffic under the savings namespace', async () => {
    await assertDebugLogRoundTrip('/api/savings-rates', 'savings', 'Savings chart render degraded')
  })
})
