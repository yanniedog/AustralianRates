export type AuditSource = 'current' | 'baseline'
export type Verdict = 'pass' | 'fail' | 'blocked'
export type ViewportKey = 'desktop' | 'tablet' | 'mobile'
export type RouteKind = 'data' | 'legal' | 'admin-login' | 'admin-guard'

export type SelectorMetric = {
  selector: string
  visible: boolean
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  clippedLeft?: boolean
  clippedRight?: boolean
  clippedHorizontally?: boolean
}

export type GeometryEvidence = {
  viewport: { width: number; height: number }
  pageOverflowX: boolean
  pageOverflowY: boolean
  horizontalIssues: string[]
  blockedSelectors: string[]
  selectorMetrics: SelectorMetric[]
}

export type CaptureCheck = {
  label: string
  passed: boolean
  details?: string
}

export type CaptureIssue = {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export type CaptureRecord = {
  id: string
  pairKey: string
  source: AuditSource
  routeKey: string
  routePath: string
  routeKind: RouteKind
  stateKey: string
  stateLabel: string
  viewportKey: ViewportKey
  screenshotPath?: string
  expectedUrl?: string
  actualUrl: string
  notes: string[]
  checks: CaptureCheck[]
  issues: CaptureIssue[]
  geometry: GeometryEvidence
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: Array<{ url: string; error: string }>
  verdict: Verdict
  reviewNote: string
}

export type GuardProof = {
  routeKey: string
  expectedPath: string
  actualPath: string
  passed: boolean
}

export type GuardCommandResult = {
  label: string
  command: string
  exitCode: number
  logPath: string
}

export type PairedFinding = {
  pairKey: string
  routeKey: string
  routePath: string
  routeKind: RouteKind
  stateKey: string
  stateLabel: string
  viewportKey: ViewportKey
  verdict: Verdict
  reviewBasis: 'automated-contract-and-geometry'
  summary: string
  current?: CaptureRecord
  baseline?: CaptureRecord
}

export type AuditSummary = {
  totalCaptures: number
  totalReviewed: number
  passCount: number
  failCount: number
  blockedCount: number
  warningCount: number
  guardCommandFailures: number
}

export type AuditReport = {
  metadata: {
    createdAt: string
    outputDir: string
    currentOrigin: string
    baselineOrigin: string
    baselineCommit: string
  }
  contractGuards: GuardCommandResult[]
  guardProofs: GuardProof[]
  captures: CaptureRecord[]
  warnings: string[]
  summary: AuditSummary
}

export type FindingsReport = {
  metadata: AuditReport['metadata']
  contractGuards: GuardCommandResult[]
  publicFindings: PairedFinding[]
  adminLoginFindings: CaptureRecord[]
  guardProofs: GuardProof[]
  summary: AuditSummary
}

export type AuditRoute = {
  key: string
  label: string
  path: string
  kind: RouteKind
}

export type AuditState = {
  key: string
  label: string
  viewportKey: ViewportKey
  screenshotName: string
  pairWithBaseline: boolean
}
