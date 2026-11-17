import { describe, expect, test } from 'vitest';
import {
  closePairs, closeQuestionsFor, countClosePairs, hundredths, isClose, numberFirst,
  type CloseItem, type Comparison, type NfItem,
} from '../src/ratings';
import { rng } from './helpers/prng';

let n = 0;
const pick = (w: string, l: string, isTie = false, undone = false): Comparison =>
  ({ id: `c${n++}`, winnerId: w, loserId: l, isTie, createdAt: '2026-11-16T00:00:00.000Z', undoneAt: undone ? '2026-11-16T00:00:01.000Z' : null });
const it = (id: string, typed: number | null): NfItem => ({ id, typed });
const shown = (items: NfItem[], comps: Comparison[]) => {
  const r = numberFirst(items, comps);
  return Object.fromEntries([...r].map(([id, v]) => [id, v.rating]));
};

describe('isClose', () => {
  test('within 0.3 inclusive, in whole hundredths (no float noise)', () => {
    expect(isClose(8.0, 8.3)).toBe(true);
    expect(isClose(8.3, 8.0)).toBe(true);
    expect(isClose(8.0, 8.31)).toBe(false);
    expect(isClose(9.7, 10)).toBe(true);
    expect(isClose(0.1, 0.4)).toBe(true);
    expect(hundredths(8.25)).toBe(825);
  });
});

