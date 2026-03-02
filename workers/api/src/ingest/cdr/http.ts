type FetchJsonResult = {
  ok: boolean
  status: number
  url: string
  data: unknown
  text: string
}

async function fetchTextWithRetries(
  url: string,
  retries = 2,
  headers: Record<string, string> = { accept: 'application/json' },
): Promise<{ ok: boolean; status: number; text: string }> {
  let lastStatus = 0
  let lastText = ''
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers,
      })
      const text = await res.text()
      lastStatus = res.status
      lastText = text
      if (res.ok) {
        return { ok: true, status: res.status, text }
      }
    } catch (error) {
      lastText = (error as Error)?.message || String(error)
    }
  }
  return { ok: false, status: lastStatus || 500, text: lastText }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function fetchJson(url: string): Promise<FetchJsonResult> {
  const response = await fetchTextWithRetries(url, 2, { accept: 'application/json' })
  const data = parseJsonSafe(response.text)
  return {
    ok: response.ok && data != null,
    status: response.status,
    url,
    data,
    text: response.text,
  }
}

function parseSupportedVersions(body: string): number[] {
  const m = body.match(/Versions available:\s*([0-9,\s]+)/i)
  if (!m) return []
  return m[1]
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
}

export async function fetchCdrJson(url: string, versions: number[]): Promise<FetchJsonResult> {
  const tried = new Set<number>()
  const queue = [...versions]
  while (queue.length > 0) {
    const version = Number(queue.shift())
    if (!Number.isFinite(version) || tried.has(version)) continue
    tried.add(version)

    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-v': String(version),
          'x-min-v': '1',
        },
      })
      const text = await res.text()
      const data = parseJsonSafe(text)
      if (res.ok && data != null) {
        return {
          ok: true,
          status: res.status,
          url,
          data,
          text,
        }
      }
      if (res.status === 406) {
        const advertised = parseSupportedVersions(text)
        for (const x of advertised) {
          if (!tried.has(x)) queue.push(x)
        }
      }
    } catch {
      // keep trying alternate versions
    }
  }

  for (const fallbackVersion of [1, 2, 3, 4, 5, 6]) {
    if (tried.has(fallbackVersion)) continue
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-v': String(fallbackVersion),
          'x-min-v': '1',
        },
      })
      const text = await res.text()
      const data = parseJsonSafe(text)
      if (res.ok && data != null) {
        return {
          ok: true,
          status: res.status,
          url,
          data,
          text,
        }
      }
    } catch {
      // continue
    }
  }

  return fetchJson(url)
}
