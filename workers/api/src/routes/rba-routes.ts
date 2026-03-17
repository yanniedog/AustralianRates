import type { Hono } from 'hono'
import { getRbaHistory } from '../db/rba-cash-rate'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'

export function registerRbaRoutes(routes: Hono<AppContext>): void {
  routes.get('/rba/history', async (c) => {
    withPublicCache(c, 300)
    const rows = await getRbaHistory(c.env.DB)
    return c.json({ ok: true, rows })
  })
}
