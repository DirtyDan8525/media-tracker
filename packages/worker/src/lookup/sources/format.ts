/** A runtime in minutes as '1 h 15 min' or '45 min'; '' when missing or not positive. */
export function formatMinutes(min: number | null | undefined): string {
  if (typeof min !== 'number' || !Number.isFinite(min)) return '';
  const total = Math.round(min);
  if (total <= 0) return '';
  return total >= 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total} min`;
}

/** '5 tracks'; '1 track' for exactly one; '' when missing or not positive. */
export function trackCountLabel(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
  return n === 1 ? '1 track' : `${n} tracks`;
}

/** Seconds as 'm:ss' (3:42, 62:05); '' when missing or not positive. */
export function formatMmSs(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return '';
  const total = Math.round(sec);
  if (total <= 0) return '';
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The script's own edition cleaning for album titles, verbatim: removes every
 * "(...)" or "[...]" group that mentions remaster/deluxe/edition/expanded/anniversary/version
 * (anywhere in the title), then trims. Deliberately not the shared stripEdition.
 */
export function cleanEditionGroups(t: unknown): string {
  return String(t ?? '').replace(/\s*[\(\[][^\)\]]*(remaster|deluxe|edition|expanded|anniversary|version)[^\)\]]*[\)\]]/gi, '').trim();
}
