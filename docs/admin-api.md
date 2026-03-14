# Admin API Notes

This document covers the authenticated admin API surface mounted under `/api/home-loan-rates/admin`.

## Authentication

- `Authorization: Bearer <token>` is accepted when the token matches `ADMIN_API_TOKEN` or any comma-separated token in `ADMIN_API_TOKENS`.
- `Cf-Access-Jwt-Assertion: <jwt>` is accepted when both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are configured and the JWT verifies against Cloudflare Access.
- If neither auth path succeeds, the API returns `401` with `code: "UNAUTHORIZED"` and a `details.reason` value such as `admin_token_or_access_jwt_required`, `invalid_bearer_token`, or `invalid_access_jwt`.

## Download endpoints

The admin export center now creates one export type only: a full-database D1 dump delivered as a single `.sql.gz` file.

See [admin-export-api.md](admin-export-api.md) for the full request and response contract.

Key points:

- `POST /downloads` now accepts only the full-database dump job shape.
- `GET /downloads/:jobId/download` is the public single-file download route.
- The download is intended to be decompressed and restored with `wrangler d1 execute --file`.
- Existing legacy operational JSONL bundle jobs can still be downloaded until they are deleted.

## Error codes

- `UNAUTHORIZED`: auth failed or is missing
- `BAD_REQUEST`: invalid download shape, invalid delete payload, or non-retryable retry request
- `NOT_FOUND`: job or artifact id does not exist
- `DOWNLOAD_JOB_MISSING`: the job disappeared before a success response could be built
- `DOWNLOAD_JOBS_ACTIVE`: delete request included queued or processing jobs
- `DOWNLOAD_NOT_READY`: bundle requested before completion
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

## Operational notes

- The admin UI exposes only the single-file full-database dump flow.
- Under the hood, the worker may assemble the final download from multiple stored gzip parts, but the operator-facing download remains one file.
- For the most exact restore artifact, create the dump during a quiet period when writes are paused or minimal.
- The CLI backup path in [backup.md](backup.md) remains available when you want a local operational backup workflow outside the admin UI.
