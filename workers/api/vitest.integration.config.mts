import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/integration/setup.ts'],
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
