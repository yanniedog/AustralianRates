import type { Hono } from 'hono'
import { getReadDb } from '../db/read-db'
import { getRbaHistory } from '../db/rba-cash-rate'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'

export function registerRbaRoutes(routes: Hono<AppContext>): void {
  routes.get('/rba/history', async (c) => {
    withPublicCache(c, 300)
    const rows = await getRbaHistory(getReadDb(c))
    return c.json({ ok: true, rows })
  })
}
