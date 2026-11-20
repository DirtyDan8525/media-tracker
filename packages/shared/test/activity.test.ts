import { describe, expect, it } from 'vitest';
import * as shared from '../src/activity';
import { foldPosts, type ActivityItem, type ActivityType } from '../src/activity';

const T0 = Date.parse('2026-11-15T12:00:00.000Z');
let n = 0;
/** A row of post `postId` (pass its own id as postId for the anchor). */
const row = (
  postId: string,
  entryId: string,
  type: ActivityType,
  payload: ActivityItem['payload'],
  minutesAgo: number,
  over: Partial<ActivityItem> = {},
): ActivityItem => ({
  id: `r${++n}`,
  postId,
  userId: 'u1',
  type,
  entryId,
  category: 'anime',
  title: `Title ${entryId}`,
  coverUrl: '',
  payload,
  createdAt: new Date(T0 - minutesAgo * 60_000).toISOString(),
  ...over,
});

describe('foldPosts', () => {
  it('folds the rows of one post to the first from and the last to, keyed by the post id', () => {
    const items = [
      row('p1', 'a', 're-rated', { from: 8, to: 9 }, 0),
      row('p1', 'a', 're-rated', { from: 7, to: 8 }, 8, { id: 'p1' }),
    ];
    const lines = foldPosts(items);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: 'p1', entryId: 'a', userId: 'u1', rating: { from: 7, to: 9 }, at: items[0]!.createdAt });
  });

  it('a season post reads "Title · Season" and folds its own re-rates', () => {
    const season = { seasonId: 's1', season: 'Season 2' };
    const [line] = foldPosts([
      row('p1', 'a', 're-rated', { from: 8, to: 9, ...season }, 0),
      row('p1', 'a', 'rated', { from: null, to: 8, ...season }, 5, { id: 'p1' }),
    ]);
    expect(line).toMatchObject({ title: 'Title a · Season 2', entryId: 'a', rating: { from: null, to: 9 } });
  });

  it('drops a post whose rating ends where it began (7 to 8 to 7)', () => {
    const items = [row('p1', 'a', 're-rated', { from: 8, to: 7 }, 0), row('p1', 'a', 're-rated', { from: 7, to: 8 }, 1, { id: 'p1' })];
    expect(foldPosts(items)).toEqual([]);
  });

  it('two post ids for one entry give two lines, even when the rows are close in time', () => {
    const items = [row('p2', 'a', 're-rated', { from: 8, to: 9 }, 0, { id: 'p2' }), row('p1', 'a', 're-rated', { from: 7, to: 8 }, 1, { id: 'p1' })];
    const lines = foldPosts(items);
    expect(lines.map((l) => l.key)).toEqual(['p2', 'p1']);
  });

  it('does not merge rows of one entry by time alone (rows 2 minutes apart in different posts stay apart)', () => {
    const items = [row('p2', 'a', 'rated', { from: null, to: 8 }, 0, { id: 'p2' }), row('p1', 'a', 'added', {}, 2, { id: 'p1' })];
    expect(foldPosts(items)).toHaveLength(2);
  });

  it('a rating and a status in one post read as one line; added + rated is added with rating from null', () => {
    const [line] = foldPosts([
      row('p1', 'a', 'status', { from: 'Watching', to: 'Completed' }, 0),
      row('p1', 'a', 'rated', { from: null, to: 9 }, 1),
      row('p1', 'a', 'added', {}, 2, { id: 'p1' }),
    ]);
    expect(line).toMatchObject({ added: true, rating: { from: null, to: 9 }, status: { from: 'Watching', to: 'Completed' } });
  });

  it('shows an added row with its own rating and status', () => {
    const [line] = foldPosts([row('p1', 'a', 'added', { rating: 8, status: 'Completed' }, 0, { id: 'p1' })]);
    expect(line).toMatchObject({ added: true, rating: { from: null, to: 8 }, status: { from: null, to: 'Completed' } });
  });

  it('orders posts newest first by their newest row, whatever order the rows come in, across users', () => {
    const items = [
      row('p1', 'a', 'rated', { from: null, to: 5 }, 30, { id: 'p1' }),
      row('p2', 'b', 'rated', { from: null, to: 6 }, 10, { id: 'p2', userId: 'u2' }),
      row('p1', 'a', 're-rated', { from: 5, to: 7 }, 25),
      row('p3', 'c', 'rated', { from: null, to: 4 }, 20, { id: 'p3' }),
    ];
    const lines = foldPosts(items);
    expect(lines.map((l) => l.key)).toEqual(['p2', 'p3', 'p1']);
    expect(lines[0]!.userId).toBe('u2');
    expect(lines[2]!.rating).toEqual({ from: null, to: 7 });
  });

  it('mergeActivity is gone', () => {
    expect('mergeActivity' in shared).toBe(false);
  });
});
