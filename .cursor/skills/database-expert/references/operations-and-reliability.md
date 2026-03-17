# Operations and Reliability

Reference for backups, restore, monitoring, and security.

## Table of contents

- Backups and restore
- Monitoring and alerting
- Security and access control
- D1-specific operations

---

## Backups and restore

- **Automate** – Backups must run on a schedule (e.g. daily). No reliance on manual runs for critical data.
- **Verify** – Periodically restore to a test database and run integrity checks or smoke queries. Document the restore procedure.
- **Scope** – Full dump for disaster recovery; optionally point-in-time or table-level if supported and needed.
- **Australian Rates** – Use the project’s admin export/backup flow and docs (e.g. full database dump, import script). Restore path must be tested; see docs/admin-export-reconstruction.md and backup.md.

---

## Monitoring and alerting

- **Slow queries** – Log or metric queries above a threshold. Use EXPLAIN QUERY PLAN for those that appear in top-N slow list.
- **Errors** – Track d1_error, sqlite_busy, and constraint violations. Alert on sudden increase or integrity failures.
- **Schema drift** – Detect unexpected schema changes (e.g. missing index or table). Optional checks in CI or post-migration.
- **Capacity** – Monitor database size and growth; plan for limits (D1 has size limits per plan).

---

## Security and access control

- **Least privilege** – Application and admin accounts should have only the permissions they need. Separate read-only from read-write where possible.
- **No raw SQL from input** – Always use parameterised statements. Never concatenate or interpolate user or external input into SQL.
- **Secrets** – No database credentials in code or in repo. Use environment or secret store; rotate periodically.
- **Audit** – If required, log access to sensitive tables or admin operations. Retain logs according to policy.

---

## D1-specific operations

- **Migrations** – `wrangler d1 migrations apply <binding> --remote` (production) or `--local` (dev). Apply in order; do not skip or reorder.
- **Console and debug** – Use `wrangler d1 execute` for one-off queries or debugging. Prefer read-only for inspection; avoid ad-hoc schema changes.
- **Backup** – Use Cloudflare’s backup/export and the project’s documented restore path. Ensure backup runs before major migrations when possible.
- **Bounds** – Be aware of D1 limits (database size, statement size, bind count, timeout). Design batching and pagination to stay within bounds.
