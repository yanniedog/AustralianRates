import { Hono } from 'hono'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import { log } from '../utils/logger'
import {
  DAILY_BACKUP_FILENAME,
  dailyBackupR2Key,
  runDailyBackup,
} from '../pipeline/daily-backup'

const R2_PREFIX = 'daily-backup'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const adminBackupRoutes = new Hono<AppContext>()

/**
 * List available daily backup dates (from R2 prefix listing).
 * GET /admin/backups/daily?limit=31
 */
adminBackupRoutes.get('/backups/daily', async (c) => {
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 31))
  const dates: string[] = []
  let cursor: string | undefined
  try {
    do {
      const list = await c.env.RAW_BUCKET.list({
        prefix: `${R2_PREFIX}/`,
        limit: 500,
        cursor,
      })
      for (const obj of list.objects) {
        const parts = obj.key.split('/')
        if (parts.length >= 2 && DATE_RE.test(parts[1])) {
          dates.push(parts[1])
        }
      }
      cursor = list.truncated ? list.cursor : undefined
    } while (cursor)

    const unique = [...new Set(dates)].sort((a, b) => b.localeCompare(a)).slice(0, limit)
    return c.json({
      ok: true,
      dates: unique,
      count: unique.length,
    })
  } catch (error) {
    log.error('admin-backups', 'List daily backups failed', {
      code: 'daily_backup_list_failed',
      error,
      context: (error as Error)?.message || String(error),
    })
    return jsonError(c, 500, 'BACKUP_LIST_FAILED', 'Failed to list daily backups.')
  }
})

/**
 * Trigger a daily backup for a given date (admin-only).
 * POST /admin/backups/daily { "date": "YYYY-MM-DD" }
 */
adminBackupRoutes.post('/backups/daily', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const dateRaw = body.date ?? body.collection_date
  const date = typeof dateRaw === 'string' ? dateRaw.trim() : ''
  if (!DATE_RE.test(date)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'Body must include date (YYYY-MM-DD).')
  }

  const result = await runDailyBackup(c.env, date)
  if (!result.ok) {
    return jsonError(c, 400, 'DAILY_BACKUP_FAILED', result.error ?? 'Backup failed.')
  }
  return c.json({
    ok: true,
    backup: {
      date: result.date,
      r2_key: result.r2_key,
      byte_size: result.byte_size,
      table_counts: result.table_counts,
    },
  })
})

/**
 * Instant download of a daily backup file.
 * GET /admin/backups/daily/:date/download
 */
adminBackupRoutes.get('/backups/daily/:date/download', async (c) => {
  const date = c.req.param('date').trim()
  if (!DATE_RE.test(date)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'Date must be YYYY-MM-DD.')
  }

  const r2Key = dailyBackupR2Key(date)
  const object = await c.env.RAW_BUCKET.get(r2Key)
  if (!object) {
    return jsonError(c, 404, 'NOT_FOUND', `No daily backup found for ${date}.`)
  }

  const body = await object.arrayBuffer()
  const fileName = DAILY_BACKUP_FILENAME(date)
  c.header('Content-Type', 'application/gzip')
  c.header('Content-Disposition', `attachment; filename="${fileName}"`)
  c.header('Cache-Control', 'no-store')
  return c.body(body)
})
