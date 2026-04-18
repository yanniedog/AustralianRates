import { requestCloudflareJson } from '../lib/cloudflare-api';
import { getCloudflareAccountId, pickCloudflareToken } from '../lib/cloudflare-token';
import { loadRepoEnv } from '../lib/env';

const PROJECT_NAME = 'australianrates';

const TOKEN_KEYS = [
  'CLOUDFLARE_FULL_ACCESS_TOKEN',
  'CLOUDFLARE_PAGES_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_GENERAL_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_MULTI',
  'CLOUDFLARE_EDIT_ZONE_DNS',
];

loadRepoEnv(process.cwd());

const apiToken = pickCloudflareToken(TOKEN_KEYS);
const accountId = getCloudflareAccountId();

async function main(): Promise<void> {
  if (!apiToken) {
    console.error('Set a Cloudflare API token with Pages Edit in .env (e.g. CLOUDFLARE_API_TOKEN).');
    process.exit(1);
  }
  const deployPath = `/accounts/${accountId}/pages/projects/${PROJECT_NAME}/deployments`;
  console.log('Triggering Pages deployment for %s...', PROJECT_NAME);
  const result = await requestCloudflareJson<any>({
    token: apiToken,
    method: 'POST',
    path: deployPath,
    body: {},
  }).catch((error) => {
    console.error('Trigger failed:', (error as Error).message);
    process.exit(1);
  });

  const deployment = (result as any)?.result;
  if (deployment && deployment.url) {
    console.log('Deployment triggered:', deployment.url);
    console.log('Wait for the build to finish; then the site will show the latest commit.');
  } else {
    console.log('Response:', JSON.stringify(result).slice(0, 200));
  }
}

void main();
