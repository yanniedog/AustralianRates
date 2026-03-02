import { requestCloudflareJson } from './lib/cloudflare-api';
import { getCloudflareAccountId, pickCloudflareToken } from './lib/cloudflare-token';
import { loadRepoEnv } from './lib/env';

const PROJECT_NAME = 'australianrates';
const BUILD_COMMAND = 'npm run build';
const BUILD_OUTPUT_DIR = 'site';

loadRepoEnv(process.cwd());

const accountId = getCloudflareAccountId();
const apiToken = pickCloudflareToken(['CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_GENERAL_TOKEN', 'CF_API_TOKEN']);

async function main(): Promise<void> {
  if (!apiToken) {
    console.error('Set CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_API_TOKEN, or CLOUDFLARE_GENERAL_TOKEN in .env.');
    console.error('Token needs Account | Cloudflare Pages | Write. See .env.example.');
    process.exit(1);
  }

  const pathname = `/accounts/${accountId}/pages/projects/${PROJECT_NAME}`;
  console.log('Fetching current project...');
  const getResult = await requestCloudflareJson<any>({
    token: apiToken,
    method: 'GET',
    path: pathname,
  }).catch((error) => {
    const message = (error as Error).message;
    console.error('GET project failed:', message);
    if (message.includes('Authentication') || message.includes('Invalid') || message.includes('403') || message.includes('401')) {
      console.error('Use an API Token with Account | Cloudflare Pages | Edit.');
    }
    process.exit(1);
  });

  const project = (getResult as any).result;
  const currentBuild = project.build_config || {};
  if (currentBuild.build_command === BUILD_COMMAND && (currentBuild.destination_dir === BUILD_OUTPUT_DIR || currentBuild.build_output_dir === BUILD_OUTPUT_DIR)) {
    console.log('Build config already set: build_command=%s, output=%s', BUILD_COMMAND, BUILD_OUTPUT_DIR);
    console.log('Triggering a deployment so the next build includes version.json...');
    const deployPath = `/accounts/${accountId}/pages/projects/${PROJECT_NAME}/deployments`;
    const deployResult = await requestCloudflareJson<any>({
      token: apiToken,
      method: 'POST',
      path: deployPath,
      body: {},
    }).catch((error) => {
      console.warn('Trigger deploy failed (push a commit or retry from dashboard):', (error as Error).message);
      return null;
    });
    if (deployResult?.result?.url) console.log('Deployment triggered:', deployResult.result.url);
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
  await requestCloudflareJson({
    token: apiToken,
    method: 'PATCH',
    path: pathname,
    body: patchBody,
  }).catch((error) => {
    console.error('PATCH project failed:', (error as Error).message);
    process.exit(1);
  });

  console.log('Build config updated. Triggering a new deployment...');
  const deployPath = `/accounts/${accountId}/pages/projects/${PROJECT_NAME}/deployments`;
  const deployResult = await requestCloudflareJson<any>({
    token: apiToken,
    method: 'POST',
    path: deployPath,
    body: {},
  }).catch((error) => {
    console.warn('Trigger deploy failed (run a deploy from dashboard or push a commit):', (error as Error).message);
    return null;
  });
  if (deployResult?.result?.url) console.log('Deployment triggered:', deployResult.result.url);
  console.log('Once the new build completes, version.json will be present and the footer will show deploy status.');
}

void main();
