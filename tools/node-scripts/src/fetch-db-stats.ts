/**
 * Fetch DB size and per-table row counts + estimated bytes from production admin API.
 * Requires ADMIN_API_TOKEN in repo root .env (loaded by runner) when fetching from API.
 * Usage:
 *   node fetch-db-stats.js                    # fetch from API (needs token)
 *   node fetch-db-stats.js <path-to.json>     # print full table from saved API response
 */

const fs = require('fs');
const path = require('path');

const ORIGIN: string = process.env.API_BASE
  ? new URL(process.env.API_BASE).origin
  : 'https://www.australianrates.com';
const STATS_URL = `${ORIGIN}/api/home-loan-rates/admin/db/stats`;

const token = (
  process.env.ADMIN_API_TOKEN ||
  process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
  process.env.ADMIN_TEST_TOKEN ||
  process.env.LOCAL_ADMIN_API_TOKEN ||
  ''
).trim();

interface TableRow {
  name: string;
  row_count: number;
  estimated_bytes?: number | null;
}

interface StatsResponse {
  ok: boolean;
  total_bytes_approx?: number | null;
  tables: TableRow[];
  generated_at?: string;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} KB`;
  return `${n} B`;
}

function printTable(data: StatsResponse): void {

  const totalBytes = data.total_bytes_approx ?? 0;
  const totalRows = data.tables.reduce((sum, t) => sum + (t.row_count > 0 ? t.row_count : 0), 0);
  const totalEstimated = data.tables.reduce(
    (sum, t) => sum + (t.estimated_bytes != null && t.estimated_bytes > 0 ? t.estimated_bytes : 0),
    0,
  );

  console.log('========================================');
  console.log('D1 database size breakdown');
  console.log('========================================');
  console.log(`Origin: ${ORIGIN}`);
  console.log(`Generated: ${data.generated_at ?? 'unknown'}`);
  console.log('');
  if (totalBytes > 0) {
    console.log(`Total size (API): ${formatBytes(totalBytes)} (${totalBytes.toLocaleString()} bytes)`);
  } else {
    console.log('Total size (API): (not available; check Cloudflare dashboard)');
  }
  if (totalEstimated > 0) {
    console.log(`Total estimated (sum of drivers): ${formatBytes(totalEstimated)} (${totalEstimated.toLocaleString()} bytes)`);
  }
  console.log(`Total rows (all tables): ${totalRows.toLocaleString()}`);
  console.log('');
  console.log('Bytes per driver (estimated from row content, largest first):');
  console.log('----------------------------------------');
  const col1 = 'Table';
  const col2 = 'Bytes';
  const col3 = 'Rows';
  const col4 = '% of bytes';
  const maxName = Math.max(col1.length, ...data.tables.map((t) => t.name.length));
  console.log(`${col1.padEnd(maxName)}  ${col2.padStart(14)}  ${col3.padStart(12)}  ${col4.padStart(10)}`);
  console.log('-'.repeat(maxName + 2 + 14 + 2 + 12 + 2 + 10));
  for (const t of data.tables) {
    const bytes = t.estimated_bytes ?? 0;
    const n = t.row_count >= 0 ? t.row_count : 0;
    const pct =
      totalEstimated > 0 && bytes > 0 ? ((bytes / totalEstimated) * 100).toFixed(1) : '-';
    const bytesStr = bytes > 0 ? formatBytes(bytes) : '-';
    console.log(
      `${t.name.padEnd(maxName)}  ${bytesStr.padStart(14)}  ${n.toLocaleString().padStart(12)}  ${String(pct).padStart(9)}%`,
    );
  }
  console.log('');
  console.log('(Estimated bytes = sum of column lengths per row, sampled and extrapolated. SQLite LENGTH() is character count.)');
  console.log('Retention: see docs/database-optimization.md. After large deletes, run VACUUM in a maintenance window.');
}

async function main(): Promise<void> {
  let data: StatsResponse;
  const fileArg = process.argv[2];
  if (fileArg && fs.existsSync(path.resolve(process.cwd(), fileArg))) {
    const raw = fs.readFileSync(path.resolve(process.cwd(), fileArg), 'utf8');
    data = JSON.parse(raw) as StatsResponse;
    if (!Array.isArray(data.tables)) {
      console.error('Invalid JSON: expected { tables: [...] }');
      process.exit(1);
    }
    data.ok = true;
  } else {
    if (!token) {
      console.error('Missing ADMIN_API_TOKEN (or ADMIN_API_TOKENS) in environment. Set it in repo root .env.');
      process.exit(1);
    }
    const res = await fetch(STATS_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 401) {
      console.error('401 Unauthorized: token invalid or missing.');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`HTTP ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    data = (await res.json()) as StatsResponse;
    if (!data.ok || !Array.isArray(data.tables)) {
      console.error('Unexpected response:', data);
      process.exit(1);
    }
  }
  printTable(data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
