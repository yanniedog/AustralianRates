import { env } from 'cloudflare:test'
import { beforeAll } from 'vitest'
import type { EnvBindings } from '../../src/types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends EnvBindings {}
}

const migrationModules = import.meta.glob('../../migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function orderedMigrationSql(): string[] {
  return Object.entries(migrationModules)
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath, undefined, { numeric: true }))
    .map(([, sql]) => sql.replace(/\r\n/g, '\n'))
}

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = []
  const lines = sql.split('\n')
  let current: string[] = []
  let inTrigger = false

  const flush = () => {
    const statement = current.join('\n').trim()
    if (statement) statements.push(statement)
    current = []
  }

  for (const line of lines) {
    current.push(line)
    const trimmed = line.trim()
    const currentSql = current.join('\n')

    if (!inTrigger && /\bCREATE\s+TRIGGER\b/i.test(currentSql)) {
      inTrigger = true
    }

    if (inTrigger) {
      if (/^END;\s*$/i.test(trimmed)) {
        flush()
        inTrigger = false
      }
      continue
    }

    if (trimmed.endsWith(';')) {
      flush()
    }
  }

  flush()
  return statements
}

beforeAll(async () => {
  for (const sql of orderedMigrationSql()) {
    for (const statement of splitMigrationStatements(sql)) {
      await env.DB.prepare(statement).run()
    }
  }
})
