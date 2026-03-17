# Schema and Integrity

Reference for schema design, types, constraints, and migration discipline.

## Table of contents

- Canonical identity and keys
- Types and constraints
- Normalisation and denormalisation
- Migration discipline
- SQLite/D1 specifics

---

## Canonical identity and keys

- Define one **business key** per entity that is stable over time (e.g. `product_key` = `bank_name|product_id|security_purpose|repayment_type|lvr_tier|rate_structure`). Use it for joins, deduplication, and longitudinal views.
- Prefer **single-column or composite natural keys** when they are immutable and unique. Add a **surrogate id** (e.g. INTEGER PRIMARY KEY) when needed for FKs, partitioning, or external systems.
- Document the canonical key in the first migration that introduces the table and in schema comments.

---

## Types and constraints

- **Types** – Use the smallest precise type that fits the domain (INTEGER, REAL, TEXT, BLOB). For dates/times, prefer ISO8601 TEXT or INTEGER (Unix) and be consistent.
- **NOT NULL** – Enforce on every column that must always have a value. Avoid nullable columns that are “optional” only because constraints were omitted.
- **UNIQUE** – Use for business uniqueness (e.g. one row per product_key per as_of_date). Prefer a single UNIQUE constraint over ad-hoc application checks.
- **CHECK** – Use for value rules (e.g. rate >= 0, enum-like TEXT IN (...)). Keeps invalid data out at the DB layer.
- **Foreign keys** – Enable and use FKs where relationships are real. Set ON DELETE/ON UPDATE behaviour explicitly. In SQLite, enable with `PRAGMA foreign_keys = ON` in the same connection that writes.

---

## Normalisation and denormalisation

- **Normalise first** – Correct, non-redundant schema. One place for each fact; FKs for relationships.
- **Denormalise only when** – A read path is proven hot and cannot be satisfied efficiently with joins or views. Document the source of truth and how the denormalised copy is maintained (trigger, job, or application logic).
- **Avoid** – Denormalising “in case we need it” or without a clear sync strategy.

---

## Migration discipline

- **One logical change per migration** – Easier to review, roll back, and reason about.
- **Naming** – Use a consistent prefix (e.g. `NNNN_description.sql`). Order by number so application order is clear.
- **Reversibility** – Prefer: add new column → backfill → switch reads → drop old column. Avoid one-way destructive changes unless intentional.
- **No implicit order** – Do not rely on “run after X”; use migration numbers and dependency comments.
- **Testing** – Run migrations on a copy of production-like data (or real backup) before applying to production. Verify row counts and key queries after.
- **D1** – Use `wrangler d1 migrations apply <binding> --remote` for production. For local, `--local`. Do not edit applied migrations; add a new migration to correct.

---

## SQLite/D1 specifics

- **WITHOUT ROWID** – Consider for tables with a non-integer primary key that is the main access path; can reduce storage and improve some lookups.
- **Triggers** – Use for integrity (e.g. rate bounds) or denormalised sync when the logic is simple and same-connection. Keep trigger logic minimal and documented.
- **No ALTER COLUMN type** – SQLite has limited ALTER; changing type usually requires new column + backfill + drop old.
- **D1 limits** – Bound parameter count, statement size, and transaction duration per Cloudflare docs. Batch large writes; avoid unbounded IN lists.
