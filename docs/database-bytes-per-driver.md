# Bytes per driver (full table)

The full table has columns: **Table | Bytes | Rows | % of bytes**, sorted by bytes descending. Data is **real only**: from the production API or from a saved response you captured from the API.

**Total rows and total size (entire DB):**
```bash
npm run db:summary
```
or `node fetch-db-stats.js --summary`. Requires `ADMIN_API_TOKEN` in `.env`. If the API returns no size, use the Cloudflare D1 dashboard for storage size.

**Detailed breakdown (rows and bytes per table):**
```bash
npm run db:breakdown
```
or `node fetch-db-stats.js` (no flags). Prints every table with row count, estimated bytes, and % of total, sorted by bytes descending. Same `.env` requirement.

**Admin portal:** The admin portal has a **Database size** section (`/admin/db-stats.html`) that shows the same summary (total rows, total size) and a table breakdown. Open the admin dashboard, then **Database size**. Uses the same `GET /admin/db/stats` endpoint with your logged-in token.

**How to get the full table:**

1. Deploy the API so `GET /api/home-loan-rates/admin/db/stats` is live.
2. From repo root with `ADMIN_API_TOKEN` in `.env`:
   ```bash
   node fetch-db-stats.js
   ```
3. Or save the API response to a file, then:
   ```bash
   node fetch-db-stats.js path/to/stats.json
   ```

The script prints the full table. Do not use mock or synthetic data.

---

## Admin DB endpoints (breakdown in bytes)

Base path: `https://www.australianrates.com/api/home-loan-rates/admin`. All require `Authorization: Bearer <ADMIN_API_TOKEN>`.

| Method | Path | Purpose | Response size (bytes) |
|--------|------|---------|------------------------|
| GET | `/db/stats` | **Byte breakdown:** total DB size + per-table row counts and estimated bytes. Only endpoint that returns the full bytes-per-driver breakdown. | Response includes `total_bytes_approx` (number) and `tables[]` with `estimated_bytes` per table. Response body size is small (JSON metadata). |
| GET | `/db/audit` | All user tables (from sqlite_master) with row counts only; no byte estimates. | Small; one row per table with `name`, `row_count`. |
| GET | `/db/tables` | Allowlisted table names; optional `?counts=true` for row counts. | Small; array of `{ name, count? }`. |
| GET | `/db/tables/:tableName/schema` | Column info and key columns for one table. | Small; fixed schema description. |
| GET | `/db/tables/:tableName/rows` | Paginated rows (`?limit=1..500`, `?offset=0`, `?sort=`, `?dir=asc|desc`). | Variable; `limit` × row size (JSON). Typical row ~200–2000 B depending on table. |
| POST | `/db/tables/:tableName/rows/by-key` | Single row by key (body: key column values). | Variable; one row as JSON. |
| POST | `/db/tables/:tableName/rows` | Insert one row (body: column values). | Response: inserted row; small. |
| PUT | `/db/tables/:tableName/rows` | Update one row (body: key + updated fields). | Response: updated row; small. |
| DELETE | `/db/tables/:tableName/rows` | Delete one row (body: key columns). | Response: `{ deleted: true }`; small. |
| GET | `/db/clear/options` | Allowed product types, scopes, group_by for clear. | Small; options object. |
| POST | `/db/clear` | Clear rate data by scope and product type (body: scope, product type, etc.). | Small; outcome summary. |

**Byte breakdown source:** only `GET /db/stats` returns D1 storage in bytes: `total_bytes_approx` (from D1 `meta.size_after`) and per-table `estimated_bytes` (from sampled row content, extrapolated). Use `node fetch-db-stats.js` to print the human-readable table from that endpoint.

---

## API response shape (GET /db/stats)

`GET /admin/db/stats` returns:

- `ok`: boolean
- `total_bytes_approx`: number | null (from D1 meta.size_after)
- `generated_at`: string (ISO)
- `tables`: array of `{ name: string, row_count: number, estimated_bytes: number | null }`

Tables are sorted by `estimated_bytes` descending. `estimated_bytes` is computed by sampling up to 2000 rows per table and extrapolating from the sum of column lengths (SQLite `LENGTH()`).
