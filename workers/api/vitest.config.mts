import { defineConfig } from 'vitest/config'

/**
 * Default config for unit tests only. Integration tests (which use cloudflare:test
 * and the workers pool) are in test/integration/ and must be run with:
 *   vitest run --config vitest.integration.config.mts
 * This config ensures the unit run never loads integration files, avoiding
 * ERR_MODULE_NOT_FOUND for 'cloudflare:test' in environments that don't use
 * the workers pool.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', '**/node_modules/**'],
  },
})
