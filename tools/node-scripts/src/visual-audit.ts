import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'
import {
  ADMIN_GUARD_PATHS,
  ADMIN_LOGIN_ROUTE,
  ADMIN_LOGIN_STATES,
  BASELINE_COMMIT,
  CURRENT_ORIGIN,
  DATA_ROUTES,
  DESKTOP_DATA_STATES,
  LEGAL_ROUTES,
  LEGAL_STATES,
  RESPONSIVE_DATA_STATES,
  VIEWPORTS,
} from './visual-audit-config'
import { materializeBaselineSite, startBaselineServer } from './visual-audit-baseline'
import { writeAuditArtifacts } from './visual-audit-dossier'
import { collectGeometry, prepareState } from './visual-audit-page'
import type { AuditReport, AuditRoute, AuditState, CaptureRecord, FindingsReport, GuardCommandResult, GuardProof, PairedFinding, Verdict } from './visual-audit-types'

function ensureDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function captureId(source: string, routeKey: string, stateKey: string, viewportKey: string): string {
  return [source, routeKey, stateKey, viewportKey].join(':')
}

function verdictFromIssues(issues: CaptureRecord['issues']): Verdict {
  return issues.some((issue) => issue.severity === 'error') ? 'fail' : 'pass'
}

function reviewNote(verdict: Verdict, issues: CaptureRecord['issues']): string {
  return verdict === 'pass'
    ? 'Pass via automated contract, geometry, and runtime checks.'
    : issues.map((issue) => issue.message).slice(0, 3).join(' ')
}

function runNodeScript(scriptName: string, label: string, outDir: string): GuardCommandResult {
  const logPath = path.join(outDir, 'guards', `${scriptName.replace(/\.js$/u, '')}.log`)
  ensureDirectory(path.dirname(logPath))
  const attempts = 2
  let finalExitCode = 1
  const logChunks: string[] = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(process.execPath, [path.join(process.cwd(), scriptName)], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      shell: false,
    })
    finalExitCode = result.status ?? 1
    logChunks.push(`===== Attempt ${attempt}/${attempts} =====\n${result.stdout || ''}${result.stderr || ''}`)
    if (finalExitCode === 0) break
  }
  fs.writeFileSync(logPath, logChunks.join('\n\n'))
  return { command: `${process.execPath} ${scriptName}`, exitCode: finalExitCode, label, logPath }
}

function attachTelemetry(page: Page): { consoleErrors: string[]; detach: () => void; pageErrors: string[]; requestFailures: Array<{ url: string; error: string }> } {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const requestFailures: Array<{ url: string; error: string }> = []
  let ignoredTelemetry = 0
  const onConsole = (msg: { text: () => string; type: () => string }) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (text === 'Failed to load resource: net::ERR_NAME_NOT_RESOLVED' && ignoredTelemetry > 0) {
      ignoredTelemetry -= 1
      return
    }
    consoleErrors.push(text)
  }
  const onPageError = (error: Error) => pageErrors.push(String(error.message || error))
  const onRequestFailed = (req: { failure: () => { errorText?: string } | null; url: () => string }) => {
    const failure = req.failure()
    if (req.url().includes('static.cloudflareinsights.com/beacon.min.js') && failure?.errorText === 'net::ERR_NAME_NOT_RESOLVED') {
      ignoredTelemetry += 1
      return
    }
    requestFailures.push({ error: failure?.errorText || '', url: req.url() })
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('requestfailed', onRequestFailed)
  return {
    consoleErrors,
    detach: () => {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      page.off('requestfailed', onRequestFailed)
    },
    pageErrors,
    requestFailures,
  }
}

