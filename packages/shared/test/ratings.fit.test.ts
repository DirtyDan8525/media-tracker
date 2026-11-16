import { describe, expect, test } from 'vitest';
import { fitTier, newFitStats, priorFromScore, round2, scoreOf, type Comparison } from '../src/ratings';
import { rng } from './helpers/prng';

/** Newton steps for one dense guard tier: 7 measured (quadratic convergence from the priors); 10 leaves room. */
const STEPS_BOUND = 10;

type Item = { id: string; priorMean: number | null; scoreLocked: boolean };
type Cmp = Pick<Comparison, 'winnerId' | 'loserId' | 'isTie' | 'undoneAt'>;

const range: [number, number] = [9, 10];
const sc = (s: number) => scoreOf(s, range);
const logit = (p: number) => Math.log(p / (1 - p));
const item = (id: string, priorMean: number | null, scoreLocked = false): Item => ({ id, priorMean, scoreLocked });
const win = (w: string, l: string, isTie = false, undoneAt: string | null = null): Cmp => ({ winnerId: w, loserId: l, isTie, undoneAt });

/**
 * n ∈ [2, 40] titles with random priors, ⌊R·3n⌋ earlier picks (15% ties), and one new pick a beats b.
 * With `locked`, 10% of titles are locked; with `tieNext`, the new pick is a tie 15% of the time.
 */
