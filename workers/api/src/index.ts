import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { API_BASE_PATH } from './constants'
import { RunLockDO } from './durable/run-lock'
import { handleScheduledDaily } from './pipeline/scheduled'
import { consumeIngestQueue } from './queue/consumer'
import { adminRoutes } from './routes/admin'
import { publicRoutes } from './routes/public'
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
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cf-Access-Jwt-Assertion'],
  }),
)

app.route(API_BASE_PATH, publicRoutes)
app.route(`${API_BASE_PATH}/admin`, adminRoutes)

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
    log.info('scheduler', `Cron triggered at ${new Date(event.scheduledTime).toISOString()}`)
    const result = await handleScheduledDaily(event, env)
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
