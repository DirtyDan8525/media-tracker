import { describe, expect, it } from 'vitest';
import { STATUSES, statusLabel, type Category } from '../src';

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
  it('keeps stored wording on lists without a Status column', () => {
    for (const c of ['movies', 'albums', 'songs'] as Category[]) for (const s of STATUSES) expect(statusLabel(s, c)).toBe(s);
  });
});
