import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Output: `site/admin/prototypes/lightweight-charts/`.
 * Run via root `npm run build` so `build:site-version` runs after this step and
 * rewrites `?v=` on local .js/.css in every HTML using a 10-char SHA-256 prefix
 * of each file’s bytes (see tools/node-scripts/src/write-deploy-version.ts).
 * Rollup also emits content-derived filenames; do not embed git HEAD in the bundle
 * or every commit would churn hashes without source changes.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, '../../site/admin/prototypes/lightweight-charts'),
    emptyOutDir: true,
    target: 'es2022',
  },
})
