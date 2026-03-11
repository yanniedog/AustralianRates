import type { Context } from 'hono'
import { evaluateAdminAuth } from '../auth/admin'
import type { AppContext } from '../types'

type TimingParts = {
  dbMainMs?: number
  dbCountMs?: number
  detailHydrateMs?: number
  jsonMs?: number
  totalMs?: number
}

type WorkerCacheStorage = CacheStorage & {
  default?: Cache
}

const INTERNAL_PROBE_HOST = 'internal.australianrates.test'

function truthyQuery(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isInternalProbeRequest(c: Context<AppContext>): boolean {
  try {
    return new URL(c.req.url).hostname === INTERNAL_PROBE_HOST
  } catch {
    return false
  }
}

function scheduleBackgroundTask(context: unknown, task: Promise<unknown>): boolean {
  const executionCtx = (context as { executionCtx?: ExecutionContext }).executionCtx
  if (!executionCtx) return false
  executionCtx.waitUntil(task)
  return true
}

function getDefaultCache(): Cache | null {
  const cachesRef = (globalThis as typeof globalThis & { caches?: WorkerCacheStorage }).caches
  return cachesRef?.default ?? null
}

export async function shouldEnableAdminDebugTiming(c: Context<AppContext>): Promise<boolean> {
  if (!truthyQuery(c.req.query('debug_timing'))) {
    return false
  }
  const authState = await evaluateAdminAuth(c)
  if (authState.ok) {
    c.set('adminAuthState', authState)
  }
  return authState.ok
}

export function shouldBypassPublicReadCache(c: Context<AppContext>, debugTiming: boolean): boolean {
  if (debugTiming) return true
  if (isInternalProbeRequest(c)) return true
  if (truthyQuery(c.req.query('cache_bust'))) return true
  return Boolean(c.req.header('Authorization') || c.req.header('Cf-Access-Jwt-Assertion'))
}

export function shouldBypassLatestCache(c: Context<AppContext>, debugTiming: boolean): boolean {
  return shouldBypassPublicReadCache(c, debugTiming)
}

export async function matchPublicReadCache(
  c: Context<AppContext>,
  bypass: boolean,
): Promise<{ cacheKey: Request | null; response: Response | null }> {
  const cache = getDefaultCache()
  if (bypass || c.req.method.toUpperCase() !== 'GET' || !cache) {
    return { cacheKey: null, response: null }
  }

  const url = new URL(c.req.url)
  url.searchParams.delete('cache_bust')
  url.searchParams.delete('debug_timing')
  const workerVersion = String(c.env.WORKER_VERSION ?? '').trim()
  if (workerVersion) {
    url.searchParams.set('__worker_version', workerVersion)
  }

  const cacheKey = new Request(url.toString(), {
    method: 'GET',
    headers: {
      Accept: c.req.header('Accept') || 'application/json',
    },
  })
  const response = await cache.match(cacheKey)
  return {
    cacheKey,
    response: response ? new Response(response.body, response) : null,
  }
}

export async function matchLatestCache(
  c: Context<AppContext>,
  bypass: boolean,
): Promise<{ cacheKey: Request | null; response: Response | null }> {
  return matchPublicReadCache(c, bypass)
}

export function storePublicReadCache(c: Context<AppContext>, cacheKey: Request | null, response: Response): void {
  const cache = getDefaultCache()
  if (!cacheKey || response.status !== 200 || !cache) return
  const cacheResponse = response.clone()
  cacheResponse.headers.delete('set-cookie')
  scheduleBackgroundTask(c, cache.put(cacheKey, cacheResponse))
}

export function storeLatestCache(c: Context<AppContext>, cacheKey: Request | null, response: Response): void {
  storePublicReadCache(c, cacheKey, response)
}

export function setServerTimingHeader(response: Response, timing: TimingParts): void {
  const entries = [
    ['db_main', timing.dbMainMs],
    ['db_count', timing.dbCountMs],
    ['detail_hydrate', timing.detailHydrateMs],
    ['json', timing.jsonMs],
    ['total', timing.totalMs],
  ].filter((entry): entry is [string, number] => Number.isFinite(entry[1]))

  if (entries.length === 0) return

  response.headers.set(
    'Server-Timing',
    entries.map(([name, value]) => `${name};dur=${Math.max(0, Math.round(value))}`).join(', '),
  )
}
