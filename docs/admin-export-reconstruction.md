# Admin Export Reconstruction Notes

Admin exports are application-level JSONL archives. They are useful for portability, analytics, and selective recovery, but they are not a drop-in replacement for a full D1 backup.

## What each stream contains

### Canonical

- Historical source tables for the selected scope
- Manifest plus `upsert` records in `.jsonl.gz`
- Optional payload-body companion export with raw R2 body text

### Optimized

- Analytics/event and interval projection tables for the selected scope
- Manifest plus `upsert` or `tombstone` records in `.jsonl.gz`

### Operational

- Logical snapshot of all user tables in D1
- One or more per-table chunk artifacts plus a manifest artifact
- No DDL or schema statements

## What is not included

- No `CREATE TABLE` or other DDL
- No automated import tool in the repo for replaying admin JSONL back into D1
- No automated restore tool in the repo for writing canonical payload exports back into R2
- No Queue or Durable Object state

## Current restore posture

For full disaster recovery:

1. Use the repo migrations to recreate schema.
2. Use a full SQL backup from `wrangler d1 export` for exact database restoration.
3. Treat admin exports as supplemental logical exports, not the primary disaster-recovery artifact.

For selective or analytical restore work:

1. Recreate schema from migrations first.
2. Build purpose-specific import tooling that understands the admin export JSONL shapes.
3. If payload-body restoration is required, add separate tooling to PUT bodies back to `RAW_BUCKET` using the exported `r2_key`.

## Practical distinction

- `wrangler d1 export`: exact SQL backup for full D1 recovery
- Admin export center: JSONL application exports for canonical, optimized, and operational data

Use the admin export center when you need application-shaped exports or incremental datasets. Use `wrangler d1 export` when you need full-database disaster recovery.
