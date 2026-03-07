import path from 'node:path'

export function resolveCliPath(input: string): string {
  const raw = String(input || '').trim()
  if (process.platform === 'win32') {
    return path.resolve(raw)
  }

  const normalized = raw.replace(/\\/g, '/')
  if (path.posix.isAbsolute(normalized)) {
    return path.posix.normalize(normalized)
  }

  return path.resolve(normalized)
}
