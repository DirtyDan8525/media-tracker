import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/design/wide.css', 'utf8');
/** The text of every @media block that starts with `query`, joined. */
function block(query: string): string {
  let out = '';
  for (let start = css.indexOf(`@media (${query})`); start > -1; start = css.indexOf(`@media (${query})`, start + 1)) {
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) { out += css.slice(start, i); break; }
    }
  }
  expect(out).not.toBe('');
  return out;
}
const minHeight = (b: string) => b.match(/profile__banner[^{]*\{[^}]*min-height:\s*(?:clamp\()?(\d+)px/)?.[1];

describe('Profile on PC (item 23): CSS', () => {
  it('banner is 280px+ from 1024px and taller from 1440px', () => {
    expect(Number(minHeight(block('min-width: 1024px')))).toBeGreaterThanOrEqual(280);
    expect(Number(minHeight(block('min-width: 1440px')))).toBeGreaterThanOrEqual(280);
    expect(css).toMatch(/clamp\(320px, 24vw, 360px\)/);
  });
  it('the photo overlaps the banner bottom edge by half its 128px height', () => {
    const b = block('min-width: 1024px');
    expect(b).toMatch(/\.profile__id \{[^}]*margin-top: -64px/);
    expect(b).toMatch(/grid-template-columns: 128px/);
  });
  it('phone rules are untouched: the banner height is only set inside the wide media queries', () => {
    expect(css.slice(0, css.indexOf('@media'))).not.toMatch(/profile__banner/);
  });
});
