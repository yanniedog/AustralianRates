import fs from 'node:fs';
import path from 'node:path';
import { httpsGetJson } from '../lib/http';

const envPath = path.join(process.cwd(), '.env');
const raw = fs.readFileSync(envPath, 'utf8');
const vars: Record<string, string> = {};
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*(CLOUDFLARE_[A-Za-z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const tokenVars = Object.keys(vars).filter((key) => key.includes('CLOUDFLARE') && vars[key]);

async function verify(token: string): Promise<any> {
  try {
    return await httpsGetJson('api.cloudflare.com', '/client/v4/user/tokens/verify', { Authorization: 'Bearer ' + token });
  } catch {
    return { success: false };
  }
}

async function main(): Promise<void> {
  for (const name of tokenVars) {
    const r = await verify(vars[name]);
    const ok = r.success === true;
    const status = (r.result && r.result.status) || '';
    const message = ok ? `OK ${status}` : `FAIL ${(r.errors && r.errors[0] ? r.errors[0].message : '')}`;
    console.log(name + ': ' + message);
  }
}

void main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
