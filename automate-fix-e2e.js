#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

function nowIso() {
  return new Date().toISOString();
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runStep(command, args) {
  const started = Date.now();
  const pretty = `${command} ${args.join(' ')}`.trim();
  const executable = command;
  console.log(`[${nowIso()}] RUN ${pretty}`);
  let result = spawnSync(executable, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error && process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const cmdline = [command, ...args].join(' ');
    result = spawnSync(comspec, ['/d', '/s', '/c', cmdline], {
      stdio: 'inherit',
      env: process.env,
    });
  }
  const elapsed = Date.now() - started;
  const code = Number(result.status ?? 1);
  if (result.error) {
    console.error(`[${nowIso()}] ERROR ${result.error.message}`);
  }
  console.log(`[${nowIso()}] DONE code=${code} elapsed_ms=${elapsed} cmd=${pretty}`);
  return code;
}

function runWithRetries(command, args, attempts, label) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[${nowIso()}] ${label} attempt ${attempt}/${attempts}`);
    const code = runStep(command, args);
    if (code === 0) return 0;
    if (attempt < attempts) {
      const waitMs = Math.min(15000, 3000 * attempt);
      console.log(`[${nowIso()}] RETRY wait_ms=${waitMs} label=${label}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
  return 1;
}

function main() {
  const homepageAttempts = asInt(process.env.E2E_HOMEPAGE_ATTEMPTS, 2);
  const apiAttempts = asInt(process.env.E2E_API_ATTEMPTS, 1);
  const archiveAttempts = asInt(process.env.E2E_ARCHIVE_ATTEMPTS, 1);

  console.log(`[${nowIso()}] START automate-fix-e2e`);
  console.log(
    `[${nowIso()}] CONFIG homepage_attempts=${homepageAttempts} api_attempts=${apiAttempts} archive_attempts=${archiveAttempts}`,
  );

  // Always run diagnostics first to surface production API regressions quickly.
  if (runStep('node', ['diagnose-api.js']) !== 0) {
    console.error(`[${nowIso()}] FAIL diagnose-api`);
    process.exit(1);
  }

  if (runWithRetries('npm', ['run', 'test:homepage'], homepageAttempts, 'test:homepage') !== 0) {
    console.error(`[${nowIso()}] FAIL test:homepage`);
    process.exit(1);
  }

  if (runWithRetries('npm', ['run', 'test:api'], apiAttempts, 'test:api') !== 0) {
    console.error(`[${nowIso()}] FAIL test:api`);
    process.exit(1);
  }

  if (runWithRetries('npm', ['run', 'test:archive'], archiveAttempts, 'test:archive') !== 0) {
    console.error(`[${nowIso()}] FAIL test:archive`);
    process.exit(1);
  }

  console.log(`[${nowIso()}] PASS automate-fix-e2e`);
}

main();
