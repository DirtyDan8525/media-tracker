import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Radio chips draw their focus ring for keyboard focus only (:focus-visible on the hidden input),
// not on every tap or click (:focus-within). Browsers without :has() fall back to :focus-within.
const read = (f: string) => readFileSync(new URL(`../src/design/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = ['search.css', 'activity.css'].map(read).join('\n');

/** The CSS with every `@supports not selector(:has(...)) { ... }` block removed (one level of nesting). */
const outsideHasFallback = css.replace(/@supports not selector\(:has\([^)]*\)\)\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');

describe('chip focus rings', () => {
  it.each(['seg', 'activity-filter'])('.%s__opt shows its ring on :focus-visible of its input', (block) => {
    expect(css).toContain(`.${block}__opt:has(.${block}__input:focus-visible)`);
    expect(outsideHasFallback, `.${block}__opt:focus-within only inside the :has() fallback`).not.toContain(`.${block}__opt:focus-within`);
  });
});
