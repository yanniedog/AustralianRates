import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const explicitFiles = process.argv.slice(2).filter(Boolean)

function listIntegrationTests(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      found.push(...listIntegrationTests(full))
    } else if (/\.test\.ts$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

const files = explicitFiles.length
  ? explicitFiles
  : listIntegrationTests(join(root, 'test', 'integration'))
    .map((file) => relative(root, file).split(sep).join('/'))
    .sort()

const vitestBin = join(root, '..', '..', 'node_modules', 'vitest', 'vitest.mjs')
for (const file of files) {
  console.log(`[test:integration] ${file}`)
  const result = spawnSync(process.execPath, [vitestBin, 'run', '--config', 'vitest.integration.config.mts', file], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
