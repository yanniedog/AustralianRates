# Admin Export Reconstruction

The admin export center now creates one export type only: a full-database D1 dump delivered as a single `.sql.gz` file.

That file is intended to restore or replace the database from scratch.

## What the dump contains

- Table creation SQL from `sqlite_master`
- Index creation SQL
- Trigger creation SQL
- View creation SQL
- Row inserts for user tables in the D1 database
- Drop statements so the dump can overwrite an existing corrupted or stale database

The dump excludes internal SQLite and Cloudflare tables such as `sqlite_%` and `_cf_%`, so the restored SQL remains D1-compatible.

## Restore workflow

### Repair the current database in place

1. Create or select a completed dump job in the admin export center.
2. Run `Analyze restore`.
3. Confirm the reported missing rows, obsolete rows, and any blocked conditions.
4. Run `Restore this dump` once the analysis is ready.

The restore path drops the current D1 schema and data, replays the dump, and verifies the restored row counts against the dump metadata.

### Import into a blank or replacement database

1. Download the dump from the admin export center.
2. Run the import script against the target D1 database.

```bash
node scripts/import-d1-backup.js --db australianrates_api --input ./australianrates-database-full.sql.gz --remote
```

## Replace an existing corrupted database

The admin restore path and the CLI import path are intended for different operator situations:

- Use the admin restore path when the current database is still reachable and you want the worker to analyze missing or obsolete data first.
- Use the CLI import path when you are restoring into a blank database, a replacement D1 database, or a disaster-recovery target outside the current admin worker.
- Both paths replay the same single-file dump artifact.

## Consistency note

The admin worker assembles the dump through live D1 reads. For the most exact restore artifact, create the dump during a quiet period when writes are paused or minimal.

If you want a local CLI-driven backup workflow instead of the admin UI, use [backup.md](backup.md).

## Related docs

- [Admin Export API](admin-export-api.md)
- [Admin API Notes](admin-api.md)
- [Safe D1 Backups](backup.md)
