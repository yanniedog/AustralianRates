# Safe D1 Backups

This project must never commit database exports or backup artifacts.

## Why

- SQL/DB exports can be very large and will break GitHub push limits.
- Exports may contain sensitive production data and should not live in git history.
- Backups are operational artifacts, not source code.

## Safe backup command

From repo root:

```bash
npm run backup:api-db
```

This runs:

```bash
node scripts/export-d1-backup.js --db australianrates_api --remote
```

Behavior:

- Runs a read-only `wrangler d1 export`.
- Writes output outside the repo by default:
  - Windows: `%USERPROFILE%\ar-backups\`
  - macOS/Linux: `~/ar-backups/`
- Compresses SQL to `.sql.gz` (smaller by default).
- Prints exact output file path and size when done.

## Optional arguments

```bash
node scripts/export-d1-backup.js --db australianrates_api --remote --output-dir "C:\Users\<you>\ar-backups"
```

Writing inside the repo is blocked by default. If you intentionally want that behavior (not recommended), you must pass:

```bash
--allow-repo-path
```

## Git hygiene

- `artifacts/` is ignored by git.
- `artifacts/.gitkeep` is the only file intended to be tracked there.
- Never force-add backup files (for example with `git add -f`).

## Production safety

- `wrangler d1 export` is read-only and does not mutate production data.

## Admin export center vs Wrangler D1 export

- Wrangler D1 export is still the primary disaster-recovery path for an exact database clone.
- Admin export center downloads are structured JSONL application exports. They are useful for portability and analysis, but they do not include schema creation SQL.
- See [admin-export-reconstruction.md](admin-export-reconstruction.md) before treating admin exports as restore artifacts.

## Admin exports vs D1 backups

The admin export center is not the same as a full D1 backup.

- `wrangler d1 export` is the disaster-recovery path for exact database restore.
- Admin exports are JSONL application exports for canonical, optimized, and operational data.
- Admin exports do not include DDL and are not, by themselves, sufficient to recreate the full database from scratch.

See `docs/admin-export-api.md` and `docs/admin-export-reconstruction.md`.
