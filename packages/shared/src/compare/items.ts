// Turning entries into Compare items, and the lists the Compare home screen offers
// (reference/MediaTrackerCovers.gs: getRatedItems, getUnratedCompleted_, openCompareDialog).
import { CATEGORY_CONFIG, type Category, type Entry } from '../types';
import type { CompareItem } from './types';

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export const toCompareItem = (e: Entry): CompareItem =>
  ({ id: e.id, title: e.title, rating: e.rating, cover: e.coverUrl, square: CATEGORY_CONFIG[e.category].square });

/** Every rated entry, best first: rating desc, then title (collator), then id (Ruling P2). */
export function ratedItems(entries: Entry[]): CompareItem[] {
  return entries.filter((e) => e.rating !== null && e.title.trim() !== '')
    .sort((a, b) => b.rating! - a.rating! || collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(toCompareItem);
}

/**
 * Finished titles with no rating: status Completed, or any status on lists without a Status column
 * (Movies, Albums, Songs). Categories in the given order, titles by collator within each; at most 300.
 */
export function unratedFinished(byCategory: Partial<Record<Category, Entry[]>>, categories: Category[]): (CompareItem & { category: Category })[] {
  const out: (CompareItem & { category: Category })[] = [];
  for (const category of categories) {
    const hasStatus = CATEGORY_CONFIG[category].hasStatus;
    const picked = (byCategory[category] ?? [])
      .filter((e) => e.rating === null && e.title.trim() !== '' && (!hasStatus || e.status === 'Completed'))
      .sort((a, b) => collator.compare(a.title, b.title));
    for (const e of picked) out.push({ ...toCompareItem(e), category });
  }
  return out.slice(0, 300);
}

/** Lists with at least 2 rated entries, in the given order: the ones a full pass is offered for. */
export function compareLists(byCategory: Partial<Record<Category, Entry[]>>, categories: Category[]): { category: Category; count: number }[] {
  return categories.map((category) => ({ category, count: ratedItems(byCategory[category] ?? []).length }))
    .filter((l) => l.count >= 2);
}
