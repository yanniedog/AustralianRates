import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { refreshPublicSnapshotPackages } from './chart-cache-refresh'

/**
 * Post-run snapshot refresh hook. Called from the queue consumer once per batch
 * for every distinct runId that produced an outcome whose new status is `ok` or
 * `partial`. The intent is: as soon as ingest finalises (every lender_dataset
 * for the run is processed or failed), the public KV snapshot bundles should be
 * rebuilt so the homepage ribbon, slice-pair indicators and chart cache reflect
 * the new collection_date instead of waiting for the next hourly cron.
 *
 * Idempotent — `refreshPublicSnapshotPackages` skips bundles already fresher
 * than the most recent completed run via {@link isFreshPublicSnapshotPackage},
 * so concurrent triggers from the same batch do not duplicate the rebuild.
 *
 * Never throws — failures are logged and swallowed so a snapshot refresh
 * problem cannot cascade into the queue consumer marking a successful message
 * as failed.
 */
export async function triggerPostRunPackageRefresh(env: EnvBindings, runIds: Iterable<string>): Promise<void> {
  let triggeredRuns = 0
  for (const id of runIds) {
    if (typeof id === 'string' && id.length > 0) triggeredRuns++
  }
  if (triggeredRuns === 0) return
  try {
    const result = await refreshPublicSnapshotPackages(env)
    log.info('post_run_refresh', 'public packages refreshed after run finalisation', {
      context: `triggered_runs=${triggeredRuns} refreshed=${result.refreshed} skipped=${result.skipped} errors=${result.errors.length}`,
    })
  } catch (error) {
    log.warn('post_run_refresh', 'public package refresh after run finalisation failed', {
      code: 'post_run_refresh_failed',
      error,
      context: `triggered_runs=${triggeredRuns}`,
    })
  }
}
