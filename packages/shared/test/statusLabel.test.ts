import { describe, expect, it } from 'vitest';
import { STATUSES, statusLabel, statusSentence, type Category } from '../src';

describe('statusLabel', () => {
  it('leaves anime and tv wording as stored', () => {
    for (const c of ['anime', 'tv'] as Category[]) for (const s of STATUSES) expect(statusLabel(s, c)).toBe(s);
  });
  it('uses play wording for games', () => {
    expect(statusLabel('Watching / In Progress', 'games')).toBe('Playing');
    expect(statusLabel('Rewatching', 'games')).toBe('Replaying');
    expect(statusLabel('Plan to watch', 'games')).toBe('Plan to play');
    for (const s of ['Completed', 'On Hold', 'Dropped'] as const) expect(statusLabel(s, 'games')).toBe(s);
  });
  it('uses read wording for books', () => {
    expect(statusLabel('Watching / In Progress', 'books')).toBe('Reading');
    expect(statusLabel('Rewatching', 'books')).toBe('Rereading');
    expect(statusLabel('Plan to watch', 'books')).toBe('Plan to read');
    for (const s of ['Completed', 'On Hold', 'Dropped'] as const) expect(statusLabel(s, 'books')).toBe(s);
  });
  it('uses read wording for manga', () => {
    expect(statusLabel('Watching / In Progress', 'manga')).toBe('Reading');
    expect(statusLabel('Rewatching', 'manga')).toBe('Rereading');
    expect(statusLabel('Plan to watch', 'manga')).toBe('Plan to read');
    for (const s of ['Completed', 'On Hold', 'Dropped'] as const) expect(statusLabel(s, 'manga')).toBe(s);
  });
  it('says Watched for a finished video and keeps the watch wording otherwise', () => {
    expect(statusLabel('Completed', 'youtube')).toBe('Watched');
    expect(statusLabel('Plan to watch', 'youtube')).toBe('Plan to watch');
    expect(statusLabel('Watching / In Progress', 'youtube')).toBe('Watching / In Progress');
    for (const s of ['On Hold', 'Dropped', 'Rewatching'] as const) expect(statusLabel(s, 'youtube')).toBe(s);
    expect(statusLabel('Completed', 'movies')).toBe('Completed');
  });
  it('keeps stored wording on movies (watch wording, like TV) and lists without a Status column', () => {
    for (const c of ['movies', 'albums', 'songs'] as Category[]) for (const s of STATUSES) expect(statusLabel(s, c)).toBe(s);
  });
});

describe('statusSentence', () => {
  const line = (st: Parameters<typeof statusSentence>[0], c: Category, own = false) => {
    const w = statusSentence(st, c, own);
    return `${w.verb} X${w.suffix}`;
  };
  it('started / finished / dropped on every list', () => {
    for (const c of ['anime', 'games', 'books', 'manga', 'youtube'] as Category[]) {
      expect(line('Watching / In Progress', c)).toBe('started X');
      expect(line('Completed', c)).toBe('finished X');
      expect(line('Dropped', c)).toBe('dropped X');
    }
  });
  it('uses the list verb for planning and going again, and agrees with You', () => {
    expect(line('Plan to watch', 'anime')).toBe('wants to watch X');
    expect(line('Plan to watch', 'manga')).toBe('wants to read X');
    expect(line('Plan to watch', 'games', true)).toBe('want to play X');
    expect(line('Rewatching', 'tv')).toBe('started rewatching X');
    expect(line('Rewatching', 'books')).toBe('started rereading X');
    expect(line('Rewatching', 'games')).toBe('is replaying X');
    expect(line('Rewatching', 'games', true)).toBe('are replaying X');
    expect(line('On Hold', 'anime')).toBe('put X on hold');
  });
});
