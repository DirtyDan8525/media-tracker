import { readFileSync } from 'node:fs';
import { THEMES } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { barTextColor, contrast } from '../src/design/theme';

// Contrast rules the v2 refresh lives by, read from the stylesheets (jsdom does no layout or
// compositing, so these check the declared roles and the backdrop's worst case by arithmetic).
const read = (f: string) => readFileSync(new URL(`../src/design/${f}`, import.meta.url), 'utf8');
const tokens = read('tokens.css');
const css = (['components.css', 'lists.css', 'search.css', 'activity.css', 'nav.css'].map(read).join('\n')).replace(/\/\*[\s\S]*?\*\//g, '');

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

  // Selected segment / filter chips sit on Panels: whatever colour role their text uses must read there on every theme.
  const ROLE_OF_VAR: Record<string, string> = { text: 'Text', 'bright-text': 'Bright text', 'muted-text': 'Muted text', highlight: 'Highlight' };
  it.each(NAMES.flatMap((n) => ['.seg__opt--on', '.activity-filter__opt--on'].map((sel) => [n, sel] as const)))(
    '%s: %s text is >= 4.5:1 on Panels', (name, selector) => {
      const color = decls(selector).color ?? '';
      const role = ROLE_OF_VAR[/var\(--([\w-]+)\)/.exec(color)?.[1] ?? ''];
      expect(role, `${selector} color is ${color}`).toBeDefined();
      const t = THEMES[name]!;
      expect(contrast(t[role!]!, t.Panels!), `${name} ${role} on Panels`).toBeGreaterThanOrEqual(4.5);
    });

  // The initial in an Activity line's avatar circle (Task 5 review).
  it.each(NAMES)('%s: the Activity avatar initial is >= 4.5:1 on its circle', (name) => {
    const d = decls('.activity-line__avatar');
    const ROLE: Record<string, string> = { ...ROLE_OF_VAR, panel: 'Panels', card: 'Cards', bg: 'Background' };
    const fg = ROLE[/var\(--([\w-]+)\)/.exec(d.color ?? '')?.[1] ?? ''];
    const bg = ROLE[/var\(--([\w-]+)\)/.exec(d.background ?? '')?.[1] ?? ''];
    expect(fg, `color is ${d.color}`).toBeTruthy();
    expect(bg, `background is ${d.background}`).toBeTruthy();
    const t = THEMES[name]!;
    expect(contrast(t[fg!]!, t[bg!]!), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
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

  // Profile (B12): the banner holds Text / Bright text only, on its scrim over a cover, or on Header row with no cover.
  describe('profile banner', () => {
    const ROLE: Record<string, string> = { text: 'Text', 'bright-text': 'Bright text' };
    const roleOf = (value: string | undefined) => ROLE[/var\(--([\w-]+)\)/.exec(value ?? '')?.[1] ?? ''];
    const scrim = decls('.page-header.has-backdrop.profile__banner .backdrop::after').background ?? '';
    const top = Number(/color-mix\(in srgb, var\(--bg\) (\d+)%, transparent\)\s*0%/.exec(scrim)?.[1]) / 100;

    it('the scrim is declared (a lighter one would let a bright cover through)', () => {
      expect(top, `scrim is ${scrim}`).toBeGreaterThanOrEqual(0.5);
    });

    it('the banner text uses Text or Bright text only', () => {
      for (const sel of ['.profile__banner .page-title', '.profile__banner .page-sub']) {
        expect(roleOf(decls(sel).color), `${sel} color is ${decls(sel).color}`).toBeDefined();
      }
    });

    it.each(NAMES)('%s: Text and Bright text stay >= 4.5:1 on the banner (white or black cover under the scrim, or Header row)', (name) => {
      const t = THEMES[name]!;
      for (const opacity of [tokenNum('--backdrop-opacity'), tokenNum('--backdrop-opacity-wide')]) {
        for (const cover of ['#ffffff', '#000000']) {
          const shown = over(t.Background!, top, over(cover, opacity, t.Background!));
          for (const role of ['Text', 'Bright text']) {
            expect(contrast(t[role]!, shown), `${name} ${role} on ${cover} @ ${opacity}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
      expect(decls('.profile__banner').background).toBe('var(--header-row)');
      for (const role of ['Text', 'Bright text']) {
        expect(contrast(t[role]!, t['Header row']!), `${name} ${role} on Header row`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it.each(NAMES)('%s: the initial on an empty avatar reads on Highlight', (name) => {
      expect(decls('.avatar').color).toBe('var(--on-highlight)');
      expect(decls('.avatar').background).toBe('var(--highlight)');
      expect(name).toBeTruthy(); // the --on-highlight pairing is asserted for every theme in theme.test.ts
    });
  });

  // B5: the Lists menu is Cards at --see-through alpha over whatever is behind it (blurred). Its
  // text must read over the worst cases: a pure white or pure black page under it.
  describe('see-through Lists menu', () => {
    const alpha = tokenNum('--see-through');
    it('--see-through is 0.9 and the menu uses it on Cards, opaque Cards without color-mix()', () => {
      expect(alpha).toBe(0.9);
      expect(css).toMatch(/\.lists-menu\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--card\) calc\(var\(--see-through\) \* 100%\), transparent\)/);
      expect(css).toMatch(/\.lists-menu\s*\{[^}]*background:\s*var\(--card\)/);
      expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)\s*\{\s*\.lists-menu\s*\{[^}]*background:\s*var\(--card\)/);
    });

    // Muted text cannot reach 4.5:1 here: over a black page at 0.9 it reads 3.6-4.0:1 on the five
    // light themes (it is close to the limit on opaque Cards already). So the menu uses no Muted text.
    it('menu rows use Text and Bright text (current) only; the counts are Text, not Muted text', () => {
      expect(decls('.lists-menu__item').color).toBe('var(--text)');
      expect(decls('.lists-menu__item[aria-current="page"]').color).toBe('var(--bright-text)');
      expect(decls('.lists-menu__count').color).toBe('var(--text)');
      const menuCss = css.match(/\.lists-menu[\w-]*[^{]*\{[^}]*\}/g)!.join('\n');
      expect(menuCss).not.toMatch(/color:\s*var\(--muted-text\)/);
    });

    it.each(NAMES)('%s: Text and Bright text on Cards at --see-through over #ffffff and #000000 are >= 4.5:1', (name) => {
      const t = THEMES[name]!;
      for (const under of ['#ffffff', '#000000']) {
        const shown = over(t.Cards!, alpha, under);
        for (const role of ['Text', 'Bright text']) {
          expect(contrast(t[role]!, shown), `${name} ${role} over ${under}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });

  // The current list's check icon (Highlight on the see-through menu) is non-text: >= 3:1 (WCAG 1.4.11).
  describe('Lists menu check icon', () => {
    const alpha = tokenNum('--see-through');
    const ROLE: Record<string, string> = { text: 'Text', 'bright-text': 'Bright text', highlight: 'Highlight' };
    it.each(NAMES)('%s: the check icon is >= 3:1 on Cards at --see-through over #ffffff and #000000, and on opaque Cards', (name) => {
      const role = ROLE[/var\(--([\w-]+)\)/.exec(decls('.lists-menu__check').color ?? '')?.[1] ?? ''];
      expect(role, 'check colour is a theme role').toBeDefined();
      const t = THEMES[name]!;
      for (const under of [t.Cards!, over(t.Cards!, alpha, '#ffffff'), over(t.Cards!, alpha, '#000000')]) {
        expect(contrast(t[role!]!, under), `${name} ${role} on ${under}`).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // B22: the themed bar is Header row; its title and icon use barTextColor (CSS: --bar-text).
  describe('themed list bar', () => {
    it('the bar is Header row and its title and icon use --bar-text', () => {
      expect(decls('.page-header--bar').background).toBe('var(--header-row)');
      expect(decls('.page-header--bar .page-title').color).toBe('var(--bar-text)');
      expect(decls('.page-header__icon').color).toBe('var(--bar-text)');
    });

    it.each(NAMES)('%s: barTextColor on Header row is >= 4.5:1', (name) => {
      const t = THEMES[name]!;
      const c = barTextColor(t);
      expect([t.Text, t['Bright text']]).toContain(c);
      expect(contrast(c, t['Header row']!), `${name} ${c} on Header row`).toBeGreaterThanOrEqual(4.5);
    });
  });
});
