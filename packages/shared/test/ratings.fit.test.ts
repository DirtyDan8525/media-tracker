import { describe, expect, test } from 'vitest';
import { fitTier, priorFromScore, round2, scoreOf, type Comparison } from '../src/ratings';
import { rng } from './helpers/prng';

type Item = { id: string; priorMean: number | null; scoreLocked: boolean };
type Cmp = Pick<Comparison, 'winnerId' | 'loserId' | 'isTie' | 'undoneAt'>;

const range: [number, number] = [9, 10];
const sc = (s: number) => scoreOf(s, range);
const logit = (p: number) => Math.log(p / (1 - p));
const item = (id: string, priorMean: number | null, scoreLocked = false): Item => ({ id, priorMean, scoreLocked });
const win = (w: string, l: string, isTie = false, undoneAt: string | null = null): Cmp => ({ winnerId: w, loserId: l, isTie, undoneAt });

/** n ∈ [2, 40] titles with random priors, ⌊R·3n⌋ earlier picks (15% ties), and one new pick a beats b. */
function randomCase(R: () => number): { items: Item[]; earlier: Cmp[]; next: Cmp } {
  const n = 2 + Math.floor(R() * 39);
  const items = Array.from({ length: n }, (_, i) => item(`i${i}`, logit(0.03 + 0.94 * R())));
  const two = (): [string, string] => {
    const a = Math.floor(R() * n);
    let b = Math.floor(R() * (n - 1));
    if (b >= a) b++;
    return [items[a].id, items[b].id];
  };
  const earlier = Array.from({ length: Math.floor(R() * 3 * n) }, () => { const [a, b] = two(); return win(a, b, R() < 0.15); });
  const [a, b] = two();
  return { items, earlier, next: win(a, b) };
}

