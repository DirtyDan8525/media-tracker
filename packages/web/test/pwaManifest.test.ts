import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Behind Cloudflare Access the manifest must be fetched with credentials, otherwise Access
// answers with its login redirect and Chrome reports "This app cannot be installed".
describe('built PWA manifest', () => {
  let outDir: string;
  let html: string;
  let manifest: Record<string, unknown> & { icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> };

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'mt-pwa-'));
    await build({ configFile: join(__dirname, '../vite.config.ts'), root: join(__dirname, '..'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    html = readFileSync(join(outDir, 'index.html'), 'utf8');
    manifest = JSON.parse(readFileSync(join(outDir, 'manifest.webmanifest'), 'utf8'));
  }, 180_000);

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it('links the manifest with crossorigin="use-credentials"', () => {
    const link = html.match(/<link[^>]*rel="manifest"[^>]*>/)?.[0] ?? '';
    expect(link).toContain('crossorigin="use-credentials"');
  });

  it('is installable: same-origin paths, standalone, 192/512/maskable icons', () => {
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    for (const i of manifest.icons) expect(i.src.startsWith('/')).toBe(true);
    const has = (sizes: string, purpose?: string) =>
      manifest.icons.some((i) => i.sizes === sizes && i.type === 'image/png' && (purpose ? i.purpose === purpose : true));
    expect(has('192x192')).toBe(true);
    expect(has('512x512')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });
});
