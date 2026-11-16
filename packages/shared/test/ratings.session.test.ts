import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TIERS, applyMove, applyTyped, compareRated, createRatingSession, refitSet, round1, round2, tierRange,
  type Comparison, type RatedItem, type RatingChange, type RatingSession, type SavePayload, type SessionMode, type Tier,
} from '../src/ratings';
import { DAN_TOP14 } from './fixtures/danTop14';
import { rng } from './helpers/prng';

const blank = (id: string): RatedItem => ({ id, title: id, rating: null, tier: null, priorMean: null, strength: null, scoreLocked: false });
const typed = (id: string, r: number, lock = false) => applyTyped(blank(id), r, DEFAULT_TIERS, lock);
const top14 = () => DAN_TOP14.map(([t, r]) => typed(t, r));
const liked = (n: number) => Array.from({ length: n }, (_, i) => typed(`liked${String(i).padStart(2, '0')}`, round1(7.6 + (i % 14) * 0.1)));
const session = (items: RatedItem[], mode: Parameters<typeof createRatingSession>[1], comparisons: Comparison[] = []) =>
  createRatingSession({ items, comparisons, tiers: DEFAULT_TIERS }, mode);
const pickQ = (s: RatingSession) => {
  const q = s.question;
  if (q?.kind !== 'pick') throw new Error(`expected a pick question, got ${JSON.stringify(q)}`);
  return q;
};

describe('Back', () => {
  test('Back then the same pick gives the same scores', () => {
    const s = session(top14(), { kind: 'fix', tier: 3 });
    s.answer('a'); s.answer('b');
    const before = s.changes(), q = pickQ(s);
    s.answer('a');
    const after = s.changes();
    expect(after).not.toEqual(before);
    s.back();
    expect(s.changes()).toEqual(before);
    expect(pickQ(s)).toEqual(q);
    s.answer('a');
    expect(s.changes()).toEqual(after);
    expect(s.asked).toBe(3);
    expect(s.payload().picks.map((p) => p.undone)).toEqual([false, false, true, false]);
  });

  test('Back after Stop returns to the last real pick', () => {
    const s = session(top14(), { kind: 'fix', tier: 3 });
    expect(s.canBack).toBe(false);
    s.answer('a');
    const q = pickQ(s);
    s.answer('b'); s.answer('skip'); s.answer('stop');
    expect(s.question).toBeNull();
    s.back();
    expect(pickQ(s)).toEqual(q);
    expect(s.asked).toBe(1);
    s.back();
    expect(s.asked).toBe(0); expect(s.canBack).toBe(false); expect(s.changes()).toEqual([]);
    s.back(); // nothing left to undo: no-op
    expect(s.asked).toBe(0);
  });

  test('Back undoes a move; the undone pick is in payload() with undone: true', () => {
    const s = session([...top14(), ...liked(3)], { kind: 'fix', tier: null });
    const q = pickQ(s);
    s.answer('a');
    s.move('Attack on Titan', 3);
    expect(s.payload().moves).toEqual([{ id: 'Attack on Titan', tier: 3 }]);
    expect(s.changes().find((c) => c.id === 'Attack on Titan')).toMatchObject({ oldTier: 2, tier: 3 });
    s.back();
    expect(s.payload().moves).toEqual([]);
    expect(s.changes().find((c) => c.id === 'Attack on Titan')).toBeUndefined();
    s.back();
    expect(s.changes()).toEqual([]);
    expect(s.payload()).toEqual({ picks: [{ winnerId: q.a.id, loserId: q.b.id, isTie: false, undone: true }], moves: [], done: [] });
  });
});

