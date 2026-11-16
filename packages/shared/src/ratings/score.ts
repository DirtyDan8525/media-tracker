/** Spread of the prior around a title's starting point (spec §5.2; tuned in Task 9). */
export const PRIOR_SD = 1.0;
/** A typed number's prior is clamped to 3–97% of its tier's range. */
export const PRIOR_CLAMP = 0.03;

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** The strength whose score is `score` in `range`, clamped to 3–97% of the range. */
export function priorFromScore(score: number, range: [number, number]): number {
  const [low, high] = range;
  const p = Math.min(1 - PRIOR_CLAMP, Math.max(PRIOR_CLAMP, (score - low) / (high - low)));
  return Math.log(p / (1 - p));
}

/** A strength's score: low + (high − low) × sigmoid(strength). */
export const scoreOf = (strength: number, range: [number, number]): number =>
  range[0] + (range[1] - range[0]) * sigmoid(strength);

export const round1 = (x: number): number => Math.round(x * 10) / 10;
export const round2 = (x: number): number => Math.round(x * 100) / 100;
