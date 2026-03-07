import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { queryLogs } from '../src/utils/logger'
import { wrapSqliteDatabase } from './support/sqlite-d1'

describe('queryLogs', () => {
  it('returns log codes when listing entries without a code filter', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`
CREATE TABLE global_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  run_id TEXT,
  lender_code TEXT,
  code TEXT
);
INSERT INTO global_log (ts, level, source, message, context, code)
VALUES (
  '2026-03-07T08:05:15.170Z',
  'warn',
  'scheduler',
  'Scheduled daily ingest paused by app config',
  '{}',
  'ingest_paused'
);
`)

    const result = await queryLogs(wrapSqliteDatabase(sqlite), { limit: 10 })

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.code).toBe('ingest_paused')
    sqlite.close()
  })

  it('filters entries by sinceTs when provided', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`
CREATE TABLE global_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  run_id TEXT,
  lender_code TEXT,
  code TEXT
);
INSERT INTO global_log (ts, level, source, message, context)
VALUES
  ('2026-03-07T08:45:18.276Z', 'warn', 'pipeline', 'probe_payload_capture_failed', '{}'),
  ('2026-03-07T09:30:14.164Z', 'info', 'scheduler', 'Dispatching site health cron', '{}');
`)

    const result = await queryLogs(wrapSqliteDatabase(sqlite), {
      sinceTs: '2026-03-07T09:00:00.000Z',
      limit: 10,
    })

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.message).toBe('Dispatching site health cron')
    sqlite.close()
  })
})
