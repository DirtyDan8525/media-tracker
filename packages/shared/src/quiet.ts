/**
 * Quiet mode (Dan, 2026-11-20): while `settings.quietUntil` is in the future, nothing the person does creates activity
 * rows. It turns itself off 24 hours after it was switched on. Personal: admin Defaults never touch it.
 */
export const QUIET_MS = 24 * 60 * 60 * 1000;
/** The Worker refuses a `quietUntil` further ahead than this (24 h plus slack for a fast clock). */
export const QUIET_MAX_AHEAD_MS = QUIET_MS + 60 * 60 * 1000;

/** True while `quietUntil` (ISO time or null) is still ahead of `nowMs`. A missing or unreadable value is not quiet. */
export function isQuiet(quietUntil: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (typeof quietUntil !== 'string') return false;
  const t = Date.parse(quietUntil);
  return Number.isFinite(t) && t > nowMs;
}

/** An ISO time with a plausible length, or null. */
export function parseQuietUntil(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The `quietUntil` to save when quiet mode is switched on at `nowMs`. */
export const quietUntilFrom = (nowMs: number = Date.now()): string => new Date(nowMs + QUIET_MS).toISOString();
