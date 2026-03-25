'use strict';

/**
 * Shared state + human verdict for Claude MCP log scanning (NOT FIXED / FIXED transition).
 * Used by diagnose-claude-code-mcp.js and diagnose-local.js.
 */

const fs = require('fs');
const path = require('path');

const MCP_STATE = path.join(__dirname, 'debug-claude-mcp.state.json');

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

/**
 * @param {{ ok: boolean, report?: object }} parsed
 * @param {{ lastMcpHadHits: boolean, lastRunIso: string } | null} prev
 * @param {{ reRunCommands?: string }} [opts]
 * @returns {boolean} hadHits
 */
function printMcpVerdict(parsed, prev, opts = {}) {
  const reRun =
    opts.reRunCommands ||
    'npm run diagnose  |  npm run diagnose:claude-code-mcp';
  const hadHits = parsed && parsed.ok === false;
  const lines = [];

  if (hadHits) {
    lines.push('');
    lines.push('>>> MCP bridge: NOT FIXED YET');
    lines.push('    Anthropic MCP error signatures still appear in recent Cursor logs (upstream extension/binary).');
    lines.push(`    Next: update Claude Code extension; re-run: ${reRun}`);
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

module.exports = {
  MCP_STATE,
  readMcpState,
  writeMcpState,
  printMcpVerdict,
};
