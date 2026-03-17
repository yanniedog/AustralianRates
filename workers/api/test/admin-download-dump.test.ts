import { describe, expect, it } from 'vitest'
import {
  fullDatabaseDumpFileName,
  hasSqlDumpArtifacts,
  isDatabaseDumpInternalTable,
  isProtectedDatabaseDumpTableError,
  sortDatabaseDumpArtifactsForBundle,
} from '../src/routes/admin-download-dump'

describe('admin download dump helpers', () => {
  it('filters internal tables and protected-table errors', () => {
    expect(isDatabaseDumpInternalTable('_cf_KV')).toBe(true)
    expect(isDatabaseDumpInternalTable('sqlite_sequence')).toBe(true)
    expect(isDatabaseDumpInternalTable('run_reports')).toBe(false)
    expect(
      isProtectedDatabaseDumpTableError(
        new Error('D1_ERROR: access to _cf_KV.key is prohibited: SQLITE_AUTH'),
      ),
    ).toBe(true)
    expect(isProtectedDatabaseDumpTableError(new Error('some other failure'))).toBe(false)
  })

  it('builds the public dump filename and detects sql dump artifacts', () => {
    expect(
      fullDatabaseDumpFileName({
        requested_at: '2026-03-13T00:00:00.000Z',
        export_kind: 'full',
        month_iso: null,
      }),
    ).toBe('australianrates-database-full-20260313T000000Z.sql.gz')
    expect(
      fullDatabaseDumpFileName({
        requested_at: '2026-03-13T00:00:00.000Z',
        export_kind: 'monthly',
        month_iso: '2026-02',
      }),
    ).toBe('australianrates-database-monthly-2026-02.sql.gz')

    expect(
      hasSqlDumpArtifacts([
        {
          artifact_id: 'artifact-1',
          job_id: 'job-1',
          artifact_kind: 'main',
          file_name: 'database-dump-header.sql.gz',
          content_type: 'application/gzip',
          row_count: 0,
          byte_size: 100,
          cursor_start: null,
          cursor_end: null,
          r2_key: 'admin-downloads/job-1/database-dump-header.sql.gz',
          created_at: '2026-03-13T00:00:01.000Z',
        },
      ]),
    ).toBe(true)
  })

  it('orders dump parts into one valid bundle sequence', () => {
    const ordered = sortDatabaseDumpArtifactsForBundle([
      {
        artifact_id: 'footer',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-footer.sql.gz',
        content_type: 'application/gzip',
        row_count: 0,
        byte_size: 10,
        cursor_start: null,
        cursor_end: null,
        r2_key: 'footer',
        created_at: '2026-03-13T00:00:08.000Z',
      },
      {
        artifact_id: 'data-2',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-data-global_log-offset-00001000.sql.gz',
        content_type: 'application/gzip',
        row_count: 1000,
        byte_size: 10,
        cursor_start: 1000,
        cursor_end: 2000,
        r2_key: 'data-2',
        created_at: '2026-03-13T00:00:05.000Z',
      },
      {
        artifact_id: 'views',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-views.sql.gz',
        content_type: 'application/gzip',
        row_count: 0,
        byte_size: 10,
        cursor_start: null,
        cursor_end: null,
        r2_key: 'views',
        created_at: '2026-03-13T00:00:07.000Z',
      },
      {
        artifact_id: 'header',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-header.sql.gz',
        content_type: 'application/gzip',
        row_count: 0,
        byte_size: 10,
        cursor_start: null,
        cursor_end: null,
        r2_key: 'header',
        created_at: '2026-03-13T00:00:01.000Z',
      },
      {
        artifact_id: 'schema-admin',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-schema-admin_download_artifacts.sql.gz',
        content_type: 'application/gzip',
        row_count: 0,
        byte_size: 10,
        cursor_start: null,
        cursor_end: null,
        r2_key: 'schema-admin',
        created_at: '2026-03-13T00:00:02.000Z',
      },
      {
        artifact_id: 'schema-global',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-schema-global_log.sql.gz',
        content_type: 'application/gzip',
        row_count: 0,
        byte_size: 10,
        cursor_start: null,
        cursor_end: null,
        r2_key: 'schema-global',
        created_at: '2026-03-13T00:00:03.000Z',
      },
      {
        artifact_id: 'data-1',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-data-global_log-offset-00000000.sql.gz',
        content_type: 'application/gzip',
        row_count: 1000,
        byte_size: 10,
        cursor_start: 0,
        cursor_end: 1000,
        r2_key: 'data-1',
        created_at: '2026-03-13T00:00:04.000Z',
      },
      {
        artifact_id: 'indexes',
        job_id: 'job-1',
        artifact_kind: 'main',
        file_name: 'database-dump-indexes.sql.gz',
        content_type: 'application/gzip',
        row_count: 0,
        byte_size: 10,
        cursor_start: null,
        cursor_end: null,
        r2_key: 'indexes',
        created_at: '2026-03-13T00:00:06.000Z',
      },
    ])

    expect(ordered.map((artifact) => artifact.file_name)).toEqual([
      'database-dump-header.sql.gz',
      'database-dump-schema-admin_download_artifacts.sql.gz',
      'database-dump-schema-global_log.sql.gz',
      'database-dump-data-global_log-offset-00000000.sql.gz',
      'database-dump-data-global_log-offset-00001000.sql.gz',
      'database-dump-indexes.sql.gz',
      'database-dump-views.sql.gz',
      'database-dump-footer.sql.gz',
    ])
  })
})
