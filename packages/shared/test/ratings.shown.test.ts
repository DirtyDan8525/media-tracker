import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TIERS, applyMove, applyTyped, compareRated, priorFromScore, refitSet, refitTier, round1, round2, scoreOf, tierFor, tierRange,
  type Comparison, type RatedItem, type Tier, type TierSet,
} from '../src/ratings';
import { DAN_TOP14 } from './fixtures/danTop14';
import { rng } from './helpers/prng';

const blank = (id: string): RatedItem => ({ id, title: id, rating: null, tier: null, priorMean: null, strength: null, scoreLocked: false });
let n = 0;
const pick = (w: string, l: string, isTie = false): Comparison =>
  ({ id: `c${n++}`, winnerId: w, loserId: l, isTie, createdAt: '2026-11-15T00:00:00.000Z', undoneAt: null });
const typed = (id: string, r: number, lock = false) => applyTyped(blank(id), r, DEFAULT_TIERS, lock);
const decimals = (x: number) => (String(x).split('.')[1] ?? '').length;
const byId = (xs: RatedItem[]) => new Map(xs.map((x) => [x.id, x]));

describe('applyTyped', () => {
  test('a number sets tier, prior, strength and rating; null clears them', () => {
    const x = typed('x', 8.25);
    expect(x).toMatchObject({ rating: 8.25, tier: 2, scoreLocked: false });
    expect(x.priorMean).toBe(priorFromScore(8.25, [7.5, 9])); expect(x.strength).toBe(x.priorMean);
    expect(applyTyped({ ...x, scoreLocked: true }, 8.7, DEFAULT_TIERS).scoreLocked).toBe(true);
    expect(applyTyped({ ...x, scoreLocked: true }, 8.7, DEFAULT_TIERS, false).scoreLocked).toBe(false);
    expect(applyTyped({ ...x, scoreLocked: true }, null, DEFAULT_TIERS)).toEqual({ ...blank('x'), scoreLocked: false });
  });

  test('a typed number in another tier unlocks (Q8) unless lock is passed', () => {
    const locked = typed('x', 8.5, true);
    expect(applyTyped(locked, 9.5, DEFAULT_TIERS)).toMatchObject({ tier: 3, scoreLocked: false });
    expect(applyTyped(locked, 9.5, DEFAULT_TIERS, true)).toMatchObject({ tier: 3, scoreLocked: true });
    expect(applyTyped(locked, 8.7, DEFAULT_TIERS)).toMatchObject({ tier: 2, scoreLocked: true }); // same tier: kept
    expect(applyTyped(blank('n'), 8.7, DEFAULT_TIERS)).toMatchObject({ tier: 2, scoreLocked: false });
  });
});

