/**
 * Verify Cloudflare API tokens listed in .env. Does not log secret values.
 * Run from repo root: node scripts/verify-env-tokens.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const envPath = path.join(__dirname, '..', '.env');
const raw = fs.readFileSync(envPath, 'utf8');
const vars = {};
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*(CLOUDFLARE_[A-Za-z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const tokenVars = Object.keys(vars).filter((k) => k.includes('CLOUDFLARE') && vars[k]);

function verify(token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.cloudflare.com',
        path: '/client/v4/user/tokens/verify',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            resolve({ success: false });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  for (const name of tokenVars) {
    const r = await verify(vars[name]);
    const ok = r.success === true;
    const status = (r.result && r.result.status) || '';
    const msg = ok ? 'OK ' + status : 'FAIL ' + (r.errors && r.errors[0] ? r.errors[0].message : '');
    console.log(name + ': ' + msg);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
