# Raw Linkage Integrity Repair (Offline Preview + Production Plan-Only)

This runbook is for raw linkage integrity analysis only.

- No deploy commands are required.
- No migrations are required.
- Production mutation is **not** performed in this flow.
- Production plan tool is read-only and refuses mutation flags.

## Target anomaly

`raw_payloads.content_hash` rows that do not have a matching `raw_objects.content_hash`.

## 1) Create production backup export (required before prod plan checks)

```bash
npx wrangler d1 export australianrates_api --remote --output artifacts/api-prod-raw-linkage-YYYYMMDDTHHMMSSZ.sql
```

## 2) Offline preview on local SQLite clone

Use a local SQLite DB file created from a D1 export/import workflow.

```bash
node scripts/repair-raw-linkage-preview.js <local-sqlite-db-path>
```

Optional local-only shadow materialization:

```bash
node scripts/repair-raw-linkage-preview.js <local-sqlite-db-path> --apply
```

Notes:
- `--remote` is refused.
- Binding-like targets (`australianrates_api`, `DB`, etc.) are refused.
- `--apply` writes **only** `repair_shadow_raw_linkage_*` tables on the local clone.

## 2A) PR8 offline report workflow (deterministic analysis)

Generate a one-line JSON report and a compact markdown summary:

```bash
node scripts/repair-raw-linkage-report.js <local-sqlite-db-path>
```

Optional local-only shadow-table materialisation while keeping base tables untouched:

```bash
node scripts/repair-raw-linkage-report.js <local-sqlite-db-path> --apply
```

Optional markdown output path override:

```bash
node scripts/repair-raw-linkage-report.js <local-sqlite-db-path> --markdown-out artifacts/raw-linkage-summary.md
```

The PR8 report includes deterministic hashes and classification buckets:
- by `source_type`
- by fetch-event presence (`present` / `missing`)
- by URL pattern (`wayback_url`, `cdr_register_or_standard`, `cdr_banking_products`, `rba_source`, `other_url`)
- by likely cause (`legacy_wayback_html`, `likely_duplicate_payload_hash`, `missing_fetch_event_metadata`, `likely_missing_raw_object_row`, `other_source`)

## 2B) PR9 simulate-repair workflow (local clone only)

Run deterministic simulation planning on the local clone:

```bash
node scripts/repair-raw-linkage-preview.js <local-sqlite-db-path> --simulate-repair
```

This produces a one-line JSON output with:
- `orphan_count_before`
- `planned_actions_by_type`
- `planned_actions_by_bucket`
- deterministic hash fields for replayability checks

Simulation action types:
- `INSERT_RAW_OBJECT`
- `LINK_EXISTING`
- `SKIP_LEGACY`
- `SKIP_UNKNOWN`

When `--simulate-repair` is set, the tool creates shadow tables only:
- `repair_shadow_raw_linkage_planned_actions`
- `repair_shadow_raw_linkage_planned_actions_by_type`
- `repair_shadow_raw_linkage_planned_actions_by_bucket`

Policy and gate criteria are defined in:
- `docs/integrity-repair-raw-linkage-policy.md`

## 3) Production plan-only (guarded, read-only)

```bash
node scripts/plan-raw-linkage-prod.js \
  --remote \
  --db australianrates_api \
  --confirm-backup \
  --backup-artifact artifacts/api-prod-raw-linkage-YYYYMMDDTHHMMSSZ.sql \
  --repeat 2
```

Guards:
- Requires `--remote`.
- Requires allowlisted `--db australianrates_api`.
- Requires `--confirm-backup` and an existing `--backup-artifact`.
- Refuses mutation flags (`--apply`, `--delete*`, etc.).

Output includes:
- orphan count
- distinct orphan hash count
- top orphan source-type counts
- sample orphan rows (`LIMIT 20`)
- repeat stability fields (`repeats`, `stable`, `counts_per_run`)
- executed wrangler commands

## 4) Acceptance criteria for a future repair PR (not this PR)

Proceed to a future mutation PR only when all are true:
1. Offline preview output is deterministic on the same DB clone (same counts and hashes).
2. Production plan-only output is stable across repeated plan runs.
3. PR8 report buckets are internally consistent:
   `orphan_count == missing_raw_object_row == sum(by_source_type counts) == sum(by_fetch_event_presence counts)`.
4. Legacy (`wayback_html`) and non-legacy orphan populations are separated and quantified.
5. Proposed repair SQL is idempotent and includes pre/post verification queries.
6. Rollback artifact is available and verified.
7. PR9 simulation outputs map every orphan hash to an explicit planned action/bucket and show deterministic hashes across reruns.

## 5) Rollback outline (for future mutation PR)

1. Keep the pre-run export artifact immutable in `artifacts/`.
2. If unexpected deltas occur, stop further actions.
3. Restore from backup using controlled D1 restore/import workflow during a maintenance window.
4. Re-run plan-only verification queries and compare against pre-run counts.
