import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { persistFetchEvent } from '../src/db/fetch-events'
import { wrapSqliteDatabase } from './support/sqlite-d1'

describe('persistFetchEvent', () => {
  it('reuses an existing raw_objects row when the content hash appears before insert', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`
CREATE TABLE raw_objects (
  content_hash TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  first_source_url TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE fetch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  lender_code TEXT,
  dataset_kind TEXT,
  job_kind TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  collection_date TEXT,
  fetched_at TEXT NOT NULL,
  http_status INTEGER,
  content_hash TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  response_headers_json TEXT,
  duration_ms INTEGER,
  product_id TEXT,
  raw_object_created INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
`)

    let seededRaceRow = false
    const db = wrapSqliteDatabase(sqlite, {
      beforeRun(sql, args, rawDb) {
        if (seededRaceRow || !sql.includes('INSERT OR IGNORE INTO raw_objects')) return
        seededRaceRow = true
        rawDb
          .prepare(
            `INSERT INTO raw_objects (
               content_hash, source_type, first_source_url, body_bytes, content_type, r2_key, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            String(args[0]),
            'probe_site_health_dataset_latest_all',
            'https://race.example/existing',
            Number(args[3]),
            String(args[4]),
            'raw/probe/existing.json',
            '2026-03-07T08:45:17.000Z',
          )
      },
    })

    const bucketPuts: Array<{ key: string; body: string }> = []
    const result = await persistFetchEvent(
      {
        DB: db,
        RAW_BUCKET: {
          async put(key: string, body: string) {
            bucketPuts.push({ key, body })
          },
        } as unknown as R2Bucket,
      },
      {
        sourceType: 'probe_site_health_dataset_latest_all',
        sourceUrl: 'https://www.australianrates.com/api/savings-rates/latest-all?limit=1&source_mode=all',
        payload: { ok: false, error: { code: 'INTERNAL_ERROR' } },
        fetchedAtIso: '2026-03-07T08:45:17.928Z',
        httpStatus: 500,
        notes: 'probe_capture reason=api_unreachable',
      },
    )

    const rawObjectCount = sqlite.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    const fetchEvent = sqlite.prepare('SELECT raw_object_created, content_hash FROM fetch_events LIMIT 1').get() as {
      raw_object_created: number
      content_hash: string
    }

    expect(seededRaceRow).toBe(true)
    expect(bucketPuts).toHaveLength(1)
    expect(result.rawObjectCreated).toBe(false)
    expect(result.r2Key).toBe('raw/probe/existing.json')
    expect(rawObjectCount.n).toBe(1)
    expect(fetchEvent.raw_object_created).toBe(0)
    expect(fetchEvent.content_hash).toBe(result.contentHash)
    sqlite.close()
  })
})
