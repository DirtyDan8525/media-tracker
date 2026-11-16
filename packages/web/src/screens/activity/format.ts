const DAY_FORMAT = () => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const CLOCK_FORMAT = () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "Today" / "Yesterday" by the device's local midnight, else "Sat, 13 Nov" in the device's language. */
export function dayLabel(iso: string, now: Date): string {
  const t = new Date(iso);
  const days = Math.round((startOfDay(now).getTime() - startOfDay(t).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return DAY_FORMAT().format(t);
}

/** "just now", "5 min ago", "3 h ago"; from a day back, the time of day. */
export function timeAgo(iso: string, now: Date): string {
  const t = new Date(iso);
  const sec = (now.getTime() - t.getTime()) / 1000;
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return CLOCK_FORMAT().format(t);
}

/** Whose activity the screen shows. Until Phase 4 only 'you' has data. */
export type ActivityFilter = 'everyone' | 'friends' | 'you';