describe('fix mode', () => {
  test('fix mode stays inside the chosen tier and ends with null when nothing is left', () => {
    const items = [...top14(), ...liked(4), typed('fine', 7)];
    const s = session(items, { kind: 'fix', tier: 2 });
    const inLiked = new Set(items.filter((i) => i.tier === 2).map((i) => i.id));
    expect(s.settled).toEqual({ checked: 0, total: inLiked.size - 1 });
    for (let k = 0; k < 6; k++) {
      const q = pickQ(s);
      expect(inLiked.has(q.a.id) && inLiked.has(q.b.id)).toBe(true);
      expect(q).toMatchObject({ placing: null, nth: k, total: 0 });
      expect(q.a.strength!).toBeGreaterThanOrEqual(q.b.strength!);
      s.answer(k % 3 === 0 ? 'same' : 'a');
    }
    expect(s.changes().every((c) => inLiked.has(c.id))).toBe(true);
    let guard = 0;
    while (s.question !== null && guard++ < 100) { expect(inLiked.has(pickQ(s).a.id)).toBe(true); s.answer('skip'); }
    expect(s.question).toBeNull();
    expect(guard).toBeLessThan(100);
  });

  test('a one-title tier has nothing to ask', () => {
    expect(session([...top14(), typed('fine', 7)], { kind: 'fix', tier: 1 }).question).toBeNull();
    expect(session([typed('a', 9.5, true), typed('b', 9.2, true)], { kind: 'fix', tier: null }).question).toBeNull();
  });

  test('the settledness bar fills as neighbours are asked', () => {
    const s = session([typed('a', 9.5), typed('b', 9.4), typed('c', 9.1)], { kind: 'fix', tier: 3 });
    expect(s.settled).toEqual({ checked: 0, total: 2 });
    s.answer('a');
    expect(s.settled.checked).toBeGreaterThanOrEqual(1);
  });
});

describe('place mode', () => {
  test('place mode: about log2(n)+1 picks, then the next id; Skip keeps the estimate', () => {
    const items = [...top14(), ...liked(40), typed('new1', 8.2), typed('new2', 8.2)];
    const s = session(items, { kind: 'place', ids: ['new1', 'new2'] });
    let q = pickQ(s);
    expect(q).toMatchObject({ placing: { id: 'new1' }, nth: 1, total: 2 });
    let picks = 0;
    while (pickQ(s).placing!.id === 'new1') {
      q = pickQ(s);
      expect(q.a.id).toBe('new1'); expect(q.b.tier).toBe(2);
      s.answer('a'); picks++;
    }
    // 41 other Liked titles: ⌈log2(42)⌉ = 6 picks at most.
    expect(picks).toBeGreaterThanOrEqual(1); expect(picks).toBeLessThanOrEqual(6);
    expect(pickQ(s)).toMatchObject({ placing: { id: 'new2' }, nth: 2, total: 2 });
    s.answer('b');
    const new2 = s.changes().find((c) => c.id === 'new2');
    expect(new2).toBeDefined();
    s.answer('skip');
    expect(s.question).toBeNull();
    expect(s.changes().find((c) => c.id === 'new2')).toEqual(new2); // the estimate is kept
    expect(s.payload().done).toEqual(['new1', 'new2']);
    expect(s.changes().find((c) => c.id === 'new1')!.rating).toBeGreaterThan(8.2);
  });

  test('Stop ends the session and keeps the estimate; done lists only the titles reached', () => {
    const s = session([...liked(10), typed('n1', 8.0), typed('n2', 8.0)], { kind: 'place', ids: ['n1', 'n2'] });
    s.answer('a');
    s.answer('stop');
    expect(s.question).toBeNull();
    expect(s.payload().done).toEqual(['n1']);
    expect(s.changes().map((c) => c.id)).toContain('n1');
  });
});

describe('unrated mode', () => {
  test('unrated mode: tier question first, then placement in that tier', () => {
    const s = session([...top14(), ...liked(5), blank('u1'), blank('u2')], { kind: 'unrated', ids: ['u1', 'u2'] });
    expect(s.question).toMatchObject({ kind: 'tier', item: { id: 'u1' }, nth: 1, total: 2 });
    s.answer('a'); // not a pick question: ignored
    expect(s.question).toMatchObject({ kind: 'tier', item: { id: 'u1' } });
    s.chooseTier(2);
    const q = pickQ(s);
    expect(q.placing).toMatchObject({ id: 'u1', tier: 2, rating: 8.3, priorMean: 0 });
    expect(q.b.tier).toBe(2);
    s.back(); // undoes the tier choice
    expect(s.question).toMatchObject({ kind: 'tier', item: { id: 'u1' } });
    s.chooseTier(3);
    expect(pickQ(s).b.tier).toBe(3);
    s.answer('skip');
    expect(s.question).toMatchObject({ kind: 'tier', item: { id: 'u2' }, nth: 2 });
    expect(s.payload().moves).toEqual([{ id: 'u1', tier: 3 }]);
    expect(s.changes().find((c) => c.id === 'u1')).toMatchObject({ old: null, oldTier: null, tier: 3, rating: 9.5 });
  });
});

