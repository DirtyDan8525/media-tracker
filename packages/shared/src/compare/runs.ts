// Ports of the Sheet script's three Compare runs (reference/MediaTrackerCovers.gs, COMPARE_HTML: fullPass,
// placeOne, placeUnrated). Each run is a generator: it yields a Question, receives the Answer, and returns
// what the script would have shown next (the review screen, or moving on). Float comparisons are as written.
import { betterKey, pairKey, placeScore, rescore } from './score';
import type { Answer, CompareItem, CompareOptions, RatingChange } from './types';

export interface Question { a: CompareItem; b: CompareItem; title: string; progress: string }
export type RunOutcome = { kind: 'review'; changes: RatingChange[] } | { kind: 'skipped' } | { kind: 'nothingToCompare' };
export type CompareRun = Generator<Question, RunOutcome, Answer>;

// The script only ever loads rated items (getRatedItems keeps numbers only); this keeps that true, so every
// `tie` handed to placeScore is rated.
const rated = (items: CompareItem[]): (CompareItem & { rating: number })[] =>
  items.filter((i): i is CompareItem & { rating: number } => i.rating !== null);

/** Goes down the whole list (rated, best first); each item climbs past the ones above it while preferred. */
export function* fullPass(all: CompareItem[], listName: string, opts: CompareOptions): CompareRun {
  const items = rated(all);
  if (!items.length) return { kind: 'review', changes: [] }; // the script never opens a list with < 2
  const order = [items[0]], better = new Set<string>(), ties = new Set<string>();
  let stopped = false, asked = 0;
  for (let i = 1; i < items.length; i++) {
    const x = items[i];
    let pos = order.length;
    if (!stopped) while (pos > 0) {
      const y = order[pos - 1];
      if (y.rating - x.rating > opts.window) break;
      const a: Answer = yield { a: x, b: y, title: listName, progress: 'Going through ' + i + ' of ' + (items.length - 1) + ' · ' + asked + ' picks so far' };
      asked++;
      if (a === 'a') { better.add(betterKey(x, y)); pos--; continue; }
      if (a === 'b') better.add(betterKey(y, x));
      if (a === 'same') ties.add(pairKey(x, y));
      if (a === 'stop') stopped = true;
      break;
    }
    order.splice(pos, 0, x);
  }
  return { kind: 'review', changes: rescore(order, better, ties, opts.style) };
}

/** Slots one new rating in among the ones close to it (a few picks, like a binary search). */
export function* placeOne(all: CompareItem[], entryId: string, listName: string, waiting: number, opts: CompareOptions): CompareRun {
  const items = rated(all);
  const me = items.find((i) => i.id === entryId);
  if (!me) return { kind: 'skipped' };
  const others = items.filter((i) => i !== me), better = new Set<string>(), ties = new Set<string>();
  const near = others.map((o, i) => (Math.abs(o.rating - me.rating) <= opts.window ? i : -1)).filter((i) => i >= 0);
  let lo = 0;
  while (lo < others.length && others[lo].rating > me.rating) lo++; // where its score already puts it
  if (near.length) {
    let L = near[0], H = near[near.length - 1] + 1;
    while (L < H) {
      const mid = (L + H) >> 1, o = others[mid];
      const a: Answer = yield { a: me, b: o, title: 'Placing ' + me.title + ' (' + listName + ')', progress: 'New rating · ' + waiting + ' waiting' };
      if (a === 'a') { better.add(betterKey(me, o)); H = mid; }
      else if (a === 'b') { better.add(betterKey(o, me)); L = mid + 1; }
      else if (a === 'same') { ties.add(pairKey(me, o)); L = mid + 1; H = L; }
      else { L = Math.max(L, Math.min(lo, H)); H = L; }
    }
    lo = L;
  }
  const order: CompareItem[] = others.slice(); order.splice(lo, 0, me);
  const tiedWith = others.find((o) => ties.has(pairKey(me, o))) ?? null;
  return { kind: 'review', changes: placeScore(order, lo, tiedWith, opts.room) ?? rescore(order, better, ties, opts.style) };
}

/** Rates something finished but never scored: a few picks find its spot, then it gets a score between its neighbours. */
export function* placeUnrated(all: CompareItem[], u: CompareItem, listName: string, nth: number, total: number, opts: CompareOptions): CompareRun {
  const items = rated(all).filter((i) => i.id !== u.id);
  if (!items.length) return { kind: 'nothingToCompare' };
  const me: CompareItem = { ...u, rating: null, isNew: true }, better = new Set<string>(), ties = new Set<string>();
  let L = 0, H = items.length, tie: (typeof items)[number] | null = null;
  while (L < H) {
    const mid = (L + H) >> 1, o = items[mid];
    const a: Answer = yield { a: me, b: o, title: 'Rating ' + me.title + ' (' + listName + ')', progress: 'Unrated ' + nth + ' of ' + total };
    if (a === 'a') { better.add(betterKey(me, o)); H = mid; }
    else if (a === 'b') { better.add(betterKey(o, me)); L = mid + 1; }
    else if (a === 'same') { ties.add(pairKey(me, o)); tie = o; L = mid + 1; H = L; }
    else return { kind: 'skipped' };
  }
  const above = items[L - 1] as (typeof items)[number] | undefined, below = items[L] as (typeof items)[number] | undefined;
  const est = tie ? tie.rating : above && below ? (above.rating + below.rating) / 2
    : above ? Math.max(1, above.rating - 0.3) : Math.min(10, below!.rating + 0.2);
  const order: CompareItem[] = items.slice(); order.splice(L, 0, me);
  const placed = placeScore(order, L, tie, opts.room);
  if (placed) return { kind: 'review', changes: placed };
  me.rating = Math.round(est * 10) / 10;
  return { kind: 'review', changes: rescore(order, better, ties, opts.style) };
}
