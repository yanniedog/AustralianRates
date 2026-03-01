export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  level: LogLevel
  source: string
  message: string
  code?: string
  context?: string
  runId?: string
  lenderCode?: string
}

let _db: D1Database | null = null
const _buffer: LogEntry[] = []
const _pendingWrites = new Set<Promise<void>>()
const MAX_BUFFER = 200

export function initLogger(db: D1Database): void {
  _db = db
}

function formatConsole(entry: LogEntry): string {
  const parts = [`[${entry.level.toUpperCase()}] [${entry.source}]`, entry.message]
  if (entry.code) parts.push(`code=${entry.code}`)
  if (entry.runId) parts.push(`run=${entry.runId}`)
  if (entry.lenderCode) parts.push(`lender=${entry.lenderCode}`)
  if (entry.context) parts.push(entry.context)
  return parts.join(' ')
}

async function persist(entry: LogEntry): Promise<void> {
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
        entry.context ? entry.context.slice(0, 4000) : null,
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
          entry.context ? entry.context.slice(0, 4000) : null,
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
  const line = formatConsole(entry)
  if (entry.level === 'error') {
    console.error(line)
  } else if (entry.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }

  if (_db) {
    const p = persist(entry)
    _pendingWrites.add(p)
    p.finally(() => _pendingWrites.delete(p))
  } else {
    if (_buffer.length < MAX_BUFFER) _buffer.push(entry)
  }
}

export async function flushBufferedLogs(): Promise<void> {
  if (!_db) return
  await Promise.all([..._pendingWrites])
  if (_buffer.length === 0) return
  const entries = _buffer.splice(0, _buffer.length)
  await Promise.all(entries.map((entry) => persist(entry)))
}

export const log = {
  debug(source: string, message: string, ctx?: Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>): void {
    emit({ level: 'debug', source, message, ...ctx })
  },
  info(source: string, message: string, ctx?: Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>): void {
    emit({ level: 'info', source, message, ...ctx })
  },
  warn(source: string, message: string, ctx?: Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>): void {
    emit({ level: 'warn', source, message, ...ctx })
  },
  error(source: string, message: string, ctx?: Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>): void {
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
