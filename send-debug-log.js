'use strict';
// One-time diagnostic: send a log to the debug ingest server and also write to workspace log file.
// Run from repo root: node send-debug-log.js
var payload = {
  sessionId: '321116',
  location: 'send-debug-log.js',
  message: 'node diagnostic log',
  data: { source: 'node' },
  timestamp: Date.now()
};
var body = JSON.stringify(payload);
var url = 'http://127.0.0.1:7387/ingest/142ac719-0ef0-4470-bdb0-605715664be9';
var parsed = require('url').parse(url);
var http = require('http');
var fs = require('fs');
var path = require('path');

var logPath = path.join(__dirname, 'debug-321116.log');
fs.appendFileSync(logPath, JSON.stringify(payload) + '\n');
console.log('[debug-321116] wrote to', logPath);

var req = http.request({
  hostname: parsed.hostname,
  port: parsed.port || 80,
  path: parsed.path,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '321116' }
}, function (res) {
  console.log('[debug-321116] ingest status:', res.statusCode);
  res.resume();
});
req.on('error', function (err) {
  console.log('[debug-321116] ingest request failed:', err.message);
});
req.end(body);
