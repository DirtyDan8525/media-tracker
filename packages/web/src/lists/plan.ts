import { PLAN_STATUS, type Category, type Entry } from '@media-tracker/shared';

export const isPlanned = (e: Pick<Entry, 'status'>): boolean => e.status === PLAN_STATUS;

/** The planned titles in the list's own order: planOrder first (1 = up next), unplaced ones after, by date added. */
export function planRows<T extends Pick<Entry, 'id' | 'status' | 'createdAt'> & { planOrder?: number | null }>(rows: T[]): T[] {
  const key = (e: T) => e.planOrder ?? Number.POSITIVE_INFINITY;
  return rows
    .filter(isPlanned)
    .sort((a, b) => (key(a) === key(b) ? 0 : key(a) < key(b) ? -1 : 1) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** `ids` with `id` taken out and put back at index `to` (a new array; unchanged when `id` is not there). */
export function moveId(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, id);
  return out;
}

export type Step = 'top' | 'up' | 'down';
export function moveStep(ids: string[], id: string, step: Step): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  return moveId(ids, id, step === 'top' ? 0 : step === 'up' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1));
}

/** Where a row dragged `dy` pixels lands: whole rows of `itemH` px, kept inside the list of `count`. */
export function dragTarget(from: number, dy: number, itemH: number, count: number): number {
  if (!(itemH > 0)) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / itemH)));
}

const viewKey = (c: Category) => `mt:plan-view:${c}`;

/** The Plan to watch switch is remembered per list on this device. Storage can be unavailable: then it just starts off. */
export function readPlanView(category: Category): boolean {
  try {
    return localStorage.getItem(viewKey(category)) === '1';
  } catch {
    return false;
  }
}
export function writePlanView(category: Category, on: boolean): void {
  try {
    if (on) localStorage.setItem(viewKey(category), '1');
    else localStorage.removeItem(viewKey(category));
  } catch {
    // not remembered; the switch still works
  }
}
