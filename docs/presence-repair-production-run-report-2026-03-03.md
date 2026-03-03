# Presence Repair Production Run Report (2026-03-03)

## Run metadata

- Scope: `product_presence_status` one-shot repair only
- Start (UTC): `2026-03-03T04:55:19Z` (from backup artifact timestamp)
- Start (operator local): `2026-03-03 15:55:47` (artifact write timestamp)
- Git commit: `f916927e201d1f958262c9d2932d409e4396fdb5`
- Node: `v24.12.0`
- Wrangler: `4.67.0`
- Backup artifact: `artifacts\api-prod-20260303T045519Z.sql`

## Command ledger (executed)

1. Fresh production backup export

```powershell
npx wrangler d1 export australianrates_api --remote --output artifacts\api-prod-20260303T045519Z.sql
```

2. Plan-only (guarded, read-only)

```powershell
node scripts/repair-presence-prod.js --remote --db australianrates_api --confirm-backup --backup-artifact artifacts\api-prod-20260303T045519Z.sql
```

3. Independent orphan verification (authoritative orphan definition)

```powershell
npx wrangler d1 execute australianrates_api --remote --command "
SELECT COUNT(*) AS orphan_product_presence
FROM product_presence_status pps
LEFT JOIN product_catalog pc
  ON pc.dataset_kind = pps.section
 AND pc.bank_name = pps.bank_name
 AND pc.product_id = pps.product_id
WHERE pc.product_id IS NULL;"
```

4. Independent expected/existing/missing/extra verification

```powershell
npx wrangler d1 execute australianrates_api --remote --command "
WITH expected AS (
  SELECT dataset_kind AS section, bank_name, product_id
  FROM product_catalog
),
existing AS (
  SELECT section, bank_name, product_id
  FROM product_presence_status
),
missing AS (
  SELECT e.section, e.bank_name, e.product_id
  FROM expected e
  LEFT JOIN existing p
    ON p.section = e.section
   AND p.bank_name = e.bank_name
   AND p.product_id = e.product_id
  WHERE p.product_id IS NULL
),
extra AS (
  SELECT p.section, p.bank_name, p.product_id
  FROM existing p
  LEFT JOIN expected e
    ON e.section = p.section
   AND e.bank_name = p.bank_name
   AND e.product_id = p.product_id
  WHERE e.product_id IS NULL
)
SELECT
  (SELECT COUNT(*) FROM expected) AS expected_rows,
  (SELECT COUNT(*) FROM existing) AS existing_rows,
  (SELECT COUNT(*) FROM missing) AS missing_rows,
  (SELECT COUNT(*) FROM extra) AS extra_rows,
  (SELECT COUNT(*) FROM extra) AS extra_safe_delete_rows;"
```

5. Independent orphan sample (`LIMIT 20`)

```powershell
npx wrangler d1 execute australianrates_api --remote --command "
SELECT pps.section, pps.bank_name, pps.product_id
FROM product_presence_status pps
LEFT JOIN product_catalog pc
  ON pc.dataset_kind = pps.section
 AND pc.bank_name = pps.bank_name
 AND pc.product_id = pps.product_id
WHERE pc.product_id IS NULL
ORDER BY pps.section, pps.bank_name, pps.product_id
LIMIT 20;"
```

6. Apply step 1 (insert-only)

```powershell
node scripts/repair-presence-prod.js --remote --db australianrates_api --confirm-backup --backup-artifact artifacts\api-prod-20260303T045519Z.sql --i-know-this-will-mutate-production --apply
```

7. Apply step 2 (safe delete extras)

```powershell
node scripts/repair-presence-prod.js --remote --db australianrates_api --confirm-backup --backup-artifact artifacts\api-prod-20260303T045519Z.sql --i-know-this-will-mutate-production --apply --delete-extras
```

8. Final independent orphan verification

```powershell
npx wrangler d1 execute australianrates_api --remote --command "
SELECT COUNT(*) AS orphan_product_presence
FROM product_presence_status pps
LEFT JOIN product_catalog pc
  ON pc.dataset_kind = pps.section
 AND pc.bank_name = pps.bank_name
 AND pc.product_id = pps.product_id
WHERE pc.product_id IS NULL;"
```

## Plan JSON (captured single-line output)

```json
{"ok":true,"phase":"plan","orphan_before":138,"missing_count":0,"extra_safe_delete_count":138,"exit_code":0}
```

## Before/after results

| Metric | Before | After |
|---|---:|---:|
| orphan product presence | 138 | 0 |
| expected_rows | 204 | 204 |
| existing_rows | 342 | 204 |
| missing_rows | 0 | 0 |
| extra_rows | 138 | 0 |
| extra_safe_delete_rows | 138 | 0 |

## Independent verification SQL (copy/paste ready)

```sql
SELECT COUNT(*) AS orphan_product_presence
FROM product_presence_status pps
LEFT JOIN product_catalog pc
  ON pc.dataset_kind = pps.section
 AND pc.bank_name = pps.bank_name
 AND pc.product_id = pps.product_id
WHERE pc.product_id IS NULL;
```

## Rollback outline (no execution in this report)

1. Preserve `artifacts\api-prod-20260303T045519Z.sql` as immutable pre-repair backup.
2. Create a rollback maintenance plan (quiet window, operator approval, change ticket).
3. Rehydrate from the backup into a restore target using Wrangler D1 import/execute workflow.
4. Re-run orphan and expected/existing verification SQL against the restored target.
5. If required, switch production binding only after verification is complete.
