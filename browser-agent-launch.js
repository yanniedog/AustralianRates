'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const browserAgentRoot = path.resolve(__dirname, '..', 'browser-agent');
const serverJs = path.join(browserAgentRoot, 'server.js');

if (!fs.existsSync(serverJs)) {
  process.stderr.write(
    `browser-agent not found.\nExpected: ${serverJs}\nClone or symlink the browser-agent repo next to this one (e.g. c:\\code\\browser-agent).\n`
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverJs], {
  cwd: browserAgentRoot,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code == null ? 0 : code);
});
