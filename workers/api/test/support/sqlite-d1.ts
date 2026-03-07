import { DatabaseSync } from 'node:sqlite'

type WrapOptions = {
  beforeRun?: (sql: string, args: unknown[], db: DatabaseSync) => void
}

export function wrapSqliteDatabase(db: DatabaseSync, options: WrapOptions = {}): D1Database {
  return {
    prepare(sql: string) {
      let args: any[] = []
      return {
        bind(...values: unknown[]) {
          args = values as any[]
          return this
        },
        async first<T>() {
          return (db.prepare(sql).get(...args) as T | undefined) ?? null
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...args) as T[] }
        },
        async run() {
          options.beforeRun?.(sql, args, db)
          const result = db.prepare(sql).run(...args)
          return {
            meta: {
              changes: Number(result.changes ?? 0),
              last_row_id: Number(result.lastInsertRowid ?? 0),
            },
          }
        },
      }
    },
  } as unknown as D1Database
}
