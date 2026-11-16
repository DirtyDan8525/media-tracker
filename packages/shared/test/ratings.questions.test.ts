import { describe, expect, test } from 'vitest';
import {
  nextPair, pairKey, placementAnswer, placementNext, settledness, startPlacement,
  type Comparison, type RatedItem, type Tier,
} from '../src/ratings';

const item = (id: string, tier: Tier | null, strength: number, scoreLocked = false): RatedItem =>
  ({ id, title: id, rating: tier === null ? null : 5, tier, priorMean: strength, strength, scoreLocked });
let n = 0;
const pick = (w: string, l: string, undoneAt: string | null = null): Comparison =>
  ({ id: `c${n++}`, winnerId: w, loserId: l, isTie: false, createdAt: '', undoneAt });
const strengthsOf = (items: RatedItem[]) => new Map(items.map((i) => [i.id, i.strength!]));
const none = new Set<string>();

describe('pairKey', () => {
  test('sorts the ids', () => {
    expect(pairKey('b', 'a')).toBe('a~b'); expect(pairKey('a', 'b')).toBe('a~b');
  });
});

describe('nextPair', () => {
  test('nextPair: closest neighbours in the same tier, unasked first', () => {
    const items = [item('c', 3, 0), item('a', 3, 1), item('b', 3, 0.9)];
    const s = strengthsOf(items);
    expect(nextPair(items, [], s, none)).toEqual(['a', 'b']);
    // a–b asked once: the unasked b–c comes first even though it is further apart.
    expect(nextPair(items, [pick('b', 'a')], s, none)).toEqual(['b', 'c']);
    // An undone pick doesn't count as asked.
    expect(nextPair(items, [pick('b', 'a', '2026-11-15T00:00:00Z')], s, none)).toEqual(['a', 'b']);
    // Both asked once: back to the closest.
    expect(nextPair(items, [pick('a', 'b'), pick('c', 'b')], s, none)).toEqual(['a', 'b']);
    // The strengths map wins over the items' stored strengths.
    expect(nextPair(items, [], new Map([['a', 1], ['b', 0.1], ['c', 0]]), none)).toEqual(['b', 'c']);
  });

  test('equal gaps: the higher tier first, then the higher pair', () => {
    const items = [item('l1', 2, 1), item('l2', 2, 0.5), item('v1', 3, 1), item('v2', 3, 0.5), item('v3', 3, 0)];
    expect(nextPair(items, [], strengthsOf(items), none)).toEqual(['v1', 'v2']);
    expect(nextPair(items, [], strengthsOf(items), new Set([pairKey('v1', 'v2')]))).toEqual(['v2', 'v3']);
    expect(nextPair(items, [], strengthsOf(items), new Set([pairKey('v1', 'v2'), pairKey('v2', 'v3')]))).toEqual(['l1', 'l2']);
  });

  test('nextPair: never across tiers; null for a single-title tier, an all-locked tier, or everything skipped', () => {
    const across = [item('a', 3, 0), item('b', 2, 0), item('u', null, 0)];
    expect(nextPair(across, [], strengthsOf(across), none)).toBeNull();
    expect(nextPair([item('a', 3, 0)], [], new Map([['a', 0]]), none)).toBeNull();
    const locked = [item('a', 3, 0, true), item('b', 3, 0.1, true), item('c', 3, 0.2, true)];
    expect(nextPair(locked, [], strengthsOf(locked), none)).toBeNull();
    // One locked title still makes a pair with an unlocked one.
    const half = [item('a', 3, 0, true), item('b', 3, 0.1)];
    expect(nextPair(half, [], strengthsOf(half), none)).toEqual(['b', 'a']);
    const three = [item('a', 3, 1), item('b', 3, 0.5), item('c', 3, 0)];
    expect(nextPair(three, [], strengthsOf(three), new Set([pairKey('a', 'b'), pairKey('c', 'b')]))).toBeNull();
    expect(nextPair([], [], new Map(), none)).toBeNull();
  });
});

describe('settledness', () => {
  test('settledness counts direct picks between neighbours only', () => {
    const items = [item('a', 3, 1), item('b', 3, 0.5), item('c', 3, 0), item('x', 2, 0), item('y', 2, -1)];
    const s = strengthsOf(items);
    expect(settledness(items, [], s)).toEqual({ checked: 0, total: 3 });
    expect(settledness(items, [pick('a', 'c')], s)).toEqual({ checked: 0, total: 3 }); // not neighbours
    expect(settledness(items, [pick('a', 'x')], s)).toEqual({ checked: 0, total: 3 }); // across tiers
    expect(settledness(items, [pick('b', 'a')], s)).toEqual({ checked: 1, total: 3 });
    expect(settledness(items, [pick('b', 'a', 'undone')], s)).toEqual({ checked: 0, total: 3 });
    expect(settledness(items, [pick('b', 'a'), pick('a', 'b'), pick('y', 'x')], s)).toEqual({ checked: 2, total: 3 });
    const locked = items.map((i) => (i.id === 'b' || i.id === 'c' ? { ...i, scoreLocked: true } : i));
    expect(settledness(locked, [], s)).toEqual({ checked: 1, total: 3 });
    expect(settledness([item('a', 3, 0)], [], new Map([['a', 0]]))).toEqual({ checked: 0, total: 0 });
  });
});

describe('placement', () => {
  test('placement in a tier of 40 takes at most 6 picks and lands in order', () => {
    const order = Array.from({ length: 40 }, (_, i) => `t${i}`);   // t0 strongest
    for (let target = 0; target <= 40; target++) {
      let p = startPlacement(order), n = 0;
      while (!p.done) { const o = placementNext(p)!; n++; p = placementAnswer(p, Number(o.slice(1)) >= target ? 'a' : 'b'); }
      expect(n).toBeLessThanOrEqual(6); expect(p.lo).toBe(target);
      expect(placementNext(p)).toBeNull();
    }
    let p = startPlacement(order), n = 0;
    while (!p.done) { const o = placementNext(p)!; n++; p = placementAnswer(p, Number(o.slice(1)) >= 17 ? 'a' : 'b'); }
    expect(n).toBeLessThanOrEqual(6); expect(p.lo).toBe(17);
  });

  test("'same' ends placement at once", () => {
    const p = startPlacement(['a', 'b', 'c', 'd', 'e']);
    expect(placementNext(p)).toBe('c');
    const q = placementAnswer(p, 'same');
    expect(q).toMatchObject({ done: true, lo: 2, hi: 2 });
    expect(placementNext(q)).toBeNull();
    expect(p.done).toBe(false); // pure: the old state is unchanged
  });

  test('an empty tier is placed at once', () => {
    const p = startPlacement([]);
    expect(p).toMatchObject({ done: true, lo: 0, hi: 0 });
    expect(placementNext(p)).toBeNull();
  });
});
