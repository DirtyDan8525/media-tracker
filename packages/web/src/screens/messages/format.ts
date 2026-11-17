import type { ConversationSummary, FriendEntry, LastMessage, RecSnapshot } from '@media-tracker/shared';
import { nameOf } from '@media-tracker/shared';

const CLOCK = () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DAY = () => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const WEEKDAY = () => new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Clock time of a message ("14:20"). */
export const clock = (iso: string): string => CLOCK().format(new Date(iso));

/** The list's time: the clock today, "Yesterday", the weekday within a week, else "3 Nov". */
export function listTime(iso: string, now: Date): string {
  const t = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days <= 0) return clock(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAY().format(t);
  return DAY().format(t);
}

/** "2 d", "5 h", "just now": how long ago a recommendation came. */
export function ageText(iso: string, now: Date): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d} d` : `${Math.floor(d / 7)} w`;
}

/** The list row's one-line preview: "You: see you friday!", "Ren: Message deleted", "📷 Photo". */
export function previewOf(c: ConversationSummary, meId: string): string {
  const last: LastMessage | null = c.last;
  if (!last) return 'No messages yet';
  const body = last.deleted ? 'Message deleted' : last.kind === 'image' ? '📷 Photo' : last.kind === 'rec' ? (last.text ? `Recommended a title: ${last.text}` : 'Recommended a title') : last.text;
  if (last.senderId === meId) return `You: ${body}`;
  const sender = c.members.find((m) => m.id === last.senderId);
  return c.kind === 'group' && sender ? `${sender.displayName || sender.username}: ${body}` : body;
}

/** A recommendation as the shared server action's FriendEntry, so "Add to mine" can reuse the friend-title copy (S11). */
export function entryFromRec(rec: RecSnapshot): FriendEntry {
  return {
    id: '', userId: '', category: rec.category, title: rec.title, status: null, rating: rec.rating, tier: null, genres: '', creator: rec.creator ?? '',
    album: '', coverUrl: rec.coverUrl, releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none', source: rec.source,
    sourceId: rec.sourceId, seasonAvg: null, createdAt: '', notes: null,
  };
}

export { nameOf };
