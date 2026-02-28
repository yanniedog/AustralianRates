/**
 * Fixes production DNS and TLS for apex and www in the Cloudflare zone australianrates.com.
 * - Ensures zone SSL mode is "full" (edge serves HTTPS).
 * - Ensures Universal SSL is enabled (edge certificate for apex + www).
 * - Ensures DNS: CNAME www -> australianrates.pages.dev (proxied), CNAME @ -> australianrates.pages.dev (proxied).
 *
 * Requires: A Cloudflare API token with Zone:Read, Zone:Edit, DNS:Edit, SSL:Edit. Uses first available from .env:
 *   CLOUDFLARE_FULL_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_GENERAL_TOKEN, CF_API_TOKEN,
 *   CLOUDFLARE_EDIT_ZONE_DNS, CLOUDFLARE_API_AGENT_LEE_FULL_FULL, CLOUDFLARE_API_SELFPERMISSION_MOD, CLOUDFLARE_MULTI.
 * Optional: CLOUDFLARE_ZONE_ID, CLOUDFLARE_ACCOUNT_ID. Loads .env from repo root.
 * Run from repo root: node scripts/fix-cloudflare-dns-tls.js  or  npm run fix:cloudflare-dns-tls
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ZONE_NAME = 'australianrates.com';
const PAGES_TARGET = 'australianrates.pages.dev';
const ACCOUNT_ID_DEFAULT = 'f3250f7113cfd8c7f747a09f942ca6d0';

const TOKEN_KEYS = [
  'CLOUDFLARE_FULL_ACCESS_TOKEN',
  'CLOUDFLARE_API_AGENT_LEE_FULL_FULL',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_GENERAL_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_API_SELFPERMISSION_MOD',
  'CLOUDFLARE_MULTI',
  'CLOUDFLARE_EDIT_ZONE_DNS',
];

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(CLOUDFLARE_[A-Za-z0-9_]+|CF_API_TOKEN|CF_ACCOUNT_ID)\s*=\s*(.+)\s*$/);
    if (m) {
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      if (m[1] === 'CF_API_TOKEN') process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || val;
      else if (m[1] === 'CF_ACCOUNT_ID') process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || val;
      else process.env[m[1]] = val;
    }
  }
}
loadEnv();

const API_TOKEN = TOKEN_KEYS.map((k) => process.env[k]).find(Boolean);
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || ACCOUNT_ID_DEFAULT;

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4' + pathname,
      method,
      headers: {
        Authorization: 'Bearer ' + API_TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success === false) {
            const err = json.errors?.[0];
            const msg = err ? (err.message + (err.code ? ' (code ' + err.code + ')' : '')) : data || 'API error';
            reject(new Error(msg));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error(data || String(res.statusCode)));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getZoneId() {
  if (ZONE_ID) return ZONE_ID;
  const r = await request('GET', '/zones?name=' + encodeURIComponent(ZONE_NAME));
  const zones = r.result || [];
  if (zones.length === 0) throw new Error('Zone not found: ' + ZONE_NAME);
  return zones[0].id;
}

async function ensureSslMode(zoneId) {
  const pathname = '/zones/' + zoneId + '/settings/ssl';
  const get = await request('GET', pathname);
  const current = get.result?.value;
  if (current === 'full' || current === 'strict') {
    console.log('Zone SSL mode already:', current);
    return;
  }
  console.log('Setting zone SSL mode to full (was: %s)', current || 'unknown');
  await request('PATCH', pathname, { value: 'full' });
  console.log('Zone SSL mode set to full.');
}

async function ensureUniversalSsl(zoneId) {
  const pathname = '/zones/' + zoneId + '/ssl/universal/settings';
  const get = await request('GET', pathname);
  if (get.result?.enabled === true) {
    console.log('Universal SSL already enabled.');
    return;
  }
  console.log('Enabling Universal SSL (was: %s)', get.result?.enabled === false ? 'disabled' : 'unknown');
  await request('PATCH', pathname, { enabled: true });
  console.log('Universal SSL enabled. Edge certificate may take up to 15–24 hours to provision.');
}

async function ensureMinTlsVersion(zoneId) {
  const pathname = '/zones/' + zoneId + '/settings/min_tls_version';
  const get = await request('GET', pathname);
  const current = get.result?.value;
  if (current === '1.2' || current === '1.3') {
    console.log('Minimum TLS version already:', current);
    return;
  }
  console.log('Setting minimum TLS version to 1.2 (was: %s)', current || 'unknown');
  await request('PATCH', pathname, { value: '1.2' });
  console.log('Minimum TLS version set to 1.2.');
}

async function logCertificatePackStatus(zoneId) {
  try {
    const r = await request('GET', '/zones/' + zoneId + '/ssl/certificate_packs?status=all');
    const packs = r.result || [];
    if (packs.length === 0) {
      console.log('No certificate packs returned.');
      return;
    }
    for (const pack of packs) {
      console.log('Certificate pack: type=%s status=%s id=%s', pack.type, pack.status, pack.id || 'n/a');
    }
  } catch (e) {
    console.warn('Could not list certificate packs:', e.message);
  }
}

async function ensureDnsRecords(zoneId) {
  const r = await request('GET', '/zones/' + zoneId + '/dns_records?per_page=100');
  const records = r.result || [];
  const want = [
    { type: 'CNAME', name: 'www', nameFqdn: 'www.' + ZONE_NAME, content: PAGES_TARGET, proxied: true },
    { type: 'CNAME', name: '@', nameFqdn: ZONE_NAME, content: PAGES_TARGET, proxied: true },
  ];
  for (const w of want) {
    const existing = records.find((rec) => rec.type === w.type && (rec.name === w.nameFqdn || rec.name === w.name));
    const contentNorm = (existing && existing.content) ? existing.content.replace(/\.$/, '').toLowerCase() : '';
    const targetNorm = PAGES_TARGET.replace(/\.$/, '').toLowerCase();
    const proxiedOk = existing && existing.proxied === true;
    if (existing && contentNorm === targetNorm && proxiedOk) {
      console.log('DNS %s %s -> %s (proxied) already correct.', w.type, w.name, PAGES_TARGET);
      continue;
    }
    if (existing) {
      console.log('Updating DNS %s %s -> %s (proxied).', w.type, w.name, PAGES_TARGET);
      await request('PUT', '/zones/' + zoneId + '/dns_records/' + existing.id, {
        type: w.type,
        name: w.name,
        content: PAGES_TARGET,
        proxied: w.proxied,
        ttl: 1,
      });
    } else {
      console.log('Creating DNS %s %s -> %s (proxied).', w.type, w.name, PAGES_TARGET);
      await request('POST', '/zones/' + zoneId + '/dns_records', {
        type: w.type,
        name: w.name,
        content: PAGES_TARGET,
        proxied: w.proxied,
        ttl: 1,
      });
    }
  }
}

async function main() {
  if (!API_TOKEN) {
    console.error('Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_FULL_ACCESS_TOKEN in .env (Zone + DNS + SSL permissions).');
    process.exit(1);
  }
  console.log('Resolving zone ID for %s...', ZONE_NAME);
  const zoneId = await getZoneId();
  console.log('Zone ID:', zoneId);
  await logCertificatePackStatus(zoneId);
  await ensureSslMode(zoneId);
  await ensureMinTlsVersion(zoneId);
  await ensureUniversalSsl(zoneId);
  await ensureDnsRecords(zoneId);
  console.log('Done. Run npm run verify:prod-hosting after a few minutes for TLS propagation.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
