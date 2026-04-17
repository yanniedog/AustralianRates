/**
 * Pages Functions middleware that inlines the server-precomputed /snapshot JSON
 * into the initial HTML response, so the client has `window.AR.snapshotInline`
 * set before any `<script>` tag runs and `ar-snapshot.js` can skip its `/snapshot`
 * fetch.
 *
 * Strategy:
 *   1. Only act on document requests under `/`, `/savings/`, `/term-deposits/`
 *      (matching the three public section pages).
 *   2. Fire a subrequest to the existing `/api/<section>/snapshot` endpoint with
 *      a 50 ms hard budget - that endpoint is KV-cached and typically responds
 *      in single-digit ms from the same datacenter.
 *   3. If the payload is small enough (<= `MAX_INLINE_BYTES`) and valid JSON,
 *      inject it into `<head>` via `HTMLRewriter`. Otherwise fall through
 *      unchanged so the client does its normal fetch.
 *   4. Always set `X-AR-Snapshot-Inline: hit|miss|bypass-size|bypass-method|bypass-html`
 *      so the outcome is observable from DevTools without parsing the body.
 */

type Section = 'home-loan-rates' | 'savings-rates' | 'term-deposit-rates'

/** Document HTML we inject into. Heavier snapshots are skipped to keep the page size manageable. */
const MAX_INLINE_BYTES = 400_000
const SNAPSHOT_FETCH_TIMEOUT_MS = 50

function resolveSection(pathname: string): Section | null {
  const clean = pathname.replace(/\/index\.html$/i, '').replace(/\/+$/, '/')
  if (clean === '/' || clean === '') return 'home-loan-rates'
  if (clean === '/savings/') return 'savings-rates'
  if (clean === '/term-deposits/') return 'term-deposit-rates'
  return null
}

function normaliseChartWindow(value: string | null): string {
  if (!value) return ''
  const upper = String(value).trim().toUpperCase()
  return ['30D', '90D', '180D', '1Y', 'ALL'].indexOf(upper) >= 0 ? upper : ''
}

function normalisePreset(value: string | null): string {
  if (!value) return ''
  const lower = String(value).trim().toLowerCase()
  return lower === 'consumer-default' ? 'consumer-default' : ''
}

async function fetchSnapshotWithTimeout(
  origin: string,
  section: Section,
  params: URLSearchParams,
): Promise<string | null> {
  const qs = new URLSearchParams()
  const chartWindow = normaliseChartWindow(params.get('chart_window'))
  const preset = normalisePreset(params.get('preset'))
  if (chartWindow) qs.set('chart_window', chartWindow)
  if (preset) qs.set('preset', preset)
  const url = `${origin}/api/${section}/snapshot${qs.toString() ? `?${qs.toString()}` : ''}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SNAPSHOT_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cf: { cacheTtl: 60, cacheEverything: true } as RequestInitCfProperties,
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function wrapOriginalResponse(response: Response, marker: string): Response {
  const mutable = new Response(response.body, response)
  mutable.headers.set('X-AR-Snapshot-Inline', marker)
  return mutable
}

/** Build the `<script>` tag that preloads the snapshot onto `window.AR.snapshotInline`. */
function inlineScriptFor(snapshotJson: string): string {
  // Snapshot JSON is already valid JSON; it goes inside a script tag body so we
  // only need to escape `</script>` and `<!--` / `<!-->` / `-->` sequences.
  const safe = snapshotJson
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/<!--/g, '<\\!--')
    .replace(/-->/g, '--\\>')
  return `<script>window.AR=window.AR||{};window.AR.snapshotInline=${safe};</script>`
}

type RouteEnv = Record<string, unknown>

export const onRequest: PagesFunction<RouteEnv> = async (context) => {
  const { request, next } = context
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return next()

  const url = new URL(request.url)
  const section = resolveSection(url.pathname)
  if (!section) return next()

  const accept = (request.headers.get('accept') || '').toLowerCase()
  if (!accept.includes('text/html')) return next()

  const originalResponse = await next()
  const contentType = (originalResponse.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('text/html')) return wrapOriginalResponse(originalResponse, 'bypass-html')

  const snapshotJson = await fetchSnapshotWithTimeout(url.origin, section, url.searchParams)
  if (!snapshotJson) return wrapOriginalResponse(originalResponse, 'miss')
  if (snapshotJson.length > MAX_INLINE_BYTES) {
    return wrapOriginalResponse(originalResponse, 'bypass-size')
  }

  const scriptTag = inlineScriptFor(snapshotJson)
  const rewriter = new HTMLRewriter().on('head', {
    element(el) {
      el.prepend(scriptTag, { html: true })
    },
  })
  const rewritten = rewriter.transform(originalResponse)
  const out = new Response(rewritten.body, rewritten)
  out.headers.set('X-AR-Snapshot-Inline', 'hit')
  // Snapshot data may differ per visit (no cookies but URL state might); keep private cache.
  out.headers.set('Cache-Control', 'private, max-age=0, must-revalidate')
  return out
}
