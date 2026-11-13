/** null (unrated) or a number 0-10 with at most 2 decimals: the same rule the API enforces. */
export function isValidRating(r: number | null): boolean {
  if (r === null) return true;
  if (!Number.isFinite(r) || r < 0 || r > 10) return false;
  return Math.abs(r * 100 - Math.round(r * 100)) < 1e-9;
}

export const RATING_ERROR = 'Use a number from 0 to 10, with at most 2 decimals.';

/** Text from a rating box: '' is unrated. */
export function parseRating(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) && isValidRating(n) ? { ok: true, value: n } : { ok: false, error: RATING_ERROR };
}
