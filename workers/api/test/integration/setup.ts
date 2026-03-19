import { env } from 'cloudflare:test'
import { beforeAll } from 'vitest'
import { unstable_splitSqlQuery } from 'wrangler'
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
    .map(([, sql]) => sql)
}

beforeAll(async () => {
  for (const sql of orderedMigrationSql()) {
    for (const query of unstable_splitSqlQuery(sql)) {
      const statement = String(query || '').trim()
      if (!statement) continue
      await env.DB.exec(statement)
    }
  }
})
