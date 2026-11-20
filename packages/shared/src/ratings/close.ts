import { countedPicks } from './fit';
import { sigmoid } from './score';
import type { Comparison } from './types';

/**
 * Number-first rating (docs/plans/2026-11-16-phase5-number-first.md, Rulings N3–N5). The typed
 * number is the truth; picks between CLOSE titles only nudge them, by at most ±0.2, so that close
 * titles are ordered as picked. All arithmetic is in whole hundredths, so it is exact and
 * deterministic. Pure: the Worker and the device run the same code.
 */

/** Two titles are close when their typed numbers are at most this many hundredths apart (N3). */
export const CLOSE_HUNDREDTHS = 30;
/** The largest nudge, in hundredths (N4). */
export const MAX_NUDGE_HUNDREDTHS = 20;
/** 10.00 in hundredths: the top of the scale. */
const SCALE_MAX = 1000;
/** Moving titles closer than this (hundredths) share a cluster; further apart they can never cross. */
const CLUSTER_HUNDREDTHS = 2 * MAX_NUDGE_HUNDREDTHS;
/** The gap a pick opens between two equal numbers (9.6 vs 9.6 → 9.62 / 9.58), then the fallbacks. */
const GAPS = [4, 1, 0] as const;

export const hundredths = (x: number): number => Math.round(x * 100);
export const isClose = (a: number, b: number): boolean => Math.abs(hundredths(a) - hundredths(b)) <= CLOSE_HUNDREDTHS;

/** A pair's key: the two ids sorted, joined by `~`. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);

type PickRow = Pick<Comparison, 'winnerId' | 'loserId' | 'isTie' | 'undoneAt'>;

export interface NfItem { id: string; typed: number | null }
export interface NfResult {
  /** What the title shows (and what is stored as `rating`). */
  rating: number;
  /** The shown value before the display rounding, in hundredths (the list's tie-break). */
  hundredths: number;
  /** Whether the nudge moved it off its typed number. */
  moved: boolean;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The picks that count (N3): not undone, two different rated titles of the set, close now. Sorted. */
export function closePicks<C extends PickRow>(items: readonly NfItem[], comparisons: readonly C[]): C[] {
  const t = new Map<string, number>();
  for (const i of items) if (i.typed !== null) t.set(i.id, hundredths(i.typed));
  return countedPicks(new Set(t.keys()), comparisons)
    .filter((c) => Math.abs(t.get(c.winnerId)! - t.get(c.loserId)!) <= CLOSE_HUNDREDTHS);
}

interface Node { id: string; T: number; typed: number; strength: number }

/**
 * Shown numbers for every rated item of one rating set (Rulings N4, N5). Unrated items are left
 * out. A title with no counted pick shows exactly its typed number.
 */
export function numberFirst(items: readonly NfItem[], comparisons: readonly PickRow[]): Map<string, NfResult> {
  const rated = items.filter((i): i is NfItem & { typed: number } => i.typed !== null)
    .sort((a, b) => cmpStr(a.id, b.id));
  const picks = closePicks(rated, comparisons);
  const T = new Map(rated.map((i) => [i.id, hundredths(i.typed)]));

  // Strength: one Bradley–Terry gradient step from the typed numbers (prior sd 1, in points).
  // Cheap (O(picks)) and only used to choose between titles no pick orders, and to tell a tie.
  const strength = new Map(rated.map((i) => [i.id, T.get(i.id)! / 100]));
  for (const p of picks) {
    const w = T.get(p.winnerId)! / 100, l = T.get(p.loserId)! / 100;
    const r = (p.isTie ? 0.5 : 1) - sigmoid(w - l);
    strength.set(p.winnerId, strength.get(p.winnerId)! + r);
    strength.set(p.loserId, strength.get(p.loserId)! - r);
  }

  const s = new Map<string, number>(rated.map((i) => [i.id, T.get(i.id)!]));
  const inPick = new Set<string>();
  for (const p of picks) { inPick.add(p.winnerId); inPick.add(p.loserId); }
  const moving: Node[] = rated.filter((i) => inPick.has(i.id))
    .map((i) => ({ id: i.id, T: T.get(i.id)!, typed: i.typed, strength: strength.get(i.id)! }))
    .sort((a, b) => b.T - a.T || cmpStr(a.id, b.id));
  // Clusters: runs of moving titles (by T) whose neighbours are at most 0.4 apart.
  let start = 0;
  for (let k = 1; k <= moving.length; k++) {
    if (k === moving.length || moving[k - 1]!.T - moving[k]!.T > CLUSTER_HUNDREDTHS) {
      solveCluster(moving.slice(start, k), picks, s);
      start = k;
    }
  }
  return display(rated, s);
}

