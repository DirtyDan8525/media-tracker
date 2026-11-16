import type { Category, UserSettings } from '../types';
import type { RatingSet, Tier, TierSet } from './types';

/** Default tiers for every list (decision 2026-11-15). */
export const DEFAULT_TIERS: TierSet = { names: ["Didn't like", 'Fine', 'Liked', 'Loved'], bounds: [6, 7.5, 9] };

export const RATING_SETS: readonly RatingSet[] = [
  'anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'anime_seasons', 'tv_seasons',
];

/** The list whose tiers a rating set uses (season tabs use their parent list's; Ruling Q4). */
export function listOfSet(s: RatingSet): Category {
  if (s === 'anime_seasons') return 'anime';
  if (s === 'tv_seasons') return 'tv';
  return s;
}

/** The season tab of a list, or null when the list has none. */
export function seasonSetOf(c: Category): RatingSet | null {
  if (c === 'anime') return 'anime_seasons';
  if (c === 'tv') return 'tv_seasons';
  return null;
}

/**
 * The tier a score falls in. Boundary values belong to the higher tier (Ruling Q2). Use it only
 * for a newly typed number: a stored title's tier is its `tier` field (see the module note).
 */
export function tierFor(score: number, t: TierSet): Tier {
  const [b1, b2, b3] = t.bounds;
  if (score >= b3) return 3;
  if (score >= b2) return 2;
  if (score >= b1) return 1;
  return 0;
}

/** A tier's score range [low, high]. */
export function tierRange(t: TierSet, tier: Tier): [number, number] {
  const edges = [0, ...t.bounds, 10];
  return [edges[tier], edges[tier + 1]];
}

const MIN_WIDTH_TENTHS = 5;
const MAX_NAME = 20;

/**
 * A valid tier set with trimmed names, or null (Ruling Q3): four names of 1–20 characters after
 * trimming, unique ignoring case; three one-decimal bounds with 0 < b1 < b2 < b3 < 10 and every
 * tier at least 0.5 wide.
 */
export function validateTierSet(x: unknown): TierSet | null {
  if (typeof x !== 'object' || x === null) return null;
  const { names, bounds } = x as { names?: unknown; bounds?: unknown };
  if (!Array.isArray(names) || names.length !== 4 || !Array.isArray(bounds) || bounds.length !== 3) return null;
  if (!names.every((n) => typeof n === 'string')) return null;
  const trimmed = (names as string[]).map((n) => n.trim());
  if (trimmed.some((n) => n.length < 1 || n.length > MAX_NAME)) return null;
  if (new Set(trimmed.map((n) => n.toLocaleLowerCase())).size !== 4) return null;
  if (!bounds.every((b) => typeof b === 'number' && Number.isFinite(b))) return null;
  const b = bounds as number[];
  // Work in tenths so float noise (1.1 − 0.6) can't fail the width check.
  const tenths = b.map((v) => Math.round(v * 10));
  if (tenths.some((t, i) => t / 10 !== b[i])) return null;
  const edges = [0, ...tenths, 100];
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] < MIN_WIDTH_TENTHS) return null;
  return { names: trimmed as TierSet['names'], bounds: [b[0], b[1], b[2]] };
}

/** The tiers a rating set uses: its list's own, or the defaults when unset. */
export function tiersFor(settings: Pick<UserSettings, 'tiers'>, set: RatingSet): TierSet {
  return settings.tiers?.[listOfSet(set)] ?? DEFAULT_TIERS;
}
