import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENV_PATTERN = /^\s*(CLOUDFLARE_[A-Za-z0-9_]+|CF_API_TOKEN|CF_ACCOUNT_ID)\s*=\s*(.+)\s*$/;

export function normalizeEnvValue(raw: string): string {
  return raw.replace(/^["']|["']$/g, '').trim();
}

export function applyEnvPair(key: string, value: string): void {
  if (key === 'CF_API_TOKEN') {
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      process.env.CLOUDFLARE_API_TOKEN = value;
    }
    return;
  }
  if (key === 'CF_ACCOUNT_ID') {
    if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
      process.env.CLOUDFLARE_ACCOUNT_ID = value;
    }
    return;
  }
  process.env[key] = value;
}

export function loadEnvFile(envPath: string, pattern: RegExp = DEFAULT_ENV_PATTERN): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const match = line.match(pattern);
    if (!match) continue;
    const key = match[1];
    const value = normalizeEnvValue(match[2]);
    out[key] = value;
    applyEnvPair(key, value);
  }
  return out;
}

export function loadRepoEnv(fromDir: string): Record<string, string> {
  const envPath = path.join(fromDir, '.env');
  return loadEnvFile(envPath);
}

export function loadParentRepoEnv(fromDir: string): Record<string, string> {
  const envPath = path.join(fromDir, '..', '.env');
  return loadEnvFile(envPath);
}

export function pickFirstEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

export function resolveAccountId(defaultAccountId: string): string {
  return process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || defaultAccountId;
}
