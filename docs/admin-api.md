# Admin API Notes

This document covers the authenticated admin download/export surface mounted under `/api/home-loan-rates/admin`.

## Authentication

- `Authorization: Bearer <token>` is accepted when the token matches `ADMIN_API_TOKEN` or any comma-separated token in `ADMIN_API_TOKENS`.
- `Cf-Access-Jwt-Assertion: <jwt>` is accepted when both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are configured and the JWT verifies against Cloudflare Access.
- If neither auth path succeeds, the API returns `401` with `code: "UNAUTHORIZED"` and a `details.reason` value such as `admin_token_or_access_jwt_required`, `invalid_bearer_token`, or `invalid_access_jwt`.

## Download Endpoints

### `GET /downloads`

Lists recent admin download jobs.

Query params:

- `stream`: optional; `canonical`, `optimized`, or `operational`
- `scope`: optional; `all`, `home_loans`, `savings`, or `term_deposits`
- `status`: optional; `queued`, `processing`, `completed`, or `failed`
- `limit`: optional; clamped to `1..250`, default `12`

Response:

```json
{
  "ok": true,
  "count": 2,
  "jobs": [
    {
      "ok": true,
      "job": {
        "job_id": "uuid",
        "stream": "canonical",
        "scope": "all",
        "mode": "snapshot",
        "format": "jsonl_gzip",
        "since_cursor": null,
        "end_cursor": 4123,
        "include_payload_bodies": 0,
        "status": "completed",
        "requested_at": "2026-03-13T00:00:00.000Z",
        "started_at": "2026-03-13T00:00:01.000Z",
        "completed_at": "2026-03-13T00:00:30.000Z",
        "error_message": null
      },
      "download_path": null,
      "download_file_name": null,
      "artifacts": [
        {
          "artifact_id": "uuid",
          "artifact_kind": "main",
          "file_name": "canonical-all-snapshot.jsonl.gz",
          "row_count": 10000,
          "byte_size": 123456,
          "cursor_start": 0,
          "cursor_end": 4123,
          "download_path": "/admin/downloads/uuid/artifacts/uuid/download"
        }
      ]
    }
  ]
}
```

### `POST /downloads`

Creates a new admin download job.

Body fields:

- `stream`: required; `canonical`, `optimized`, or `operational`
- `scope`: optional; defaults to `all`
- `mode`: optional; defaults to `snapshot`; `operational` currently supports `snapshot` only
- `since_cursor` or `sinceCursor`: optional; normalized to a non-negative integer for `delta`
- `include_payload_bodies` or `includePayloadBodies`: optional boolean; only applies to canonical jobs

Returns `202` with the same job payload shape shown above.

### `POST /downloads/:jobId/retry`

Retries a failed job in-place.

- Only jobs with `status === "failed"` are accepted.
- Existing stored artifacts for that job are deleted before the job is reset to `queued`.
- Returns `202` with the updated job payload.

### `GET /downloads/:jobId`

Returns a single job payload, including artifact metadata and download paths.

### `GET /downloads/:jobId/artifacts/:artifactId/download`

Returns the stored artifact body with the recorded `Content-Type` and an attachment filename.

### `GET /downloads/:jobId/download`

Returns a single gzip stream for completed operational snapshots.

- Only valid for `stream === "operational"` and `mode === "snapshot"`.
- Returns `409` with `code: "DOWNLOAD_NOT_READY"` until the bundle is complete.

### `DELETE /downloads`

Deletes one or more completed or failed jobs and their stored artifacts.

Body fields:

- `job_ids` or `jobIds`: required array of job ids

Limits and behavior:

- At least one job id is required.
- The array is capped at `100` unique ids per request.
- Jobs in `queued` or `processing` state are rejected with `409` and `code: "DOWNLOAD_JOBS_ACTIVE"`.

## Error Codes

- `UNAUTHORIZED`: auth failed or is missing
- `BAD_REQUEST`: invalid stream/scope/mode/status, invalid delete payload, non-retryable retry request
- `NOT_FOUND`: job or artifact id does not exist
- `DOWNLOAD_JOB_MISSING`: the job disappeared before a success response could be built
- `DOWNLOAD_JOBS_ACTIVE`: delete request included queued or processing jobs
- `DOWNLOAD_NOT_READY`: operational bundle requested before completion
- `DOWNLOAD_ARTIFACT_MISSING`: artifact metadata exists but the R2 object is missing

All admin errors use:

```json
{
  "ok": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## Operational Notes

- Canonical and optimized jobs expose artifact-by-artifact downloads.
- Operational snapshot jobs expose both part downloads and a single bundle download path when the bundle is ready.
- Large admin exports are bounded by current row/page guards, but they still consume Worker CPU, D1 reads, R2 operations, and egress.
- Before expanding export scope or batch size, check the official Cloudflare limits pages:
  - Workers: https://developers.cloudflare.com/workers/platform/limits/
  - D1: https://developers.cloudflare.com/d1/platform/limits/
  - Queues: https://developers.cloudflare.com/queues/platform/limits/
  - R2: https://developers.cloudflare.com/r2/platform/limits/
