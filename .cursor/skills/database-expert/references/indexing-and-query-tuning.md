# Indexing and Query Tuning

Reference for index design, execution plans, and SQL tuning (SQLite/D1).

## Table of contents

- When to add an index
- Index design rules
- Measuring with EXPLAIN QUERY PLAN
- Query patterns to prefer or avoid
- D1/SQLite limits

---

## When to add an index

- **Add** – Columns used in WHERE, JOIN ON, ORDER BY, or GROUP BY of hot queries. Covering indexes when the query only needs indexed columns.
- **Avoid** – Indexes that are never used (verify with plans). Duplicate or overlapping indexes that add write cost without read benefit. Indexes on very low-cardinality columns unless used in composite with others.
- **Document** – In migration or schema comment: which query or use case each index serves.

---

## Index design rules

- **Left prefix** – Composite index (a, b, c) supports filters on (a), (a, b), (a, b, c), not (b) or (c) alone. Order columns by selectivity and query shape.
- **Covering index** – Include all columns the query needs in the index so the table is not accessed (index-only scan). Trade-off: larger index, more write cost.
- **Uniqueness** – Use UNIQUE index when the business key must be unique. Also supports lookups and can replace a separate non-unique index for that key.
- **Partial index** (SQLite) – CREATE INDEX ... WHERE condition. Use when queries always filter on that condition; smaller index, faster.

---

## Measuring with EXPLAIN QUERY PLAN

- Run `EXPLAIN QUERY PLAN <sql>` for the actual query (with bound parameters) to see scan type and index use.
- Prefer **SEARCH**/**INDEX** over **SCAN TABLE**. “SCAN TABLE” on large tables often indicates a missing or unused index.
- Check for **CORRELATE** subqueries that run per row; consider rewriting as JOIN or temporary table if hot.
- Re-check plans after schema or data volume changes.

---

## Query patterns to prefer or avoid

- **Prefer** – Parameterised statements. Selective WHERE (index-friendly). LIMIT for large result sets. Batched writes in a single transaction where appropriate.
- **Avoid** – SELECT * when only a few columns are needed. Unbounded IN (list of thousands). Functions on indexed columns in WHERE (e.g. WHERE lower(name) = ...) unless you have an expression index. N+1 query patterns; use JOIN or IN with a bounded list.
- **Locking** – In SQLite, long transactions or many writes can cause sqlite_busy. Keep transactions short; batch in chunks if necessary. D1 has per-request transaction semantics; be aware of timeout and statement limits.

---

## D1/SQLite limits

- **Bound parameters** – SQLite has a limit on number of bound parameters per statement (~999 by default). Split large IN clauses or use a temp table.
- **Statement size** – Very long SQL can hit limits; split into multiple statements or batch smaller chunks.
- **Transactions** – D1 runs each request in a transaction context; avoid holding long-running or multi-statement transactions across external calls.
- **Read replica** – If the project uses D1 read replicas, route read-only queries there when appropriate to reduce load on the primary.
