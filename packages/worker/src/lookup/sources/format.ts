/** A runtime in minutes as '1 h 15 min' or '45 min'; '' when missing or not positive. */
export function formatMinutes(min: number | null | undefined): string {
  if (typeof min !== 'number' || !Number.isFinite(min)) return '';
  const total = Math.round(min);
  if (total <= 0) return '';
  return total >= 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total} min`;
}
