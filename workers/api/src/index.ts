import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { API_BASE_PATH, ECONOMIC_API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from './constants'
import { HistoricalQualityAuditDO } from './durable/historical-quality-audit'
import { RunLockDO } from './durable/run-lock'
import { dispatchScheduledEvent, scheduledTasksForCron } from './pipeline/scheduler-dispatch'
import { consumeIngestQueue } from './queue/consumer'
import { adminRoutes } from './routes/admin'
import { economicPublicRoutes } from './routes/economic-public'
import { publicRoutes } from './routes/public'
import { savingsPublicRoutes } from './routes/savings-public'
import { tdPublicRoutes } from './routes/td-public'
import type { AppContext, EnvBindings, IngestMessage } from './types'
import { flushBufferedLogs, initLogger, log } from './utils/logger'
import { createD1BudgetTracker, withD1BudgetTracking, type D1WorkloadClass } from './utils/d1-budget'

const app = new Hono<AppContext>()

function parseConfiguredOrigins(raw: string | undefined): string[] {
  if (!raw) return []
  return Array.from(
    new Set(
      String(raw)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
}

app.use('*', async (c, next) => {
  initLogger(c.env.DB)
  const path = new URL(c.req.url).pathname
  const isAuthCheck = path.endsWith('/admin/auth-check')
  if (!isAuthCheck) await flushBufferedLogs()
  await next()
  await flushBufferedLogs()
})

app.use('*', logger())
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.github.com'],
    },
  }),
)
app.use(
  '*',
  async (c, next) => {
    const configuredOrigins = parseConfiguredOrigins(c.env.PUBLIC_ALLOWED_ORIGINS)
    const corsMiddleware = cors({
      origin: (origin) => {
        if (!origin) return 'https://www.australianrates.com'
        if (configuredOrigins.includes(origin)) return origin
        if (origin.endsWith('.pages.dev')) return origin
        if (origin.endsWith('.australianrates.com') || origin === 'https://australianrates.com') return origin
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) return origin
        return 'https://www.australianrates.com'
      },
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Cf-Access-Jwt-Assertion'],
    })
    await corsMiddleware(c, next)
  },
)

app.route(`${API_BASE_PATH}/admin`, adminRoutes)
app.route(API_BASE_PATH, publicRoutes)
app.route(ECONOMIC_API_BASE_PATH, economicPublicRoutes)
app.route(SAVINGS_API_BASE_PATH, savingsPublicRoutes)
app.route(TD_API_BASE_PATH, tdPublicRoutes)

app.notFound((c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404))

app.onError((error, c) => {
  log.error('api', 'Unhandled internal error', {
    error,
    context: JSON.stringify({
      error_type: (error as Error)?.name || 'Error',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    }),
  })
  return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } }, 500)
})

function classifyFetchWorkload(request: Request): D1WorkloadClass {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()
  if (path.includes('/admin/')) return 'nonessential'
  if (method !== 'GET' && method !== 'HEAD') return 'nonessential'
  if (path.endsWith('/snapshot') || path.includes('/site-ui') || path.includes('/health')) return 'essential_serving'
  if (path.includes('/analytics/') || path.includes('/latest') || path.includes('/filters')) return 'essential_serving'
  return 'essential_serving'
}

function classifyScheduledWorkload(cron: string): D1WorkloadClass {
  const tasks = scheduledTasksForCron(cron)
  if (tasks.includes('daily')) return 'critical_coverage'
  if (tasks.includes('public_package_refresh') || tasks.includes('site_health')) return 'essential_serving'
  return tasks.length ? 'nonessential' : 'deferable'
}

const worker: ExportedHandler<EnvBindings, IngestMessage> = {
  async fetch(request, env, ctx) {
    const tracker = await createD1BudgetTracker(env, { workload: classifyFetchWorkload(request) })
    try {
      return await app.fetch(request, tracker.env, ctx)
    } finally {
      ctx.waitUntil(tracker.flush())
    }
  },

  async scheduled(event, env): Promise<void> {
    const cron = String((event as ScheduledController & { cron?: string }).cron || '')
    await withD1BudgetTracking(env, async (trackedEnv) => {
      initLogger(trackedEnv.DB)
      log.info('scheduler', `Cron triggered at ${new Date(event.scheduledTime).toISOString()} (${cron || 'unknown'})`)
      try {
        const result = await dispatchScheduledEvent(event, trackedEnv)
        log.info('scheduler', `Scheduled run completed`, { context: JSON.stringify(result) })
      } catch (error) {
        log.error('scheduler', 'Scheduled run failed', {
          error,
          context: JSON.stringify({
            scheduled_time: new Date(event.scheduledTime).toISOString(),
            cron: cron || 'unknown',
          }),
        })
        throw error
      } finally {
        await flushBufferedLogs()
      }
    }, { workload: classifyScheduledWorkload(cron) })
  },

  async queue(batch, env, ctx): Promise<void> {
    await withD1BudgetTracking(env, async (trackedEnv) => {
      initLogger(trackedEnv.DB)
      try {
        await consumeIngestQueue(batch, trackedEnv, ctx)
      } catch (error) {
        log.error('consumer', 'Queue batch processing failed', {
          error,
          context: JSON.stringify({
            messages: batch.messages.length,
          }),
        })
        throw error
      } finally {
        await flushBufferedLogs()
      }
    }, { workload: 'critical_coverage' })
  },
}

export { HistoricalQualityAuditDO, RunLockDO }
export default worker
