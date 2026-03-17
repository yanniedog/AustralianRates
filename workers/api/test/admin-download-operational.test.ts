import { describe, expect, it } from 'vitest'
import {
  isOperationalInternalTable,
  operationalBundleFileName,
  sortOperationalArtifactsForBundle,
  isProtectedOperationalTableError,
} from '../src/routes/admin-download-operational'

describe('admin download operational helpers', () => {
  it('filters Cloudflare and sqlite internal tables from operational snapshots', () => {
    expect(isOperationalInternalTable('_cf_KV')).toBe(true)
    expect(isOperationalInternalTable('_cf_something_else')).toBe(true)
    expect(isOperationalInternalTable('sqlite_sequence')).toBe(true)
    expect(isOperationalInternalTable('run_reports')).toBe(false)
    expect(isOperationalInternalTable('historical_loan_rates')).toBe(false)
  })

  it('recognizes protected internal table access errors', () => {
    expect(
      isProtectedOperationalTableError(
        new Error('D1_ERROR: access to _cf_KV.key is prohibited: SQLITE_AUTH'),
      ),
    ).toBe(true)
    expect(isProtectedOperationalTableError(new Error('some other failure'))).toBe(false)
  })

  it('builds a single bundle filename and keeps manifest last', () => {
    expect(
      operationalBundleFileName({
        job_id: 'job-1',
        stream: 'operational',
        scope: 'all',
        mode: 'snapshot',
        format: 'jsonl_gzip',
        since_cursor: null,
        end_cursor: null,
        include_payload_bodies: 0,
        status: 'completed',
        requested_at: '2026-03-13T00:00:00.000Z',
        started_at: '2026-03-13T00:00:01.000Z',
        completed_at: '2026-03-13T00:00:02.000Z',
        error_message: null,
        export_kind: 'full',
        month_iso: null,
      }),
    ).toBe('operational-all-snapshot.jsonl.gz')

    const ordered = sortOperationalArtifactsForBundle(
      ['admin_download_artifacts', 'global_log', 'run_reports'],
      [
        {
          artifact_id: 'manifest',
          job_id: 'job-1',
          artifact_kind: 'manifest',
          file_name: 'operational-all-snapshot-manifest.jsonl.gz',
          content_type: 'application/gzip',
          row_count: 1,
          byte_size: 10,
          cursor_start: null,
          cursor_end: null,
          r2_key: 'manifest',
          created_at: '2026-03-13 00:00:03',
        },
        {
          artifact_id: 'global-10000',
          job_id: 'job-1',
          artifact_kind: 'main',
          file_name: 'operational-all-snapshot-global_log-offset-00010000.jsonl.gz',
          content_type: 'application/gzip',
          row_count: 10_000,
          byte_size: 10,
          cursor_start: 10_000,
          cursor_end: 20_000,
          r2_key: 'global-10000',
          created_at: '2026-03-13 00:00:02',
        },
        {
          artifact_id: 'admin-0',
          job_id: 'job-1',
          artifact_kind: 'main',
          file_name: 'operational-all-snapshot-admin_download_artifacts-offset-00000000.jsonl.gz',
          content_type: 'application/gzip',
          row_count: 10,
          byte_size: 10,
          cursor_start: 0,
          cursor_end: 10,
          r2_key: 'admin-0',
          created_at: '2026-03-13 00:00:01',
        },
        {
          artifact_id: 'global-0',
          job_id: 'job-1',
          artifact_kind: 'main',
          file_name: 'operational-all-snapshot-global_log-offset-00000000.jsonl.gz',
          content_type: 'application/gzip',
          row_count: 10_000,
          byte_size: 10,
          cursor_start: 0,
          cursor_end: 10_000,
          r2_key: 'global-0',
          created_at: '2026-03-13 00:00:02',
        },
      ],
    )

    expect(ordered.map((artifact) => artifact.file_name)).toEqual([
      'operational-all-snapshot-admin_download_artifacts-offset-00000000.jsonl.gz',
      'operational-all-snapshot-global_log-offset-00000000.jsonl.gz',
      'operational-all-snapshot-global_log-offset-00010000.jsonl.gz',
      'operational-all-snapshot-manifest.jsonl.gz',
    ])
  })
})
