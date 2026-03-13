# Admin Export Reconstruction

Admin exports are application-level JSONL bundles. They are useful for analytics portability, longitudinal data inspection, and selective recovery, but they are not a full disaster-recovery substitute for a Wrangler D1 export.

## What Each Stream Contains

### Canonical

- Historical rate tables for the selected scope
- Manifest and row upsert records in JSONL
- Optional payload-body records when `include_payload_bodies` is enabled

Use this when you need historical rows plus optional raw payload body content.

### Optimized

- Analytics-oriented change/event and interval projection tables
- Manifest and row upsert records in JSONL

Use this when you need the chart/pivot/history layer without replaying the full canonical set.

### Operational

- All user tables from D1, chunked into multiple JSONL gzip artifacts when needed
- A manifest describing table coverage and artifact parts
- A single bundle download for completed snapshots when available

Use this for operational audits and broad data portability across the existing schema.

## What Admin Exports Do Not Include

- DDL or schema creation SQL
- Automatic D1 import tooling in this repo
- Automatic R2 restore tooling in this repo
- Queue state, Durable Object state, or KV namespace state

That means admin exports alone are not enough to recreate a blank environment from scratch.

## Recommended Recovery Paths

### Exact D1 disaster recovery

Use the Wrangler D1 export process in [backup.md](backup.md). That path captures the database as SQL and remains the primary disaster-recovery workflow.

### Application-level reconstruction from admin exports

Use admin exports only when you intentionally want JSONL replay instead of a raw SQL dump.

Minimum steps:

1. Recreate the schema by applying the API worker migrations first.
2. Import the JSONL export rows into the existing schema with a dedicated D1 import script.
3. If you need raw payload bodies, replay canonical payload-body records into `RAW_BUCKET` using the recorded `r2_key` values.

Current limitation:

- The D1 import script and optional R2 restore script are not in the repo yet.
- Until those tools exist, admin exports should be treated as structured backup artifacts, not a one-command restore path.

## Stream Selection Guidance

- Use canonical when longitudinal raw records matter.
- Use optimized when you only need the analytics projection layer.
- Use operational when you need all user tables under the current schema.
- Use Wrangler D1 export when you need an exact database clone or disaster-recovery artifact.

## Cost and Storage Notes

- Operational snapshots can be large because they cover all user tables.
- Canonical exports with payload bodies can also grow quickly because they inline raw body content.
- Plan for R2 storage and egress before keeping many long-lived export artifacts.

## Related Docs

- [Admin API Notes](admin-api.md)
- [Safe D1 Backups](backup.md)
