import type { AdminDownloadArtifactRow, AdminDownloadJobRow } from '../db/admin-download-jobs'
import { gzipDecompressToText } from '../utils/compression'
import type { AdminDownloadEnv } from './admin-download-artifact-writer'
import { databaseDumpPartKind, sortDatabaseDumpArtifactsForBundle } from './admin-download-dump'
import { analyzeDatabaseDumpRestore, type DatabaseDumpRestoreAnalysis } from './admin-download-restore-analysis'
import { countTableRows, listDatabaseObjectSnapshot, quoteSqlIdentifier } from './admin-download-schema'

export type DatabaseDumpRestoreResult = {
  restored_at: string
  parts_applied: number
  extra_tables_dropped: string[]
  extra_views_dropped: string[]
  extra_triggers_dropped: string[]
  verified_tables: number
  verified_rows: number
}

type RestoreOptions = {
  force?: boolean
  analysis?: DatabaseDumpRestoreAnalysis
}

function dropStatements(kind: 'VIEW' | 'TRIGGER' | 'TABLE', names: string[]): string[] {
  const ordered = names.slice().sort((left, right) => right.localeCompare(left))
  return ordered.map((name) => `DROP ${kind} IF EXISTS ${quoteSqlIdentifier(name)};`)
}

async function readArtifactSql(bucket: R2Bucket, artifact: AdminDownloadArtifactRow): Promise<string> {
  const object = await bucket.get(artifact.r2_key)
  if (!object) throw new Error(`Stored dump part is missing: ${artifact.file_name}`)
  return gzipDecompressToText(await object.arrayBuffer())
}

function executableSql(sql: string): string {
  const withoutComments = String(sql || '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  let normalized = ''
  let inSingleQuote = false
  for (let index = 0; index < withoutComments.length; index += 1) {
    const char = withoutComments[index]
    const next = withoutComments[index + 1]
    if (char === "'") {
      normalized += char
      if (inSingleQuote && next === "'") {
        normalized += next
        index += 1
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }
    if (!inSingleQuote && (char === '\n' || char === '\r')) {
      if (!normalized.endsWith(' ')) normalized += ' '
      continue
    }
    normalized += char
  }
  normalized = normalized.trim()
  if (!normalized) return ''
  return /;\s*$/.test(normalized) ? normalized : `${normalized};`
}

async function dropExtraObjects(env: Pick<AdminDownloadEnv, 'DB'>, analysis: DatabaseDumpRestoreAnalysis): Promise<void> {
  const snapshot = await listDatabaseObjectSnapshot(env.DB)
  await env.DB.exec('PRAGMA foreign_keys = OFF;')

  for (const statement of dropStatements('VIEW', snapshot.views)) {
    await env.DB.exec(statement)
  }
  for (const statement of dropStatements('TRIGGER', snapshot.triggers)) {
    await env.DB.exec(statement)
  }

  let remainingTables = snapshot.tables.slice().sort((left, right) => right.localeCompare(left))
  while (remainingTables.length > 0) {
    const nextPass: string[] = []
    let droppedThisPass = 0
    let lastError: unknown = null
    for (const tableName of remainingTables) {
      try {
        await env.DB.exec(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(tableName)};`)
        droppedThisPass += 1
      } catch (error) {
        lastError = error
        nextPass.push(tableName)
      }
    }
    if (!nextPass.length) break
    if (droppedThisPass === 0) {
      throw new Error(
        `Failed to drop current tables before restore: ${nextPass.join(', ')}. ${(lastError as Error)?.message || String(lastError || '')}`,
      )
    }
    remainingTables = nextPass
  }
}

async function verifyRestore(env: Pick<AdminDownloadEnv, 'DB'>, analysis: DatabaseDumpRestoreAnalysis): Promise<{ tables: number; rows: number }> {
  let verifiedRows = 0
  for (const table of analysis.source.tables) {
    const currentRows = await countTableRows(env.DB, table.table_name)
    if (currentRows !== table.dump_row_count) {
      throw new Error(
        `Restore verification failed for ${table.table_name}: expected ${table.dump_row_count} row(s) but found ${currentRows}.`,
      )
    }
    verifiedRows += currentRows
  }
  return {
    tables: analysis.source.tables.length,
    rows: verifiedRows,
  }
}

export async function executeDatabaseDumpRestore(
  env: Pick<AdminDownloadEnv, 'DB' | 'RAW_BUCKET'>,
  job: AdminDownloadJobRow,
  artifacts: AdminDownloadArtifactRow[],
  options: RestoreOptions = {},
): Promise<{ analysis: DatabaseDumpRestoreAnalysis; result: DatabaseDumpRestoreResult }> {
  const analysis = options.analysis ?? await analyzeDatabaseDumpRestore(env, job, artifacts)
  if (!analysis.ready) {
    throw new Error(`Dump restore is blocked: ${analysis.errors.join(' ')}`)
  }
  if (analysis.requires_force && !options.force) {
    throw new Error('Dump restore requires explicit force acknowledgement because it will replace or remove current data.')
  }

  await dropExtraObjects(env, analysis)

  const mainArtifacts = sortDatabaseDumpArtifactsForBundle(
    artifacts.filter((artifact) => artifact.artifact_kind === 'main' && databaseDumpPartKind(artifact.file_name) !== null),
  )
  for (const artifact of mainArtifacts) {
    const partKind = databaseDumpPartKind(artifact.file_name)
    if (partKind === 'header') continue
    const sql = executableSql(await readArtifactSql(env.RAW_BUCKET, artifact))
    if (!sql) continue
    try {
      await env.DB.exec(sql)
    } catch (error) {
      throw new Error(
        `Failed to apply ${artifact.file_name}: ${(error as Error)?.message || String(error)} SQL=${sql.slice(0, 240)}`,
      )
    }
  }

  const verified = await verifyRestore(env, analysis)
  return {
    analysis,
    result: {
      restored_at: new Date().toISOString(),
      parts_applied: mainArtifacts.length,
      extra_tables_dropped: analysis.target.extra_tables,
      extra_views_dropped: analysis.target.extra_views,
      extra_triggers_dropped: analysis.target.extra_triggers,
      verified_tables: verified.tables,
      verified_rows: verified.rows,
    },
  }
}