describe('refitSet / refitTier', () => {
  test('import keeps every score exactly: no picks, no changes', () => {
    const items = [0, 5.99, 6, 7.49, 7.5, 8.25, 9, 9.97, 10].map((r, i) => applyTyped(blank(`t${i}`), r, DEFAULT_TIERS));
    expect(refitSet(items, [], DEFAULT_TIERS)).toEqual([]);
  });

  test("Dan's top 14: FMA beats Edgerunners changes only those two, to 9.98 and 9.96", () => {
    const items = DAN_TOP14.map(([t, r]) => applyTyped(blank(t), r, DEFAULT_TIERS));
    const out = refitSet(items, [pick('Fullmetal Alchemist: Brotherhood', 'Cyberpunk: Edgerunners')], DEFAULT_TIERS, { priorSd: 1 });
    expect(out.map((i) => [i.id, i.rating])).toEqual([['Cyberpunk: Edgerunners', 9.96], ['Fullmetal Alchemist: Brotherhood', 9.98]]);
  });

  test('one decimal unless an ordered neighbour collides', () => {
    // a and b both typed 8.6, ordered by a 3–2 record: both would show 8.6, so both show two decimals.
    const items = [typed('a', 8.6), typed('b', 8.6), typed('c', 8.0)];
    const out = byId(refitSet(items, [pick('a', 'b'), pick('b', 'a'), pick('a', 'b'), pick('b', 'a'), pick('a', 'b')], DEFAULT_TIERS));
    const a = out.get('a')!.rating!, b = out.get('b')!.rating!;
    expect(round1(a)).toBe(8.6); expect(round1(b)).toBe(8.6);
    expect(a).toBeGreaterThan(b);
    expect(decimals(a)).toBe(2); expect(decimals(b)).toBe(2);
    expect(out.has('c')).toBe(false);
    // One pick between 8.6 and 8.0 separates them: one decimal each.
    const one = refitSet([typed('a', 8.6), typed('c', 8.0)], [pick('a', 'c')], DEFAULT_TIERS);
    for (const i of one) { expect(i.rating).toBe(round1(i.rating!)); }
    expect(one).toHaveLength(2);
  });

  test('an unfitted neighbour never switches to two decimals', () => {
    // y typed 9.15 loses to z (9.5) and drops to about 9.13, next to x imported at 9.1 (no picks):
    // y shows two decimals, x keeps 9.1.
    const items = [typed('x', 9.1), typed('y', 9.15), typed('z', 9.5)];
    const out = byId(refitSet(items, [pick('z', 'y')], DEFAULT_TIERS));
    const y = out.get('y')!.rating!;
    expect(round1(y)).toBe(9.1); expect(decimals(y)).toBe(2); expect(y).toBeGreaterThan(9.1); expect(y).toBeLessThan(9.15);
    expect(out.has('x')).toBe(false);
  });

  test('a locked neighbour counts by its typed number in the two-decimal rule', () => {
    // F typed 9.5 loses to G and drops to about 9.47; L is locked at 9.5 right below it: F shows two decimals.
    const items = [typed('L', 9.5, true), typed('F', 9.5), typed('G', 9.9)];
    const out = byId(refitSet(items, [pick('G', 'F')], DEFAULT_TIERS));
    const f = out.get('F')!.rating!;
    expect(round1(f)).toBe(9.5); expect(decimals(f)).toBe(2);
    expect(out.has('L')).toBe(false);
    // Unlocked and unfitted, L would show 9.5 too: same result. Locked at 9.1 instead: no collision, one decimal.
    const apart = byId(refitSet([typed('L', 9.1, true), typed('F', 9.5), typed('G', 9.9)], [pick('G', 'F')], DEFAULT_TIERS));
    expect(apart.get('F')!.rating).toBe(9.5);
  });

  test('a fitted title at the top of a tier never shows the next tier\'s lower bound', () => {
    // w wins five times at the top of Liked: its score rounds to 9.0, which would read as Loved.
    const items = [typed('w', 8.95), typed('a', 8.9), typed('b', 8.5), typed('c', 8.0)];
    const out = byId(refitSet(items, [pick('w', 'a'), pick('w', 'a'), pick('w', 'b'), pick('w', 'b'), pick('w', 'c')], DEFAULT_TIERS));
    const w = out.get('w')!;
    expect(scoreOf(w.strength!, [7.5, 9])).toBeGreaterThan(8.95);
    expect(w.rating!).toBeLessThanOrEqual(8.99);
    expect(tierFor(w.rating!, DEFAULT_TIERS)).toBe(2);
    for (const i of out.values()) expect(tierFor(i.rating!, DEFAULT_TIERS)).toBe(i.tier);
    // One decimal: 8.9 at most.
    const solo = refitSet([typed('w', 8.95), typed('c', 8.0)], [pick('w', 'c'), pick('w', 'c')], DEFAULT_TIERS);
    expect(solo.find((i) => i.id === 'w')!.rating).toBe(8.9);
    // The top tier may show its upper bound.
    const top = refitSet([typed('t', 9.97), typed('u', 9.5)], [pick('t', 'u'), pick('t', 'u')], DEFAULT_TIERS);
    expect(top.find((i) => i.id === 't')!.rating).toBe(10);
  });

  test('tier-only and reset titles near the top edge stay in their tier', () => {
    // A tier-only Didn't like title whose prior sits near the top of 0–6 would round to 6.0 (Fine).
    const t = { ...blank('t'), tier: 0 as Tier, priorMean: 5, strength: 5 };
    expect(refitTier([t], [], tierRange(DEFAULT_TIERS, 0))[0].rating).toBe(5.9);
  });

  test('picks in one tier never change another tier', () => {
    const items = [
      ...DAN_TOP14.map(([t, r]) => typed(t, r)),
      typed('liked1', 8.0), typed('liked2', 8.0), typed('fine1', 7), typed('fine2', 7), typed('bad1', 3), typed('bad2', 3),
    ];
    const comps = [pick('Gurren Lagann', 'Naruto: Shippuden'), pick('FLCL', 'Mob Psycho 100'), pick('liked1', 'liked2'), pick('bad1', 'bad2')];
    const out = refitSet(items, comps, DEFAULT_TIERS);
    const lovedOnly = refitSet(items, comps.slice(0, 2), DEFAULT_TIERS);
    expect(lovedOnly.length).toBeGreaterThan(0);
    expect(lovedOnly.every((i) => i.tier === 3)).toBe(true);
    // The Liked and Didn't like picks only change their own tiers, and leave Loved exactly as with the Loved picks alone.
    expect(out.filter((i) => i.tier === 3)).toEqual(lovedOnly);
    expect(out.filter((i) => i.tier !== 3).map((i) => i.id).sort()).toEqual(['bad1', 'bad2', 'liked1', 'liked2']);
  });

  test('a cross-tier pick counts for nothing', () => {
    const items = [typed('loved', 9.5), typed('liked', 8.0), typed('fine', 7.0)];
    expect(refitSet(items, [pick('liked', 'loved'), pick('fine', 'liked', true)], DEFAULT_TIERS)).toEqual([]);
  });

  test('locked: never rewritten, still an opponent', () => {
    const items = [typed('L', 9.5, true), typed('B', 9.5)];
    const out = refitSet(items, [pick('B', 'L')], DEFAULT_TIERS);
    expect(out.map((i) => i.id)).toEqual(['B']);
    expect(out[0].rating!).toBeGreaterThan(9.5);
    // Locked keeps its typed number even with picks against it.
    const many = refitSet(items, [pick('B', 'L'), pick('B', 'L'), pick('B', 'L')], DEFAULT_TIERS);
    expect(many.find((i) => i.id === 'L')).toBeUndefined();
  });

  test('rangeChanged spreads unfitted titles over the new range; locked keep their number', () => {
    const items = [typed('a', 9.5), typed('b', 9.97), typed('L', 9.8, true)];
    const wider: TierSet = { names: DEFAULT_TIERS.names, bounds: [6, 7.5, 8.5] };
    expect(refitSet(items, [], wider)).toEqual([]); // without rangeChanged nothing is rewritten
    const out = byId(refitSet(items, [], wider, { rangeChanged: true }));
    expect(out.get('a')!.rating).toBe(9.3); // the middle of 8.5–10 is 9.25
    expect(out.get('b')!.rating).toBe(round1(scoreOf(items[1].priorMean!, [8.5, 10])));
    expect(out.has('L')).toBe(false);
    expect(out.get('a')!.tier).toBe(3); // no title changes tier
  });

  test('a title that lost its picks goes back to round1(scoreOf(prior))', () => {
    const items = [typed('a', 9.5), typed('b', 9.5)];
    const c = pick('a', 'b');
    const fitted = refitSet(items, [c], DEFAULT_TIERS);
    const after = items.map((i) => fitted.find((f) => f.id === i.id) ?? i);
    expect(after[0].strength).not.toBe(after[0].priorMean);
    const back = byId(refitSet(after, [{ ...c, undoneAt: '2026-11-15T01:00:00.000Z' }], DEFAULT_TIERS));
    expect(back.get('a')).toMatchObject({ rating: 9.5, strength: items[0].priorMean });
    expect(back.get('b')).toMatchObject({ rating: 9.5, strength: items[1].priorMean });
  });

  test('tier-only titles show the middle of their tier', () => {
    const t = { ...blank('t'), tier: 2 as Tier, priorMean: 0, strength: 0 };
    expect(refitTier([t], [], [7.5, 9])).toEqual([{ ...t, rating: 8.3 }]);
  });
});

