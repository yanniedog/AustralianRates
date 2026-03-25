'use strict';

/**
 * Automated diagnostic for Claude Code (Cursor) MCP bridge issues.
 * Does not require manual reproduction steps: run `npm run diagnose:claude-code-mcp`.
 *
 * - Locates anthropic.claude-code extension under ~/.cursor/extensions
 * - Runs bundled claude.exe --version
 * - Scans recent Cursor *.log files for MCP -32601 / claude-vscode signatures
 * - Writes debug-claude-mcp.log (gitignored) with NDJSON + summary
 *
 * Exit: 0 = no matching error lines in scanned logs; 2 = signatures found; 1 = script/runtime error
 *
 * Flags: --json | -j  Print one JSON object to stdout (for orchestrators); still writes debug-claude-mcp.log unless --no-file
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_LOG = path.join(__dirname, 'debug-claude-mcp.log');
const MAX_LOG_DEPTH = 4;
const MAX_FILES = 40;
const TAIL_BYTES = 384 * 1024;
const CUTOFF_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

/** Tight patterns only — avoid matching unrelated "32601" or "Method not found" inside other extensions' JSON. */
const PATTERNS = [
  {
    id: 'claude_vscode_mcp_32601',
    re: /MCP server\s+"claude-vscode"\s+Failed to fetch tools:.*-32601|MCP error\s*-?\s*32601.*claude-vscode/i,
  },
  {
    id: 'anthropic_claude_channel',
    re: /\[info\]\s+From claude:.*\[ERROR\].*claude-vscode.*Failed to fetch tools/i,
  },
];

function getCursorExtensionsDir() {
  const h = os.homedir();
  if (process.platform === 'win32') {
    return path.join(h, '.cursor', 'extensions');
  }
  if (process.platform === 'darwin') {
    return path.join(h, '.cursor', 'extensions');
  }
  return path.join(h, '.cursor', 'extensions');
}

function getCursorLogsDir() {
  const h = os.homedir();
  if (process.platform === 'win32') {
    return path.join(h, 'AppData', 'Roaming', 'Cursor', 'logs');
  }
  if (process.platform === 'darwin') {
    return path.join(h, 'Library', 'Application Support', 'Cursor', 'logs');
  }
  return path.join(h, '.config', 'Cursor', 'logs');
}

function findExtensionClaudeExe() {
  const extRoot = getCursorExtensionsDir();
  if (!fs.existsSync(extRoot)) {
    return { error: `extensions dir missing: ${extRoot}` };
  }
  const dirs = fs.readdirSync(extRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('anthropic.claude-code-'))
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const name of dirs) {
    const exe = path.join(extRoot, name, 'resources', 'native-binary', 'claude.exe');
    if (process.platform === 'win32' && fs.existsSync(exe)) {
      return { exe, extensionDir: name };
    }
    const unix = path.join(extRoot, name, 'resources', 'native-binary', 'claude');
    if (fs.existsSync(unix)) {
      return { exe: unix, extensionDir: name };
    }
  }
  return { error: `no anthropic.claude-code-* under ${extRoot}` };
}

function readTail(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const fd = fs.openSync(filePath, 'r');
  try {
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function collectRecentLogs(dir, cutoffMs, depth) {
  const out = [];
  if (depth > MAX_LOG_DEPTH || !fs.existsSync(dir)) {
    return out;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...collectRecentLogs(full, cutoffMs, depth + 1));
    } else if (e.name.endsWith('.log')) {
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= cutoffMs) {
          out.push({ full, mtimeMs: st.mtimeMs });
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function scanLogContent(text, filePath) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        hits.push({
          patternId: p.id,
          lineNumApprox: i + 1,
          snippet: line.length > 500 ? `${line.slice(0, 500)}…` : line,
          file: filePath,
        });
      }
    }
  }
  return hits;
}

function appendNdjson(obj) {
  if (process.argv.includes('--no-file')) return;
  fs.appendFileSync(OUT_LOG, `${JSON.stringify(obj)}\n`, 'utf8');
}

function main() {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes('--json') || argv.includes('-j');
  const noFile = argv.includes('--no-file');

  const days = Math.max(1, Number(process.env.DIAGNOSE_CLAUDE_LOG_DAYS || 7) || 7);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const ts = new Date().toISOString();

  if (!noFile) {
    try {
      fs.writeFileSync(
        OUT_LOG,
        `# diagnose-claude-code-mcp ${ts}\n`,
        'utf8',
      );
    } catch (e) {
      console.error('Cannot write', OUT_LOG, e.message);
      process.exit(1);
    }
  }

  const report = {
    timestamp: ts,
    platform: process.platform,
    cursorLogsDir: getCursorLogsDir(),
    extensionRoot: getCursorExtensionsDir(),
  };

  const bin = findExtensionClaudeExe();
  if (bin.exe) {
    try {
      const ver = execFileSync(bin.exe, ['--version'], {
        encoding: 'utf8',
        timeout: 15000,
      }).trim();
      report.claudeBinaryVersion = ver;
      report.extensionFolder = bin.extensionDir;
    } catch (e) {
      report.claudeBinaryError = e.message;
    }
  } else {
    report.claudeBinaryError = bin.error;
  }

  const logsDir = report.cursorLogsDir;
  const allLogs = collectRecentLogs(logsDir, cutoffMs, 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES);

  report.logFilesScanned = allLogs.length;
  report.cutoffDays = days;

  let allHits = [];
  for (const { full, mtimeMs } of allLogs) {
    let text;
    try {
      text = readTail(full, TAIL_BYTES);
    } catch (e) {
      appendNdjson({ type: 'log_read_error', file: full, error: e.message, timestamp: Date.now() });
      continue;
    }
    const hits = scanLogContent(text, full);
    for (const h of hits) {
      allHits.push({ ...h, logMtime: new Date(mtimeMs).toISOString() });
    }
  }

  const seen = new Set();
  allHits = allHits.filter((h) => {
    const k = `${h.file}|||${h.snippet}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  report.mcpErrorSignaturesFound = allHits.length;
  report.uniqueFilesWithHits = [...new Set(allHits.map((h) => h.file))].length;

  appendNdjson({ type: 'summary', data: report, timestamp: Date.now() });
  for (const h of allHits.slice(0, 200)) {
    appendNdjson({ type: 'hit', data: h, timestamp: Date.now() });
  }

  const summaryLines = [
    '--- Claude Code MCP diagnostic (automated) ---',
    `Bundled binary: ${report.claudeBinaryVersion || report.claudeBinaryError || 'unknown'}`,
    `Cursor logs: ${logsDir} (exists: ${fs.existsSync(logsDir)})`,
    `Recent .log files scanned (tail ${Math.round(TAIL_BYTES / 1024)} KB each): ${allLogs.length}`,
    `MCP-related signature hits: ${allHits.length}`,
    `Full NDJSON: ${noFile ? '(disabled)' : OUT_LOG}`,
  ];

  const textOut = `${summaryLines.join('\n')}\n`;

  if (jsonMode) {
    const payload = {
      tool: 'diagnose-claude-code-mcp',
      ok: allHits.length === 0,
      exitCode: allHits.length > 0 ? 2 : 0,
      report,
      hits: allHits,
      summaryText: textOut.trim(),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(textOut);
    if (!noFile) {
      fs.appendFileSync(OUT_LOG, `\n${textOut}`, 'utf8');
    }
  }

  if (allHits.length > 0) {
    if (!jsonMode) {
      process.stderr.write(
        '\nAutomated scan found MCP error signatures in Cursor logs. See debug-claude-mcp.log for lines.\n',
      );
    }
    process.exit(2);
  }
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
