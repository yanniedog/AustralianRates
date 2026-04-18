/**
 * GitHub-hosted runners often get HTTP 403 from Cloudflare on australianrates.com
 * (Bot Fight / WAF). Scheduled doctor would false-fail while the site is healthy for browsers.
 */

function envTruthy(v: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase())
}

/** When set with GITHUB_ACTIONS, doctor scripts may skip hard failures if health is 403-only. */
export function tolerateCfActionsRunnerBlock(): boolean {
  return envTruthy(process.env.GITHUB_ACTIONS) && envTruthy(process.env.DOCTOR_TOLERATE_CF_ACTIONS_RUNNER_BLOCK)
}

const HEALTH_PROBE_MS = 10_000

export async function publicHealthIs403(origin: string): Promise<boolean> {
  const base = String(origin || '').replace(/\/+$/, '')
  const url = `${base}/api/home-loan-rates/health`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), HEALTH_PROBE_MS)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal })
    return res.status === 403
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}
