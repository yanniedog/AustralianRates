/**
 * Ensures Pages middleware `SNAPSHOT_KV_VERSION` matches API `SNAPSHOT_PAYLOAD_VERSION`,
 * otherwise HTML inline KV keys drift from Worker snapshot writes (Codex PR #226 P1).
 */
'use strict'

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const CACHE_FILE = path.join(ROOT, 'workers', 'api', 'src', 'db', 'snapshot-cache.ts')
const MIDDLEWARE_FILES = [
  path.join(ROOT, 'site', 'functions', '_middleware.js'),
  path.join(ROOT, 'functions', '_middleware.js'),
]

function readPayloadVersion() {
  const text = fs.readFileSync(CACHE_FILE, 'utf8')
  const m = text.match(/const\s+SNAPSHOT_PAYLOAD_VERSION\s*=\s*(\d+)/)
  if (!m) {
    throw new Error(`Could not parse SNAPSHOT_PAYLOAD_VERSION in ${CACHE_FILE}`)
  }
  return Number(m[1])
}

function readKvVersion(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const m = text.match(/const\s+SNAPSHOT_KV_VERSION\s*=\s*(\d+)/)
  if (!m) {
    throw new Error(`Could not parse SNAPSHOT_KV_VERSION in ${filePath}`)
  }
  return Number(m[1])
}

const payload = readPayloadVersion()
const errors = []

for (const mw of MIDDLEWARE_FILES) {
  const kv = readKvVersion(mw)
  if (kv !== payload) {
    errors.push(
      `${path.relative(ROOT, mw)}: SNAPSHOT_KV_VERSION=${kv} but SNAPSHOT_PAYLOAD_VERSION=${payload} in workers/api/src/db/snapshot-cache.ts — bump together.`,
    )
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(
  `OK: snapshot KV version ${payload} synced across middleware (${MIDDLEWARE_FILES.map((f) => path.relative(ROOT, f)).join(', ')}).`,
)