function randomCase(R: () => number, o: { locked?: boolean; tieNext?: boolean } = {}): { items: Item[]; earlier: Cmp[]; next: Cmp } {
  const n = 2 + Math.floor(R() * 39);
  const items = Array.from({ length: n }, (_, i) => item(`i${i}`, logit(0.03 + 0.94 * R()), o.locked === true && R() < 0.1));
  const two = (): [string, string] => {
    const a = Math.floor(R() * n);
    let b = Math.floor(R() * (n - 1));
    if (b >= a) b++;
    return [items[a].id, items[b].id];
  };
  const earlier = Array.from({ length: Math.floor(R() * 3 * n) }, () => { const [a, b] = two(); return win(a, b, R() < 0.15); });
  const [a, b] = two();
  return { items, earlier, next: win(a, b, o.tieNext === true && R() < 0.15) };
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

  test('a pick never lowers the winner or raises the loser, with locked titles and earlier tie picks (2,000 random cases)', () => {
    const R = rng(43);
    let violations = 0, lockedCases = 0;
    for (let c = 0; c < 2000; c++) {
      const { items, earlier, next } = randomCase(R, { locked: true });
      if (items.some((i) => i.scoreLocked)) lockedCases++;
      const before = fitTier(items, earlier), after = fitTier(items, [...earlier, next]);
      if (after.get(next.winnerId)! < before.get(next.winnerId)! - 1e-12) violations++;
      if (after.get(next.loserId)! > before.get(next.loserId)! + 1e-12) violations++;
      for (const i of items) if (i.scoreLocked && after.get(i.id) !== i.priorMean) violations++;
    }
    expect(lockedCases).toBeGreaterThan(1000);
    expect(violations).toBe(0);
  });

  // Measured 2026-11-15 (2,000 cases each, print with PRINT_DRIFT=1):
  //   plain, seed 42: mean change of the tier average +4.3e-5, up in 50.95% of cases;
  //   locked titles and tie picks, seed 44: mean change −2.7e-6, up in 49.0% of cases.
  test('no drift with locked titles and tie picks: mean change < 0.001, rises in 45–55% of cases', () => {
    const R = rng(44);
    const changes: number[] = [];
    for (let c = 0; c < 2000; c++) {
      const { items, earlier, next } = randomCase(R, { locked: true, tieNext: true });
      const avg = (s: Map<string, number>) => mean(items.map((i) => sc(s.get(i.id)!)));
      changes.push(avg(fitTier(items, [...earlier, next])) - avg(fitTier(items, earlier)));
    }
    const up = changes.filter((d) => d > 0).length / changes.length;
    if (process.env.PRINT_DRIFT) console.log('drift locked+ties', mean(changes), up);
    expect(Math.abs(mean(changes))).toBeLessThan(0.001);
    expect(up).toBeGreaterThanOrEqual(0.45); expect(up).toBeLessThanOrEqual(0.55);
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
    if (process.env.PRINT_DRIFT) console.log('drift plain', mean(changes), up);
    expect(Math.abs(mean(changes))).toBeLessThan(0.001);
    expect(up).toBeGreaterThanOrEqual(0.45); expect(up).toBeLessThanOrEqual(0.55);
  });

  test('groups not linked by picks are fitted separately, with the same result as alone', () => {
    const R = rng(11);
    const group = (p: string, n: number) => Array.from({ length: n }, (_, i) => item(`${p}${i}`, logit(0.03 + 0.94 * R())));
    const A = group('a', 12), B = group('b', 9), C = [item('c0', 0.4)];
    const picks = (g: Item[], m: number) => Array.from({ length: m }, () => {
      const x = Math.floor(R() * g.length); let y = Math.floor(R() * (g.length - 1)); if (y >= x) y++;
      return win(g[x].id, g[y].id, R() < 0.15);
    });
    const pa = picks(A, 30), pb = picks(B, 20);
    const all = fitTier([...A, ...B, ...C], [...pa, ...pb]);
    const alone = new Map([...fitTier(A, pa), ...fitTier(B, pb)]);
    for (const i of [...A, ...B]) expect(Object.is(all.get(i.id), alone.get(i.id))).toBe(true);
    expect(all.get('c0')).toBe(0.4);
  });

  // Complexity guard (Review Focus 5), sized past a big real tier: one connected 150-title tier with
  // 600 picks (and the plan's 120/480). Deterministic work counts catch a complexity regression
  // without timing anything; one loose min-of-N time bound catches a gross slowdown. The strict
  // Workers budget (10 ms CPU) is an opt-in perf test below: run it alone, on a quiet machine,
  //   PERF=1 npx -y npm@11 test -w packages/shared -- test/ratings.fit.test.ts -t perf
  const bigTier = (n: number, m: number) => {
    const R = rng(9);
    const items = Array.from({ length: n }, (_, i) => item(`t${String(i).padStart(3, '0')}`, logit(0.03 + 0.94 * R())));
    const picks = Array.from({ length: m }, () => {
      const a = Math.floor(R() * n); let b = Math.floor(R() * (n - 1)); if (b >= a) b++;
      return win(items[a].id, items[b].id, R() < 0.15);
    });
    return { items, picks };
  };

  test.each([[150, 600], [120, 480]])('a %i-title tier with %i picks: bounded Newton work', (n, m) => {
    const { items, picks } = bigTier(n, m);
    const stats = newFitStats();
    const s = fitTier(items, picks, { stats });
    expect(s.size).toBe(n);
    expect(stats).toMatchObject({ fits: 1, groups: 1, maxGroup: n, picks: m });
    expect(stats.steps).toBeLessThanOrEqual(STEPS_BOUND);
  });

  test('a 150-title tier with 600 picks: loose time bound (min of 5 < 30 ms)', () => {
    const { items, picks } = bigTier(150, 600);
    for (let k = 0; k < 2; k++) fitTier(items, picks); // warm up the JIT
    let min = Infinity;
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); fitTier(items, picks); min = Math.min(min, performance.now() - t0); }
    expect(min).toBeLessThan(30);
  });

  test.runIf(process.env.PERF)('perf: a 150-title tier with 600 picks fits within the 8 ms budget (median of 15)', () => {
    const { items, picks } = bigTier(150, 600);
    for (let k = 0; k < 3; k++) fitTier(items, picks);
    const times: number[] = [];
    for (let k = 0; k < 15; k++) { const t0 = performance.now(); fitTier(items, picks); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    expect(times[7], `median ${times[7]} ms (min ${times[0]}, max ${times[14]})`).toBeLessThan(8);
  });
});