function shuffle<T>(xs: T[], R: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('fitTier', () => {
  test('no picks: every strength is exactly its prior', () => {
    const items = [item('a', 1.3), item('b', -0.7), item('c', 0), item('d', null)];
    const s = fitTier(items, []);
    expect(s.get('a')).toBe(1.3); expect(s.get('b')).toBe(-0.7); expect(s.get('c')).toBe(0); expect(s.get('d')).toBe(0);
    expect(s.size).toBe(4);
  });

  test('undone picks and picks naming unknown ids are ignored', () => {
    const items = [item('a', 1.3), item('b', -0.7)];
    const s = fitTier(items, [win('a', 'b', false, '2026-11-15T00:00:00Z'), win('a', 'zz'), win('zz', 'b'), win('a', 'a')]);
    expect(s.get('a')).toBe(1.3); expect(s.get('b')).toBe(-0.7);
  });

  test('locked items keep their prior and still pull the others', () => {
    const items = [item('A', 0.5, true), item('B', 0.5)];
    const s = fitTier(items, [win('A', 'B')]);
    expect(s.get('A')).toBe(0.5);
    expect(s.get('B')!).toBeLessThan(0.5);
  });

  test('one pick between two 10.0s gives 9.98 and 9.96 (spec §10)', () => {
    const p = priorFromScore(10, range);
    const s = fitTier([item('f', p), item('c', p)], [win('f', 'c')], { priorSd: 1 });
    expect(round2(sc(s.get('f')!))).toBe(9.98); expect(round2(sc(s.get('c')!))).toBe(9.96);
  });

  test('a larger priorSd lets one pick move scores further', () => {
    const p = priorFromScore(9.5, range);
    const gap = (sd: number) => { const s = fitTier([item('f', p), item('c', p)], [win('f', 'c')], { priorSd: sd }); return s.get('f')! - s.get('c')!; };
    expect(gap(2)).toBeGreaterThan(gap(1));
    expect(gap(1)).toBeGreaterThan(gap(0.5));
  });

  test('ties: two equal priors tied stay equal (no gap, no cap)', () => {
    const p = priorFromScore(10, range);
    const s = fitTier([item('a', p), item('b', p)], [win('a', 'b', true), win('b', 'a', true)]);
    expect(s.get('a')).toBe(s.get('b'));
    expect(s.get('a')).toBeCloseTo(p, 12);
    // A tie pulls two different titles together.
    const t = fitTier([item('a', 1), item('b', -1)], [win('b', 'a', true)]);
    expect(t.get('a')!).toBeLessThan(1); expect(t.get('b')!).toBeGreaterThan(-1); expect(t.get('a')!).toBeGreaterThan(t.get('b')!);
  });

  test('deterministic: shuffled items and comparisons give bit-identical strengths', () => {
    const R = rng(7);
    for (let c = 0; c < 50; c++) {
      const { items, earlier, next } = randomCase(R);
      const picks = [...earlier, next];
      const a = fitTier(items, picks);
      const b = fitTier(shuffle(items, R), shuffle(picks, R));
      for (const it of items) expect(Object.is(a.get(it.id), b.get(it.id))).toBe(true);
    }
  });

  test('stays in range: a title that wins 50 times stays below 10, one that loses 50 times above 9', () => {
    const top = priorFromScore(10, range), bottom = priorFromScore(9, range);
    const items = [item('w', top), item('l', bottom), ...['a', 'b', 'c', 'd'].map((id) => item(id, 0))];
    const picks: Cmp[] = [];
    for (let i = 0; i < 50; i++) picks.push(win('w', ['a', 'b', 'c', 'd', 'l'][i % 5]), win(['a', 'b', 'c', 'd', 'w'][i % 5], 'l'));
    const s = fitTier(items, picks);
    expect(sc(s.get('w')!)).toBeLessThan(10); expect(sc(s.get('l')!)).toBeGreaterThan(9);
    expect(sc(s.get('w')!)).toBeGreaterThan(sc(top));
    expect(sc(s.get('l')!)).toBeLessThan(sc(bottom));
  });

  test('a pick never lowers the winner or raises the loser (2,000 random cases)', () => {
    const R = rng(42);
    let violations = 0;
    for (let c = 0; c < 2000; c++) {
      const { items, earlier, next } = randomCase(R);
      const before = fitTier(items, earlier), after = fitTier(items, [...earlier, next]);
      if (after.get(next.winnerId)! < before.get(next.winnerId)! - 1e-12) violations++;
      if (after.get(next.loserId)! > before.get(next.loserId)! + 1e-12) violations++;
    }
    expect(violations).toBe(0);
  });

  test('no drift: over 2,000 random cases the mean change of the tier average is < 0.001 and it rises in 45–55% of cases', () => {
    const R = rng(42);
    const changes: number[] = [];
    for (let c = 0; c < 2000; c++) {
      const { items, earlier, next } = randomCase(R);
      const avg = (s: Map<string, number>) => mean(items.map((i) => sc(s.get(i.id)!)));
      changes.push(avg(fitTier(items, [...earlier, next])) - avg(fitTier(items, earlier)));
    }
    const up = changes.filter((d) => d > 0).length / changes.length;
    expect(Math.abs(mean(changes))).toBeLessThan(0.001);
    expect(up).toBeGreaterThanOrEqual(0.45); expect(up).toBeLessThanOrEqual(0.55);
  });

  test('a 120-title tier with 480 picks fits in under 50 ms', () => {
    const R = rng(9);
    const items = Array.from({ length: 120 }, (_, i) => item(`t${String(i).padStart(3, '0')}`, logit(0.03 + 0.94 * R())));
    const picks = Array.from({ length: 480 }, () => {
      const a = Math.floor(R() * 120); let b = Math.floor(R() * 119); if (b >= a) b++;
      return win(items[a].id, items[b].id, R() < 0.15);
    });
    fitTier(items, picks); // warm up the JIT
    const t0 = performance.now();
    const s = fitTier(items, picks);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(s.size).toBe(120);
  });
});
