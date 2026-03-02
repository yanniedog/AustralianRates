'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function runTsScript(repoRoot, scriptRel, passthroughArgs) {
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const scriptPath = path.join(repoRoot, 'tools', 'node-scripts', 'src', scriptRel);
  const result = spawnSync(process.execPath, [tsxCli, scriptPath, ...passthroughArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
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
