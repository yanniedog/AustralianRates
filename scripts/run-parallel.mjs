#!/usr/bin/env node
/**
 * Run multiple root package.json npm scripts concurrently; exit 1 if any fail.
 * Usage: node scripts/run-parallel.mjs <script-name> [<script-name> ...]
 * Example: node scripts/run-parallel.mjs typecheck:api typecheck:scripts
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const scripts = process.argv.slice(2).filter((a) => a && !a.startsWith('-'));
if (scripts.length === 0) {
  console.error('usage: node scripts/run-parallel.mjs <npm-script> [<npm-script> ...]');
  process.exit(1);
}

const cwd = process.cwd();

function assertSafeScriptName(name) {
  if (!/^[a-zA-Z0-9:_-]+$/.test(name)) {
    console.error(`[run-parallel] invalid script name (allowed: letters, digits, :, _, -): ${name}`);
    process.exit(1);
  }
}

function run(name) {
  assertSafeScriptName(name);
  return new Promise((resolve) => {
    /** Single shell string avoids Node DEP0190 (shell + argv array). */
    const child = spawn(`npm run ${name}`, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code, signal) => {
      resolve({ name, code: code ?? (signal ? 1 : 0) });
    });
    child.on('error', (err) => {
      console.error(`[run-parallel] ${name}: spawn error: ${err.message}`);
      resolve({ name, code: 1 });
    });
  });
}

const outcomes = await Promise.all(scripts.map(run));
const failed = outcomes.filter((o) => o.code !== 0);
if (failed.length > 0) {
  console.error(
    `[run-parallel] failed (${failed.length}/${outcomes.length}):`,
    failed.map((f) => `${f.name} exit=${f.code}`).join('; '),
  );
  process.exit(1);
}
