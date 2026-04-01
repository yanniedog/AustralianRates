import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildAdminHeaders, fetchWithTimeout, resolveAdminToken, resolveEnvOrigin } from '../lib/admin-api'

function argValue(args: string[], name: string): string | undefined {
  const exact = args.find((arg) => arg.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultOutput(kind: 'json' | 'md'): string {
  return path.resolve(os.tmpdir(), `retention-size-audit-${todayStamp()}.${kind}`)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} KB`
  return `${bytes} B`
}

function renderMarkdown(report: any): string {
  const recommendation = report?.raw_run_state_projection?.recommendation ?? {}
  const candidates = report?.raw_run_state_projection?.candidates ?? []
  const tables = report?.tables ?? []
  return [
    '# Retention Size Audit',
    '',
    `- Generated: \`${report?.generated_at || ''}\``,
    `- Current DB size: \`${Number(report?.current_db_size_mb || 0).toFixed(3)} MB\``,
    `- Current backend retention: \`${report?.current_backend_retention_days || 0}\` day(s)`,
    `- Fetch-events retention: \`${report?.fetch_events_retention_days || 0}\` day(s)`,
    `- Evidence backfill complete: \`${report?.evidence_backfill?.has_permanent_evidence_backfill ? 'yes' : 'no'}\``,
    `- Recommended run-state retention: \`${recommendation.recommended_days || 7}\` day(s) (${recommendation.reason || 'unknown'})`,
    '',
    '## Candidate Projections',
    '',
    ...candidates.map(
      (candidate: any) =>
        `- ${candidate.candidate_days} days: +${candidate.projected_added_rows} rows, +${candidate.projected_added_mb} MB (${formatBytes(candidate.projected_added_bytes)})`,
    ),
    '',
    '## Tables',
    '',
    ...tables.map(
      (table: any) =>
        `- ${table.name}: rows=${table.row_count} bytes=${table.estimated_bytes ?? 0} avg_rows/day=${table.avg_rows_per_day} avg_bytes/day=${table.avg_bytes_per_day} confidence=${table.projection_confidence}`,
    ),
    '',
  ].join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const origin = resolveEnvOrigin(['API_BASE'])
  const outputJson = path.resolve(argValue(args, '--output-json') || defaultOutput('json'))
  const outputMd = path.resolve(argValue(args, '--output-md') || defaultOutput('md'))
  const token = resolveAdminToken(['ADMIN_API_TOKEN', 'ADMIN_API_TOKENS'])
  if (!token) throw new Error('ADMIN_API_TOKEN is required')
  const response = await fetchWithTimeout(
    `${origin}/api/home-loan-rates/admin/audits/historical-quality/retention-size-audit`,
    { headers: buildAdminHeaders(token, 'application/json') },
    120_000,
  )
  if (!response.ok) throw new Error(`retention_size_audit_failed ${response.status}`)
  const report = await response.json()
  fs.mkdirSync(path.dirname(outputJson), { recursive: true })
  fs.mkdirSync(path.dirname(outputMd), { recursive: true })
  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(outputMd, `${renderMarkdown(report)}\n`)
  process.stdout.write(`${JSON.stringify({ ok: true, output_json: outputJson, output_md: outputMd })}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
