/**
 * Creates a Cloudflare API token with read and edit access to everything on the account.
 * Uses CLOUDFLARE_BOOTSTRAP_TOKEN or CLOUDFLARE_API_TOKEN / CLOUDFLARE_GENERAL_TOKEN from .env
 * (must have "Create additional tokens" / API Tokens Write).
 * Run from repo root: node create-full-access-token.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(CLOUDFLARE_[A-Z_]+|CF_API_TOKEN|CF_ACCOUNT_ID)\s*=\s*(.+)\s*$/);
    if (m) {
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      if (m[1] === 'CF_API_TOKEN') process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || val;
      else if (m[1] === 'CF_ACCOUNT_ID') process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || val;
      else process.env[m[1]] = val;
    }
  }
}
loadEnv();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || 'f3250f7113cfd8c7f747a09f942ca6d0';
const BOOTSTRAP_TOKEN = process.env.CLOUDFLARE_BOOTSTRAP_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_GENERAL_TOKEN || process.env.CF_API_TOKEN;

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4' + path,
      method,
      headers: {
        Authorization: 'Bearer ' + BOOTSTRAP_TOKEN,
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
  if (!BOOTSTRAP_TOKEN) {
    console.error('Set CLOUDFLARE_BOOTSTRAP_TOKEN or CLOUDFLARE_GENERAL_TOKEN in .env (token with Create additional tokens).');
    process.exit(1);
  }

  console.log('Listing permission groups...');
  let groups = [];
  try {
    const r = await api('GET', '/accounts/' + ACCOUNT_ID + '/tokens/permission_groups');
    groups = r.result || [];
  } catch (e) {
    try {
      const r2 = await api('GET', '/user/tokens/permission_groups');
      groups = r2.result || [];
    } catch (e2) {
      console.error('Failed to list permission groups:', e.message);
      console.error('Use a token with "Create additional tokens" (Account API Tokens). Set CLOUDFLARE_BOOTSTRAP_TOKEN in .env.');
      process.exit(1);
    }
  }

  const permissionGroups = groups
    .filter((g) => g.id && g.name)
    .map((g) => ({ id: g.id, name: g.name }));
  if (permissionGroups.length === 0) {
    console.error('No permission groups returned.');
    process.exit(1);
  }

  console.log('Creating token with', permissionGroups.length, 'permission groups (full account access)...');
  const accountResource = 'com.cloudflare.api.account.' + ACCOUNT_ID;
  const body = {
    name: 'full-access-australianrates',
    policies: [
      {
        effect: 'allow',
        resources: { [accountResource]: '*' },
        permission_groups: permissionGroups,
      },
    ],
  };

  let createResult;
  try {
    createResult = await api('POST', '/accounts/' + ACCOUNT_ID + '/tokens', body);
  } catch (e) {
    try {
      createResult = await api('POST', '/user/tokens', body);
    } catch (e2) {
      console.error('Create token failed:', e.message, e2.message);
      process.exit(1);
    }
  }

  const newToken = createResult.result && (createResult.result.value || createResult.result.token);
  if (!newToken) {
    console.error('Create response missing token value:', JSON.stringify(createResult).slice(0, 300));
    process.exit(1);
  }

  const envPath = path.join(__dirname, '.env');
  const envKey = 'CLOUDFLARE_FULL_ACCESS_TOKEN';
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf8').split('\n');
  }
  const out = [];
  let replaced = false;
  for (const line of lines) {
    if (line.match(new RegExp('^\\s*' + envKey + '\\s*='))) {
      out.push(envKey + '=' + newToken);
      replaced = true;
      continue;
    }
    out.push(line);
  }
  if (!replaced) out.push(envKey + '=' + newToken);
  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8');
  console.log('Added', envKey, 'to .env. Store it securely; the secret is shown only once.');
}

main();
