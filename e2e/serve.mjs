// Starts the Worker for the e2e tests on the given port with a brand-new local database.
// Test-only settings go on the command line (never a file), so nothing here can reach production.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.argv[2];
if (!/^\d+$/.test(port ?? '')) throw new Error('usage: node e2e/serve.mjs <port>');

const worker = resolve(fileURLToPath(new URL('..', import.meta.url)), 'packages/worker');
const state = resolve(worker, `.wrangler/e2e-state-${port}`);
const wrangler = (args, opts = {}) =>
  [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], { cwd: worker, stdio: 'inherit', ...opts }];

rmSync(state, { recursive: true, force: true });
const [cmd, args, opts] = wrangler(['d1', 'migrations', 'apply', 'media-tracker', '--local', '--persist-to', state]);
const migrated = spawnSync(cmd, args, opts);
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const [c2, a2, o2] = wrangler([
  'dev', '--port', port, '--ip', '127.0.0.1', '--persist-to', state,
  '--var', 'ENVIRONMENT:dev', '--var', 'DEV_EMAIL:e2e@example.com', '--var', 'LOOKUP_FAKE:1',
]);
const child = spawn(c2, a2, o2);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(sig); });
child.on('exit', (code) => process.exit(code ?? 0));
