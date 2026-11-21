import { describe, expect, it } from 'vitest';
import { bothRated, groupTop5, sameTitle, theirsNotYours, type Comparable } from '../src/compareFriends';

let n = 0;
const e = (title: string, rating: number | null, extra: Partial<Comparable> = {}): Comparable => ({
  id: `e${++n}`,
  category: 'anime',
  title,
  rating,
  coverUrl: '',
  source: null,
  sourceId: null,
  ...extra,
});

describe('sameTitle', () => {
  it('matches by source+sourceId even when titles differ', () => {
    const a = e('Frieren', 9, { source: 'anilist', sourceId: '154587' });
    const b = e('Sousou no Frieren', 8, { source: 'anilist', sourceId: '154587' });
    expect(sameTitle(a, b)).toBe(true);
  });

  it("matches \"Frieren: Beyond Journey's End\" by normTitle only within one category", () => {
    const a = e("Frieren: Beyond Journey's End", 9);
    const b = e('frieren beyond journeys end', 8);
    expect(sameTitle(a, b)).toBe(true);
    expect(sameTitle(a, { ...b, category: 'tv' })).toBe(false);
  });
});

describe('bothRated', () => {
  it('sorts 9 vs 5 before 8 vs 7, then title', () => {
    const mine = [e('B', 8), e('A', 9), e('C', 7), e('D', 7)];
    const theirs = [e('B', 7), e('A', 5), e('C', 6), e('D', 6)];
    const rows = bothRated(mine, theirs);
    expect(rows.map((r) => r.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows[0]).toMatchObject({ mine: 9, theirs: 5, diff: 4 });
  });

  it('ignores unrated entries and your private ones', () => {
    const mine = [e('Secret', 9, { isPrivate: true }), e('Open', null)];
    const theirs = [e('Secret', 3), e('Open', 4)];
    expect(bothRated(mine, theirs)).toEqual([]);
  });

  it('counts a person with two entries of one title once, at the higher rating', () => {
    const mine = [e('Show', 6), e('Show', 9)];
    const theirs = [e('Show', 5)];
    const rows = bothRated(mine, theirs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mine: 9, theirs: 5, diff: 4 });
  });
});

describe('theirsNotYours', () => {
  it('your private entry is left out of bothRated and groupTop5 but still blocks it from theirsNotYours', () => {
    const mine = [e('Hidden', 9, { isPrivate: true })];
    const theirs = [e('Hidden', 8), e('Other', 7)];
    expect(bothRated(mine, theirs)).toEqual([]);
    expect(theirsNotYours(mine, theirs).map((x) => x.title)).toEqual(['Other']);
    expect(
      groupTop5([
        { userId: 'me', entries: mine },
        { userId: 'ren', entries: theirs },
      ]),
    ).toEqual([]);
  });

  it('skips unrated, orders by rating, stops at 20', () => {
    const theirs = [e('Unrated', null), ...Array.from({ length: 25 }, (_, i) => e(`T${String(i).padStart(2, '0')}`, (i % 10) + 1))];
    const out = theirsNotYours([], theirs);
    expect(out).toHaveLength(20);
    expect(out.every((x) => x.rating !== null)).toBe(true);
    expect(out.map((x) => x.rating)).toEqual([...out.map((x) => x.rating)].sort((a, b) => b! - a!));
    expect(theirsNotYours([], theirs, 3)).toHaveLength(3);
  });

  it('is blocked by an unrated entry of yours', () => {
    expect(theirsNotYours([e('Planned', null)], [e('Planned', 8)])).toEqual([]);
  });
});

describe('groupTop5', () => {
  const p = (userId: string, entries: Comparable[]) => ({ userId, entries });

  it('averages, needs 2 raters, ties by raters then title, returns at most 5', () => {
    const rows = groupTop5([
      p('me', [e('Solo', 10), e('A', 8), e('B', 8), e('C', 8), e('D', 6), e('E', 5), e('F', 4)]),
      p('ren', [e('A', 8), e('B', 8), e('C', 8), e('D', 6), e('E', 5), e('F', 4)]),
      p('vance', [e('B', 8), e('D', 6), e('E', 5), e('F', 4)]),
    ]);
    expect(rows.map((r) => r.title)).toEqual(['B', 'A', 'C', 'D', 'E']);
    expect(rows[0]).toMatchObject({ average: 8, raters: 3 });
    expect(rows.find((r) => r.title === 'Solo')).toBeUndefined();
    expect(groupTop5([p('me', [e('A', 8)]), p('ren', [e('A', 6)])], 3)).toEqual([]);
  });

  it('counts a person with two entries of one title once (their higher rating)', () => {
    const rows = groupTop5([p('me', [e('A', 2), e('A', 8)]), p('ren', [e('A', 6)])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ average: 7, raters: 2 });
    expect(groupTop5([p('me', [e('A', 2), e('A', 8)])])).toEqual([]);
  });

  it('carries each rater\'s best entry id, highest rating first', () => {
    const a = e('Frieren', 7, { id: 'my-low' });
    const a2 = e('Frieren', 9, { id: 'my-high' });
    const b = e('Frieren', 9.5, { id: 'ren-1' });
    const [row] = groupTop5([p('me', [a, a2]), p('ren', [b])]);
    expect(row!.owners).toEqual([
      { userId: 'ren', entryId: 'ren-1', rating: 9.5 },
      { userId: 'me', entryId: 'my-high', rating: 9 },
    ]);
  });
});
