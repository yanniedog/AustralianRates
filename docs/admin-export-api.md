# Admin Export API

The admin export center uses the authenticated admin API under `/api/home-loan-rates/admin/downloads`.

## Endpoints

### `GET /admin/downloads`

Lists jobs for the requested filters.

Query params:

- `stream`: `canonical`, `optimized`, or `operational`
- `scope`: `all`, `home_loans`, `savings`, or `term_deposits`
- `status`: `queued`, `processing`, `completed`, or `failed`
- `limit`: `1` to `250` (default `12`)

Response:

```json
{
  "ok": true,
  "count": 1,
  "jobs": [
    {
      "ok": true,
      "job": {
        "job_id": "uuid",
        "stream": "canonical",
        "scope": "all",
        "mode": "snapshot",
        "status": "completed"
      },
      "download_path": null,
      "download_file_name": null,
      "artifacts": [
        {
          "artifact_id": "uuid",
          "artifact_kind": "main",
          "file_name": "canonical-all-snapshot.jsonl.gz",
          "row_count": 123,
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

Creates a new export job.

Body:

- `stream`: required
- `scope`: optional, defaults to `all`
- `mode`: `snapshot` or `delta`
- `since_cursor` or `sinceCursor`: optional non-negative integer for delta jobs
- `include_payload_bodies` or `includePayloadBodies`: optional boolean, canonical-only

Notes:

- `operational` currently supports `snapshot` only.
- `since_cursor` is normalized to a non-negative integer; there is currently no explicit upper bound beyond numeric coercion.

Returns `202 Accepted` with the same job/artifact shape used by `GET /admin/downloads/:jobId`.

### `POST /admin/downloads/:jobId/retry`

Retries a failed job.

Behavior:

- Allowed only when `status === "failed"`.
- Deletes any stored artifacts for that job from D1 and R2 before re-queueing.
- Resets the job back to `queued` and immediately attempts to continue processing.

Returns `202 Accepted` with the current job/artifact status body.

### `GET /admin/downloads/:jobId`

Returns a single job in the same shape used by list responses.

### `GET /admin/downloads/:jobId/artifacts/:artifactId/download`

Downloads one artifact as binary content. The response sets:

- `Content-Type` from artifact metadata
- `Content-Disposition` using the artifact file name

### `GET /admin/downloads/:jobId/download`

Streams a single concatenated `.jsonl.gz` file for completed `operational` snapshot jobs only.

Returns:

- `400` when the job is not an operational snapshot
- `409` while the snapshot is still being prepared
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
- `DOWNLOAD_NOT_READY`: operational bundle requested before completion
- `DOWNLOAD_ARTIFACT_MISSING`: artifact metadata exists but storage object is missing

HTTP usage:

- `400` for validation or state preconditions
- `404` for missing jobs or artifacts
- `409` for active-job delete conflicts or bundle-not-ready states
- `500` for unexpected persistence failures
