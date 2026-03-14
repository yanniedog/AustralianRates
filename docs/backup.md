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

- The admin export center now creates one export type only: a full-database `.sql.gz` dump for D1 restore or replacement.
- The admin UI download is a single file, even if the worker assembles it from multiple stored parts behind the scenes.
- `wrangler d1 export` remains useful when you want the backup artifact written directly to your own machine outside the admin UI.

## Admin exports vs CLI backups

Both paths now target the same operational goal: a restorable SQL dump.

- `npm run backup:api-db` creates the dump locally from the CLI.
- The admin export center creates the dump through the authenticated admin UI/API.
- The admin UI can also analyze and restore a completed dump back into the current database in place.
- For blank or replacement databases, use `node scripts/import-d1-backup.js --db <name> --input <dump.sql.gz>`.

For the admin flow and restore steps, see [admin-export-api.md](admin-export-api.md) and [admin-export-reconstruction.md](admin-export-reconstruction.md).
