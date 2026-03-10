import fs from 'node:fs'
import path from 'node:path'
import type { AuditReport, CaptureRecord, FindingsReport, PairedFinding } from './visual-audit-types'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function rel(baseDir: string, filePath?: string): string {
  if (!filePath) return ''
  return path.relative(baseDir, filePath).split(path.sep).join('/')
}

function badge(status: string): string {
  return `<span class="badge badge-${status}">${escapeHtml(status.toUpperCase())}</span>`
}

function renderIssues(record: CaptureRecord | undefined): string {
  if (!record) return '<p class="muted">Missing capture.</p>'
  const entries = [...record.issues.map((issue) => `${issue.severity}: ${issue.message}`), ...record.notes]
  if (entries.length === 0) return '<p class="muted">No issues recorded.</p>'
  return `<ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
}

function renderChecks(record: CaptureRecord | undefined): string {
  if (!record) return '<p class="muted">No checks.</p>'
  return `<ul>${record.checks
    .map((check) => `<li>${check.passed ? 'PASS' : 'FAIL'} ${escapeHtml(check.label)}${check.details ? ` (${escapeHtml(check.details)})` : ''}</li>`)
    .join('')}</ul>`
}

function renderCaptureColumn(baseDir: string, heading: string, record?: CaptureRecord): string {
  if (!record) {
    return `<section class="capture-col"><h4>${escapeHtml(heading)}</h4><p class="muted">Missing capture.</p></section>`
  }
  const image = record.screenshotPath
    ? `<a href="${escapeHtml(rel(baseDir, record.screenshotPath))}" target="_blank" rel="noreferrer"><img src="${escapeHtml(rel(baseDir, record.screenshotPath))}" alt="${escapeHtml(record.stateLabel)}"></a>`
    : '<p class="muted">No screenshot.</p>'
  const consoleText = [...record.consoleErrors, ...record.pageErrors].slice(0, 6)
  return `<section class="capture-col">
    <h4>${escapeHtml(heading)} ${badge(record.verdict)}</h4>
    ${image}
    <p><strong>URL:</strong> ${escapeHtml(record.actualUrl)}</p>
    <p><strong>Geometry:</strong> overflowX=${String(record.geometry.pageOverflowX)} blocked=${record.geometry.blockedSelectors.length}</p>
    ${renderChecks(record)}
    ${renderIssues(record)}
    ${consoleText.length ? `<details><summary>Console / runtime</summary><pre>${escapeHtml(consoleText.join('\n'))}</pre></details>` : ''}
  </section>`
}

function renderFinding(baseDir: string, finding: PairedFinding): string {
  return `<article class="finding">
    <header>
      <h3>${escapeHtml(`${finding.routeKey} / ${finding.stateLabel} / ${finding.viewportKey}`)} ${badge(finding.verdict)}</h3>
      <p>${escapeHtml(finding.summary)}</p>
    </header>
    <div class="capture-grid">
      ${renderCaptureColumn(baseDir, 'Current', finding.current)}
      ${renderCaptureColumn(baseDir, 'Baseline', finding.baseline)}
    </div>
  </article>`
}

function renderAdminCapture(baseDir: string, record: CaptureRecord): string {
  return `<article class="finding">
    <header><h3>${escapeHtml(`${record.routeKey} / ${record.viewportKey}`)} ${badge(record.verdict)}</h3><p>${escapeHtml(record.reviewNote)}</p></header>
    <div class="capture-grid">${renderCaptureColumn(baseDir, 'Current', record)}</div>
  </article>`
}

function renderGuardCommands(report: AuditReport): string {
  return `<table><thead><tr><th>Check</th><th>Exit</th><th>Log</th></tr></thead><tbody>${report.contractGuards
    .map(
      (guard) =>
        `<tr><td>${escapeHtml(guard.label)}</td><td>${guard.exitCode}</td><td><a href="${escapeHtml(rel(report.metadata.outputDir, guard.logPath))}">${escapeHtml(
          path.basename(guard.logPath),
        )}</a></td></tr>`,
    )
    .join('')}</tbody></table>`
}

export function writeAuditArtifacts(report: AuditReport, findings: FindingsReport): void {
  const outDir = report.metadata.outputDir
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(findings, null, 2))

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Visual Audit Dossier</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;margin:0;background:#f6f7fb;color:#162034}
main{max-width:1600px;margin:0 auto;padding:24px}
h1,h2,h3,h4{margin:0 0 10px} section+section{margin-top:24px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700}
.badge-pass{background:#d8f5df;color:#14532d}.badge-fail{background:#fde1e1;color:#8a1c1c}.badge-blocked{background:#e7ecf5;color:#334155}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0}
.summary div,.finding,.panel{background:#fff;border:1px solid #d7dde7;border-radius:16px;padding:16px}
.capture-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}
.capture-col img{width:100%;border:1px solid #d7dde7;border-radius:12px;background:#fff}
.muted{color:#667085}.finding{margin-top:18px} pre{white-space:pre-wrap;word-break:break-word}
table{width:100%;border-collapse:collapse;background:#fff} th,td{padding:10px;border-bottom:1px solid #e4e9f2;text-align:left;vertical-align:top}
ul{margin:8px 0 0 18px;padding:0}
</style></head><body><main>
<h1>Reference-Based Visual QA Dossier</h1>
<p>Current origin: ${escapeHtml(report.metadata.currentOrigin)} | Baseline commit: ${escapeHtml(report.metadata.baselineCommit)} | Baseline origin: ${escapeHtml(
    report.metadata.baselineOrigin,
  )}</p>
<div class="summary panel">
  <div><strong>Captures</strong><div>${report.summary.totalCaptures}</div></div>
  <div><strong>Reviewed</strong><div>${report.summary.totalReviewed}</div></div>
  <div><strong>Pass</strong><div>${report.summary.passCount}</div></div>
  <div><strong>Fail</strong><div>${report.summary.failCount}</div></div>
  <div><strong>Blocked</strong><div>${report.summary.blockedCount}</div></div>
  <div><strong>Warnings</strong><div>${report.summary.warningCount}</div></div>
</div>
<section class="panel"><h2>Contract Guards</h2>${renderGuardCommands(report)}</section>
<section><h2>Public Findings</h2>${findings.publicFindings.map((finding) => renderFinding(outDir, finding)).join('')}</section>
<section><h2>Admin Login Findings</h2>${findings.adminLoginFindings.map((record) => renderAdminCapture(outDir, record)).join('')}</section>
<section class="panel"><h2>Admin Guard Proofs</h2><table><thead><tr><th>Route</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead><tbody>${findings.guardProofs
    .map((proof) => `<tr><td>${escapeHtml(proof.routeKey)}</td><td>${escapeHtml(proof.expectedPath)}</td><td>${escapeHtml(proof.actualPath)}</td><td>${proof.passed ? 'PASS' : 'FAIL'}</td></tr>`)
    .join('')}</tbody></table></section>
</main></body></html>`

  fs.writeFileSync(path.join(outDir, 'dossier.html'), html)
}