/** Orders one cluster (Kahn over picks and the > 0.3 typed order) and assigns its values into `s`. */
function solveCluster(nodes: Node[], picks: readonly PickRow[], s: Map<string, number>): void {
  if (nodes.length === 0) return;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const k = nodes.length;
  const out: number[][] = nodes.map(() => []);
  const indeg = new Int32Array(k);
  const decisive = new Set<string>();
  const tied = new Set<string>();
  for (const p of picks) {
    let w = idx.get(p.winnerId), l = idx.get(p.loserId);
    if (w === undefined || l === undefined) continue;
    if (p.isTie) {
      tied.add(pairKey(p.winnerId, p.loserId));
      // "About the same" never reorders: the higher typed number stays first (equal numbers: no edge).
      if (nodes[w]!.T === nodes[l]!.T) continue;
      if (nodes[w]!.T < nodes[l]!.T) [w, l] = [l, w];
    } else {
      decisive.add(pairKey(p.winnerId, p.loserId));
    }
    out[w]!.push(l); indeg[l]!++;
  }
  // nodes are sorted by T desc: the first unplaced one has the highest remaining T.
  const placed = new Uint8Array(k);
  let top = 0;
  const better = (a: Node, b: Node) => a.strength > b.strength || (a.strength === b.strength && (a.T > b.T || (a.T === b.T && a.id < b.id)));
  const order: Node[] = [];
  for (let step = 0; step < k; step++) {
    while (placed[top]) top++;
    const maxT = nodes[top]!.T;
    let best = -1, bestFree = -1;
    for (let i = 0; i < k; i++) {
      if (placed[i] || nodes[i]!.T < maxT - CLOSE_HUNDREDTHS) continue;
      if (bestFree < 0 || better(nodes[i]!, nodes[bestFree]!)) bestFree = i;
      if (indeg[i] === 0 && (best < 0 || better(nodes[i]!, nodes[best]!))) best = i;
    }
    // No title is free of pick constraints: the picks (and ties) form a cycle; break it at the strongest.
    const chosen = best >= 0 ? best : bestFree;
    placed[chosen] = 1;
    order.push(nodes[chosen]!);
    for (const l of out[chosen]!) indeg[l]!--;
  }

  for (const G of GAPS) {
    const D = new Array<number>(k).fill(0);
    for (let j = 1; j < k; j++) {
      const a = order[j - 1]!, b = order[j]!;
      let gap: number;
      if (a.T > b.T) gap = Math.min(G, a.T - b.T);
      // Equal typed numbers stay equal when the two were called "About the same" (Dan, 2026-11-20: a tie between two
      // 10s pulled them apart because other picks gave them different strengths), or when nothing tells them apart.
      else if (a.T === b.T && !decisive.has(pairKey(a.id, b.id)) && (tied.has(pairKey(a.id, b.id)) || Math.abs(a.strength - b.strength) <= 1e-9)) gap = 0;
      else gap = G;
      D[j] = D[j - 1]! + gap;
    }
    const z = order.map((n, j) => n.T + D[j]!);
    const U = new Array<number>(k), L = new Array<number>(k);
    // Shown scores stay within 0–10 (Dan, 2026-11-19: two 10s compared went above 10): the top of a
    // tie at 10 stays 10.00 and the other drops below it, never the reverse.
    for (let j = 0; j < k; j++) U[j] = Math.min(j > 0 ? U[j - 1]! : Infinity, Math.min(order[j]!.T + MAX_NUDGE_HUNDREDTHS, SCALE_MAX) + D[j]!);
    for (let j = k - 1; j >= 0; j--) L[j] = Math.max(j < k - 1 ? L[j + 1]! : -Infinity, Math.max(order[j]!.T - MAX_NUDGE_HUNDREDTHS, 0) + D[j]!);
    if (G > 0 && order.some((_, j) => L[j]! > U[j]!)) continue;
    const w = poolNonIncreasing(z);
    order.forEach((n, j) => {
      const v = Math.round(Math.min(U[j]!, Math.max(L[j]!, w[j]!)));
      s.set(n.id, v - D[j]!);
    });
    return;
  }
}

