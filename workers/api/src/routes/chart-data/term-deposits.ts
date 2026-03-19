import type { Hono } from 'hono'
import { queryTdChartData } from '../../db/chart-data/term-deposits'
import { ChartDataRequestError } from '../../db/chart-data/errors'
import type { AppContext } from '../../types'
import { jsonError } from '../../utils/http'
import {
  assertDateRange,
  parseNumberQuery,
  parseOptionalDateQuery,
  parseStringListQuery,
} from './common'

export function registerTdChartDataRoute(routes: Hono<AppContext>): void {
  routes.get('/chart-data', async (c) => {
    try {
      const lenders = parseStringListQuery(c, ['lenders', 'lenders[]'])
      const startDate = parseOptionalDateQuery(c.req.query('startDate'), 'startDate')
      const endDate = parseOptionalDateQuery(c.req.query('endDate'), 'endDate')
      assertDateRange(startDate, endDate)

      const termMonths = parseNumberQuery(c.req.query('termMonths'), 'termMonths')
      const response = await queryTdChartData(c.env.DB, {
        lenders,
        termMonths,
        interestPayment: String(c.req.query('interestPayment') || '').trim() || undefined,
        depositTier: String(c.req.query('depositTier') || '').trim() || undefined,
        startDate,
        endDate,
      })
      return c.json(response)
    } catch (error) {
      if (error instanceof ChartDataRequestError) {
        return jsonError(c, error.status as 400 | 422, error.code, error.message, error.details)
      }
      return jsonError(c, 500, 'CHART_DATA_BUILD_FAILED', 'Failed to build chart data response.')
    }
  })
}
