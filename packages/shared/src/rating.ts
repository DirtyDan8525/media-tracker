/**
 * A rating (or an average of ratings) as text: at least one decimal, at most two, no padding beyond
 * one decimal. 10 -> "10.0", 9.5 -> "9.5", 8.25 -> "8.25", 8.333 -> "8.33", 8.999 -> "9.0".
 */
export function formatRating(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}
