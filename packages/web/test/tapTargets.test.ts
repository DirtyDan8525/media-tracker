import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Spec section 6: every tap target is at least 44 px. jsdom does no layout, so this reads the
// stylesheets: a control's effective hit height is its height / min-height / line-height plus
// whatever its ::after hit area adds (inset: -Npx 0 adds N above and N below).
const css = ['components.css', 'lists.css', 'search.css', 'activity.css', 'feed.css', 'nav.css', 'list-menu.css'].map((f) => readFileSync(new URL(`../src/design/${f}`, import.meta.url), 'utf8')).join('\n');
const tokens = readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
const TAP = Number(/--tap:\s*(\d+)px/.exec(tokens)![1]);
/** A px size token from tokens.css (e.g. --tap, --btn-h), or null. */
const token = (name: string): number | null => {
  const m = new RegExp(`${name}:\\s*(\\d+)px`).exec(tokens);
  return m ? Number(m[1]) : null;
};

function rules(selector: string): string[] {
  const out: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out;
}

const px = (v: string): number | null => {
  const t = v.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(t);
  if (ref) return token(ref[1]!);
  return /^(\d+)px$/.test(t) ? Number(t.slice(0, -2)) : null;
};

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
    ['.tier-btn', 'min-height'],
    ['.select-chip', 'height'],
    ['.frame--wide .select-chip', 'height'],
    ['.cell-btn', 'min-height'],
    ['.input--cell', 'height'],
    ['.season-row .input', 'height'],
    ['.input', 'height'],
    ['a.entry-card__title', 'line-height'],
    ['.seg__opt', 'min-height'],
    ['.search__input', 'height'],
    ['.activity-filter__opt', 'min-height'],
    ['.group__row', 'min-height'],
    ['.profile__strip-link', 'min-height'],
    ['.crop__slider', 'height'],
    ['.crop__viewport', 'height'],
    ['.bottom-tabs__item', 'min-height'],
    ['.bottom-tabs__search', 'min-height'],
    ['.add-fab', 'height'],
    ['.list-menu__trigger', 'min-height'],
    ['.list-menu__item', 'min-height'],
    ['.profile-btn', 'height'],
    ['.feed-post__select', 'min-height'],
  ] as const)('%s', (selector, prop) => {
    const props = prop === 'height' ? ['height', 'min-height'] : [prop];
    const size = hit(selector, props);
    if (selector === '.frame--wide .select-chip') {
      // the wide variant may override the height (and its own ::after); otherwise it keeps the chip's
      expect((declared(selector, ['height']) ?? declared('.select-chip', ['height']))! + afterExtent(selector)).toBeGreaterThanOrEqual(TAP);
    } else {
      expect(size, `${selector} is ${size}px`).toBeGreaterThanOrEqual(TAP);
    }
  });

  // A link stretched over its row: its ::after fills the nearest positioned ancestor (the row), so
  // the hit area is the row's height, as long as the link itself is not positioned.
  it.each([
    ['a.activity-line__title', '.activity-line'],
  ] as const)('%s is stretched over %s', (link, row) => {
    const after = rules(`${link}::after`).join(';');
    expect(after, `${link}::after`).toMatch(/content:\s*['"]{2}/);
    expect(after).toMatch(/position:\s*absolute/);
    expect(after).toMatch(/inset:\s*0(;|$|\s)/);
    expect(rules(link).join(';'), `${link} must not be positioned`).not.toMatch(/position:\s*(relative|absolute)/);
    expect(rules(row).join(';'), `${row} needs position: relative`).toMatch(/position:\s*relative/);
    const size = declared(row, ['height', 'min-height']) ?? 0;
    expect(size, `${row} is ${size}px`).toBeGreaterThanOrEqual(TAP);
  });

  it.each(['.add-fab', '.profile-btn'])('%s is also at least 44 px wide', (selector) => {
    expect(declared(selector, ['width', 'min-width']) ?? 0).toBeGreaterThanOrEqual(TAP);
  });

  it('the cell button is also at least 44 px wide, and hit areas sit on positioned controls', () => {
    expect(declared('.cell-btn', ['min-width'])).toBe(TAP);
    // v2: chips and compact buttons are 44 px themselves; any control that still pads with ::after must be positioned
    for (const s of ['.cell-btn', '.select-chip', '.btn--chip', '.btn--compact']) {
      if (afterExtent(s) === 0) continue;
      expect(rules(s).join(';'), `${s} needs position: relative for its ::after`).toMatch(/position:\s*relative/);
    }
    expect(afterExtent('.cell-btn')).toBeGreaterThan(0);
  });
});

// Task 7 review: in iPhone landscape the notch / curved corners sit at the sides, so the phone's
// fixed nav pieces keep clear of them with the left/right safe-area insets.
describe('phone nav keeps clear of the side safe areas', () => {
  const body = (sel: string) => rules(sel).join(';');
  it('.add-fab adds env(safe-area-inset-right) to right', () => {
    for (const sel of ['.add-fab']) {
      expect(body(sel), sel).toMatch(/(?:^|;)\s*right:\s*calc\([^;]*env\(safe-area-inset-right\)/);
    }
  });
  it('.bottom-tabs pads by env(safe-area-inset-left) and env(safe-area-inset-right)', () => {
    expect(body('.bottom-tabs')).toMatch(/padding-left:\s*env\(safe-area-inset-left\)/);
    expect(body('.bottom-tabs')).toMatch(/padding-right:\s*env\(safe-area-inset-right\)/);
  });
});

// Task 7 review: toasts clear the 56 px Add bubble only while it shows (AddBubble puts
// .has-add-fab on <html>); otherwise they sit just above the bottom bar.
it('the toast region lifts above the Add bubble only under .has-add-fab', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const base = /(?:^|\})\s*\.toast-region\s*\{([^}]*)\}/.exec(plain)![1]!;
  expect(base).not.toMatch(/56px/);
  expect(plain).toMatch(/\.has-add-fab \.toast-region\s*\{[^}]*bottom:[^;}]*56px/);
});
