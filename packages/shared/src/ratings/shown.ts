import { countedPicks, fitTier } from './fit';
import { priorFromScore, round1, round2, scoreOf } from './score';
import { tierFor, tierRange } from './tiers';
import type { Comparison, RatedItem, Tier, TierSet } from './types';

type RefitOpts = { rangeChanged?: boolean; priorSd?: number };

/** Strengths closer than this count as equal (no pick ordered the two). */
const SAME_STRENGTH = 1e-9;

/**
 * The number a score shows as, with one or two decimals. Below the top tier it is capped just under
 * the tier's upper bound (8.9, or 8.99 with two decimals, for the default Liked), so a shown score
 * never reads as the next tier's lower bound. The top tier may show its upper bound (10.0).
 *
 * Note: switching a title between one and two decimals can lower its shown number by up to 0.04
 * (9.04 → 9.0, or 9.05 shown as 9.1 then 9.04) even when its strength rose. Accepted: the
 * guarantees of spec §5.2 are about strengths and scores, which are monotonic; only the rounding
 * of the display can step back.
 */
export function shownValue(score: number, range: [number, number], twoDecimals: boolean): number {
  const v = twoDecimals ? round2(score) : round1(score);
  if (range[1] >= 10) return v;
  return Math.min(v, twoDecimals ? round2(range[1] - 0.01) : round1(range[1] - 0.1));
}

/**
 * Re-fits one tier and works out its shown scores (Rulings Q6, Q7). `items` are the rated titles
 * of the tier, `range` its score range. Returns only the items whose `rating` or `strength`
 * changed, with the new values, in input order.
 *
 * - A locked title keeps its rating (and its prior as strength).
 * - A fitted title (≥ 1 counted pick inside the tier) shows round1(score), or round2(score) when
 *   a neighbour in strength order shows the same one-decimal text and the two strengths differ.
 * - An unfitted title keeps its stored rating, unless the range changed, it has no rating (tier
 *   only), or it was fitted before (strength ≠ prior): then it shows round1(scoreOf(prior)).
 * Every value it writes goes through `shownValue`, so it stays below the next tier's lower bound.
 */
export function refitTier(items: RatedItem[], comparisons: Comparison[], range: [number, number], opts?: RefitOpts): RatedItem[] {
  const strengths = fitTier(items, comparisons, { priorSd: opts?.priorSd });
  const ids = new Set(items.map((i) => i.id));
  const fitted = new Set<string>();
  for (const c of countedPicks(ids, comparisons)) { fitted.add(c.winnerId); fitted.add(c.loserId); }

  const str = (i: RatedItem) => strengths.get(i.id)!;
  const prior = (i: RatedItem) => i.priorMean ?? 0;
  const order = [...items].sort((a, b) => str(b) - str(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // The one-decimal text each title would show. A locked title shows its typed number.
  const oneText = (i: RatedItem): number =>
    fitted.has(i.id) && !i.scoreLocked
      ? shownValue(scoreOf(str(i), range), range, false)
      : round1(i.rating ?? shownValue(scoreOf(prior(i), range), range, false));

  const next = new Map<string, number | null>();
  order.forEach((i, k) => {
    if (i.scoreLocked) { next.set(i.id, i.rating); return; }
    if (fitted.has(i.id)) {
      const score = scoreOf(str(i), range);
      const mine = oneText(i);
      const collides = [order[k - 1], order[k + 1]].some(
        (o) => o !== undefined && oneText(o) === mine && Math.abs(str(o) - str(i)) > SAME_STRENGTH,
      );
      next.set(i.id, shownValue(score, range, collides));
      return;
    }
    const reset = opts?.rangeChanged || i.rating === null || i.strength !== i.priorMean;
    next.set(i.id, reset ? shownValue(scoreOf(prior(i), range), range, false) : i.rating);
  });

  const out: RatedItem[] = [];
  for (const i of items) {
    const rating = next.get(i.id)!, strength = str(i);
    if (rating !== i.rating || strength !== i.strength) out.push({ ...i, rating, strength });
  }
  return out;
}

/**
 * Re-fits every tier of a rating set. Each tier uses only the comparisons whose two titles are
 * both in it now, so a pick never changes another tier. Unrated items (tier null) are left alone.
 */
export function refitSet(items: RatedItem[], comparisons: Comparison[], tiers: TierSet, opts?: RefitOpts): RatedItem[] {
  const out: RatedItem[] = [];
  for (const t of [3, 2, 1, 0] as Tier[]) {
    const inTier = items.filter((i) => i.tier === t);
    if (inTier.length > 0) out.push(...refitTier(inTier, comparisons, tierRange(tiers, t), opts));
  }
  return out;
}

/**
 * A typed rating. A number sets the tier it falls in, the prior from the number, strength = prior
 * and rating = the number. The lock is `lock` when given; otherwise a number that changes the tier
 * unlocks the title (Ruling Q8) and one in the same tier keeps the lock. Null clears the rating.
 */
export function applyTyped(item: RatedItem, rating: number | null, tiers: TierSet, lock?: boolean): RatedItem {
  if (rating === null) return { ...item, rating: null, tier: null, priorMean: null, strength: null, scoreLocked: false };
  const tier = tierFor(rating, tiers);
  const priorMean = priorFromScore(rating, tierRange(tiers, tier));
  const scoreLocked = lock ?? (item.tier !== null && tier !== item.tier ? false : item.scoreLocked);
  return { ...item, rating, tier, priorMean, strength: priorMean, scoreLocked };
}

/**
 * A title moved to another tier keeps its rough place (Ruling Q23): its prior is where its shown
 * score falls in the new range (clamped to 3–97%, so near the matching edge), or the middle when
 * it has no score. It is unlocked; strength = prior.
 */
export function applyMove(item: RatedItem, tier: Tier, tiers: TierSet): RatedItem {
  const range = tierRange(tiers, tier);
  const priorMean = item.rating === null ? 0 : priorFromScore(item.rating, range);
  return { ...item, tier, priorMean, strength: priorMean, rating: shownValue(scoreOf(priorMean, range), range, false), scoreLocked: false };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

type Ordered = Pick<RatedItem, 'rating' | 'tier' | 'strength' | 'title' | 'id'>;
const descNullLast = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;

/** List order by rating (spec §5.1): rating desc (unrated last), tier desc, strength desc, title, id. */
export function compareRated(a: Ordered, b: Ordered): number {
  return descNullLast(a.rating, b.rating)
    || descNullLast(a.tier, b.tier)
    || descNullLast(a.strength, b.strength)
    || collator.compare(a.title, b.title)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
