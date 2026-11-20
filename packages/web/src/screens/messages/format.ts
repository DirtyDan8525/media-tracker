import type { ConversationSummary, FriendEntry, LastMessage, Message, RecSnapshot, ReplyInfo } from '@media-tracker/shared';
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
  const recWhat = last.recTitle ? `Recommended ${last.recTitle}` : 'Recommended a title';
  const body = last.deleted ? 'Message deleted' : last.kind === 'image' ? '📷 Photo' : last.kind === 'voice' ? '🎤 Voice memo' : last.kind === 'rec' ? (last.text ? `${recWhat}: ${last.text}` : recWhat) : last.text;
  if (last.senderId === meId) return `You: ${body}`;
  const sender = c.members.find((m) => m.id === last.senderId);
  return c.kind === 'group' && sender ? `${sender.displayName || sender.username}: ${body}` : body;
}

/** One line about a message for the composer's "Replying to" bar: its text, "Recommended <title>", or "📷 Photo". */
export function snippetOfMessage(m: Pick<Message, 'kind' | 'text' | 'rec'>): string {
  const one = (m.kind === 'rec' ? `Recommended ${m.rec?.title ?? 'a title'}` : m.kind === 'image' ? '📷 Photo' : m.kind === 'voice' ? '🎤 Voice memo' : m.text).replace(/\s+/g, ' ').trim();
  const chars = Array.from(one);
  return chars.length > 80 ? `${chars.slice(0, 79).join('')}…` : one;
}

/** What a quote shows for the replied-to message: its snippet, with a rec / picture given a word. */
export function quoteText(r: ReplyInfo): string {
  if (r.deleted) return 'Original message deleted';
  if (r.kind === 'rec') return shortQuote(`Recommended ${r.snippet || 'a title'}`);
  if (r.kind === 'image') return '📷 Photo';
  if (r.kind === 'voice') return '🎤 Voice memo';
  return shortQuote(r.snippet);
}

/** A reply's quote never shows the whole original: one line, about 40 characters or 8 words, cut at a word with "…". */
export function shortQuote(text: string, maxChars = 40, maxWords = 8): string {
  const one = text.replace(/\s+/g, ' ').trim();
  const words = one.split(' ');
  let cut = words.length > maxWords ? words.slice(0, maxWords).join(' ') : one;
  const chars = Array.from(cut);
  if (chars.length > maxChars) {
    cut = chars.slice(0, maxChars).join('');
    const space = cut.lastIndexOf(' ');
    if (space >= maxChars / 2) cut = cut.slice(0, space);
  }
  if (cut.length >= one.length) return one;
  return `${cut.replace(/[\s.,;:!?-]+$/u, '')}…`;
}

const TIME = () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const MONTH_DAY = (year: boolean) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });

/** When a message was sent, for its menu: "Today at 11:49 PM", "Yesterday at 9:05 AM", "Nov 18 at 3:02 PM" (the year when not this one). */
export function sentAt(iso: string, now: Date): string {
  const t = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : MONTH_DAY(t.getFullYear() !== now.getFullYear()).format(t);
  return `${day} at ${TIME().format(t)}`;
}

/** "0:07", "1:59": a voice memo's time. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
