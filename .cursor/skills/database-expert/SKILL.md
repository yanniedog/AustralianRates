---
name: database-expert
---

# Database Expert

Apply expert-level database administration, engineering, optimisation, and systems thinking so the database is as good as it can be. Work across schema design, SQL tuning, indexing, migrations, integrity, operations, and security.

---

## Before changing anything

1. **Understand the workload** – Read patterns (point lookups, range scans, aggregations), write volume, and latency expectations. Optimise for the real access paths.
2. **Respect existing invariants** – Identify canonical keys, uniqueness, and referential constraints. Do not weaken integrity to “fix” a symptom without explicit trade-off.
3. **Check the engine** – This project uses Cloudflare D1 (SQLite). Use SQLite-compatible syntax and be aware of D1 limits (e.g. bind count, statement size). For other engines, adapt patterns accordingly.

---

## Schema and integrity

- **Canonical identity** – Use a single, stable key for “same entity over time” (e.g. `product_key`). Document it in schema comments and migrations.
- **Types and constraints** – Choose types that match domain and query needs. Enforce NOT NULL, UNIQUE, and CHECK where the business rules require them; avoid optional constraints that hide bugs.
- **Normalisation vs denormalisation** – Normalise for correctness and single source of truth; denormalise only for proven read hot paths, with a clear strategy for keeping derived data in sync.
- **Migrations** – Keep migrations reversible where possible (e.g. add column then backfill then drop old). Never rely on implicit ordering; name and order migration files explicitly. Test migrations on a copy of production-like data before applying.

See [references/schema-and-integrity.md](references/schema-and-integrity.md) for patterns, constraints, and migration discipline.

---

## Indexing and query tuning

- **Index for the query** – Add indexes that match filter, join, and order-by columns used in hot queries. Avoid redundant or unused indexes that slow writes.
- **Measure, then change** – Prefer execution plans (EXPLAIN QUERY PLAN in SQLite) and timing before adding or dropping indexes. Document why each index exists.
- **Query shape** – Prefer selective filters and small result sets. Avoid full table scans on large tables unless intentional. Use LIMIT and pagination for large reads.
- **Writes** – Batch inserts/updates where possible; be aware of lock duration and contention (e.g. sqlite_busy). In D1, respect transaction and statement limits.

See [references/indexing-and-query-tuning.md](references/indexing-and-query-tuning.md) for index design, execution plans, and SQLite/D1 specifics.

---

## Operations and reliability

- **Backups and restore** – Ensure backups are automated, tested, and restorable. For D1, use the project’s backup/restore flow (see project docs) and verify restore on a test database.
- **Monitoring** – Track slow queries, error rates, and lock/contention. Alert on integrity failures or schema drift.
- **Security** – Principle of least privilege; no raw credentials in code. Use parameterised statements only; never concatenate user input into SQL. Audit sensitive access if required.

See [references/operations-and-reliability.md](references/operations-and-reliability.md) for backup, monitoring, and security practices.

---

## Project context (Australian Rates)

- **Storage** – Cloudflare D1 (SQLite). Migrations live under `workers/api/migrations/`. Apply with `wrangler d1 migrations apply`.
- **Canonical key** – `product_key` identifies a product over time (see AGENTS.md and mission docs). Charts and exports must group or filter by `product_key` for longitudinal correctness.
- **Rules** – No mock data in tests; use real D1 or real-data fixtures. Do not refactor migration files or build config per project rules.

When proposing schema or query changes, state impact on existing migrations, indexes, and application code, and call out any new D1/SQLite limits or failure modes.
