/**
 * Triggers a new Cloudflare Pages deployment for the australianrates project.
 * Uses the production branch from the connected Git repo. Use this when the
 * live site is "Behind" the latest commit (e.g. build wasn't triggered or failed).
 *
 * Requires: Cloudflare API token with Pages Edit. Uses first available from .env
 * (same token list as fix-cloudflare-dns-tls.js). Optional: CLOUDFLARE_ACCOUNT_ID.
 * Run from repo root: node scripts/trigger-pages-deploy.js  or  npm run pages:trigger
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_NAME = 'australianrates';
const ACCOUNT_ID_DEFAULT = 'f3250f7113cfd8c7f747a09f942ca6d0';

const TOKEN_KEYS = [
  'CLOUDFLARE_FULL_ACCESS_TOKEN',
  'CLOUDFLARE_API_AGENT_LEE_FULL_FULL',
  'CLOUDFLARE_PAGES_TOKEN',
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

async function main() {
  if (!API_TOKEN) {
    console.error('Set a Cloudflare API token with Pages Edit in .env (e.g. CLOUDFLARE_API_TOKEN).');
    process.exit(1);
  }
  const deployPath = `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`;
  console.log('Triggering Pages deployment for %s...', PROJECT_NAME);
  const result = await request('POST', deployPath, {}).catch((e) => {
    console.error('Trigger failed:', e.message);
    process.exit(1);
  });
  const deployment = result.result;
  if (deployment && deployment.url) {
    console.log('Deployment triggered:', deployment.url);
    console.log('Wait for the build to finish; then the site will show the latest commit.');
  } else {
    console.log('Response:', JSON.stringify(result).slice(0, 200));
  }
}

main();