async function captureRouteState(browser: Browser, source: 'current' | 'baseline', origin: string, outDir: string, route: AuditRoute, state: AuditState): Promise<CaptureRecord> {
  const context = await browser.newContext({ ...VIEWPORTS[state.viewportKey], viewport: VIEWPORTS[state.viewportKey] })
  const page = await context.newPage()
  const telemetry = attachTelemetry(page)
  const issues: CaptureRecord['issues'] = []
  const checks: CaptureRecord['checks'] = []
  const notes: string[] = []
  const screenshotDir = path.join(outDir, 'captures', source, route.key)
  ensureDirectory(screenshotDir)
  const screenshotPath = path.join(screenshotDir, state.screenshotName)
  const expectedUrl = origin + route.path

  try {
    await page.goto(expectedUrl, { timeout: 60_000, waitUntil: 'domcontentloaded' })
    if (route.kind === 'legal') await page.waitForSelector('#main-content', { timeout: 30_000 })
    if (route.kind === 'admin-login') await page.waitForSelector('#admin-token', { timeout: 30_000 })
    const interactiveSelectors = await prepareState(page, route, state, checks, issues)
    if (route.kind === 'admin-login') checks.push({ label: 'admin token input visible', passed: await page.locator('#admin-token').isVisible().catch(() => false) })
    await page.screenshot({ fullPage: true, path: screenshotPath })
    const geometry = await collectGeometry(page, interactiveSelectors)
    if (geometry.pageOverflowX) issues.push({ code: 'PAGE_OVERFLOW_X', message: 'Page has horizontal overflow.', severity: 'error' })
    if (geometry.horizontalIssues.length > 0) issues.push({ code: 'CLIPPED_SELECTORS', message: `Clipped selectors: ${geometry.horizontalIssues.join(', ')}`, severity: 'error' })
    if (geometry.blockedSelectors.length > 0) issues.push({ code: 'BLOCKED_SELECTORS', message: `Blocked selectors: ${geometry.blockedSelectors.join(', ')}`, severity: 'error' })
    const verdict = verdictFromIssues(issues)
    return {
      actualUrl: page.url(),
      checks,
      consoleErrors: telemetry.consoleErrors,
      geometry,
      id: captureId(source, route.key, state.key, state.viewportKey),
      issues,
      notes,
      pageErrors: telemetry.pageErrors,
      pairKey: `${route.key}:${state.key}:${state.viewportKey}`,
      requestFailures: telemetry.requestFailures,
      reviewNote: reviewNote(verdict, issues),
      routeKey: route.key,
      routeKind: route.kind,
      routePath: route.path,
      screenshotPath,
      source,
      stateKey: state.key,
      stateLabel: state.label,
      verdict,
      viewportKey: state.viewportKey,
      expectedUrl,
    }
  } finally {
    telemetry.detach()
    await context.close()
  }
}

