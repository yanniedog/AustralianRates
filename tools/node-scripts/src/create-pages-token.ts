import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requestCloudflareJson } from './lib/cloudflare-api';
import { getCloudflareAccountId, pickCloudflareToken } from './lib/cloudflare-token';
import { loadRepoEnv } from './lib/env';
import { describeTokenCreateResponse } from './lib/safe-api-response-log';

loadRepoEnv(process.cwd());

const accountId = getCloudflareAccountId();
const bootstrapToken = pickCloudflareToken(['CLOUDFLARE_BOOTSTRAP_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_GENERAL_TOKEN', 'CF_API_TOKEN']);

function upsertEnvValue(envPath: string, envKey: string, envValue: string): void {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (line.match(new RegExp(`^\\s*${envKey}\\s*=`))) {
      out.push(`${envKey}=${envValue}`);
      replaced = true;
      continue;
    }
    out.push(line);
  }
  if (!replaced) out.push(`${envKey}=${envValue}`);
  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8');
}

async function listPermissionGroups(token: string): Promise<any[]> {
  try {
    const r = await requestCloudflareJson<any>({
      token,
      method: 'GET',
      path: `/accounts/${accountId}/tokens/permission_groups`,
    });
    return r.result || [];
  } catch {
    const r2 = await requestCloudflareJson<any>({
      token,
      method: 'GET',
      path: '/user/tokens/permission_groups',
    });
    return r2.result || [];
  }
}

async function createToken(token: string, body: unknown): Promise<any> {
  try {
    return await requestCloudflareJson<any>({
      token,
      method: 'POST',
      path: `/accounts/${accountId}/tokens`,
      body,
    });
  } catch (error) {
    const fallback = await requestCloudflareJson<any>({
      token,
      method: 'POST',
      path: '/user/tokens',
      body,
    }).catch((error2) => {
      throw new Error(`${(error as Error).message} ${(error2 as Error).message}`);
    });
    return fallback;
  }
}

function runSetPagesBuildConfig(): void {
  const repoRoot = process.cwd();
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const script = path.join(repoRoot, 'tools', 'node-scripts', 'src', 'set-pages-build-config.ts');
  const result = spawnSync(process.execPath, [tsxCli, script], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.status == null) process.exit(1);
}

async function main(): Promise<void> {
  if (!bootstrapToken) {
    console.error('Set CLOUDFLARE_BOOTSTRAP_TOKEN or CLOUDFLARE_API_TOKEN in .env (token with Create additional tokens).');
    process.exit(1);
  }

  console.log('Listing permission groups...');
  const groups = await listPermissionGroups(bootstrapToken).catch((error) => {
    console.error('Failed to list permission groups:', (error as Error).message);
    process.exit(1);
  });

  const pagesPerm = groups.find((g: any) => g.name && String(g.name) === 'Pages Write');
  if (!pagesPerm) {
    const pagesAny = groups.filter((g: any) => g.name && String(g.name).toLowerCase().includes('pages') && !String(g.name).includes('Custom'));
    console.error('Pages Write not found. Pages-related:', pagesAny.map((g: any) => g.name));
    process.exit(1);
  }

  console.log('Creating token with Pages Write...');
  const accountResource = `com.cloudflare.api.account.${accountId}`;
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

  const createResult = await createToken(bootstrapToken, body).catch((error) => {
    console.error('Create token failed:', (error as Error).message);
    process.exit(1);
  });

  const newToken = createResult?.result && (createResult.result.value || createResult.result.token);
  if (!newToken) {
    console.error('Create response missing token value.', describeTokenCreateResponse(createResult));
    process.exit(1);
  }

  const envPath = path.join(process.cwd(), '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const hasPagesToken = lines.some((line) => line.match(/^\s*CLOUDFLARE_PAGES_TOKEN\s*=/));
  const targetKey = hasPagesToken ? 'CLOUDFLARE_PAGES_TOKEN' : 'CLOUDFLARE_API_TOKEN';
  upsertEnvValue(envPath, targetKey, newToken);
  console.log(`Updated .env with new Pages Write token (${targetKey}).`);

  console.log('Applying Pages build config...');
  runSetPagesBuildConfig();
}

void main();