describe('applyMove', () => {
  test('applyMove keeps the rough place: top of Liked → bottom of Loved, bottom of Loved → top of Liked (Q23)', () => {
    const up = applyMove(applyTyped(blank('x'), 8.9, DEFAULT_TIERS, true), 3, DEFAULT_TIERS);
    expect(up).toMatchObject({ tier: 3, rating: 9, scoreLocked: false });
    expect(up.priorMean).toBe(priorFromScore(9.03, [9, 10])); expect(up.strength).toBe(up.priorMean);
    const down = applyMove(applyTyped(blank('y'), 9.0, DEFAULT_TIERS), 2, DEFAULT_TIERS);
    // 8.955 would round to 9.0, which reads as Loved: a Liked title shows 8.9 at most.
    expect(down).toMatchObject({ tier: 2, rating: 8.9 });
    expect(scoreOf(down.priorMean!, [7.5, 9])).toBeCloseTo(8.955, 12);
    expect(applyMove(applyTyped(blank('z'), 5, DEFAULT_TIERS), 1, DEFAULT_TIERS).priorMean).toBe(priorFromScore(6, [6, 7.5])); // clamps to 3%
    expect(applyMove({ ...blank('u'), rating: null }, 2, DEFAULT_TIERS)).toMatchObject({ priorMean: 0, rating: 8.3 }); // unrated → middle
  });
});

