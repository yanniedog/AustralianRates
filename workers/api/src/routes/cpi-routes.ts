import type { Hono } from 'hono'
import { getCpiHistory } from '../db/cpi-data'
import type { AppContext } from '../types'
import { withPublicCache } from '../utils/http'

export function registerCpiRoutes(routes: Hono<AppContext>): void {
  routes.get('/cpi/history', async (c) => {
    withPublicCache(c, 3600) // quarterly data; cache for 1 hour
    const rows = await getCpiHistory(c.env.DB)
    return c.json({ ok: true, rows })
  })
}
