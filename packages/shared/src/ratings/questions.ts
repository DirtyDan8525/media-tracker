import type { Comparison, RatedItem, Tier } from './types';

/** A pair's key: the two ids sorted, joined by `~`. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);

/** How many counted picks (not undone, two different titles) each pair has. */
function pairCounts(comparisons: readonly Comparison[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of comparisons) {
    if (c.undoneAt !== null || c.winnerId === c.loserId) continue;
    const k = pairKey(c.winnerId, c.loserId);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

interface Neighbours { tier: Tier; index: number; a: RatedItem; b: RatedItem; sa: number; sb: number }

/** Adjacent pairs inside each tier, the tier sorted by strength desc then id. Unrated items are left out. */
function neighbours(items: RatedItem[], strengths: Map<string, number>): Neighbours[] {
  const str = (i: RatedItem) => strengths.get(i.id) ?? i.strength ?? i.priorMean ?? 0;
  const out: Neighbours[] = [];
  for (const tier of [3, 2, 1, 0] as Tier[]) {
    const order = items.filter((i) => i.tier === tier)
      .sort((a, b) => str(b) - str(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let k = 0; k + 1 < order.length; k++) {
      out.push({ tier, index: k, a: order[k], b: order[k + 1], sa: str(order[k]), sb: str(order[k + 1]) });
    }
  }
  return out;
}

/**
 * The most useful next question (spec §5.2): of the adjacent pairs inside each tier, the one with
 * the fewest picks so far, then the closest strengths, then the higher tier, then the higher pair.
 * Skipped pairs and pairs of two locked titles are never asked. Returns [stronger, weaker], or
 * null when nothing is left to ask.
 */
export function nextPair(
  items: RatedItem[], comparisons: Comparison[], strengths: Map<string, number>, skipped: ReadonlySet<string>,
): [string, string] | null {
  const counts = pairCounts(comparisons);
  let best: { n: Neighbours; count: number; gap: number } | null = null;
  for (const n of neighbours(items, strengths)) {
    const key = pairKey(n.a.id, n.b.id);
    if (skipped.has(key) || (n.a.scoreLocked && n.b.scoreLocked)) continue;
    const count = counts.get(key) ?? 0, gap = Math.abs(n.sa - n.sb);
    if (best === null
      || count < best.count
      || (count === best.count && (gap < best.gap
        || (gap === best.gap && (n.tier > best.n.tier
          || (n.tier === best.n.tier && n.index < best.n.index)))))) {
      best = { n, count, gap };
    }
  }
  return best === null ? null : [best.n.a.id, best.n.b.id];
}

/**
 * "N of M neighbours checked" (Ruling Q18): adjacent pairs inside each tier, checked when the two
 * have a counted pick between them directly or are both locked. M = 0 means fully settled.
 */
export function settledness(items: RatedItem[], comparisons: Comparison[], strengths: Map<string, number>): { checked: number; total: number } {
  const counts = pairCounts(comparisons);
  const ns = neighbours(items, strengths);
  const checked = ns.filter((n) => (n.a.scoreLocked && n.b.scoreLocked) || (counts.get(pairKey(n.a.id, n.b.id)) ?? 0) > 0).length;
  return { checked, total: ns.length };
}

/**
 * A binary search for a title's place in a tier (Ruling Q13), over the tier's order (strongest
 * first, without the placed title) frozen at the start. The title belongs at index `lo` once done.
 */
export interface Placement { order: string[]; lo: number; hi: number; done: boolean }

export const startPlacement = (order: string[]): Placement =>
  ({ order: [...order], lo: 0, hi: order.length, done: order.length === 0 });

/** The title to compare with next, or null when placement is done. */
export function placementNext(p: Placement): string | null {
  return p.done ? null : p.order[Math.floor((p.lo + p.hi) / 2)];
}

/** `a`: the placed title is better than the opponent; `b`: worse; `same`: ends the search there. */
export function placementAnswer(p: Placement, a: 'a' | 'b' | 'same'): Placement {
  if (p.done) return p;
  const mid = Math.floor((p.lo + p.hi) / 2);
  if (a === 'same') return { ...p, lo: mid, hi: mid, done: true };
  const lo = a === 'b' ? mid + 1 : p.lo, hi = a === 'a' ? mid : p.hi;
  return { ...p, lo, hi, done: lo >= hi };
}
