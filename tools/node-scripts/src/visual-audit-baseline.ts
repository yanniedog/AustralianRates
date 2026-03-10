import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function runGit(args: string[], repoRoot: string, encoding: BufferEncoding | 'buffer' = 'utf8'): string | Buffer {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: encoding === 'buffer' ? undefined : encoding,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  if (result.status !== 0) {
    const stderr = encoding === 'buffer' ? String(result.stderr || '') : result.stderr
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
  }
  return encoding === 'buffer' ? Buffer.from(result.stdout || []) : String(result.stdout || '')
}

function ensureDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function safeStaticPath(rootDir: string, requestPath: string): string | null {
  let pathname = decodeURIComponent(requestPath.split('?')[0] || '/')
  if (pathname === '/') pathname = '/index.html'
  if (pathname.endsWith('/')) pathname += 'index.html'
  const normalized = path.normalize(pathname).replace(/^([\\/])+/, '')
  const fullPath = path.join(rootDir, normalized)
  return fullPath.startsWith(rootDir) ? fullPath : null
}

function sendResponse(res: http.ServerResponse, status: number, body: string, headers?: Record<string, string | number>): void {
  res.writeHead(status, headers || { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

function proxyApiRequest(req: http.IncomingMessage, res: http.ServerResponse, apiOrigin: string): void {
  const target = new URL(req.url || '/', apiOrigin)
  const headers = { ...req.headers }
  delete headers.host
  delete headers.origin
  delete headers.referer
  delete headers['content-length']

  if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
    sendResponse(res, 204, '', {
      'access-control-allow-headers': 'Content-Type, Authorization, X-Requested-With',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
    })
    return
  }

  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const requester = target.protocol === 'http:' ? http : https
    const upstream = requester.request(target, { headers, method: req.method || 'GET' }, (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers }
      delete responseHeaders['content-length']
      responseHeaders['access-control-allow-origin'] = '*'
      responseHeaders['cache-control'] = 'no-store'
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders)
      upstreamRes.pipe(res)
    })
    upstream.on('error', (error) => sendResponse(res, 502, `Proxy error: ${String(error.message || error)}`))
    if (body && body.length > 0) upstream.write(body)
    upstream.end()
  })
}

function serveStaticFile(rootDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const fullPath = safeStaticPath(rootDir, req.url || '/')
  if (!fullPath) {
    sendResponse(res, 400, 'Bad request')
    return
  }
  fs.stat(fullPath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendResponse(res, 404, 'Not found')
      return
    }
    const contentType = MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, { 'cache-control': 'no-store', 'content-type': contentType })
    fs.createReadStream(fullPath).pipe(res)
  })
}

export function materializeBaselineSite(repoRoot: string, outDir: string, commit: string): string {
  const siteRoot = path.join(outDir, 'baseline-site')
  ensureDirectory(siteRoot)
  const listed = String(runGit(['ls-tree', '-r', '--name-only', commit, 'site'], repoRoot))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const repoPath of listed) {
    const targetPath = path.join(siteRoot, repoPath.replace(/^site[\\/]/, ''))
    ensureDirectory(path.dirname(targetPath))
    const blob = runGit(['show', `${commit}:${repoPath}`], repoRoot, 'buffer')
    fs.writeFileSync(targetPath, blob)
  }
  return siteRoot
}

export async function startBaselineServer(rootDir: string, apiOrigin: string): Promise<{ close: () => Promise<void>; origin: string }> {
  const server = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/api/')) {
      proxyApiRequest(req, res, apiOrigin)
      return
    }
    serveStaticFile(rootDir, req, res)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to resolve baseline server address.')
  const origin = `http://127.0.0.1:${address.port}`

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
    origin,
  }
}
