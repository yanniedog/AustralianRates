import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

/**
 * Queue-consumer post-run hook retained for observability. Public cache rebuilds
 * are deferred to the Melbourne 03:01 scheduled cache refresh so a completed
 * daily ingest produces one coherent chart/report/snapshot cache pass.
 */
export async function triggerPostRunPackageRefresh(env: EnvBindings, runIds: Iterable<string>): Promise<void> {
  void env
  let triggeredRuns = 0
  for (const id of runIds) {
    if (typeof id === 'string' && id.length > 0) triggeredRuns++
  }
  if (triggeredRuns === 0) return
  log.info('post_run_refresh', 'public cache refresh deferred to scheduled daily cache cron', {
    context: `triggered_runs=${triggeredRuns}`,
  })
}
