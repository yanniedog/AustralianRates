import type { Hono } from 'hono'
import { queryHomeLoanChartData } from '../../db/chart-data/home-loans'
import { ChartDataRequestError } from '../../db/chart-data/errors'
import type { AppContext } from '../../types'
import { jsonError } from '../../utils/http'
import {
  assertDateRange,
  parseBooleanQuery,
  parseNumberQuery,
  parseOptionalDateQuery,
  parseStringListQuery,
} from './common'

export function registerHomeLoanChartDataRoute(routes: Hono<AppContext>): void {
  routes.get('/chart-data', async (c) => {
    try {
      const lenders = parseStringListQuery(c, ['lenders', 'lenders[]'])
      const lvr = parseNumberQuery(c.req.query('lvr'), 'lvr')
      const repaymentType = String(c.req.query('repaymentType') || '').trim() as 'P&I' | 'IO'
      const occupancy = String(c.req.query('occupancy') || '').trim() as 'Owner' | 'Investor'
      const offset = parseBooleanQuery(c.req.query('offset'), 'offset')
      const startDate = parseOptionalDateQuery(c.req.query('startDate'), 'startDate')
      const endDate = parseOptionalDateQuery(c.req.query('endDate'), 'endDate')

      if (lvr == null) throw new ChartDataRequestError(400, 'INVALID_LVR', 'lvr is required.')
      if (repaymentType !== 'P&I' && repaymentType !== 'IO') {
        throw new ChartDataRequestError(400, 'INVALID_REPAYMENT_TYPE', 'repaymentType must be P&I or IO.')
      }
      if (occupancy !== 'Owner' && occupancy !== 'Investor') {
        throw new ChartDataRequestError(400, 'INVALID_OCCUPANCY', 'occupancy must be Owner or Investor.')
      }
      if (offset == null) throw new ChartDataRequestError(400, 'INVALID_OFFSET', 'offset is required.')
      assertDateRange(startDate, endDate)

      const response = await queryHomeLoanChartData(c.env.DB, {
        lenders,
        lvr,
        repaymentType,
        occupancy,
        offset,
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
