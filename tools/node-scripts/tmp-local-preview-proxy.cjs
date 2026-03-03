const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4173);
const ROOT = path.resolve(process.cwd(), 'site');
const API_ORIGIN = 'https://www.australianrates.com';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function safePath(urlPath) {
  let pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  if (pathname === '/') pathname = '/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';
  const normalized = path.normalize(pathname).replace(/^([\\/])+/, '');
  const full = path.join(ROOT, normalized);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function serveStatic(req, res) {
  const full = safePath(req.url || '/');
  if (!full) return send(res, 400, 'Bad request');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(full).pipe(res);
  });
}

function proxyApi(req, res) {
  const method = req.method || 'GET';
  const target = new URL((req.url || '/').toString(), API_ORIGIN);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  delete headers['content-length'];

  if (method === 'OPTIONS') {
    return send(res, 204, '', {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Requested-With',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
    });
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const outbound = https.request(target, {
      method,
      headers,
    }, (upstream) => {
      const responseHeaders = { ...upstream.headers };
      delete responseHeaders['content-length'];
      responseHeaders['access-control-allow-origin'] = '*';
      responseHeaders['cache-control'] = 'no-store';
      res.writeHead(upstream.statusCode || 502, responseHeaders);
      upstream.pipe(res);
    });

    outbound.on('error', (err) => {
      send(res, 502, `Proxy error: ${String(err.message || err)}`);
    });

    if (body && body.length) outbound.write(body);
    outbound.end();
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) return proxyApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local preview proxy running at http://127.0.0.1:${PORT}`);
});
