// A line-by-line port of the Sheet script's compare scoring (reference/MediaTrackerCovers.gs, COMPARE_HTML:
// rescore and placeScore). Float comparisons and rounding are kept exactly as the script has them.
import type { CompareItem, CompareRoom, CompareStyle, RatingChange } from './types';

/** The two ids sorted, joined by `~` (the script's `pk`). */
export const pairKey = (a: CompareItem, b: CompareItem): string => [a.id, b.id].sort().join('~');
/** `winner>loser`, the key recorded when the person picks a winner. */
export const betterKey = (winner: CompareItem, loser: CompareItem): string => `${winner.id}>${loser.id}`;

// The script multiplies ratings directly; JS turns null into 0 there.
const num = (x: number | null): number => x ?? 0;

/**
 * New ratings for an order the person chose. Works in tenths (hundredths if any score has two decimals),
 * so untouched scores stay exactly as they are and new ones look like the ones typed.
 */
export function rescore(order: CompareItem[], better: Set<string>, ties: Set<string>, style: CompareStyle): RatingChange[] {
  const U = order.every((o) => Math.abs(num(o.rating) * 10 - Math.round(num(o.rating) * 10)) < 1e-6) ? 10 : 100, G = U / 10;
  const n = order.length, r = order.map((o) => Math.round(num(o.rating) * U)), strict: boolean[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = order[i], b = order[i + 1];
    if (ties.has(pairKey(a, b))) strict[i] = false;
    else if (better.has(betterKey(a, b))) strict[i] = true;
    else if (r[i] === r[i + 1]) strict[i] = false;
    else strict[i] = true;
  }
  let v: number[];
  if (style === 'Swap the numbers') {
    v = r.slice().sort((x, y) => y - x);
  } else {
    // "Meet in the middle": the smallest changes that put things in the chosen order, 0.1 apart.
    const k = [0]; for (let i = 1; i < n; i++) k[i] = k[i - 1] + (strict[i - 1] ? G : 0);
    const s = r.map((x, i) => x + k[i]);
    type Block = { sum: number; w: number; start: number; end: number };
    const blocks: Block[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && !strict[i - 1]) { const b = blocks[blocks.length - 1]; b.sum += s[i]; b.w++; b.end = i; }
      else blocks.push({ sum: s[i], w: 1, start: i, end: i });
    }
    const st: Block[] = [];
    blocks.forEach((b) => {
      st.push(b);
      while (st.length > 1 && st[st.length - 2].sum / st[st.length - 2].w < st[st.length - 1].sum / st[st.length - 1].w) {
        const top = st.pop()!, prev = st.pop()!;
        st.push({ sum: prev.sum + top.sum, w: prev.w + top.w, start: prev.start, end: top.end });
      }
    });
    const out: number[] = new Array(n);
    st.forEach((b) => { for (let i = b.start; i <= b.end; i++) out[i] = Math.round(b.sum / b.w - k[i]); });
    v = out;
  }
  // Tied neighbours share a score; then keep everything in order and within 1-10.
  for (let i = 0; i < n;) {
    let j = i; while (j < n - 1 && !strict[j]) j++;
    if (j > i) { const avg = Math.round(v.slice(i, j + 1).reduce((x, y) => x + y, 0) / (j - i + 1)); for (let t = i; t <= j; t++) v[t] = avg; }
    i = j + 1;
  }
  v[0] = Math.min(v[0], 10 * U);
  for (let i = 1; i < n; i++) v[i] = strict[i - 1] ? Math.min(v[i], v[i - 1] - (style === 'Swap the numbers' ? 0 : G)) : Math.min(v[i], v[i - 1]);
  return order.map((o, i) => ({ id: o.id, title: o.title, old: o.isNew ? null : o.rating, isNew: !!o.isNew, rating: Math.max(0, v[i]) / U }))
    // Script: `c.isNew || Math.round(c.old * U) !== Math.round(c.rating * U)`; old is a number (or null → 0) here.
    .filter((c) => c.isNew || Math.round(num(c.old) * U) !== Math.round(c.rating * U));
}

/**
 * Placing ONE title (a new or unrated one): only that title's score changes. If the two neighbours are too
 * close for a whole-tenth score in between, `room` decides: an in-between score like 9.45, or the same score
 * as the one just above. Returns null for 'Push others down': the caller falls back to `rescore`.
 * Precondition: `tie`, when given, is a rated item (non-null rating), as in the script.
 */
export function placeScore(order: CompareItem[], idx: number, tie: CompareItem | null, room: CompareRoom): RatingChange[] | null {
  const me = order[idx], above = order[idx - 1] as CompareItem | undefined, below = order[idx + 1] as CompareItem | undefined;
  const keep = (val: number): RatingChange[] => {
    const old = me.isNew ? null : me.rating;
    return old != null && Math.round(old * 100) === Math.round(val * 100) ? []
      : [{ id: me.id, title: me.title, old, isNew: !!me.isNew, rating: val }];
  };
  if (room === 'Push others down') return null; // use the old whole-list re-score
  if (tie) return keep(num(tie.rating));
  const hi = above ? above.rating : null, lo = below ? below.rating : null;
  const r = me.isNew ? null : me.rating;
  if (r != null && (hi == null || r < hi) && (lo == null || r > lo)) return keep(r); // already fits
  const r10 = (x: number) => Math.round(x * 10) / 10, r100 = (x: number) => Math.round(x * 100) / 100;
  if (hi == null) { const t = Math.min(10, r10(num(lo) + 0.2)); return keep(t > num(lo) ? t : 10); }
  if (lo == null) return keep(Math.max(0, r10(hi - 0.3)));
  const mid = (hi + lo) / 2, t = r10(mid);
  if (t < hi && t > lo) return keep(t);
  if (room === 'Give the same score' || hi - lo < 0.02) return keep(hi);
  return keep(r100(mid)); // e.g. 9.45 between 9.5 and 9.4
}