describe('moves', () => {
  test('moving the placed title restarts placement in its new tier, earlier picks still count', () => {
    const s = session([...top14(), ...liked(8), typed('x', 9.4)], { kind: 'place', ids: ['x'] });
    const q = pickQ(s);
    expect(q.b.tier).toBe(3);
    s.answer('b');
    s.move('x', 2);
    const r = pickQ(s);
    expect(r.placing).toMatchObject({ id: 'x', tier: 2 });
    expect(r.b.tier).toBe(2);
    expect(s.asked).toBe(1);
    expect(s.payload().picks).toEqual([{ winnerId: q.b.id, loserId: 'x', isTie: false, undone: false }]);
    expect(s.payload().moves).toEqual([{ id: 'x', tier: 2 }]);
    // x keeps its rough place: it was near the bottom of Loved, so it starts near the top of Liked.
    expect(r.placing!.rating!).toBeGreaterThan(8.8);
    expect(r.placing!.rating!).toBeLessThanOrEqual(tierRange(DEFAULT_TIERS, 2)[1]);
  });
});

describe('changes', () => {
  test('changes(): old → new with tiers; nothing for untouched titles', () => {
    const s = session(top14(), { kind: 'fix', tier: 3 });
    expect(s.changes()).toEqual([]);
    while (pickQ(s).a.id !== 'Cyberpunk: Edgerunners' && s.asked < 20) s.answer('skip');
    expect(pickQ(s)).toMatchObject({ a: { id: 'Cyberpunk: Edgerunners' }, b: { id: 'Fullmetal Alchemist: Brotherhood' } });
    s.answer('b');
    expect(s.changes()).toEqual([
      { id: 'Fullmetal Alchemist: Brotherhood', title: 'Fullmetal Alchemist: Brotherhood', old: 10, rating: 9.98, oldTier: 3, tier: 3 },
      { id: 'Cyberpunk: Edgerunners', title: 'Cyberpunk: Edgerunners', old: 10, rating: 9.96, oldTier: 3, tier: 3 },
    ]);
  });
});

