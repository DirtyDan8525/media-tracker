import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke test: the built web app served by `wrangler dev` (local D1, ENVIRONMENT=dev,
// canned lookups). Each device project gets its own server and a fresh database, because the
// dev sign-in is one fixed user per server. Uses the system Chrome (no browser download).
const SERVERS = [
  { project: 'Pixel 7', port: 8788, device: devices['Pixel 7'] },
  { project: 'Desktop Chrome', port: 8789, device: devices['Desktop Chrome'] },
];

// Build the web app once. Test workers load this file too; the env flag stops them rebuilding.
if (!process.env.E2E_BUILT) {
  if (!process.env.E2E_SKIP_BUILD) {
    execFileSync('npm', ['run', 'build', '-w', 'packages/web'], { stdio: 'inherit', shell: process.platform === 'win32' });
  }
  process.env.E2E_BUILT = '1';
}

export default defineConfig({
  testDir: 'packages/web/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  projects: SERVERS.map(({ project, port, device }) => ({
    name: project,
    use: { ...device, channel: 'chrome', baseURL: `http://127.0.0.1:${port}`, serviceWorkers: 'block' },
  })),
  webServer: SERVERS.map(({ port }) => ({
    command: `node e2e/serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore' as const,
    stderr: 'pipe' as const,
  })),
});
