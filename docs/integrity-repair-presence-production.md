# Presence Integrity Repair (Production One-Shot, Guarded)

This runbook is for the guarded production one-shot repair tool.

- No deploy commands are required.
- No migrations are used.
- Tool scope is limited to `product_presence_status`.

## Preconditions

The tool will refuse to run unless all guard flags are present:

- `--remote`
- `--db australianrates_api`
- `--i-know-this-will-mutate-production`
- `--confirm-backup`
- `--backup-artifact <path>` (must exist)

## 1) Create backup/export artifact first

```bash
npx wrangler d1 export australianrates_api --remote --output artifacts/api-prod-pre-presence-repair.sql
```

## 2) Plan-only (read-only)

```bash
node scripts/repair-presence-prod.js \
  --remote \
  --db australianrates_api \
  --i-know-this-will-mutate-production \
  --confirm-backup \
  --backup-artifact artifacts/api-prod-pre-presence-repair.sql
```

Plan-only output includes:
- current orphan presence count
- planned `missing_rows`
- planned `extra_safe_delete_rows`
- exact SQL for plan and apply steps

## 3) Apply (insert missing only)

```bash
node scripts/repair-presence-prod.js \
  --remote \
  --db australianrates_api \
  --apply \
  --i-know-this-will-mutate-production \
  --confirm-backup \
  --backup-artifact artifacts/api-prod-pre-presence-repair.sql
```

## 4) Apply (insert missing + delete safe extras)

```bash
node scripts/repair-presence-prod.js \
  --remote \
  --db australianrates_api \
  --apply \
  --delete-extras \
  --i-know-this-will-mutate-production \
  --confirm-backup \
  --backup-artifact artifacts/api-prod-pre-presence-repair.sql
```

After `--apply`, the tool automatically reruns orphan presence count and prints `orphan_presence_count_after_apply`.

## 5) Post-run verification commands

```bash
npx wrangler d1 execute australianrates_api --remote --command "SELECT COUNT(*) AS orphan_presence_count FROM product_presence_status p LEFT JOIN product_catalog c ON c.dataset_kind = p.section AND c.bank_name = p.bank_name AND c.product_id = p.product_id WHERE c.product_id IS NULL"
```

```bash
npx wrangler d1 execute australianrates_api --remote --command "SELECT p.section, p.bank_name, p.product_id, p.last_seen_collection_date, p.last_seen_at FROM product_presence_status p LEFT JOIN product_catalog c ON c.dataset_kind = p.section AND c.bank_name = p.bank_name AND c.product_id = p.product_id WHERE c.product_id IS NULL ORDER BY p.last_seen_at DESC LIMIT 20"
```

## Rollback guidance

1. Keep the export artifact from step 1 immutable.
2. If repair output is unexpected, stop further mutation runs.
3. Restore by rehydrating from the pre-repair export in a controlled maintenance window.
4. Re-run verification queries and archive before/after outputs.