describe('compareRated', () => {
  test('compareRated: equal shown score → higher tier, then stronger first', () => {
    const r = (id: string, rating: number | null, tier: Tier | null, strength: number | null, title = id) =>
      ({ id, title, rating, tier, strength });
    const xs = [
      r('none', null, null, null), r('lowTier', 9.0, 2, 3), r('weak', 9.0, 3, 0.1), r('strong', 9.0, 3, 0.2),
      r('top', 9.5, 3, 0), r('nullStrength', 9.0, 3, null), r('b2', 8, 2, 0, 'Beta'), r('b1', 8, 2, 0, 'beta'), r('a', 8, 2, 0, 'Alpha'),
    ];
    expect([...xs].sort(compareRated).map((x) => x.id)).toEqual(['top', 'strong', 'weak', 'nullStrength', 'lowTier', 'a', 'b1', 'b2', 'none']);
  });
});

describe('guarantees', () => {
  test('shown scores stay within the tier range and read as their own tier (2,000 random cases)', () => {
    const R = rng(3);
    for (let c = 0; c < 2000; c++) {
      const tier = Math.floor(R() * 4) as Tier;
      const [low, high] = tierRange(DEFAULT_TIERS, tier);
      const size = 2 + Math.floor(R() * 20);
      const items = Array.from({ length: size }, (_, i) => applyTyped(blank(`i${i}`), round2(low + Math.floor(R() * (high - low) * 100) / 100), DEFAULT_TIERS, R() < 0.1));
      expect(items.every((i) => tierFor(i.rating!, DEFAULT_TIERS) === tier)).toBe(true);
      const comps = Array.from({ length: Math.floor(R() * 4 * size) }, () => {
        const a = Math.floor(R() * size); let b = Math.floor(R() * (size - 1)); if (b >= a) b++;
        return pick(items[a].id, items[b].id, R() < 0.15);
      });
      for (const i of refitTier(items, comps, [low, high], { priorSd: 0.5 + R() * 2 })) {
        expect(i.scoreLocked).toBe(false);
        expect(i.rating!).toBeGreaterThanOrEqual(low); expect(i.rating!).toBeLessThanOrEqual(high);
        expect(tierFor(i.rating!, DEFAULT_TIERS)).toBe(tier); // never the next tier's lower bound
      }
    }
  });
});
