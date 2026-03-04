export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  level: LogLevel
  source: string
  message: string
  code?: string
  context?: unknown
  traceback?: string
  error?: unknown
  runId?: string
  lenderCode?: string
}

type PersistedLogEntry = Omit<LogEntry, 'context' | 'error'> & {
  context?: string
}

let _db: D1Database | null = null
const _buffer: PersistedLogEntry[] = []
const _pendingWrites = new Set<Promise<void>>()
const MAX_BUFFER = 200
const MAX_CONTEXT_CHARS = 32000

export function initLogger(db: D1Database): void {
  _db = db
}

function errorMetadata(error: unknown): { name: string; message: string; stack: string | null } | null {
  if (!(error instanceof Error)) return null
  return {
    name: error.name || 'Error',
    message: error.message || 'Unknown error',
    stack: error.stack || null,
  }
}

function fallbackTraceback(level: LogLevel, source: string, message: string): string | undefined {
  if (level !== 'warn' && level !== 'error') return undefined
  const stack = new Error(`[${source}] ${message}`).stack
  return stack || undefined
}

function serializeContext(context: unknown): string | undefined {
  if (context == null) return undefined
  if (typeof context === 'string') return context
  try {
    return JSON.stringify(context)
  } catch {
    return String(context)
  }
}

export function parseLogContext(rawContext: unknown): unknown {
  if (typeof rawContext !== 'string') return rawContext
  const trimmed = rawContext.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return rawContext
  }
}

export function extractTraceback(rawContext: unknown): string | null {
  const parsed = parseLogContext(rawContext)
  if (parsed && typeof parsed === 'object' && 'traceback' in parsed && typeof parsed.traceback === 'string') {
    return parsed.traceback
  }
  return null
}

export function normalizeLogEntryForStorage(entry: LogEntry): PersistedLogEntry {
  const errMeta = errorMetadata(entry.error)
  const traceback = entry.traceback || errMeta?.stack || fallbackTraceback(entry.level, entry.source, entry.message)
  let contextToPersist: unknown = entry.context

  if (entry.level === 'warn' || entry.level === 'error') {
    const enrichedContext: Record<string, unknown> = {}
    if (entry.context != null) enrichedContext.context = entry.context
    if (errMeta) {
      enrichedContext.error = {
        name: errMeta.name,
        message: errMeta.message,
      }
    }
    if (traceback) enrichedContext.traceback = traceback
    contextToPersist = enrichedContext
  }

  const serializedContext = serializeContext(contextToPersist)
  return {
    level: entry.level,
    source: entry.source,
    message: entry.message,
    code: entry.code,
    context: serializedContext,
    traceback,
    runId: entry.runId,
    lenderCode: entry.lenderCode,
  }
}

function formatConsole(entry: PersistedLogEntry): string {
  const parts = [`[${entry.level.toUpperCase()}] [${entry.source}]`, entry.message]
  if (entry.code) parts.push(`code=${entry.code}`)
  if (entry.runId) parts.push(`run=${entry.runId}`)
  if (entry.lenderCode) parts.push(`lender=${entry.lenderCode}`)
  if (entry.context) parts.push(entry.context)
  return parts.join(' ')
}

async function persist(entry: PersistedLogEntry): Promise<void> {
  if (!_db) return
  try {
    await _db
      .prepare(
        `INSERT INTO global_log (level, source, message, code, context, run_id, lender_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        entry.level,
        entry.source,
        entry.message.slice(0, 2000),
        entry.code ? entry.code.slice(0, 100) : null,
        entry.context ? entry.context.slice(0, MAX_CONTEXT_CHARS) : null,
        entry.runId ?? null,
        entry.lenderCode ?? null,
      )
      .run()
  } catch {
    // Backward compatibility for environments without the `code` column.
    try {
      await _db
        .prepare(
          `INSERT INTO global_log (level, source, message, context, run_id, lender_code)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
          entry.level,
          entry.source,
          entry.message.slice(0, 2000),
          entry.context ? entry.context.slice(0, MAX_CONTEXT_CHARS) : null,
          entry.runId ?? null,
          entry.lenderCode ?? null,
        )
        .run()
    } catch {
      // avoid recursive logging failures
    }
  }
}

function emit(entry: LogEntry): void {
  const normalized = normalizeLogEntryForStorage(entry)
  const line = formatConsole(normalized)
  if (normalized.level === 'error') {
    console.error(line)
  } else if (normalized.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }

  if (_db) {
    const p = persist(normalized)
    _pendingWrites.add(p)
    p.finally(() => _pendingWrites.delete(p))
  } else if (_buffer.length < MAX_BUFFER) {
    _buffer.push(normalized)
  }
}

