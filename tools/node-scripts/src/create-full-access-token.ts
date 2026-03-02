import fs from 'node:fs';
import path from 'node:path';
import { requestCloudflareJson } from './lib/cloudflare-api';
import { getCloudflareAccountId, pickCloudflareToken } from './lib/cloudflare-token';
import { loadRepoEnv } from './lib/env';

loadRepoEnv(process.cwd());

const accountId = getCloudflareAccountId();
const bootstrapToken = pickCloudflareToken(['CLOUDFLARE_BOOTSTRAP_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_GENERAL_TOKEN', 'CF_API_TOKEN']);

function upsertEnvValue(envPath: string, envKey: string, envValue: string): void {
  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf8').split('\n');
  }
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

async function listPermissionGroups(token: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const r = await requestCloudflareJson<any>({
      token,
      method: 'GET',
      path: `/accounts/${accountId}/tokens/permission_groups`,
    });
    return (r.result || []).filter((x: any) => x.id && x.name);
  } catch {
    const r2 = await requestCloudflareJson<any>({
      token,
      method: 'GET',
      path: '/user/tokens/permission_groups',
    });
    return (r2.result || []).filter((x: any) => x.id && x.name);
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

async function main(): Promise<void> {
  if (!bootstrapToken) {
    console.error('Set CLOUDFLARE_BOOTSTRAP_TOKEN or CLOUDFLARE_GENERAL_TOKEN in .env (token with Create additional tokens).');
    process.exit(1);
  }

  console.log('Listing permission groups...');
  const permissionGroups = await listPermissionGroups(bootstrapToken).catch((error) => {
    console.error('Failed to list permission groups:', (error as Error).message);
    console.error('Use a token with "Create additional tokens" (Account API Tokens). Set CLOUDFLARE_BOOTSTRAP_TOKEN in .env.');
    process.exit(1);
  });

  if (!permissionGroups.length) {
    console.error('No permission groups returned.');
    process.exit(1);
  }

  console.log('Creating token with', permissionGroups.length, 'permission groups (full account access)...');
  const accountResource = `com.cloudflare.api.account.${accountId}`;
  const body = {
    name: 'full-access-australianrates',
    policies: [{ effect: 'allow', resources: { [accountResource]: '*' }, permission_groups: permissionGroups }],
  };
  const createResult = await createToken(bootstrapToken, body).catch((error) => {
    console.error('Create token failed:', (error as Error).message);
    process.exit(1);
  });

  const newToken = createResult?.result && (createResult.result.value || createResult.result.token);
  if (!newToken) {
    console.error('Create response missing token value:', JSON.stringify(createResult).slice(0, 300));
    process.exit(1);
  }

  const envPath = path.join(process.cwd(), '.env');
  const envKey = 'CLOUDFLARE_FULL_ACCESS_TOKEN';
  upsertEnvValue(envPath, envKey, newToken);
  console.log('Added', envKey, 'to .env. Store it securely; the secret is shown only once.');
}

void main();
