import { nextPair, pairKey, placementAnswer, placementNext, settledness, startPlacement, type Placement } from './questions';
import { applyMove, compareRated, refitSet, refitTier } from './shown';
import { tierRange } from './tiers';
import type { Comparison, PickInput, RatedItem, RatingChange, SavePayload, Tier, TierSet } from './types';

export type SessionMode = { kind: 'fix'; tier: Tier | null } | { kind: 'place'; ids: string[] } | { kind: 'unrated'; ids: string[] };

export type SessionQuestion =
  | { kind: 'pick'; a: RatedItem; b: RatedItem; placing: RatedItem | null; nth: number; total: number }
  | { kind: 'tier'; item: RatedItem; nth: number; total: number };

export type SessionAnswer = 'a' | 'b' | 'same' | 'skip' | 'stop';

export interface RatingSession {
  /** null: Stop pressed, or nothing left to ask. */
  readonly question: SessionQuestion | null;
  readonly settled: { checked: number; total: number };
  readonly canBack: boolean;
  /** Picks made in this session and not undone. */
  readonly asked: number;
  answer(a: SessionAnswer): void;
  /** Answers a 'tier' question. */
  chooseTier(t: Tier): void;
  /** "Belongs in another tier". */
  move(id: string, t: Tier): void;
  back(): void;
  /** Titles whose shown score or tier differs from the base, ordered by compareRated of the new values. */
  changes(): RatingChange[];
  payload(): SavePayload;
}

interface PickRecord { winnerId: string; loserId: string; isTie: boolean; undone: boolean; seq: number }

/** Everything that Back restores. Immutable: each action makes a new one. */
interface State {
  /**
   * Base items with this session's moves and tier choices applied (what the fit starts from). A
   * moved title is always `applyMove(base, finalTier)`, and one back in its base tier is the base
   * item itself, exactly as the Worker applies `payload().moves` to its stored rows.
   */
  moved: Map<string, RatedItem>;
  /** Final tier of each title whose tier differs from the base, in the order first moved. */
  finalTiers: Map<string, Tier>;
  picks: PickRecord[];
  /** After the fit: what the session shows now. */
  items: Map<string, RatedItem>;
  skipped: Set<string>;
  stopped: boolean;
  /** Place / unrated modes: the title being placed is ids[cursor]. */
  cursor: number;
  placement: Placement | null;
  reached: string[];
}

type ActionKind = 'pick' | 'skip' | 'move' | 'tier' | 'stop';

