'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

function normalizeEnvValue(raw) {
  return String(raw || '').replace(/^["']|["']$/g, '').trim();
}

function loadRepoEnv(repoRoot) {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return {};

  const loaded = {};
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = normalizeEnvValue(match[2]);
    loaded[key] = value;
  }
  return loaded;
}

function runTsScript(repoRoot, scriptRel, passthroughArgs) {
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const scriptPath = path.join(repoRoot, 'tools', 'node-scripts', 'src', scriptRel);
  const mergedEnv = Object.assign({}, loadRepoEnv(repoRoot), process.env);
  const result = spawnSync(process.execPath, [tsxCli, scriptPath, ...passthroughArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: mergedEnv,
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (typeof result.status === 'number') {
    process.exit(result.status);
  }
  process.exit(1);
}

module.exports = {
  runTsScript,
};
