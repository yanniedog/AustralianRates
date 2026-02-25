import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from './constants'
import { RunLockDO } from './durable/run-lock'
import { dispatchScheduledEvent } from './pipeline/scheduler-dispatch'
import { consumeIngestQueue } from './queue/consumer'
import { adminRoutes } from './routes/admin'
import { publicRoutes } from './routes/public'
import { savingsPublicRoutes } from './routes/savings-public'
import { tdPublicRoutes } from './routes/td-public'
import type { AppContext, EnvBindings, IngestMessage } from './types'
import { flushBufferedLogs, initLogger, log } from './utils/logger'

const app = new Hono<AppContext>()

app.use('*', async (c, next) => {
  initLogger(c.env.DB)
  await flushBufferedLogs()
  await next()
  await flushBufferedLogs()
})

app.use('*', logger())
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net', 'https://cdn.plot.ly'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.github.com'],
    },
  }),
)
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*'
      if (origin.endsWith('.australianrates.com') || origin === 'https://australianrates.com') return origin
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) return origin
      return 'https://www.australianrates.com'
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cf-Access-Jwt-Assertion'],
  }),
)

app.route(API_BASE_PATH, publicRoutes)
app.route(`${API_BASE_PATH}/admin`, adminRoutes)
app.route(SAVINGS_API_BASE_PATH, savingsPublicRoutes)
app.route(TD_API_BASE_PATH, tdPublicRoutes)

app.notFound((c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404))

app.onError((error, c) => {
  log.error('api', `Unhandled error: ${(error as Error)?.message || String(error)}`, {
    context: (error as Error)?.stack,
  })
  return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } }, 500)
})

const worker: ExportedHandler<EnvBindings, IngestMessage> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },

  async scheduled(event, env): Promise<void> {
    initLogger(env.DB)
    const cron = String((event as ScheduledController & { cron?: string }).cron || '')
    log.info('scheduler', `Cron triggered at ${new Date(event.scheduledTime).toISOString()} (${cron || 'unknown'})`)
    const result = await dispatchScheduledEvent(event, env)
    log.info('scheduler', `Scheduled run completed`, { context: JSON.stringify(result) })
    await flushBufferedLogs()
  },

  async queue(batch, env): Promise<void> {
    initLogger(env.DB)
    await consumeIngestQueue(batch, env)
    await flushBufferedLogs()
  },
}

export { RunLockDO }
export default worker
