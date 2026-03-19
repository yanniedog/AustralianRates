import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig(async () => {
  const d1Migrations = await readD1Migrations('./migrations')

  return {
    test: {
      include: ['test/integration/**/*.test.ts'],
      setupFiles: ['./test/integration/setup.ts'],
      provide: {
        d1Migrations,
      },
      poolOptions: {
        workers: {
          wrangler: {
            configPath: './wrangler.toml',
            environment: 'test',
          },
        },
      },
    },
  }
})
