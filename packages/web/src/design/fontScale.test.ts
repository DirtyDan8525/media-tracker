import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every font size must follow Appearance > Text size (--app-scale), either via a --fs-* token or calc(Npx * var(--app-scale)).
// Documented exceptions: sizes that must stay fixed in px.
const EXCEPTIONS: Record<string, string> = {
  'auth.css': 'sign-in inputs stay 16px so iOS does not zoom the page on focus',
  'account.css': 'password inputs stay 16px so iOS does not zoom the page on focus',
  'admin.css': 'admin form inputs stay 16px so iOS does not zoom the page on focus',
  'textsize.css': 'the "Aa" button glyph is a fixed-size control icon',
};

describe('text size reaches every stylesheet', () => {
  const files = readdirSync('src/design').filter((f) => f.endsWith('.css'));
  it('has no unscaled font-size in px', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (EXCEPTIONS[f]) continue;
      readFileSync(`src/design/${f}`, 'utf8').split('\n').forEach((line, i) => {
        if (/font-size:\s*[0-9.]+px/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
  it('keeps the exception list honest', () => {
    for (const f of Object.keys(EXCEPTIONS)) expect(files).toContain(f);
  });
});
