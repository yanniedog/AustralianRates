import path from 'node:path'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Proto UI build stamp (commit/branch). HTML uses per-file content hashes from write-deploy-version. */
function sanitizeVersionToken(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function gitHead(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function protoBuildStamp(): string {
  const commit = process.env.CF_PAGES_COMMIT_SHA || gitHead()
  const short = commit ? sanitizeVersionToken(commit.slice(0, 7)) : ''
  return short || sanitizeVersionToken(process.env.CF_PAGES_BRANCH || '') || 'dev'
}

const buildStamp = protoBuildStamp()

function arProtoBuildStampCssPlugin() {
  const virtualId = '\0ar-proto-build-stamp.css'
  return {
    name: 'ar-proto-build-stamp-css',
    resolveId(id: string) {
      if (id === 'virtual:ar-proto-build-stamp.css') return virtualId
    },
    load(id: string) {
      if (id === virtualId) {
        return `:root{--ar-lw-proto-build:${buildStamp}}`
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), arProtoBuildStampCssPlugin()],
  base: './',
  define: {
    'import.meta.env.VITE_PROTO_BUILD_STAMP': JSON.stringify(buildStamp),
  },
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, '../../site/admin/prototypes/lightweight-charts'),
    emptyOutDir: true,
    target: 'es2022',
  },
})
