import { CATEGORY_CONFIG, type Category, type Entry } from '@media-tracker/shared';

export interface ListStats {
  entries: number;
  rated: number;
  average: number | null;
  /** Count of Completed; null for lists without a Status column (Ruling P8). */
  completed: number | null;
  highest: number | null;
}

export interface GenreStat { genre: string; count: number; average: number | null }

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

const ratingsOf = (rows: Entry[]): number[] => rows.flatMap((e) => (e.rating === null ? [] : [e.rating]));
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const maxOf = (xs: number[]): number | null => (xs.length ? Math.max(...xs) : null);

function listStats(category: Category, rows: Entry[]): ListStats {
  const ratings = ratingsOf(rows);
  return {
    entries: rows.length,
    rated: ratings.length,
    average: mean(ratings),
    completed: CATEGORY_CONFIG[category].hasStatus ? rows.filter((e) => e.status === 'Completed').length : null,
    highest: maxOf(ratings),
  };
}

function genreStats(rows: Entry[]): GenreStat[] {
  const byKey = new Map<string, { genre: string; count: number; ratings: number[] }>();
  for (const e of rows) {
    const seen = new Set<string>();
    for (const part of e.genres.split(',')) {
      const genre = part.trim();
      if (!genre) continue;
      const key = genre.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const g = byKey.get(key) ?? { genre, count: 0, ratings: [] };
      g.count++;
      if (e.rating !== null) g.ratings.push(e.rating);
      byKey.set(key, g);
    }
  }
  return [...byKey.values()]
    .map((g) => ({ genre: g.genre, count: g.count, average: mean(g.ratings) }))
    .sort((a, b) => b.count - a.count || collator.compare(a.genre, b.genre));
}

/** Per-list figures for the enabled lists (in the order given), the totals over them, and Anime's genres. */
export function computeStats(byCategory: Partial<Record<Category, Entry[]>>, enabled: Category[]): {
  lists: (ListStats & { category: Category })[];
  all: ListStats;
  animeGenres: GenreStat[];
} {
  const lists = enabled.map((category) => ({ category, ...listStats(category, byCategory[category] ?? []) }));
  const every = enabled.flatMap((c) => byCategory[c] ?? []);
  const ratings = ratingsOf(every);
  const withStatus = lists.filter((l) => l.completed !== null);
  const all: ListStats = {
    entries: lists.reduce((n, l) => n + l.entries, 0),
    rated: lists.reduce((n, l) => n + l.rated, 0),
    average: mean(ratings),
    completed: withStatus.length ? withStatus.reduce((n, l) => n + (l.completed ?? 0), 0) : null,
    highest: maxOf(ratings),
  };
  return { lists, all, animeGenres: enabled.includes('anime') ? genreStats(byCategory.anime ?? []) : [] };
}

/** How many rated entries fall on each score 1..10 (index 0 is score 1): the rating's whole part (9.0 to 9.9 is score 9; 10.0 is 10), clamped to 1..10 so 0.x counts as 1. */
export function ratingDistribution(byCategory: Partial<Record<Category, Entry[]>>, enabled: Category[]): number[] {
  const out = new Array<number>(10).fill(0);
  for (const r of ratingsOf(enabled.flatMap((c) => byCategory[c] ?? []))) {
    out[Math.min(10, Math.max(1, Math.floor(r))) - 1]!++;
  }
  return out;
}
