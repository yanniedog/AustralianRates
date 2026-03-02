import { requestCloudflareJson } from '../lib/cloudflare-api';
import { getCloudflareAccountId, pickCloudflareToken } from '../lib/cloudflare-token';
import { loadRepoEnv } from '../lib/env';

const ZONE_NAME = 'australianrates.com';
const PAGES_TARGET = 'australianrates.pages.dev';

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

loadRepoEnv(process.cwd());

const apiToken = pickCloudflareToken(TOKEN_KEYS);
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const accountId = getCloudflareAccountId();

async function request(method: string, pathname: string, body?: unknown): Promise<any> {
  return await requestCloudflareJson({
    token: apiToken as string,
    method,
    path: pathname,
    body,
  });
}

async function getZoneId(): Promise<string> {
  if (zoneId) return zoneId;
  const r = await request('GET', '/zones?name=' + encodeURIComponent(ZONE_NAME));
  const zones = r.result || [];
  if (!zones.length) throw new Error('Zone not found: ' + ZONE_NAME);
  return zones[0].id;
}

async function ensureSslMode(targetZoneId: string): Promise<void> {
  const pathname = `/zones/${targetZoneId}/settings/ssl`;
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

async function ensureUniversalSsl(targetZoneId: string): Promise<void> {
  const pathname = `/zones/${targetZoneId}/ssl/universal/settings`;
  const get = await request('GET', pathname);
  if (get.result?.enabled === true) {
    console.log('Universal SSL already enabled.');
    return;
  }
  console.log('Enabling Universal SSL (was: %s)', get.result?.enabled === false ? 'disabled' : 'unknown');
  await request('PATCH', pathname, { enabled: true });
  console.log('Universal SSL enabled. Edge certificate may take up to 15-24 hours to provision.');
}

async function ensureMinTlsVersion(targetZoneId: string): Promise<void> {
  const pathname = `/zones/${targetZoneId}/settings/min_tls_version`;
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

async function logCertificatePackStatus(targetZoneId: string): Promise<void> {
  try {
    const r = await request('GET', `/zones/${targetZoneId}/ssl/certificate_packs?status=all`);
    const packs = r.result || [];
    if (!packs.length) {
      console.log('No certificate packs returned.');
      return;
    }
    for (const pack of packs) {
      console.log('Certificate pack: type=%s status=%s id=%s', pack.type, pack.status, pack.id || 'n/a');
    }
  } catch (error) {
    console.warn('Could not list certificate packs:', (error as Error).message);
  }
}

async function ensureDnsRecords(targetZoneId: string): Promise<void> {
  const r = await request('GET', `/zones/${targetZoneId}/dns_records?per_page=100`);
  const records = r.result || [];
  const desired = [
    { type: 'CNAME', name: 'www', nameFqdn: 'www.' + ZONE_NAME, content: PAGES_TARGET, proxied: true },
    { type: 'CNAME', name: '@', nameFqdn: ZONE_NAME, content: PAGES_TARGET, proxied: true },
  ];

  for (const want of desired) {
    const existing = records.find((rec: any) => rec.type === want.type && (rec.name === want.nameFqdn || rec.name === want.name));
    const contentNorm = existing?.content ? String(existing.content).replace(/\.$/, '').toLowerCase() : '';
    const targetNorm = PAGES_TARGET.replace(/\.$/, '').toLowerCase();
    const proxiedOk = existing && existing.proxied === true;
    if (existing && contentNorm === targetNorm && proxiedOk) {
      console.log('DNS %s %s -> %s (proxied) already correct.', want.type, want.name, PAGES_TARGET);
      continue;
    }
    if (existing) {
      console.log('Updating DNS %s %s -> %s (proxied).', want.type, want.name, PAGES_TARGET);
      await request('PUT', `/zones/${targetZoneId}/dns_records/${existing.id}`, {
        type: want.type,
        name: want.name,
        content: PAGES_TARGET,
        proxied: want.proxied,
        ttl: 1,
      });
    } else {
      console.log('Creating DNS %s %s -> %s (proxied).', want.type, want.name, PAGES_TARGET);
      await request('POST', `/zones/${targetZoneId}/dns_records`, {
        type: want.type,
        name: want.name,
        content: PAGES_TARGET,
        proxied: want.proxied,
        ttl: 1,
      });
    }
  }
}

async function main(): Promise<void> {
  if (!apiToken) {
    console.error('Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_FULL_ACCESS_TOKEN in .env (Zone + DNS + SSL permissions).');
    process.exit(1);
  }
  console.log('Resolving zone ID for %s...', ZONE_NAME);
  const resolvedZoneId = await getZoneId();
  console.log('Zone ID:', resolvedZoneId);
  console.log('Account ID:', accountId);
  await logCertificatePackStatus(resolvedZoneId);
  await ensureSslMode(resolvedZoneId);
  await ensureMinTlsVersion(resolvedZoneId);
  await ensureUniversalSsl(resolvedZoneId);
  await ensureDnsRecords(resolvedZoneId);
  console.log('Done. Run npm run verify:prod-hosting after a few minutes for TLS propagation.');
}

void main().catch((error) => {
  console.error((error as Error).message || error);
  process.exit(1);
});
