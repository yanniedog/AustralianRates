# Raw Linkage Production Repair (PR10 Guarded Executor)

This runbook is for guarded production raw-linkage repair execution.

## Safety constraints

- No deploy commands.
- No migrations.
- Allowlisted DB only: `australianrates_api`.
- Deletion is disallowed in PR10.
- Mutation is insert-only and idempotent.
- All mutation runs require:
  - `--remote`
  - `--db australianrates_api`
  - `--confirm-backup`
  - `--backup-artifact <path>`
  - `--i-know-this-will-mutate-production`

## 1) Mandatory backup export

```bash
npx wrangler d1 export australianrates_api --remote --output artifacts/api-prod-raw-linkage-YYYYMMDDTHHMMSSZ.sql
```

## 2) Plan-only (read-only)

```bash
node scripts/repair-raw-linkage-prod.js \
  --remote \
  --db australianrates_api \
  --confirm-backup \
  --backup-artifact artifacts/api-prod-raw-linkage-YYYYMMDDTHHMMSSZ.sql
```

Plan output includes:
- `orphan_before`
- `distinct_hashes_count`
- `insert_candidates_count`
- top bucket counts
- deterministic `plan_hash`

## 3) Apply (insert-only)

```bash
node scripts/repair-raw-linkage-prod.js \
  --remote \
  --db australianrates_api \
  --confirm-backup \
  --backup-artifact artifacts/api-prod-raw-linkage-YYYYMMDDTHHMMSSZ.sql \
  --i-know-this-will-mutate-production \
  --apply
```

Behaviour:
- Runs plan snapshot and fresh pre-apply snapshot.
- Refuses apply if plan counts/hash changed.
- Inserts only policy-approved repairable rows (`likely_missing_raw_object_row`).
- Re-runs post-apply verification queries and reports before/after.

## 4) Independent verification SQL (before/after)

```bash
npx wrangler d1 execute australianrates_api --remote --command "
WITH orphan_rows AS (
  SELECT rp.id, rp.content_hash
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
)
SELECT
  COUNT(*) AS orphan_payload_rows,
  COUNT(DISTINCT content_hash) AS orphan_distinct_hashes
FROM orphan_rows;"
```

```bash
npx wrangler d1 execute australianrates_api --remote --command "
WITH orphan_rows AS (
  SELECT rp.content_hash, rp.source_type, rp.source_url
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
)
SELECT
  COALESCE(source_type, 'unknown') AS source_type,
  COUNT(*) AS orphan_rows
FROM orphan_rows
GROUP BY COALESCE(source_type, 'unknown')
ORDER BY orphan_rows DESC, source_type ASC
LIMIT 20;"
```

## 5) Rollback outline

1. Keep the pre-run backup artifact immutable in `artifacts/`.
2. If unexpected deltas occur, stop further mutation.
3. Restore from export using controlled D1 restore/import workflow in maintenance window.
4. Re-run plan-only and independent verification queries and compare with pre-run outputs.
