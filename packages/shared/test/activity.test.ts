import { describe, expect, it } from 'vitest';
import { mergeActivity, type ActivityItem, type ActivityType } from '../src/activity';

const T0 = Date.parse('2026-11-15T12:00:00.000Z');
let n = 0;
const row = (
  entryId: string,
  type: ActivityType,
  payload: ActivityItem['payload'],
  minutesAgo: number,
): ActivityItem => ({
  id: `r${++n}`,
  type,
  entryId,
  category: 'anime',
  title: `Title ${entryId}`,
  coverUrl: '',
  payload,
  createdAt: new Date(T0 - minutesAgo * 60_000).toISOString(),
});

describe('mergeActivity', () => {
  it('merges five re-rated rows within 4 minutes into one line, first from to last to', () => {
    const items = [
      row('a', 're-rated', { from: 5, to: 6 }, 0),
      row('a', 're-rated', { from: 4, to: 5 }, 1),
      row('a', 're-rated', { from: 3, to: 4 }, 2),
      row('a', 're-rated', { from: 2, to: 3 }, 3),
      row('a', 're-rated', { from: 1, to: 2 }, 4),
    ];
    const lines = mergeActivity(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.rating).toEqual({ from: 1, to: 6 });
    expect(lines[0]!.key).toBe(items[0]!.id);
  });

  it('shows nothing when a rating ends where it began (7 to 8 to 7)', () => {
    const items = [row('a', 're-rated', { from: 8, to: 7 }, 0), row('a', 're-rated', { from: 7, to: 8 }, 1)];
    expect(mergeActivity(items)).toEqual([]);
  });

  it('keeps rows 11 minutes apart as two lines', () => {
    const items = [row('a', 're-rated', { from: 8, to: 9 }, 0), row('a', 're-rated', { from: 7, to: 8 }, 11)];
    expect(mergeActivity(items)).toHaveLength(2);
  });

  it('merges interleaved A, B, A into one line each, ordered by newest at', () => {
    const items = [
      row('a', 'rated', { from: null, to: 8 }, 0),
      row('b', 'rated', { from: null, to: 6 }, 1),
      row('a', 're-rated', { from: 7, to: 8 }, 2),
    ];
    const lines = mergeActivity(items);
    expect(lines.map((l) => l.entryId)).toEqual(['a', 'b']);
    expect(lines[0]!.rating).toEqual({ from: 7, to: 8 });
  });

  it('merges added + rated into added: true, rating from null', () => {
    const items = [row('a', 'rated', { from: null, to: 9 }, 0), row('a', 'added', {}, 2)];
    const [line] = mergeActivity(items);
    expect(line).toMatchObject({ added: true, rating: { from: null, to: 9 }, status: null });
  });

  it('shows an added row with its own rating and status', () => {
    const [line] = mergeActivity([row('a', 'added', { rating: 8, status: 'Completed' }, 0)]);
    expect(line).toMatchObject({ added: true, rating: { from: null, to: 8 }, status: { from: null, to: 'Completed' } });
  });

  it('keeps the first from and last to for status rows', () => {
    const items = [
      row('a', 'status', { from: 'Watching', to: 'Completed' }, 0),
      row('a', 'status', { from: 'Plan to watch', to: 'Watching' }, 3),
    ];
    const [line] = mergeActivity(items);
    expect(line!.status).toEqual({ from: 'Plan to watch', to: 'Completed' });
  });

  it('uses the newest row id as key and its time as at', () => {
    const items = [row('a', 'rated', { from: null, to: 5 }, 0), row('a', 'added', {}, 1)];
    const [line] = mergeActivity(items);
    expect(line!.key).toBe(items[0]!.id);
    expect(line!.at).toBe(items[0]!.createdAt);
  });

  it('honours a custom window', () => {
    const items = [row('a', 'rated', { from: null, to: 5 }, 0), row('a', 'added', {}, 1)];
    expect(mergeActivity(items, 30_000)).toHaveLength(2);
  });
});
