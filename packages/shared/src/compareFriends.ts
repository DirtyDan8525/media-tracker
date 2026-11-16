import { normTitle } from './matching';
import { GROUP_MIN_RATERS, type FriendEntry } from './social';
import type { Category } from './types';

export type Comparable = Pick<FriendEntry, 'id' | 'category' | 'title' | 'rating' | 'coverUrl' | 'source' | 'sourceId'> & {
  isPrivate?: boolean;
};

export interface BothRatedRow {
  title: string;
  category: Category;
  coverUrl: string;
  mine: number;
  theirs: number;
  diff: number;
  myId: string;
  theirId: string;
}

export interface GroupRow {
  title: string;
  coverUrl: string;
  average: number;
  raters: number;
}

const srcKey = (e: Comparable): string | null => (e.source && e.sourceId ? `src:${e.source}:${e.sourceId}` : null);
const titleKey = (e: Comparable): string => `t:${e.category}:${normTitle(e.title)}`;

/** S12: equal source+sourceId when both have them, or equal normTitle within one category. */
export function sameTitle(a: Comparable, b: Comparable): boolean {
  const sa = srcKey(a);
  if (sa && sa === srcKey(b)) return true;
  return titleKey(a) === titleKey(b);
}

/** Groups items that match each other (transitively), indexing each list once through a Map per key. */
function cluster<T extends { e: Comparable }>(items: T[]): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const seen = new Map<string, number>();
  items.forEach((it, i) => {
    for (const k of [srcKey(it.e), titleKey(it.e)]) {
      if (!k) continue;
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, T[]>();
  items.forEach((it, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(it);
  });
  return [...groups.values()];
}

const rated = (e: Comparable): e is Comparable & { rating: number } => typeof e.rating === 'number';
const best = (es: (Comparable & { rating: number })[]) => es.reduce((a, b) => (b.rating > a.rating ? b : a));
const byTitle = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const coverOf = (es: Comparable[]) => es.find((x) => x.coverUrl)?.coverUrl ?? '';

export function bothRated(mine: Comparable[], theirs: Comparable[]): BothRatedRow[] {
  const items = [
    ...mine.filter((e) => !e.isPrivate && rated(e)).map((e) => ({ e: e as Comparable & { rating: number }, mine: true })),
    ...theirs.filter(rated).map((e) => ({ e, mine: false })),
  ];
  const rows: BothRatedRow[] = [];
  for (const g of cluster(items)) {
    const m = g.filter((x) => x.mine).map((x) => x.e);
    const t = g.filter((x) => !x.mine).map((x) => x.e);
    if (!m.length || !t.length) continue;
    const bm = best(m);
    const bt = best(t);
    rows.push({
      title: bt.title,
      category: bt.category,
      coverUrl: bt.coverUrl || bm.coverUrl,
      mine: bm.rating,
      theirs: bt.rating,
      diff: Math.abs(bm.rating - bt.rating),
      myId: bm.id,
      theirId: bt.id,
    });
  }
  return rows.sort((a, b) => b.diff - a.diff || byTitle(a.title, b.title));
}

/** Their rated titles with no match among any of your entries (private and unrated included). */
export function theirsNotYours(mine: Comparable[], theirs: Comparable[], limit = 20): Comparable[] {
  const items = [...mine.map((e) => ({ e, mine: true })), ...theirs.filter(rated).map((e) => ({ e, mine: false }))];
  const out: (Comparable & { rating: number })[] = [];
  for (const g of cluster(items)) {
    if (g.some((x) => x.mine)) continue;
    out.push(best(g.map((x) => x.e as Comparable & { rating: number })));
  }
  return out.sort((a, b) => b.rating - a.rating || byTitle(a.title, b.title)).slice(0, limit);
}

export function groupTop5(
  people: { userId: string; entries: Comparable[] }[],
  minRaters = GROUP_MIN_RATERS,
): GroupRow[] {
  const items = people.flatMap((p) =>
    p.entries.filter((e) => !e.isPrivate && rated(e)).map((e) => ({ e: e as Comparable & { rating: number }, who: p.userId })),
  );
  const rows: (GroupRow & { sort: number })[] = [];
  for (const g of cluster(items)) {
    const per = new Map<string, number>();
    for (const x of g) per.set(x.who, Math.max(per.get(x.who) ?? -Infinity, x.e.rating));
    if (per.size < minRaters) continue;
    const top = best(g.map((x) => x.e));
    const average = [...per.values()].reduce((a, b) => a + b, 0) / per.size;
    rows.push({ title: top.title, coverUrl: coverOf(g.map((x) => x.e)), average, raters: per.size, sort: average });
  }
  return rows
    .sort((a, b) => b.average - a.average || b.raters - a.raters || byTitle(a.title, b.title))
    .slice(0, 5)
    .map(({ sort: _s, ...r }) => r);
}
