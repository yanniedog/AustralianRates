import type { EnvBindings } from '../types'

export function getReadDb(env: Pick<EnvBindings, 'DB' | 'READ_DB'>): D1Database {
  return env.READ_DB ?? env.DB
}
