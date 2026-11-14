import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Spec section 6: every tap target is at least 44 px. jsdom does no layout, so this reads the
// stylesheets: a control's effective hit height is its height / min-height / line-height plus
// whatever its ::after hit area adds (inset: -Npx 0 adds N above and N below).
const css = ['components.css', 'lists.css'].map((f) => readFileSync(new URL(`../src/design/${f}`, import.meta.url), 'utf8')).join('\n');
const TAP = Number(/--tap:\s*(\d+)px/.exec(readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8'))![1]);

function rules(selector: string): string[] {
  const out: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out;
}

const px = (v: string): number | null => (v.trim() === 'var(--tap)' ? TAP : /^(\d+)px$/.test(v.trim()) ? Number(v.trim().slice(0, -2)) : null);

/** The last declared value of `prop` across the rules for `selector` (later rules win). */
function declared(selector: string, props: string[]): number | null {
  let value: number | null = null;
  for (const body of rules(selector)) {
    for (const d of body.split(';')) {
      const [name, ...rest] = d.split(':');
      if (name && props.includes(name.trim())) value = px(rest.join(':')) ?? value;
    }
  }
  return value;
}

/** Vertical extension from `selector::after { inset: -Npx 0 }` (0 when there is none). */
function afterExtent(selector: string): number {
  const body = rules(`${selector}::after`).join(';');
  const m = /inset:\s*-(\d+)px/.exec(body);
  return m ? Number(m[1]) * 2 : 0;
}

const hit = (selector: string, props = ['height', 'min-height']) => (declared(selector, props) ?? 0) + afterExtent(selector);

describe('tap targets are at least 44 px (spec section 6)', () => {
  it.each([
    ['.btn', 'min-height'],
    ['.icon-btn', 'height'],
    ['.link-btn', 'min-height'],
    ['.btn--compact', 'min-height'],
    ['.btn--chip', 'min-height'],
    ['.select-chip', 'height'],
    ['.frame--wide .select-chip', 'height'],
    ['.cell-btn', 'min-height'],
    ['.input--cell', 'height'],
    ['.season-row .input', 'height'],
    ['.input', 'height'],
    ['a.entry-card__title', 'line-height'],
  ] as const)('%s', (selector, prop) => {
    const props = prop === 'height' ? ['height', 'min-height'] : [prop];
    const size = hit(selector, props);
    if (selector === '.frame--wide .select-chip') {
      // the wide variant overrides the height and its own ::after
      expect(declared(selector, ['height'])! + afterExtent(selector)).toBeGreaterThanOrEqual(TAP);
    } else {
      expect(size, `${selector} is ${size}px`).toBeGreaterThanOrEqual(TAP);
    }
  });

  it('the cell button is also at least 44 px wide, and hit areas sit on positioned controls', () => {
    expect(declared('.cell-btn', ['min-width'])).toBe(TAP);
    for (const s of ['.cell-btn', '.select-chip', '.btn--chip', '.btn--compact']) {
      expect(rules(s).join(';'), `${s} needs position: relative for its ::after`).toMatch(/position:\s*relative/);
    }
  });
});
