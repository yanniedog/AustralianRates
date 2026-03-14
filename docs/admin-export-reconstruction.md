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

1. Download the dump from the admin export center.
2. Decompress it to a `.sql` file.
3. Apply it to the target D1 database.

Example:

```bash
gunzip -c australianrates-database-full.sql.gz > australianrates-database-full.sql
npx wrangler d1 execute australianrates_api --remote --file ./australianrates-database-full.sql
```

## Replace an existing corrupted database

The dump includes `DROP ... IF EXISTS` statements before recreating objects and loading data.

That means the same file can be used to:

- Restore into a blank database
- Replace an existing corrupted database
- Rebuild a stale database with the contents captured in the dump

## Consistency note

The admin worker assembles the dump through live D1 reads. For the most exact restore artifact, create the dump during a quiet period when writes are paused or minimal.

If you want a local CLI-driven backup workflow instead of the admin UI, use [backup.md](backup.md).

## Related docs

- [Admin Export API](admin-export-api.md)
- [Admin API Notes](admin-api.md)
- [Safe D1 Backups](backup.md)
