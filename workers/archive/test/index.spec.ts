import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('australianrates-archive worker', () => {
	it('returns 404 for unknown path (unit style)', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('returns 404 for unknown path (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/');
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('returns default-disabled contract for /api/debug/version when debug flag is false', async () => {
		const request = new IncomingRequest('https://example.com/api/debug/version');
		const testEnv = {
			...(env as unknown as Record<string, unknown>),
			FEATURE_ARCHIVE_DEBUG_ENABLED: 'false',
		} as Parameters<typeof worker.fetch>[1];
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toContain('no-store');
		const data = (await response.json()) as {
			ok: boolean;
			error?: { code?: string; message?: string };
		};
		expect(data.ok).toBe(false);
		expect(data.error?.code).toBe('ARCHIVE_DEBUG_DISABLED');
		expect(typeof data.error?.message).toBe('string');
	});

	it('requires operator auth for /api/debug/version when debug flag is true', async () => {
		const request = new IncomingRequest('https://example.com/api/debug/version');
		const testEnv = {
			...(env as unknown as Record<string, unknown>),
			FEATURE_ARCHIVE_DEBUG_ENABLED: 'true',
			ARCHIVE_OPERATOR_TOKEN: 'test-token',
		} as Parameters<typeof worker.fetch>[1];
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toContain('no-store');
		const data = (await response.json()) as {
			ok: boolean;
			error?: { code?: string; message?: string };
		};
		expect(data.ok).toBe(false);
		expect(data.error?.code).toBe('ARCHIVE_UNAUTHORIZED');
	});

	it('returns JSON with ok and version for /api/debug/version when debug flag is true and auth matches', async () => {
		const request = new IncomingRequest('https://example.com/api/debug/version', {
			headers: {
				authorization: 'Bearer test-token',
			},
		});
		const testEnv = {
			...(env as unknown as Record<string, unknown>),
			FEATURE_ARCHIVE_DEBUG_ENABLED: 'true',
			ARCHIVE_OPERATOR_TOKEN: 'test-token',
		} as Parameters<typeof worker.fetch>[1];
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const data = (await response.json()) as { ok: boolean; version?: string; hasBindings?: object };
		expect(data.ok).toBe(true);
		expect(typeof data.version).toBe('string');
		expect(data.hasBindings).toBeDefined();
	});

	it('returns default-disabled contract for /api/queue-test/result when queue-test flag is false', async () => {
		const request = new IncomingRequest('https://example.com/api/queue-test/result');
		const testEnv = {
			...(env as unknown as Record<string, unknown>),
			FEATURE_ARCHIVE_QUEUE_TEST_ENABLED: 'false',
		} as Parameters<typeof worker.fetch>[1];
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toContain('no-store');
		const data = (await response.json()) as {
			ok: boolean;
			error?: { code?: string; message?: string };
		};
		expect(data.ok).toBe(false);
		expect(data.error?.code).toBe('ARCHIVE_QUEUE_TEST_DISABLED');
	});

	it('requires operator auth for /api/admin/lenders when admin flag is true', async () => {
		const request = new IncomingRequest('https://example.com/api/admin/lenders');
		const testEnv = {
			...(env as unknown as Record<string, unknown>),
			FEATURE_ARCHIVE_ADMIN_ENABLED: 'true',
			ARCHIVE_OPERATOR_TOKEN: 'test-token',
		} as Parameters<typeof worker.fetch>[1];
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		const data = (await response.json()) as {
			ok: boolean;
			error?: { code?: string; message?: string };
		};
		expect(data.ok).toBe(false);
		expect(data.error?.code).toBe('ARCHIVE_UNAUTHORIZED');
	});
});