export async function flushBufferedLogs(): Promise<void> {
  if (!_db) return
  await Promise.all([..._pendingWrites])
  if (_buffer.length === 0) return
  const entries = _buffer.splice(0, _buffer.length)
  await Promise.all(entries.map((entry) => persist(entry)))
}

type LogContextInput = Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>

export const log = {
  debug(source: string, message: string, ctx?: LogContextInput): void {
    emit({ level: 'debug', source, message, ...ctx })
  },
  info(source: string, message: string, ctx?: LogContextInput): void {
    emit({ level: 'info', source, message, ...ctx })
  },
  warn(source: string, message: string, ctx?: LogContextInput): void {
    emit({ level: 'warn', source, message, ...ctx })
  },
  error(source: string, message: string, ctx?: LogContextInput): void {
    emit({ level: 'error', source, message, ...ctx })
  },
}

/** Message thrown when code filter is used but global_log.code column is missing (pre-0019). */
export const CODE_FILTER_UNSUPPORTED_MESSAGE =
  'Log code filter requires global_log.code column (migration 0019). Database schema may not be up to date.'

export async function queryLogs(
  db: D1Database,
  opts: { level?: LogLevel; source?: string; code?: string; limit?: number; offset?: number } = {},
): Promise<{ entries: Array<Record<string, unknown>>; total: number }> {
  const whereBase: string[] = []
  const baseBinds: Array<string | number> = []

  if (opts.level) {
    whereBase.push('level = ?')
    baseBinds.push(opts.level)
  }
  if (opts.source) {
    whereBase.push('source = ?')
    baseBinds.push(opts.source)
  }
  const whereBaseClause = whereBase.length ? `WHERE ${whereBase.join(' AND ')}` : ''
  const whereWithCodeClause =
    opts.code != null
      ? whereBase.length
        ? `${whereBaseClause} AND code = ?`
        : 'WHERE code = ?'
      : whereBaseClause
  const bindsWithCode = opts.code != null ? [...baseBinds, opts.code] : [...baseBinds]
  const limit = Math.min(Math.max(1, opts.limit ?? 1000), 10000)
  const offset = Math.max(0, opts.offset ?? 0)

  let total = 0
  if (opts.code != null) {
    try {
      const countResult = await db
        .prepare(`SELECT COUNT(*) AS total FROM global_log ${whereWithCodeClause}`)
        .bind(...bindsWithCode)
        .first<{ total: number }>()
      total = Number(countResult?.total ?? 0)
    } catch (err) {
      throw new Error(CODE_FILTER_UNSUPPORTED_MESSAGE, { cause: err })
    }
  } else {
    const countResult = await db
      .prepare(`SELECT COUNT(*) AS total FROM global_log ${whereBaseClause}`)
      .bind(...baseBinds)
      .first<{ total: number }>()
    total = Number(countResult?.total ?? 0)
  }

  const dataSqlWithCode = `SELECT id, ts, level, source, message, code, context, run_id, lender_code FROM global_log ${whereWithCodeClause} ORDER BY ts DESC LIMIT ? OFFSET ?`
  let dataResult: { results?: Array<Record<string, unknown>> }
  if (opts.code != null) {
    try {
      dataResult = await db
        .prepare(dataSqlWithCode)
        .bind(...bindsWithCode, limit, offset)
        .all<Record<string, unknown>>()
    } catch (err) {
      throw new Error(CODE_FILTER_UNSUPPORTED_MESSAGE, { cause: err })
    }
  } else {
    const dataSqlLegacy = `SELECT id, ts, level, source, message, context, run_id, lender_code FROM global_log ${whereBaseClause} ORDER BY ts DESC LIMIT ? OFFSET ?`
    dataResult = await db
      .prepare(dataSqlLegacy)
      .bind(...baseBinds, limit, offset)
      .all<Record<string, unknown>>()
  }

  return { entries: dataResult.results ?? [], total }
}

export async function getLogStats(db: D1Database): Promise<{ count: number; latest_ts: string | null }> {
  const result = await db
    .prepare('SELECT COUNT(*) AS cnt, MAX(ts) AS latest_ts FROM global_log')
    .first<{ cnt: number; latest_ts: string | null }>()
  return {
    count: Number(result?.cnt ?? 0),
    latest_ts: result?.latest_ts ?? null,
  }
}
