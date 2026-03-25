'use strict';

/**
 * Single entry for automated local debugging (no manual Cursor steps).
 *
 *   npm run diagnose
 *   npm run diagnose -- --with-api
 *
 * Runs:
 *   1. diagnose-claude-code-mcp.js --json (Cursor / Anthropic MCP signatures)
 *   2. optional: diagnose-api.js (production API; network) when --with-api
 *
 * Exit: 0 = all steps clean; 1 = any step failed or threw; 2 = MCP issue detected (Claude)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_LOG = path.join(ROOT, 'debug-local-diagnose.log');
const MCP_STATE = path.join(ROOT, 'debug-claude-mcp.state.json');

function readMcpState() {
  try {
    const raw = fs.readFileSync(MCP_STATE, 'utf8');
    const j = JSON.parse(raw);
    return {
      lastMcpHadHits: Boolean(j.lastMcpHadHits),
      lastRunIso: typeof j.lastRunIso === 'string' ? j.lastRunIso : '',
    };
  } catch {
    return null;
  }
}

function writeMcpState(hadHits) {
  try {
    fs.writeFileSync(
      MCP_STATE,
      `${JSON.stringify(
        { lastMcpHadHits: hadHits, lastRunIso: new Date().toISOString() },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch (e) {
    console.error('Could not write', MCP_STATE, e.message);
  }
}

function printMcpVerdict(parsed, prev) {
  const hadHits = parsed && parsed.ok === false;
  const lines = [];

  if (hadHits) {
    lines.push('');
    lines.push('>>> MCP bridge: NOT FIXED YET');
    lines.push('    Anthropic MCP error signatures still appear in recent Cursor logs (upstream extension/binary).');
    lines.push('    Next: update Claude Code extension; re-run: npm run diagnose');
  } else if (parsed && parsed.ok === true) {
    const wasBroken = prev && prev.lastMcpHadHits === true;
    if (wasBroken) {
      lines.push('');
      lines.push('================================================================================');
      lines.push('  FIXED (automated diagnostic): MCP signatures GONE from the scan window.');
      lines.push('  Previous run had hits; this run found none — treat the IDE MCP check as passing.');
      lines.push('  Re-run after Cursor sessions if you want to confirm it stays clean.');
      lines.push('================================================================================');
    } else {
      lines.push('');
      lines.push('>>> MCP bridge: CLEAN (no matching signatures in scanned logs)');
      lines.push('    If you never had failures, this is the steady state. Exit code 0 = OK for this check.');
    }
  }

  const block = lines.join('\n');
  if (block) process.stdout.write(`${block}\n`);
  return hadHits;
}

function runNode(script, extraArgs = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script), ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
  });
  return {
    code: r.status == null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error,
  };
}

function main() {
  const withApi = process.argv.includes('--with-api');
  const ts = new Date().toISOString();
  const lines = [`# diagnose-local ${ts}`, ''];

  console.log('=== Automated local diagnostics ===\n');

  let worst = 0;
  const prevMcpState = readMcpState();

  const mcp = runNode('diagnose-claude-code-mcp.js', ['--json']);
  if (mcp.error) {
    console.error('claude-code-mcp spawn error:', mcp.error.message);
    lines.push(`[claude-code-mcp] SPAWN_ERROR: ${mcp.error.message}`);
    worst = Math.max(worst, 1);
  } else {
    let parsed = null;
    try {
      parsed = JSON.parse(mcp.stdout);
    } catch {
      console.error('[claude-code-mcp] invalid JSON stdout:\n', mcp.stdout.slice(0, 2000));
      lines.push(`[claude-code-mcp] exit=${mcp.code} parse_error`);
      worst = Math.max(worst, Number.isInteger(mcp.code) ? mcp.code : 1);
    }
    if (parsed) {
      const st = parsed.ok ? 'OK' : 'ISSUE';
      console.log(`[claude-code-mcp] ${st} (exit ${mcp.code})`);
      console.log(`  Binary: ${parsed.report?.claudeBinaryVersion || parsed.report?.claudeBinaryError || '?'}`);
      console.log(`  MCP signatures in logs: ${parsed.hits?.length ?? '?'}`);
      if (!parsed.ok && parsed.hits?.[0]?.file) {
        console.log(`  Example log: ${parsed.hits[0].file}`);
      }
      const hadHits = printMcpVerdict(parsed, prevMcpState);
      writeMcpState(hadHits);
      lines.push(`[claude-code-mcp] ${JSON.stringify({ ok: parsed.ok, exit: mcp.code, hits: parsed.hits?.length })}`);
      worst = Math.max(worst, mcp.code === 2 ? 2 : mcp.code === 0 ? 0 : 1);
    }
  }

  if (withApi) {
    console.log('\n[api] running diagnose-api.js (production) ...\n');
    const api = runNode('diagnose-api.js');
    if (api.error) {
      console.error('diagnose-api spawn error:', api.error.message);
      lines.push(`[api] SPAWN_ERROR: ${api.error.message}`);
      worst = Math.max(worst, 1);
    } else {
      process.stdout.write(api.stdout);
      if (api.stderr) process.stderr.write(api.stderr);
      lines.push(`[api] exit=${api.code}`);
      if (api.code !== 0) worst = Math.max(worst, 1);
    }
  } else {
    console.log('\n[api] skipped (pass --with-api to run production API diagnostics)\n');
    lines.push('[api] skipped');
  }

  const summary = `\n=== Overall exit code: ${worst} (0=clean, 1=fail, 2=Claude MCP signatures) ===\n`;
  process.stdout.write(summary);
  lines.push(summary.trim());

  try {
    fs.writeFileSync(OUT_LOG, `${lines.join('\n')}\n`, 'utf8');
    console.log(`Wrote: ${OUT_LOG}`);
  } catch (e) {
    console.error('Could not write', OUT_LOG, e.message);
  }

  process.exit(worst);
}

main();