describe('numberFirst', () => {
  test('no picks: every title shows exactly its typed number (imported scores unchanged)', () => {
    const items = [it('a', 9.97), it('b', 8.25), it('c', 10), it('d', 0), it('e', 7.333), it('u', null)];
    const r = numberFirst(items, []);
    expect(r.get('a')!.rating).toBe(9.97);
    expect(r.get('b')!.rating).toBe(8.25);
    expect(r.get('c')!.rating).toBe(10);
    expect(r.get('d')!.rating).toBe(0);
    expect(r.get('e')!.rating).toBe(7.333);
    expect(r.has('u')).toBe(false);
    for (const v of r.values()) expect(v.moved).toBe(false);
  });

  test('one pick between two 9.6s gives 9.62 and 9.58 (wireframe)', () => {
    expect(shown([it('inv', 9.6), it('arc', 9.6)], [pick('inv', 'arc')])).toEqual({ inv: 9.62, arc: 9.58 });
    expect(shown([it('inv', 9.6), it('arc', 9.6)], [pick('arc', 'inv')])).toEqual({ inv: 9.58, arc: 9.62 });
  });

  test('a pick reverses a 0.3 gap and shows one decimal when that is enough', () => {
    // 8.0 beat 8.3: they meet in the middle, 8.17 / 8.13 → 8.2 / 8.1 (both within 0.2 of typed).
    expect(shown([it('a', 8.0), it('b', 8.3)], [pick('a', 'b')])).toEqual({ a: 8.2, b: 8.1 });
  });

  test('a pick that agrees with the numbers changes nothing', () => {
    const r = numberFirst([it('a', 8.3), it('b', 8.0)], [pick('a', 'b')]);
    expect(r.get('a')!.rating).toBe(8.3);
    expect(r.get('b')!.rating).toBe(8.0);
  });

  test('"About the same" between equal numbers keeps them tied and unchanged', () => {
    expect(shown([it('a', 9.0), it('b', 9.0)], [pick('a', 'b', true)])).toEqual({ a: 9.0, b: 9.0 });
  });

  test('"About the same" never reorders', () => {
    expect(shown([it('a', 8.0), it('b', 8.2)], [pick('a', 'b', true)])).toEqual({ a: 8.0, b: 8.2 });
  });

  test('"About the same" keeps the typed order even when another pick lifts the lower title (e2e case)', () => {
    // Naruto 3.0 beat Bleach 3.0; Trigun 3.1 was called about the same as both. Trigun stays above Naruto.
    const r = shown([it('n', 3), it('b', 3), it('t', 3.1)], [pick('n', 'b'), pick('t', 'n', true), pick('t', 'b', true)]);
    expect(r.t).toBe(3.1);
    expect(r.n).toBeGreaterThan(r.b);
    expect(r.t).toBeGreaterThan(r.n);
  });

  test('picks between titles no longer close, undone picks and unknown ids do not count', () => {
    const items = [it('a', 8.0), it('b', 8.31), it('c', 8.0)];
    const comps = [pick('a', 'b'), pick('c', 'a', false, true), pick('a', 'zz')];
    expect(shown(items, comps)).toEqual({ a: 8.0, b: 8.31, c: 8.0 });
  });

  test('an unmoved neighbour keeps its two-decimal number; a moved one shows two decimals when needed', () => {
    // a beat b (both 8.2) → 8.22 / 8.18: one decimal would read 8.2 for both, so two decimals.
    const r = shown([it('a', 8.2), it('b', 8.2), it('c', 8.25)], [pick('a', 'b')]);
    expect(r).toEqual({ a: 8.22, b: 8.18, c: 8.25 });
  });

  test('a chain of picks: 8.0 > 8.3 > 8.6 cannot all fit in ±0.2; titles > 0.3 apart keep their order', () => {
    const r = numberFirst([it('a', 8.0), it('b', 8.3), it('c', 8.6)], [pick('a', 'b'), pick('b', 'c')]);
    const h = (id: string) => r.get(id)!.hundredths;
    expect(h('c')).toBeGreaterThan(h('a')); // 0.6 apart: typed order kept
    for (const [id, t] of [['a', 800], ['b', 830], ['c', 860]] as const) expect(Math.abs(h(id) - t)).toBeLessThanOrEqual(20);
  });

  test('deterministic: shuffled items and comparisons give identical results', () => {
    const R = rng(7);
    const items = Array.from({ length: 30 }, (_, i) => it(`t${i}`, Math.round((7 + R() * 2) * 10) / 10));
    const comps: Comparison[] = [];
    for (let k = 0; k < 40; k++) {
      const a = items[Math.floor(R() * 30)]!, b = items[Math.floor(R() * 30)]!;
      if (a.id !== b.id) comps.push(pick(a.id, b.id, R() < 0.15));
    }
    const base = numberFirst(items, comps);
    const shuffle = <T,>(xs: T[]) => xs.map((x) => [R(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
    for (let k = 0; k < 5; k++) expect(numberFirst(shuffle(items), shuffle(comps))).toEqual(base);
  });

  describe('invariants over 2,000 random sets', () => {
    const R = rng(42);
    const cases = Array.from({ length: 2000 }, () => {
      const size = 2 + Math.floor(R() * 25);
      const center = 5 + R() * 5;
      const items = Array.from({ length: size }, (_, i) => {
        const v = Math.min(10, Math.max(0, center + (R() - 0.5) * 1.6));
        return it(`i${i}`, R() < 0.3 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);
      });
      const comps: Comparison[] = [];
      const m = Math.floor(R() * size * 2);
      for (let k = 0; k < m; k++) {
        const a = items[Math.floor(R() * size)]!, b = items[Math.floor(R() * size)]!;
        if (a.id !== b.id) comps.push(pick(a.id, b.id, R() < 0.15, R() < 0.05));
      }
      return { items, comps };
    });

    test('|shown − typed| ≤ 0.2; titles > 0.3 apart never cross or tie; unmoved titles show their typed number exactly', () => {
      for (const { items, comps } of cases) {
        const r = numberFirst(items, comps);
        for (const x of items) {
          const v = r.get(x.id)!;
          expect(Math.abs(v.rating - x.typed!)).toBeLessThanOrEqual(0.2 + 1e-9);
          if (!v.moved) expect(v.rating).toBe(x.typed);
        }
        for (const x of items) for (const y of items) {
          if (hundredths(x.typed!) - hundredths(y.typed!) > 30) expect(r.get(x.id)!.rating).toBeGreaterThan(r.get(y.id)!.rating);
        }
      }
    });

    test('shown ratings keep the order of the unrounded values (rounding never reorders or merges)', () => {
      for (const { items, comps } of cases) {
        const r = numberFirst(items, comps);
        for (const x of items) for (const y of items) {
          const a = r.get(x.id)!, b = r.get(y.id)!;
          if (a.hundredths > b.hundredths) expect(a.rating).toBeGreaterThan(b.rating);
        }
      }
    });

    test('acyclic decisive picks between close titles are honoured when only two titles are involved', () => {
      for (const { items, comps } of cases) {
        const counted = comps.filter((c) => c.undoneAt === null && !c.isTie);
        const r = numberFirst(items, counted);
        // Only titles with exactly one counted pick between them and nothing else: always honoured.
        const deg = new Map<string, number>();
        const ty = new Map(items.map((x) => [x.id, x.typed!]));
        const closeOnes = counted.filter((c) => isClose(ty.get(c.winnerId)!, ty.get(c.loserId)!));
        for (const c of closeOnes) for (const id of [c.winnerId, c.loserId]) deg.set(id, (deg.get(id) ?? 0) + 1);
        for (const c of closeOnes) {
          if (deg.get(c.winnerId) !== 1 || deg.get(c.loserId) !== 1) continue;
          const nearby = items.filter((x) => x.id !== c.winnerId && x.id !== c.loserId && (r.get(x.id)!.moved)
            && Math.min(Math.abs(hundredths(x.typed!) - hundredths(ty.get(c.winnerId)!)), Math.abs(hundredths(x.typed!) - hundredths(ty.get(c.loserId)!))) <= 40);
          if (nearby.length > 0) continue;
          expect(r.get(c.winnerId)!.rating).toBeGreaterThan(r.get(c.loserId)!.rating);
        }
      }
    });
  });

  test('a 300-title list with 600 picks stays cheap (complexity guard)', () => {
    const R = rng(3);
    const items = Array.from({ length: 300 }, (_, i) => it(`t${String(i).padStart(3, '0')}`, Math.round((6 + R() * 4) * 10) / 10));
    const comps: Comparison[] = [];
    while (comps.length < 600) {
      const a = items[Math.floor(R() * 300)]!, b = items[Math.floor(R() * 300)]!;
      if (a.id !== b.id && isClose(a.typed!, b.typed!)) comps.push(pick(a.id, b.id, R() < 0.1));
    }
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) numberFirst(items, comps);
    expect((performance.now() - t0) / 10).toBeLessThan(20);
  });
});

describe('questions', () => {
  const ci = (id: string, typed: number | null, planned = false): CloseItem => ({ id, title: id.toUpperCase(), typed, planned });

  test('closeQuestionsFor: at most 2, nearest typed number first, never an answered pair, never planned or unrated', () => {
    const items = [ci('x', 9.6), ci('a', 9.6), ci('b', 9.5), ci('c', 9.9), ci('d', 9.65, true), ci('e', 9.29), ci('f', null), ci('g', 9.62)];
    expect(closeQuestionsFor('x', items, [])).toEqual(['a', 'g']);
    expect(closeQuestionsFor('x', items, [pick('a', 'x')])).toEqual(['g', 'b']);
    expect(closeQuestionsFor('x', items, [pick('a', 'x', false, true)])).toEqual(['a', 'g']);
    expect(closeQuestionsFor('x', items, [], 5)).toEqual(['a', 'g', 'b', 'c']);
    expect(closeQuestionsFor('d', items, [])).toEqual([]);
    expect(closeQuestionsFor('f', items, [])).toEqual([]);
  });

  test('closePairs: nearest first, unanswered only, limited; countClosePairs counts them all', () => {
    const items = [ci('a', 8.0), ci('b', 8.0), ci('c', 8.2), ci('d', 8.6), ci('e', 8.9), ci('p', 8.0, true)];
    expect(closePairs(items, [])).toEqual([['a', 'b'], ['a', 'c'], ['b', 'c'], ['d', 'e']]);
    expect(countClosePairs(items, [])).toBe(4);
    expect(closePairs(items, [pick('b', 'a')])).toEqual([['a', 'c'], ['b', 'c'], ['d', 'e']]);
    expect(countClosePairs(items, [pick('b', 'a', true)])).toBe(3);
    expect(closePairs(items, [], 2)).toEqual([['a', 'b'], ['a', 'c']]);
  });
});