const byStrength = (a: RatedItem, b: RatedItem): number =>
  (b.strength ?? 0) - (a.strength ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A rating session (spec §5.2 flows): Fix my ratings, Place it, and rating unrated titles. It
 * starts from the saved items and comparisons and keeps a log of this session's actions; the
 * shown scores are always a re-fit of the base with the session's moves and picks, exactly as
 * the Worker will compute on Save. Nothing is saved here: `payload()` is what Save sends.
 */
export function createRatingSession(
  base: { items: RatedItem[]; comparisons: Comparison[]; tiers: TierSet },
  mode: SessionMode,
  opts?: { priorSd?: number },
): RatingSession {
  const { tiers } = base;
  const baseById = new Map(base.items.map((i) => [i.id, i]));
  const ids = mode.kind === 'fix' ? [] : mode.ids;
  /** Every pick made in the session, in order; Back marks one undone. */
  const allPicks: PickRecord[] = [];
  const log: { kind: ActionKind; state: State }[] = [];

  const comparisonsOf = (picks: PickRecord[]): Comparison[] => [
    ...base.comparisons,
    ...picks.map((p) => ({ id: `session-${p.seq}`, winnerId: p.winnerId, loserId: p.loserId, isTie: p.isTie, createdAt: '', undoneAt: null })),
  ];

  /** The full fit, at the start. */
  const fitAll = (moved: Map<string, RatedItem>, picks: PickRecord[]): Map<string, RatedItem> => {
    const items = new Map(moved);
    for (const c of refitSet([...moved.values()], comparisonsOf(picks), tiers, opts)) items.set(c.id, c);
    return items;
  };

  /**
   * Re-fits only the tiers an action touched. Tiers are fitted independently (a tier's result
   * depends only on its own titles and the picks between them), so this equals a full re-fit.
   */
  const refit = (prev: Map<string, RatedItem>, moved: Map<string, RatedItem>, picks: PickRecord[], touched: (Tier | null)[]) => {
    const items = new Map(prev);
    const comps = comparisonsOf(picks);
    for (const t of new Set(touched)) {
      if (t === null) continue;
      const inTier = [...moved.values()].filter((i) => i.tier === t);
      for (const i of inTier) items.set(i.id, i);
      for (const c of refitTier(inTier, comps, tierRange(tiers, t), opts)) items.set(c.id, c);
    }
    return items;
  };

  /** Place / unrated modes: moves to the next title that still needs a question, starting placements. */
  const advance = (s: State): State => {
    if (mode.kind === 'fix' || s.stopped) return s;
    let { cursor, placement } = s;
    const reached = [...s.reached];
    while (cursor < ids.length) {
      const id = ids[cursor];
      const item = s.items.get(id);
      if (item === undefined) { cursor++; placement = null; continue; }
      if (!reached.includes(id)) reached.push(id);
      if (item.tier === null) break; // a tier question
      if (placement === null) {
        placement = startPlacement([...s.items.values()].filter((i) => i.tier === item.tier && i.id !== id).sort(byStrength).map((i) => i.id));
      }
      if (!placement.done) break;
      cursor++; placement = null;
    }
    return { ...s, cursor, placement, reached };
  };

  let state: State = (() => {
    const moved = new Map(baseById);
    return advance({ moved, finalTiers: new Map(), picks: [], items: fitAll(moved, []), skipped: new Set(), stopped: false, cursor: 0, placement: null, reached: [] });
  })();

  const scope = (s: State): RatedItem[] =>
    [...s.items.values()].filter((i) => i.tier !== null && (mode.kind !== 'fix' || mode.tier === null || i.tier === mode.tier));
  const strengthsOf = (items: RatedItem[]) => new Map(items.map((i) => [i.id, i.strength ?? i.priorMean ?? 0]));

  const questionOf = (s: State): SessionQuestion | null => {
    if (s.stopped) return null;
    if (mode.kind === 'fix') {
      const items = scope(s);
      const pair = nextPair(items, comparisonsOf(s.picks), strengthsOf(items), s.skipped);
      if (pair === null) return null;
      return { kind: 'pick', a: s.items.get(pair[0])!, b: s.items.get(pair[1])!, placing: null, nth: s.picks.length, total: 0 };
    }
    if (s.cursor >= ids.length) return null;
    const item = s.items.get(ids[s.cursor])!;
    const nth = s.cursor + 1, total = ids.length;
    if (item.tier === null) return { kind: 'tier', item, nth, total };
    const opponent = placementNext(s.placement!)!;
    return { kind: 'pick', a: item, b: s.items.get(opponent)!, placing: item, nth, total };
  };

  let question = questionOf(state);
  const commit = (kind: ActionKind, next: State) => {
    log.push({ kind, state });
    state = next;
    question = questionOf(state);
  };

  /**
   * Applies a move or tier choice, or returns null when the title is already in that tier (a
   * no-op). The moved title is built from the base (Q23 keeps its rough place from its stored
   * score); one moved back to its base tier is restored untouched and leaves the payload.
   */
  const moveState = (id: string, t: Tier): State | null => {
    const cur = state.items.get(id)!;
    if (cur.tier === t) return null;
    const base = baseById.get(id)!;
    const moved = new Map(state.moved);
    const finalTiers = new Map(state.finalTiers);
    if (base.tier === t) { moved.set(id, base); finalTiers.delete(id); }
    else { moved.set(id, applyMove(base, t, tiers)); finalTiers.set(id, t); }
    // A move invalidates the frozen tier order, so the current placement restarts.
    return advance({ ...state, moved, finalTiers, items: refit(state.items, moved, state.picks, [cur.tier, t]), placement: null });
  };

  const session: RatingSession = {
    get question() { return question; },
    get settled() {
      const items = mode.kind === 'fix' ? scope(state) : [...state.items.values()].filter((i) => i.tier !== null);
      return settledness(items, comparisonsOf(state.picks), strengthsOf(items));
    },
    get canBack() { return log.some((e) => e.kind === 'pick' || e.kind === 'move' || e.kind === 'tier'); },
    get asked() { return state.picks.length; },

    answer(a) {
      const q = question;
      if (q === null) return;
      if (a === 'stop') { commit('stop', { ...state, stopped: true }); return; }
      if (a === 'skip') {
        if (mode.kind === 'fix') {
          if (q.kind !== 'pick') return;
          const skipped = new Set(state.skipped).add(pairKey(q.a.id, q.b.id));
          commit('skip', { ...state, skipped });
        } else {
          // Skip keeps the estimate so far and goes on to the next title.
          commit('skip', advance({ ...state, cursor: state.cursor + 1, placement: null }));
        }
        return;
      }
      if (q.kind !== 'pick') return;
      const [w, l] = a === 'b' ? [q.b.id, q.a.id] : [q.a.id, q.b.id];
      const rec: PickRecord = { winnerId: w, loserId: l, isTie: a === 'same', undone: false, seq: allPicks.length };
      allPicks.push(rec);
      const picks = [...state.picks, rec];
      const touched = [state.moved.get(w)!.tier, state.moved.get(l)!.tier];
      const next: State = { ...state, picks, items: refit(state.items, state.moved, picks, touched) };
      if (mode.kind !== 'fix') next.placement = placementAnswer(state.placement!, a);
      commit('pick', advance(next));
    },

    chooseTier(t) {
      if (question?.kind !== 'tier') return;
      const next = moveState(question.item.id, t);
      if (next !== null) commit('tier', next);
    },

    move(id, t) {
      const cur = state.items.get(id);
      if (cur === undefined || state.stopped) return;
      const next = moveState(id, t);
      if (next !== null) commit('move', next);
    },

    back() {
      // Pop any skips and stops, then the last pick, move or tier choice (Ruling Q14).
      let k = log.length - 1;
      while (k >= 0 && (log[k].kind === 'skip' || log[k].kind === 'stop')) k--;
      if (k < 0) return;
      const popped = log[k];
      // Only skips and stops follow it, so a popped pick is the last active one. It stays in
      // payload() as undone (the spec's history).
      if (popped.kind === 'pick') state.picks[state.picks.length - 1].undone = true;
      state = popped.state;
      log.length = k;
      question = questionOf(state);
    },

    changes() {
      const out: (RatingChange & { strength: number | null })[] = [];
      for (const [id, now] of state.items) {
        const was = baseById.get(id)!;
        if (now.rating === null || now.tier === null) continue;
        if (now.rating === was.rating && now.tier === was.tier) continue;
        out.push({ id, title: now.title, old: was.rating, rating: now.rating, oldTier: was.tier, tier: now.tier, strength: now.strength });
      }
      return out.sort(compareRated).map(({ strength: _, ...c }) => c);
    },

    payload() {
      const picks: PickInput[] = allPicks.map((p) => ({ winnerId: p.winnerId, loserId: p.loserId, isTie: p.isTie, undone: p.undone }));
      const moves = [...state.finalTiers].map(([id, tier]) => ({ id, tier }));
      return { picks, moves, done: [...state.reached] };
    },
  };

  return session;
}
