import { pickFirstEnv, resolveAccountId } from './env';

export const DEFAULT_ACCOUNT_ID = 'f3250f7113cfd8c7f747a09f942ca6d0';

export function pickCloudflareToken(tokenKeys: string[]): string | undefined {
  return pickFirstEnv(tokenKeys);
}

export function getCloudflareAccountId(defaultId: string = DEFAULT_ACCOUNT_ID): string {
  return resolveAccountId(defaultId);
}
