# Presence Integrity Repair Runbook (Offline Only)

This runbook repairs `product_presence_status` drift on a **local SQLite clone** of production D1.

- No deploy commands.
- No production mutation.
- Repair is deterministic and idempotent.

## 1) Export production D1 to SQL (read-only)

```bash
npx wrangler d1 export australianrates_api --remote --output artifacts/api-prod-YYYYMMDD.sql
```

## 2) Materialize a local SQLite clone

```bash
sqlite3 artifacts/api-prod-YYYYMMDD.db ".read artifacts/api-prod-YYYYMMDD.sql"
```

## 3) Dry-run preview (no local writes)

```bash
node scripts/repair-presence-integrity.js artifacts/api-prod-YYYYMMDD.db > artifacts/presence-repair-preview.json
```

The JSON includes:
- `before.counts` and projected `after.counts`
- `before.samples` (`LIMIT 50`)
- deterministic `sha256` diff hashes

## 4) Apply on the local clone only

```bash
node scripts/repair-presence-integrity.js artifacts/api-prod-YYYYMMDD.db --apply > artifacts/presence-repair-apply.json
```

Behavior in `--apply` mode:
- Creates shadow tables:
  - `repair_shadow_presence_expected`
  - `repair_shadow_presence_missing`
  - `repair_shadow_presence_extra`
  - `repair_shadow_presence_extra_safe_delete`
- Inserts missing rows into `product_presence_status`
- Deletes only extra rows that are safe to delete (not present in historical tables)

Use `--keep-extra` to disable extra-row deletion.

## 5) Validate clone after apply

Run the PR3 integrity runbook queries against the local clone (remove `--remote`) and compare before/after:

```bash
node scripts/print-integrity-runbook.js
```

Then run generated commands with `--local` and verify:
- orphan product presence is `0`, or residual rows are explicitly enumerated in `presence-repair-apply.json`
- no regressions in other integrity counters

## Acceptance Criteria (Offline)

1. Same export + repeated dry-runs produce identical `before.hashes`.
2. Repeated `--apply` runs are idempotent (`inserted_missing_rows=0`, `deleted_extra_rows=0` on second run).
3. Orphan presence count reaches `0` or a justified residual set is captured with sample rows and diff hash.
4. Other PR3 integrity counters do not regress on the repaired clone.

## Rollback Plan (for eventual prod window; not executed here)

1. Take fresh production export immediately before any mutation window.
2. Keep immutable artefacts:
   - pre-repair export SQL
   - dry-run JSON
   - apply JSON
3. If post-repair verification fails, restore by rehydrating from pre-repair export in a controlled maintenance window.
4. Re-run integrity checks and archive the before/after reports.
