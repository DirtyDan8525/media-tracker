import { readFileSync } from 'node:fs';
import { THEMES } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { contrast } from '../src/design/theme';

// Contrast rules the v2 refresh lives by, read from the stylesheets (jsdom does no layout or
// compositing, so these check the declared roles and the backdrop's worst case by arithmetic).
const read = (f: string) => readFileSync(new URL(`../src/design/${f}`, import.meta.url), 'utf8');
const tokens = read('tokens.css');
const css = (read('components.css') + '\n' + read('lists.css')).replace(/\/\*[\s\S]*?\*\//g, '');

function decls(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').map((s) => s.trim()).includes(selector)) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}
const tokenNum = (name: string) => Number(new RegExp(`${name}:\\s*([\\d.]+)`).exec(tokens)![1]);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
/** `top` at `alpha` over `under` (sRGB, as browsers composite). */
const over = (top: string, alpha: number, under: string) => toHex(rgb(top).map((t, i) => t * alpha + rgb(under)[i]! * (1 - alpha)));

const NAMES = Object.keys(THEMES);

describe('v2 contrast', () => {
  it('the PC Sort chip text is Text (Highlight on Panels fails 4.5:1 on light themes)', () => {
    expect(decls('.frame--wide .select-chip').color).toBe('var(--text)');
  });

  it.each(NAMES)('%s: an unchecked checkbox border is >= 3:1 on Background (WCAG 1.4.11)', (name) => {
    const border = decls('.switch-row input').border ?? '';
    const role = /var\(--([\w-]+)\)/.exec(border)?.[1];
    expect(role).toBe('muted-text');
    const t = THEMES[name]!;
    expect(contrast(t['Muted text']!, t.Background!)).toBeGreaterThanOrEqual(3);
  });

  it('the backdrop is hidden where color-mix() (its scrim) is unsupported', () => {
    expect(css).toMatch(/@supports not \(background: color-mix\(in srgb, red, blue\)\)\s*\{\s*\.backdrop\s*\{\s*display:\s*none;?\s*\}/);
  });

  // Worst case under the scrim's lightest stop: a flat pure-white or pure-black cover (blur and
  // saturate can't go past these) at the backdrop opacity, on Background, under N% Background.
  const scrimTop = Number(/color-mix\(in srgb, var\(--bg\) (\d+)%, transparent\) 0%/.exec(read('components.css'))![1]) / 100;
  it.each(NAMES)('%s: Text and Bright text stay >= 4.5:1 over the backdrop with a white or black cover', (name) => {
    const t = THEMES[name]!;
    for (const opacity of [tokenNum('--backdrop-opacity'), tokenNum('--backdrop-opacity-wide')]) {
      for (const cover of ['#ffffff', '#000000']) {
        const img = over(cover, opacity, t.Background!);
        const shown = over(t.Background!, scrimTop, img);
        for (const role of ['Text', 'Bright text']) {
          expect(contrast(t[role]!, shown), `${name} ${role} on ${cover} @ ${opacity}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
