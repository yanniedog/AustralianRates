import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { shouldBypassLatestCache } from '../src/routes/latest-response'
import type { AppContext } from '../src/types'

function makeApp() {
  const app = new Hono<AppContext>()
  app.get('/latest-all', (c) => c.json({ bypass: shouldBypassLatestCache(c, false) }))
  return app
}

describe('latest cache bypass policy', () => {
  it('bypasses cache for internal probe requests', async () => {
    const response = await makeApp().request('https://internal.australianrates.test/latest-all')
    const body = (await response.json()) as { bypass: boolean }

    expect(body.bypass).toBe(true)
  })

  it('keeps cache enabled for ordinary public requests', async () => {
    const response = await makeApp().request('https://www.australianrates.com/latest-all')
    const body = (await response.json()) as { bypass: boolean }

    expect(body.bypass).toBe(false)
  })
})