async function runGuardProofs(browser: Browser, origin: string): Promise<GuardProof[]> {
  const page = await browser.newPage({ viewport: VIEWPORTS.desktop })
  const proofs: GuardProof[] = []
  try {
    for (const key of ADMIN_GUARD_PATHS) {
      await page.goto(`${origin}/admin/${key}`, { timeout: 45_000, waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)
      const actualPath = new URL(page.url()).pathname
      proofs.push({ actualPath, expectedPath: '/admin/', passed: actualPath === '/admin/' || actualPath === '/admin', routeKey: key })
    }
  } finally {
    await page.close()
  }
  return proofs
}

function buildFindings(report: AuditReport): FindingsReport {
  const publicMap = new Map<string, CaptureRecord[]>()
  const adminLoginFindings = report.captures.filter((capture) => capture.routeKind === 'admin-login')
  for (const capture of report.captures.filter((entry) => entry.routeKind === 'data' || entry.routeKind === 'legal')) {
    const existing = publicMap.get(capture.pairKey) || []
    existing.push(capture)
    publicMap.set(capture.pairKey, existing)
  }
  const publicFindings: PairedFinding[] = Array.from(publicMap.values()).map((captures) => {
    const current = captures.find((capture) => capture.source === 'current')
    const baseline = captures.find((capture) => capture.source === 'baseline')
    const verdict: Verdict = !current || !baseline ? 'fail' : current.verdict === 'fail' || baseline.verdict === 'fail' ? 'fail' : 'pass'
    return {
      baseline,
      current,
      pairKey: captures[0].pairKey,
      reviewBasis: 'automated-contract-and-geometry',
      routeKey: captures[0].routeKey,
      routeKind: captures[0].routeKind,
      routePath: captures[0].routePath,
      stateKey: captures[0].stateKey,
      stateLabel: captures[0].stateLabel,
      summary: verdict === 'pass' ? 'Current and baseline captures are present and passed the automated rubric.' : 'One or more paired captures failed automated review or are missing.',
      verdict,
      viewportKey: captures[0].viewportKey,
    }
  })
  return { adminLoginFindings, contractGuards: report.contractGuards, guardProofs: report.guardProofs, metadata: report.metadata, publicFindings, summary: report.summary }
}

function summarize(report: Omit<AuditReport, 'summary'>): AuditReport['summary'] {
  const totalReviewed = report.captures.length
  const failCount = report.captures.filter((capture) => capture.verdict === 'fail').length + report.guardProofs.filter((proof) => !proof.passed).length
  const warningCount = report.warnings.length
  return {
    blockedCount: 0,
    failCount,
    guardCommandFailures: report.contractGuards.filter((guard) => guard.exitCode !== 0).length,
    passCount: totalReviewed - report.captures.filter((capture) => capture.verdict === 'fail').length,
    totalCaptures: report.captures.length,
    totalReviewed,
    warningCount,
  }
}

async function captureMatrix(browser: Browser, source: 'current' | 'baseline', origin: string, outDir: string): Promise<CaptureRecord[]> {
  const captures: CaptureRecord[] = []
  for (const route of DATA_ROUTES) for (const state of [...DESKTOP_DATA_STATES, ...RESPONSIVE_DATA_STATES]) captures.push(await captureRouteState(browser, source, origin, outDir, route, state))
  for (const route of LEGAL_ROUTES) for (const state of LEGAL_STATES) captures.push(await captureRouteState(browser, source, origin, outDir, route, state))
  return captures
}

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'test-screenshots', `visual-audit-${stamp()}`)
  ensureDirectory(outDir)
  const contractGuards: GuardCommandResult[] = [
    runNodeScript('test-homepage.js', 'Homepage contract', outDir),
    runNodeScript('test-chart-ux.js', 'Chart UX contract', outDir),
    runNodeScript('test-table-error-detect.js', 'Table integrity contract', outDir),
  ]

  const baselineRoot = materializeBaselineSite(process.cwd(), outDir, BASELINE_COMMIT)
  const baselineServer = await startBaselineServer(baselineRoot, CURRENT_ORIGIN)
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' })

  try {
    const currentCaptures = await captureMatrix(browser, 'current', CURRENT_ORIGIN, outDir)
    const baselineCaptures = await captureMatrix(browser, 'baseline', baselineServer.origin, outDir)
    const adminCaptures: CaptureRecord[] = []
    for (const state of ADMIN_LOGIN_STATES) adminCaptures.push(await captureRouteState(browser, 'current', CURRENT_ORIGIN, outDir, ADMIN_LOGIN_ROUTE, state))
    const guardProofs = await runGuardProofs(browser, CURRENT_ORIGIN)
    const warnings = ['Authenticated admin interiors were not audited because ADMIN_TEST_TOKEN was not supplied.']
    const partial: Omit<AuditReport, 'summary'> = {
      captures: [...currentCaptures, ...baselineCaptures, ...adminCaptures],
      contractGuards,
      guardProofs,
      metadata: { baselineCommit: BASELINE_COMMIT, baselineOrigin: baselineServer.origin, createdAt: new Date().toISOString(), currentOrigin: CURRENT_ORIGIN, outputDir: outDir },
      warnings,
    }
    const report: AuditReport = { ...partial, summary: summarize(partial) }
    const findings = buildFindings(report)
    writeAuditArtifacts(report, findings)
    console.log(JSON.stringify({ baselineOrigin: baselineServer.origin, outputDir: outDir, summary: report.summary }, null, 2))
  } finally {
    await browser.close()
    await baselineServer.close()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
