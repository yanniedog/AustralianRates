import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/integration/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 25_000,
    teardownTimeout: 12_000,
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
          environment: 'test',
        },
      },
    },
  },
})
