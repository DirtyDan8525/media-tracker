import { STATUSES, type Entry, type Status } from '@media-tracker/shared';

export interface ListFilter { q: string; status: Status | ''; genre: string }

/** Case-, accent- and spacing-insensitive form of a string, for matching. */
export function foldText(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const splitGenres = (g: string): string[] => g.split(',').map((x) => x.trim()).filter(Boolean);

export const isFiltering = (f: ListFilter): boolean => foldText(f.q) !== '' || f.status !== '' || f.genre !== '';

export function matchesFilter(e: Entry, f: ListFilter): boolean {
  if (f.status && e.status !== f.status) return false;
  if (f.genre) {
    const want = foldText(f.genre);
    if (!splitGenres(e.genres).some((g) => foldText(g) === want)) return false;
  }
  const words = foldText(f.q).split(' ').filter(Boolean);
  if (words.length) {
    const hay = foldText([e.title, e.typedTitle, e.creator, e.album, e.genres].join(' '));
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Every genre in the rows (case-insensitively merged, first spelling kept) with how many entries have it. */
export function genreOptions(rows: Entry[]): { genre: string; count: number }[] {
  const seen = new Map<string, { genre: string; count: number }>();
  for (const e of rows) {
    const once = new Set<string>();
    for (const g of splitGenres(e.genres)) {
      const key = foldText(g);
      if (once.has(key)) continue;
      once.add(key);
      const hit = seen.get(key);
      if (hit) hit.count++;
      else seen.set(key, { genre: g, count: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => collator.compare(a.genre, b.genre));
}

export function readFilter(p: URLSearchParams): ListFilter {
  const status = p.get('status') ?? '';
  return {
    q: p.get('q') ?? '',
    status: (STATUSES as readonly string[]).includes(status) ? (status as Status) : '',
    genre: p.get('genre') ?? '',
  };
}

export function writeFilter(f: ListFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status) p.set('status', f.status);
  if (f.genre) p.set('genre', f.genre);
  return p;
}
