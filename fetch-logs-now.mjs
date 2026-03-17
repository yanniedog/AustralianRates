import fs from 'fs';
import path from 'path';

function loadEnv(repoRoot) {
  const p = path.join(repoRoot, '.env');
  if (!fs.existsSync(p)) return {};
  const o = {};
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
  return o;
}
const repoRoot = process.cwd();
Object.assign(process.env, loadEnv(repoRoot));

const token = (process.env.ADMIN_API_TOKEN || process.env.ADMIN_TEST_TOKEN || process.env.LOCAL_ADMIN_API_TOKEN || '').trim();
if (!token) {
  console.error('Missing ADMIN_API_TOKEN/ADMIN_TEST_TOKEN/LOCAL_ADMIN_API_TOKEN in .env');
  process.exit(1);
}

const BASE = 'https://www.australianrates.com/api/home-loan-rates/admin/logs/system';
const opts = { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) };

async function main() {
  const [statsRes, actionableRes, errorsRes, warnRes] = await Promise.all([
    fetch(`${BASE}/stats`, opts),
    fetch(`${BASE}/actionable?limit=50`, opts),
    fetch(`${BASE}?format=jsonl&limit=300&level=error`, opts),
    fetch(`${BASE}?format=jsonl&limit=300&level=warn`, opts),
  ]);
  if (!statsRes.ok) throw new Error(`stats ${statsRes.status}`);
  if (!actionableRes.ok) throw new Error(`actionable ${actionableRes.status}`);
  const stats = await statsRes.json();
  const actionable = await actionableRes.json();
  const errorsText = errorsRes.ok ? await errorsRes.text() : '';
  const warnText = warnRes.ok ? await warnRes.text() : '';
  console.log('=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('\n=== ACTIONABLE ===');
  console.log(JSON.stringify(actionable, null, 2));
  console.log('\n=== ERRORS (jsonl) ===');
  console.log(errorsText || '(none)');
  console.log('\n=== WARNINGS (jsonl) ===');
  console.log(warnText || '(none)');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
