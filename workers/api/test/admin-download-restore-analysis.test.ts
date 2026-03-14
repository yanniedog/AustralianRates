import { describe, expect, it } from 'vitest'
import {
  parseDatabaseDumpHeaderObjects,
  summarizeDatabaseDumpTables,
} from '../src/routes/admin-download-restore-analysis'

describe('admin download restore analysis helpers', () => {
  it('parses source objects from the dump header', () => {
    const header = [
      '-- AustralianRates full database dump',
      'DROP VIEW IF EXISTS "vw_latest_rates";',
      'DROP TRIGGER IF EXISTS "trigger_after_insert";',
      'DROP TABLE IF EXISTS "admin_download_jobs";',
      'DROP TABLE IF EXISTS "historical_loan_rates";',
    ].join('\n')

    expect(parseDatabaseDumpHeaderObjects(header)).toEqual({
      tables: ['admin_download_jobs', 'historical_loan_rates'],
      views: ['vw_latest_rates'],
      triggers: ['trigger_after_insert'],
    })
  })

  it('detects incomplete or inconsistent table dump parts', () => {
    const tables = summarizeDatabaseDumpTables(
      [
        {
          artifact_id: 'data-1',
          job_id: 'job-1',
          artifact_kind: 'main',
          file_name: 'database-dump-data-historical_loan_rates-offset-00000025.sql.gz',
          content_type: 'application/gzip',
          row_count: 10,
          byte_size: 10,
          cursor_start: 25,
          cursor_end: 35,
          r2_key: 'data-1',
          created_at: '2026-03-14T00:00:00.000Z',
        },
      ],
      ['historical_loan_rates'],
    )

    expect(tables).toEqual([
      {
        table_name: 'historical_loan_rates',
        schema_present: false,
        data_part_count: 1,
        dump_row_count: 10,
        current_row_count: null,
        contiguous: false,
        issues: [
          'Expected data offset 0 but found 25.',
          'Table data parts exist but schema part is missing.',
        ],
      },
    ])
  })
})
