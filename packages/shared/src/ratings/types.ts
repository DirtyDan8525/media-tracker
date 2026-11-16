import type { Category, Status } from '../types';

/** 0 = the bottom tier (Didn't like) … 3 = the top tier (Loved). */
export type Tier = 0 | 1 | 2 | 3;

/**
 * One list's tiers. `names` are indexed by tier; `bounds` = [b1, b2, b3] split 0–10 into
 * [0, b1) [b1, b2) [b2, b3) [b3, 10]: a boundary value belongs to the higher tier.
 */
export interface TierSet {
  names: [string, string, string, string];
  bounds: [number, number, number];
}

/** A set of titles rated against each other: a list, or a season tab (kept apart from its list). */
export type RatingSet = Category | 'anime_seasons' | 'tv_seasons';

/** What the ratings model needs to know about one title (an entry or a season). */
export interface RatedItem {
  id: string;
  title: string;
  /** The shown score (null when unrated). */
  rating: number | null;
  tier: Tier | null;
  /** Where the title starts inside its tier (a strength), from a typed number or the middle (0). */
  priorMean: number | null;
  /** The last fitted strength (= priorMean when the title has no counted picks). */
  strength: number | null;
  scoreLocked: boolean;
}

/** A rated item with what a rating screen shows. */
export interface SetItem extends RatedItem {
  cover: string;
  square: boolean;
  status: Status | null;
}

export interface Comparison {
  id: string;
  winnerId: string;
  loserId: string;
  /** "About the same": half a win each (winner/loser are then just the two titles). */
  isTie: boolean;
  createdAt: string;
  undoneAt: string | null;
}

/** One pick as the client sends it on Save. */
export interface PickInput {
  winnerId: string;
  loserId: string;
  isTie: boolean;
  undone: boolean;
}

/** The body of a ratings save (Ruling Q11). */
export interface SavePayload {
  picks: PickInput[];
  moves: { id: string; tier: Tier }[];
  done: string[];
}

/** One changed title in a session's review: old → new. */
export interface RatingChange {
  id: string;
  title: string;
  old: number | null;
  rating: number;
  oldTier: Tier | null;
  tier: Tier;
}
