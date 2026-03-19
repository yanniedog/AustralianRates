import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, inject } from 'vitest'
import type { EnvBindings } from '../../src/types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends EnvBindings {}
}

declare module 'vitest' {
  interface ProvidedContext {
    d1Migrations: Array<{ name: string; queries: string[] }>
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('d1Migrations'))
})
