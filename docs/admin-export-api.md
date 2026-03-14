# Admin Export API

The admin export center uses the authenticated admin API under `/api/home-loan-rates/admin/downloads`.

New job creation now supports one export type only:

- A full-database dump of the D1 database
- Downloaded as one `.sql.gz` file
- Intended for restore or replacement with `wrangler d1 execute --file`

## Endpoints

### `GET /admin/downloads`

Lists recent admin download jobs.

Query params:

- `stream`: optional; existing data may still contain legacy `canonical`, `optimized`, or `operational` jobs
- `scope`: optional; existing data may still contain legacy scopes
- `status`: `queued`, `processing`, `completed`, or `failed`
- `limit`: `1` to `250` (default `12`)

Response shape:

```json
{
  "ok": true,
  "count": 1,
  "jobs": [
    {
      "ok": true,
      "job": {
        "job_id": "uuid",
        "stream": "operational",
        "scope": "all",
        "mode": "snapshot",
        "status": "completed"
      },
      "download_path": "/admin/downloads/uuid/download",
      "download_file_name": "australianrates-database-full-20260314T010203Z.sql.gz",
      "artifacts": [
        {
          "artifact_id": "uuid",
          "artifact_kind": "main",
          "file_name": "database-dump-header.sql.gz",
          "row_count": 0,
          "byte_size": 456,
          "cursor_start": null,
          "cursor_end": null,
          "download_path": "/admin/downloads/uuid/artifacts/uuid/download"
        }
      ]
    }
  ]
}
```

### `POST /admin/downloads`

Creates a new full-database dump job.

Accepted body:

- Empty object, or
- `stream: "operational"`, `scope: "all"`, `mode: "snapshot"`

Rejected inputs:

- `canonical` or `optimized` streams
- Any delta cursor
- Payload-body options
- Any scope other than `all`
- Any mode other than `snapshot`

Returns `202 Accepted` with the same job/artifact shape used by `GET /admin/downloads/:jobId`.

### `POST /admin/downloads/:jobId/retry`

Retries a failed full-database dump job.

Behavior:

- Allowed only when `status === "failed"`
- Allowed only for the full-database dump job shape (`operational` + `all` + `snapshot`)
- Deletes stored dump parts for that job from D1 and R2 before re-queueing

Returns `202 Accepted` with the current job/artifact status body.

### `GET /admin/downloads/:jobId`

Returns one job in the same shape used by list responses.

### `GET /admin/downloads/:jobId/artifacts/:artifactId/download`

Downloads one stored artifact part as binary content.

This is primarily for diagnostics. The admin UI is expected to use the single-file bundle route instead.

### `GET /admin/downloads/:jobId/download`

Streams one concatenated gzip file for completed operational dump jobs.

For new jobs, this is the public single-file SQL dump:

- Filename: `australianrates-database-full-<timestamp>.sql.gz`
- Contents: SQL DDL + SQL inserts for the D1 database

Legacy operational JSONL bundle jobs can still use the same route until they are deleted.

Returns:

- `400` when the job is not an operational dump job
- `409` while the dump is still being prepared
- `404` when the job or required artifacts are missing

### `DELETE /admin/downloads`

Deletes one or more completed or failed jobs.

Body:

```json
{
  "job_ids": ["job-1", "job-2"]
}
```

Limits and behavior:

- `job_ids` is required
- Maximum `100` job ids per request
- Returns `409` if any requested job is still `queued` or `processing`
- Deletes both D1 artifact rows and backing R2 objects

## Restore Use

1. Download the `.sql.gz` file from the admin export center.
2. Decompress it to `.sql`.
3. Apply it to the target D1 database with Wrangler:

```bash
gunzip -c australianrates-database-full.sql.gz > australianrates-database-full.sql
npx wrangler d1 execute australianrates_api --remote --file ./australianrates-database-full.sql
```

For the most exact clone, create the dump during a quiet period when writes are paused or minimal.

## Error contract

All admin download errors use:

```json
{
  "ok": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human readable message",
    "details": {}
  }
}
```

Common codes:

- `BAD_REQUEST`: validation or unsupported state
- `NOT_FOUND`: missing job or artifact
- `DOWNLOAD_JOB_MISSING`: job row unexpectedly missing after create/retry
- `DOWNLOAD_JOBS_ACTIVE`: delete blocked by queued or processing jobs
- `DOWNLOAD_NOT_READY`: bundle requested before completion
- `DOWNLOAD_ARTIFACT_MISSING`: artifact metadata exists but storage object is missing
