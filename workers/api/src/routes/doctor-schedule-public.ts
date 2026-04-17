import type { Hono } from 'hono'
import { getAppConfig } from '../db/app-config'
import { getReadDb } from '../db/read-db'
import type { AppContext } from '../types'
import { DOCTOR_SCHEDULE_KEY } from '../constants'
import { resolvedDoctorScheduleFromStored } from '../utils/doctor-schedule'
import { withPublicCache } from '../utils/http'

/** GET /doctor-schedule — hour (0–23) and IANA zone for scheduled GitHub doctor; no secrets. */
export function registerDoctorSchedulePublicRoute(routes: Hono<AppContext>): void {
  routes.get('/doctor-schedule', async (c) => {
    withPublicCache(c, 120)
    const raw = await getAppConfig(getReadDb(c), DOCTOR_SCHEDULE_KEY)
    const { hour, time_zone } = resolvedDoctorScheduleFromStored(raw)
    return c.json({ ok: true, hour, time_zone })
  })
}
