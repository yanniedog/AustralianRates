import { parse } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const payload = {
  sessionId: '321116',
  location: 'send-debug-log.ts',
  message: 'node diagnostic log',
  data: { source: 'node' },
  timestamp: Date.now(),
};

const body = JSON.stringify(payload);
const url = 'http://127.0.0.1:7387/ingest/142ac719-0ef0-4470-bdb0-605715664be9';
const parsed = parse(url);

const logPath = path.join(process.cwd(), 'debug-321116.log');
fs.appendFileSync(logPath, JSON.stringify(payload) + '\n');
console.log('[debug-321116] wrote to', logPath);

const req = http.request(
  {
    hostname: parsed.hostname || undefined,
    port: parsed.port || 80,
    path: parsed.path || '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '321116',
    },
  },
  (res) => {
    console.log('[debug-321116] ingest status:', res.statusCode);
    res.resume();
  },
);

req.on('error', (error) => {
  console.log('[debug-321116] ingest request failed:', error.message);
});

req.end(body);
