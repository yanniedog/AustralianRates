import type { Context } from 'hono'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import { log } from '../utils/logger'

export function handlePublicReadFailure(
  c: Context<AppContext>,
  logMessage: string,
  code: string,
  message: string,
  error: unknown,
) {
  log.error('public', logMessage, {
    code,
    context: (error as Error)?.message ?? String(error),
  })
  withNoStore(c)
  return jsonError(c, 500, code, message)
}
