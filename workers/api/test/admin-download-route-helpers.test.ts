import { describe, expect, it } from 'vitest'
import {
  buildAdminDownloadStatusBody,
  isRetryableAdminDownloadJob,
  normalizeAdminDownloadSinceCursor,
  parseAdminDownloadBoolean,
  parseAdminDownloadJobIds,
  parseAdminDownloadLimit,
} from '../src/routes/admin-download-route-helpers'

describe('admin download route helpers', () => {
  it('normalizes admin download request inputs', () => {
    expect(parseAdminDownloadBoolean('true')).toBe(true)
    expect(parseAdminDownloadBoolean('yes')).toBe(true)
    expect(parseAdminDownloadBoolean('false')).toBe(false)

    expect(parseAdminDownloadLimit(undefined, 12)).toBe(12)
    expect(parseAdminDownloadLimit('999', 12)).toBe(250)
    expect(parseAdminDownloadLimit('-5', 12)).toBe(1)

    expect(parseAdminDownloadJobIds(['job-1', 'job-1', '', null])).toEqual(['job-1'])
    expect(normalizeAdminDownloadSinceCursor('42.9')).toBe(42)
    expect(normalizeAdminDownloadSinceCursor('-9')).toBe(0)
    expect(normalizeAdminDownloadSinceCursor('not-a-number')).toBe(0)
  })

  it('marks only failed jobs as retryable', () => {
    expect(isRetryableAdminDownloadJob({ status: 'failed' })).toBe(true)
    expect(isRetryableAdminDownloadJob({ status: 'queued' })).toBe(false)
    expect(isRetryableAdminDownloadJob({ status: 'completed' })).toBe(false)
    expect(isRetryableAdminDownloadJob(null)).toBe(false)
  })

  it('builds status payloads with artifact download links', () => {
    const operational = buildAdminDownloadStatusBody(
      {
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
      },
      [
        {
          artifact_id: 'artifact-1',
          job_id: 'job-1',
          artifact_kind: 'main',
          file_name: 'database-dump-header.sql.gz',
          content_type: 'application/gzip',
          row_count: 0,
          byte_size: 512,
          cursor_start: null,
          cursor_end: null,
          r2_key: 'admin-downloads/job-1/database-dump-header.sql.gz',
          created_at: '2026-03-13T00:00:03.000Z',
        },
      ],
    )

    expect(operational.download_path).toBe('/admin/downloads/job-1/download')
    expect(operational.download_file_name).toBe('australianrates-database-full-20260313T000000Z.sql.gz')
    expect(operational.artifacts[0]?.download_path).toBe('/admin/downloads/job-1/artifacts/artifact-1/download')

    const legacyOperational = buildAdminDownloadStatusBody(
      {
        job_id: 'job-2',
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
      },
      [
        {
          artifact_id: 'artifact-2',
          job_id: 'job-2',
          artifact_kind: 'manifest',
          file_name: 'operational-all-snapshot-manifest.jsonl.gz',
          content_type: 'application/gzip',
          row_count: 1,
          byte_size: 256,
          cursor_start: null,
          cursor_end: null,
          r2_key: 'admin-downloads/job-2/manifest.jsonl.gz',
          created_at: '2026-03-13T00:00:03.000Z',
        },
      ],
    )

    expect(legacyOperational.download_path).toBe('/admin/downloads/job-2/download')
    expect(legacyOperational.download_file_name).toBe('operational-all-snapshot.jsonl.gz')
  })
})
