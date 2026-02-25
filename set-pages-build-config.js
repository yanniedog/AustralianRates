/**
 * Sets Cloudflare Pages project build configuration via the Cloudflare API
 * so that version.json is generated on deploy and the footer shows "In sync" / "Behind".
 *
 * Requires: CLOUDFLARE_API_TOKEN (token with Pages Edit), optional CLOUDFLARE_ACCOUNT_ID.
 * Loads .env from repo root if present (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
 * Run from repo root: node set-pages-build-config.js  or  npm run pages:set-build
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CF_API_TOKEN|CF_ACCOUNT_ID)\s*=\s*(.+)\s*$/);
    if (m) {
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      if (m[1] === 'CF_API_TOKEN') process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || val;
      else if (m[1] === 'CF_ACCOUNT_ID') process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || val;
      else process.env[m[1]] = val;
    }
  }
}
loadEnv();

const PROJECT_NAME = 'australianrates';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || 'f3250f7113cfd8c7f747a09f942ca6d0';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

const BUILD_COMMAND = 'npm run build';
const BUILD_OUTPUT_DIR = 'site';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.cloudflare.com',
      path: '/client/v4' + path,
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
            reject(new Error(json.errors?.[0]?.message || data || 'API error'));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error(data || res.statusCode));
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
    console.error('Set CLOUDFLARE_API_TOKEN or CF_API_TOKEN (Cloudflare API token with Pages Edit).');
    console.error('Create at: https://dash.cloudflare.com/profile/api-tokens');
    console.error('Or add to .env in repo root (see .env.example).');
    process.exit(1);
  }

  const path = `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}`;

  console.log('Fetching current project...');
  const getResult = await request('GET', path).catch((e) => {
    console.error('GET project failed:', e.message);
    process.exit(1);
  });

  const project = getResult.result;
  const currentBuild = project.build_config || {};
  if (
    currentBuild.build_command === BUILD_COMMAND &&
    (currentBuild.destination_dir === BUILD_OUTPUT_DIR || currentBuild.build_output_dir === BUILD_OUTPUT_DIR)
  ) {
    console.log('Build config already set: build_command=%s, output=%s', BUILD_COMMAND, BUILD_OUTPUT_DIR);
    return;
  }

  console.log('Updating build config: build_command=%s, destination_dir=%s', BUILD_COMMAND, BUILD_OUTPUT_DIR);
  const patchBody = {
    build_config: {
      build_command: BUILD_COMMAND,
      destination_dir: BUILD_OUTPUT_DIR,
      root_dir: project.build_config?.root_dir ?? '',
    },
  };
  await request('PATCH', path, patchBody).catch((e) => {
    console.error('PATCH project failed:', e.message);
    process.exit(1);
  });

  console.log('Build config updated. Triggering a new deployment...');
  const deployPath = `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`;
  const deployResult = await request('POST', deployPath, {}).catch((e) => {
    console.warn('Trigger deploy failed (run a deploy from dashboard or push a commit):', e.message);
    return null;
  });
  if (deployResult && deployResult.result?.url) {
    console.log('Deployment triggered:', deployResult.result.url);
  }
  console.log('Once the new build completes, version.json will be present and the footer will show deploy status.');
}

main();
