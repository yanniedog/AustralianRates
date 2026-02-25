/**
 * Uses the token in .env (must have "Create additional tokens" / API Tokens Write)
 * to create a new token with only Pages Edit, then updates .env and runs pages:set-build.
 * Run from repo root: node create-pages-token.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

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

function api(method, path, body, token) {
  const t = token || BOOTSTRAP_TOKEN;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4' + path,
      method,
      headers: {
        Authorization: 'Bearer ' + t,
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
    console.error('Set CLOUDFLARE_BOOTSTRAP_TOKEN or CLOUDFLARE_API_TOKEN in .env (token with Create additional tokens).');
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
      console.error('Failed to list permission groups:', e.message, e2.message);
      process.exit(1);
    }
  }

  const pagesPerm = groups.find(
    (g) =>
      g.name &&
      String(g.name) === 'Pages Write'
  );
  if (!pagesPerm) {
    const pagesAny = groups.filter((g) => g.name && String(g.name).toLowerCase().includes('pages') && !String(g.name).includes('Custom'));
    console.error('Pages Write not found. Pages-related:', pagesAny.map((g) => g.name));
    process.exit(1);
  }

  console.log('Creating token with Pages Write...');
  const accountResource = 'com.cloudflare.api.account.' + ACCOUNT_ID;
  const body = {
    name: 'pages-write-australianrates',
    policies: [
      {
        effect: 'allow',
        resources: { [accountResource]: '*' },
        permission_groups: [{ id: pagesPerm.id, name: pagesPerm.name }],
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
    console.error('Create response missing token value:', JSON.stringify(createResult).slice(0, 200));
    process.exit(1);
  }

  const envPath = path.join(__dirname, '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const out = [];
  const hasPagesToken = lines.some((l) => l.match(/^\s*CLOUDFLARE_PAGES_TOKEN\s*=/));
  const targetKey = hasPagesToken ? 'CLOUDFLARE_PAGES_TOKEN' : 'CLOUDFLARE_API_TOKEN';
  for (const line of lines) {
    if (line.match(new RegExp('^\\s*' + targetKey + '\\s*='))) {
      out.push(targetKey + '=' + newToken);
      continue;
    }
    out.push(line);
  }
  if (!out.some((l) => l.startsWith(targetKey + '='))) out.push(targetKey + '=' + newToken);
  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8');
  console.log('Updated .env with new Pages Write token (' + targetKey + ').');

  console.log('Applying Pages build config...');
  execSync('node set-pages-build-config.js', { cwd: __dirname, stdio: 'inherit' });
}

main();
