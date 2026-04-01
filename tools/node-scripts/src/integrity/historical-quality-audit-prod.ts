import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ALLOWED_DB = 'australianrates_api'
const DEFAULT_ORIGIN = 'https://www.australianrates.com'

function argValue(args: string[], name: string): string | undefined {
  const exact = args.find((arg) => arg.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = args.indexOf(name)
  if (index >= 0) return args[index + 1]
  return undefined
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name) || args.some((arg) => arg === `${name}=true`)
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultOutput(kind: 'json' | 'md'): string {
  const ext = kind === 'json' ? 'json' : 'md'
  return path.resolve(os.tmpdir(), `historical-quality-audit-${todayStamp()}.${ext}`)
}

function requireToken(): string {
  const token = String(process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_TOKENS?.split(',')[0] || '').trim()
  if (!token) throw new Error('ADMIN_API_TOKEN is required')
  return token
}

function parseConfig(args: string[]) {
  if (!hasFlag(args, '--remote')) throw new Error('--remote is required')
  const db = String(argValue(args, '--db') || '').trim()
  if (db !== ALLOWED_DB) throw new Error(`only --db ${ALLOWED_DB} is allowed`)
  return {
    origin: String(argValue(args, '--origin') || process.env.API_BASE || DEFAULT_ORIGIN).trim().replace(/\/+$/, ''),
    outputJson: path.resolve(argValue(args, '--output-json') || defaultOutput('json')),
    outputMd: path.resolve(argValue(args, '--output-md') || defaultOutput('md')),
  }
}

async function adminFetch(origin: string, token: string, pathname: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!response.ok) {
    throw new Error(`admin_request_failed ${pathname} ${response.status}`)
  }
  return response.json()
}

function renderMarkdown(report: any): string {
  const run = report.run
  const overall = (report.daily || []).filter((row: any) => row.scope === 'overall')
  const topFindings = (report.findings || []).slice(0, 20)
  return [
    '# Historical Quality Audit',
    '',
    `- Run: \`${run?.audit_run_id || ''}\``,
    `- Status: \`${run?.status || ''}\``,
    `- Started: \`${run?.started_at || ''}\``,
    `- Finished: \`${run?.finished_at || ''}\``,
    '',
    '## Cutoff Candidates',
    '',
    '```json',
    JSON.stringify(run?.summary?.cutoff_candidates ?? null, null, 2),
    '```',
    '',
    '## Overall Daily Scores',
    '',
    ...overall.map(
      (row: any) =>
        `- ${row.collection_date}: structural=${Number(row.structural_score_v1 ?? 0).toFixed(3)} provenance=${Number(row.provenance_score_v1 ?? 0).toFixed(3)} transition=${Number(row.transition_score_v1 ?? 0).toFixed(3)} evidence=${Number(row.evidence_confidence_score_v1 ?? 0).toFixed(3)}`,
    ),
    '',
    '## Findings',
    '',
    ...topFindings.map(
      (finding: any) =>
        `- ${finding.collection_date} ${finding.scope} ${finding.criterion_code} ${finding.severity}: ${finding.summary}`,
    ),
    '',
  ].join('\n')
}

async function main() {
  const config = parseConfig(process.argv.slice(2))
  const token = requireToken()
  const start = await adminFetch(config.origin, token, '/api/home-loan-rates/admin/audits/historical-quality/run', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  const auditRunId = String(start?.detail?.run?.audit_run_id || start?.created?.auditRunId || '').trim()
  if (!auditRunId) throw new Error('missing audit run id from start response')

  let detail = start.detail
  for (let step = 0; step < 500; step += 1) {
    const status = String(detail?.run?.status || '').trim()
    if (status === 'completed' || status === 'failed') break
    const resumed = await adminFetch(config.origin, token, '/api/home-loan-rates/admin/audits/historical-quality/resume', {
      method: 'POST',
      body: JSON.stringify({ audit_run_id: auditRunId }),
    })
    detail = resumed.detail
  }

  const finalReport = await adminFetch(
    config.origin,
    token,
    `/api/home-loan-rates/admin/audits/historical-quality/${encodeURIComponent(auditRunId)}`,
  )

  fs.mkdirSync(path.dirname(config.outputJson), { recursive: true })
  fs.mkdirSync(path.dirname(config.outputMd), { recursive: true })
  fs.writeFileSync(config.outputJson, `${JSON.stringify(finalReport, null, 2)}\n`)
  fs.writeFileSync(config.outputMd, `${renderMarkdown(finalReport)}\n`)
  process.stdout.write(`${JSON.stringify({ ok: true, audit_run_id: auditRunId, output_json: config.outputJson, output_md: config.outputMd })}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
