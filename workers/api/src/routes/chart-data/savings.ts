import type { Hono } from 'hono'
import { querySavingsChartData } from '../../db/chart-data/savings'
import { ChartDataRequestError } from '../../db/chart-data/errors'
import type { AppContext } from '../../types'
import { jsonError } from '../../utils/http'
import { parseOptionalNumber } from '../public-query'
import { assertDateRange, parseOptionalDateQuery, parseStringListQuery } from './common'

export function registerSavingsChartDataRoute(routes: Hono<AppContext>): void {
  routes.get('/chart-data', async (c) => {
    try {
      const lenders = parseStringListQuery(c, ['lenders', 'lenders[]'])
      const startDate = parseOptionalDateQuery(c.req.query('startDate'), 'startDate')
      const endDate = parseOptionalDateQuery(c.req.query('endDate'), 'endDate')
      assertDateRange(startDate, endDate)

      const response = await querySavingsChartData(c.env.DB, {
        lenders,
        accountType: String(c.req.query('accountType') || '').trim() || undefined,
        rateType: String(c.req.query('rateType') || '').trim() || undefined,
        depositTier: String(c.req.query('depositTier') || '').trim() || undefined,
        balanceMin: parseOptionalNumber(c.req.query('balance_min') ?? c.req.query('balanceMin')),
        balanceMax: parseOptionalNumber(c.req.query('balance_max') ?? c.req.query('balanceMax')),
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
