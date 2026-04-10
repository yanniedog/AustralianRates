import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		testTimeout: 15_000,
		hookTimeout: 12_000,
		teardownTimeout: 8_000,
		fileParallelism: true,
		maxWorkers: 4,
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