/** Least-squares non-increasing fit (pool adjacent violators). Block sums are integers, so exact. */
function poolNonIncreasing(z: number[]): number[] {
  const sums: number[] = [], counts: number[] = [];
  for (const v of z) {
    sums.push(v); counts.push(1);
    while (sums.length > 1 && sums[sums.length - 2]! * counts[counts.length - 1]! < sums[sums.length - 1]! * counts[counts.length - 2]!) {
      const s = sums.pop()!, c = counts.pop()!;
      sums[sums.length - 1]! += s; counts[counts.length - 1]! += c;
    }
  }
  const out: number[] = [];
  sums.forEach((s, b) => { for (let c = 0; c < counts[b]!; c++) out.push(s / counts[b]!); });
  return out;
}

/** Rule N5: what each title shows. */
function display(rated: (NfItem & { typed: number })[], s: Map<string, number>): Map<string, NfResult> {
  const T = (i: NfItem & { typed: number }) => hundredths(i.typed);
  const byValue = new Map<number, (NfItem & { typed: number })[]>();
  for (const i of rated) {
    const v = s.get(i.id)!;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(i);
  }
  const values = [...byValue.keys()].sort((a, b) => b - a);
  const tenth = (v: number) => Math.round(v / 10);
  const out = new Map<string, NfResult>();
  values.forEach((v, g) => {
    const members = byValue.get(v)!;
    const pinned = members.some((i) => T(i) === v);
    let shown = v / 100;
    if (v % 10 !== 0 && !pinned) {
      const t = tenth(v);
      const apart = (g === 0 || tenth(values[g - 1]!) !== t) && (g === values.length - 1 || tenth(values[g + 1]!) !== t);
      if (apart && members.every((i) => Math.abs(t * 10 - T(i)) <= MAX_NUDGE_HUNDREDTHS)) shown = t / 10;
    }
    for (const i of members) {
      const moved = v !== T(i);
      out.set(i.id, { rating: moved ? shown : i.typed, hundredths: v, moved });
    }
  });
  return out;
}

// ---- Questions (N6, N7) --------------------------------------------------------------------

export interface CloseItem { id: string; title: string; typed: number | null; planned: boolean }

/** Pairs that already have a pick (not undone): never asked again. */
export function answeredPairs(comparisons: readonly PickRow[]): Set<string> {
  const out = new Set<string>();
  for (const c of comparisons) if (c.undoneAt === null && c.winnerId !== c.loserId) out.add(pairKey(c.winnerId, c.loserId));
  return out;
}

const askable = (items: readonly CloseItem[]) =>
  items.filter((i): i is CloseItem & { typed: number } => i.typed !== null && !i.planned);

/**
 * The titles to ask about after `id` was rated (N6): close to it, unanswered, not planned; nearest
 * typed number first, then title, then id. At most `max`.
 */
export function closeQuestionsFor(id: string, items: readonly CloseItem[], comparisons: readonly PickRow[], max = 2): string[] {
  const me = askable(items).find((i) => i.id === id);
  if (me === undefined) return [];
  const t = hundredths(me.typed);
  const answered = answeredPairs(comparisons);
  const settled = settledBy(comparisons);
  return askable(items)
    .filter((i) => i.id !== id && Math.abs(hundredths(i.typed) - t) <= CLOSE_HUNDREDTHS && !answered.has(pairKey(id, i.id)) && !settled(id, i.id))
    .map((i) => ({ i, d: Math.abs(hundredths(i.typed) - t) }))
    .sort((a, b) => a.d - b.d || a.i.title.localeCompare(b.i.title) || cmpStr(a.i.id, b.i.id))
    .slice(0, max)
    .map(({ i }) => i.id);
}

