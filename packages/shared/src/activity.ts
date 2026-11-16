import type { Category } from './types';

export const ACTIVITY_TYPES = ['added', 'rated', 're-rated', 'status'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityItem {
  id: string;
  type: ActivityType;
  entryId: string;
  category: Category;
  title: string;
  coverUrl: string;
  payload: {
    rating?: number | null;
    status?: string | null;
    from?: number | string | null;
    to?: number | string;
    via?: 'compare';
  };
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  next: { before: string; beforeId: string } | null;
}

/** One displayed line: every row of one entry inside the merge window folded together. */
export interface ActivityLine {
  key: string;
  entryId: string;
  category: Category;
  title: string;
  coverUrl: string;
  at: string;
  added: boolean;
  rating: { from: number | null; to: number } | null;
  status: { from: string | null; to: string } | null;
}

export const ACTIVITY_MERGE_MS = 600_000;

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Folds activity rows (newest first) into lines (B15). A row joins its entry's open group when
 * the group's newest time minus the row's time is within `windowMs`. Within a group the first
 * `from` and the last `to` win; a change that ends where it began (7 to 8 to 7) shows nothing,
 * and a group with nothing left to show is dropped. Lines come out ordered by newest `at`.
 */
export function mergeActivity(items: ActivityItem[], windowMs: number = ACTIVITY_MERGE_MS): ActivityLine[] {
  interface Group {
    newest: ActivityItem;
    rows: ActivityItem[]; // newest first
  }
  const groups: Group[] = [];
  const open = new Map<string, Group>();
  for (const row of items) {
    const g = open.get(row.entryId);
    if (g && Date.parse(g.newest.createdAt) - Date.parse(row.createdAt) <= windowMs) {
      g.rows.push(row);
    } else {
      const fresh: Group = { newest: row, rows: [row] };
      groups.push(fresh);
      open.set(row.entryId, fresh);
    }
  }

  const lines: ActivityLine[] = [];
  for (const g of groups) {
    const oldestFirst = [...g.rows].reverse();
    let added = false;
    let ratingFrom: number | null | undefined;
    let ratingTo: number | null = null;
    let statusFrom: string | null | undefined;
    let statusTo: string | null = null;
    for (const r of oldestFirst) {
      const p = r.payload;
      if (r.type === 'added') {
        added = true;
        if (p.rating !== undefined && p.rating !== null) {
          if (ratingFrom === undefined) ratingFrom = null;
          ratingTo = p.rating;
        }
        if (p.status !== undefined && p.status !== null) {
          if (statusFrom === undefined) statusFrom = null;
          statusTo = p.status;
        }
      } else if (r.type === 'rated' || r.type === 're-rated') {
        if (ratingFrom === undefined) ratingFrom = num(p.from);
        ratingTo = num(p.to);
      } else if (r.type === 'status') {
        if (statusFrom === undefined) statusFrom = str(p.from);
        statusTo = str(p.to);
      }
    }
    const rating =
      ratingTo !== null && ratingFrom !== undefined && ratingFrom !== ratingTo ? { from: ratingFrom, to: ratingTo } : null;
    const status =
      statusTo !== null && statusFrom !== undefined && statusFrom !== statusTo ? { from: statusFrom, to: statusTo } : null;
    if (!added && !rating && !status) continue;
    const n = g.newest;
    lines.push({
      key: n.id,
      entryId: n.entryId,
      category: n.category,
      title: n.title,
      coverUrl: n.coverUrl,
      at: n.createdAt,
      added,
      rating,
      status,
    });
  }
  return lines;
}