describe('moves match the Worker', () => {
  test('a move into the current tier does nothing', () => {
    const s = session([...top14(), ...liked(3)], { kind: 'fix', tier: null });
    s.move('Attack on Titan', 2);
    expect(s.canBack).toBe(false);
    expect(s.payload().moves).toEqual([]);
    expect(s.changes()).toEqual([]);
  });

  test('a title moved away and back is restored unchanged and leaves the payload', () => {
    const s = session([typed('x', 8.25), typed('y', 8.0), typed('z', 9.5)], { kind: 'fix', tier: null });
    s.move('x', 3);
    expect(s.payload().moves).toEqual([{ id: 'x', tier: 3 }]);
    s.move('x', 2);
    expect(s.payload().moves).toEqual([]);
    expect(s.changes()).toEqual([]); // still 8.25, not 8.3
    expect(s.canBack).toBe(true);
    s.back();
    expect(s.payload().moves).toEqual([{ id: 'x', tier: 3 }]);
  });

  test('repeated moves are built from the stored item with the final tier', () => {
    const base = typed('x', 2.28);
    const s = session([base, typed('y', 8.0), typed('w', 7.0)], { kind: 'fix', tier: null });
    s.move('x', 2); s.move('x', 1);
    expect(s.payload().moves).toEqual([{ id: 'x', tier: 1 }]);
    expect(s.changes()).toEqual([{ id: 'x', title: 'x', old: 2.28, rating: applyMove(base, 1, DEFAULT_TIERS).rating, oldTier: 0, tier: 1 }]);
  });

  // What the Worker does on Save: apply the payload's moves to its stored rows, then fit with the
  // stored comparisons plus the picks not undone.
  function workerChanges(base: { items: RatedItem[]; comparisons: Comparison[] }, payload: SavePayload): RatingChange[] {
    const stored = new Map(base.items.map((i) => [i.id, i]));
    const moved = new Map(stored);
    for (const m of payload.moves) {
      const b = stored.get(m.id);
      if (b !== undefined && b.tier !== m.tier) moved.set(m.id, applyMove(b, m.tier, DEFAULT_TIERS));
    }
    const comps: Comparison[] = [
      ...base.comparisons,
      ...payload.picks.filter((p) => !p.undone).map((p, k) => ({ id: `w${k}`, winnerId: p.winnerId, loserId: p.loserId, isTie: p.isTie, createdAt: '', undoneAt: null })),
    ];
    const items = new Map(moved);
    for (const c of refitSet([...moved.values()], comps, DEFAULT_TIERS)) items.set(c.id, c);
    const out: (RatingChange & { strength: number | null })[] = [];
    for (const [id, now] of items) {
      const was = stored.get(id)!;
      if (now.rating === null || now.tier === null || (now.rating === was.rating && now.tier === was.tier)) continue;
      out.push({ id, title: now.title, old: was.rating, rating: now.rating, oldTier: was.tier, tier: now.tier, strength: now.strength });
    }
    return out.sort(compareRated).map(({ strength: _, ...c }) => c);
  }

  test('random sessions with moves, Back and Skip preview exactly what the Worker saves (400 sessions)', () => {
    const R = rng(77);
    let moves = 0, backs = 0;
    for (let c = 0; c < 400; c++) {
      const n = 6 + Math.floor(R() * 25);
      const raw = Array.from({ length: n }, (_, i) => {
        const id = `t${String(i).padStart(2, '0')}`;
        return R() < 0.1 ? blank(id) : typed(id, round2(R() * 10), R() < 0.1);
      });
      const randomPick = (k: number): Comparison => {
        const a = Math.floor(R() * n); let b = Math.floor(R() * (n - 1)); if (b >= a) b++;
        return { id: `b${k}`, winnerId: raw[a].id, loserId: raw[b].id, isTie: R() < 0.15, createdAt: '', undoneAt: R() < 0.1 ? 'x' : null };
      };
      const comparisons = Array.from({ length: Math.floor(R() * 2 * n) }, (_, k) => randomPick(k));
      // Stored rows are the Worker's last fit of them.
      const fitted = new Map(raw.map((i) => [i.id, i]));
      for (const ch of refitSet(raw, comparisons, DEFAULT_TIERS)) fitted.set(ch.id, ch);
      const base = { items: [...fitted.values()], comparisons };
      const unrated = base.items.filter((i) => i.tier === null).map((i) => i.id);
      const someIds = base.items.filter(() => R() < 0.3).map((i) => i.id);
      const modes: SessionMode[] = [
        { kind: 'fix', tier: null }, { kind: 'fix', tier: Math.floor(R() * 4) as Tier },
        { kind: 'place', ids: someIds }, { kind: 'unrated', ids: unrated },
      ];
      const s = createRatingSession({ ...base, tiers: DEFAULT_TIERS }, modes[c % 4]);
      for (let k = 0; k < 40; k++) {
        const r = R();
        const q = s.question;
        if (q?.kind === 'tier' && r < 0.6) s.chooseTier(Math.floor(R() * 4) as Tier);
        else if (r < 0.3) s.answer('a');
        else if (r < 0.42) s.answer('b');
        else if (r < 0.5) s.answer('same');
        else if (r < 0.6) s.answer('skip');
        else if (r < 0.8) { s.move(base.items[Math.floor(R() * n)].id, Math.floor(R() * 4) as Tier); moves++; }
        else if (r < 0.97) { s.back(); backs++; }
        else s.answer('stop');
      }
      expect(s.changes()).toEqual(workerChanges(base, s.payload()));
    }
    expect(moves).toBeGreaterThan(1000); expect(backs).toBeGreaterThan(1000);
  });
});