/**
 * Order already settled by picks, transitively: a beat b, and b beat c, settles a vs c (Dan,
 * 2026-11-19: a friend spent ages in Sharpen because every pair within 0.3 was asked, so 20
 * titles around 9.x gave 190 questions). "About the same" joins two titles into one group, so
 * a = b and b beat c settles a vs c too.
 */
function settledBy(comparisons: readonly PickRow[]): (a: string, b: string) => boolean {
  const active = comparisons.filter((c) => c.undoneAt === null && c.winnerId !== c.loserId);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const c of active) if (c.isTie) { const ra = find(c.winnerId), rb = find(c.loserId); if (ra !== rb) parent.set(ra, rb); }
  const beats = new Map<string, string[]>();
  for (const c of active) {
    if (c.isTie) continue;
    const w = find(c.winnerId), l = find(c.loserId);
    const xs = beats.get(w);
    if (xs === undefined) beats.set(w, [l]); else xs.push(l);
  }
  const memo = new Map<string, Set<string>>();
  const below = (id: string): Set<string> => {
    let out = memo.get(id);
    if (out !== undefined) return out;
    out = new Set();
    const stack = [...(beats.get(id) ?? [])];
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (out.has(x)) continue;
      out.add(x);
      for (const y of beats.get(x) ?? []) stack.push(y);
    }
    memo.set(id, out);
    return out;
  };
  return (a, b) => {
    const ra = find(a), rb = find(b);
    return ra === rb || below(ra).has(rb) || below(rb).has(ra);
  };
}

/**
 * Calls `f(a, b, d)` for each close pair still worth asking (a before b in id order), d = distance
 * in hundredths. Only NEIGHBOURS in the current shown order are asked (like an insertion sort):
 * once every close neighbour pair is picked, the order is fully set, so at most n − 1 questions
 * are open at a time instead of every pair within 0.3. Pairs already picked, or settled through
 * other picks, are skipped.
 */
function forEachClosePair(items: readonly CloseItem[], comparisons: readonly PickRow[], f: (a: string, b: string, d: number, top: number) => void): void {
  const rated = askable(items);
  const shown = numberFirst(rated, comparisons);
  const xs = rated.map((i) => ({ id: i.id, T: hundredths(i.typed), S: shown.get(i.id)?.hundredths ?? hundredths(i.typed) }))
    .sort((a, b) => b.S - a.S || b.T - a.T || cmpStr(a.id, b.id));
  const answered = answeredPairs(comparisons);
  const settled = settledBy(comparisons);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]!, b = xs[i + 1]!;
    const d = Math.abs(a.T - b.T);
    if (d > CLOSE_HUNDREDTHS) continue;
    if (answered.has(pairKey(a.id, b.id)) || settled(a.id, b.id)) continue;
    f(a.id < b.id ? a.id : b.id, a.id < b.id ? b.id : a.id, d, Math.max(a.T, b.T));
  }
}

/** How many close questions are open for a set now (N7): neighbour pairs only, see forEachClosePair. */
export function countClosePairs(items: readonly CloseItem[], comparisons: readonly PickRow[]): number {
  let n = 0;
  forEachClosePair(items, comparisons, () => { n++; });
  return n;
}

/** The unanswered close pairs, nearest numbers first, then the higher numbers, then ids; at most `limit` (N7). */
export function closePairs(items: readonly CloseItem[], comparisons: readonly PickRow[], limit = 200): [string, string][] {
  const buckets: { a: string; b: string; top: number }[][] = Array.from({ length: CLOSE_HUNDREDTHS + 1 }, () => []);
  forEachClosePair(items, comparisons, (a, b, d, top) => { buckets[d]!.push({ a, b, top }); });
  const out: [string, string][] = [];
  for (const bucket of buckets) {
    bucket.sort((x, y) => y.top - x.top || cmpStr(x.a, y.a) || cmpStr(x.b, y.b));
    for (const p of bucket) {
      if (out.length >= limit) return out;
      out.push([p.a, p.b]);
    }
  }
  return out;
}
