import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        // Configured here rather than via wrangler.toml so tests don't need
        // ../web/dist (the [assets] directory) or a real D1 database id.
        miniflare: {
          compatibilityDate: '2026-11-10',
          d1Databases: ['DB'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'dev',
            ADMIN_EMAIL: '',
            // Opt-in perf tests (PERF=1): the strict CPU budgets, run alone on a quiet machine.
            PERF: process.env.PERF ?? '',
          },
          serviceBindings: {
            ASSETS: () => new Response('asset-stub', { status: 200 }),
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
