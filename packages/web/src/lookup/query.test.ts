import { normTitle, similarity, type LookupInfo } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { buildInfoPatch, buildLookupQuery, shouldReplaceTitle } from './query';

const info = (over: Partial<LookupInfo> = {}): LookupInfo => ({
  title: 'Official', trusted: false, cover: 'https://img.example/c.jpg', genres: 'Drama', creator: 'Studio X', source: 'anilist', sourceId: '7', ...over,
});

describe('buildLookupQuery', () => {
  it('adds the creator to the term only for categories where it is a search hint', () => {
    expect(buildLookupQuery('albums', 'Abbey Road', 'The Beatles')).toEqual({
      category: 'albums', term: 'Abbey Road The Beatles', typedTitle: 'Abbey Road', hint: 'The Beatles',
    });
    expect(buildLookupQuery('anime', 'Frieren', 'Madhouse')).toEqual({
      category: 'anime', term: 'Frieren', typedTitle: 'Frieren', hint: '',
    });
  });
  it('never exceeds the Worker\'s 500-character limit: the creator hint is clipped first, the title kept', () => {
    const title = 'T'.repeat(300);
    const q = buildLookupQuery('albums', title, 'C'.repeat(900));
    expect(q.term.length).toBe(500);
    expect(q.term.startsWith(`${title} C`)).toBe(true);
    expect(q.typedTitle).toBe(title);
    expect(q.hint.length).toBe(500);
    // a title that leaves no room for the creator keeps the title alone
    const long = buildLookupQuery('songs', 'T'.repeat(499), 'Someone');
    expect(long.term).toBe('T'.repeat(499));
    expect(buildLookupQuery('songs', 'T'.repeat(700), 'x').term.length).toBe(500);
    // short input is untouched
    expect(buildLookupQuery('albums', 'Abbey Road', 'The Beatles').term).toBe('Abbey Road The Beatles');
  });
  it('uses just the title when a hint category has no creator', () => {
    expect(buildLookupQuery('books', 'Dune', '')).toEqual({ category: 'books', term: 'Dune', typedTitle: 'Dune', hint: '' });
  });
});

describe('shouldReplaceTitle', () => {
  it('replaces when trusted, or when the titles are at least half similar', () => {
    expect(shouldReplaceTitle('jjba', info({ title: "JoJo's Bizarre Adventure", trusted: true }))).toBe(true);
    expect(shouldReplaceTitle('frieren', info({ title: 'Frieren: Beyond', trusted: false }))).toBe(true);
  });
  it('keeps the typed title for an untrusted, unlike official title', () => {
    expect(similarity(normTitle('jjba'), normTitle("JoJo's Bizarre Adventure"))).toBeLessThan(0.5);
    expect(shouldReplaceTitle('jjba', info({ title: "JoJo's Bizarre Adventure", trusted: false }))).toBe(false);
  });
});

describe('buildInfoPatch', () => {
  const entry = { category: 'anime' as const, title: 'frieren', creator: '' };
  it('fills the lookup fields and marks the lookup ok', () => {
    expect(buildInfoPatch(entry, 'frieren', info({ title: 'Frieren', album: 'Alb' }), 'add')).toEqual({
      title: 'Frieren', coverUrl: 'https://img.example/c.jpg', genres: 'Drama', creator: 'Studio X', album: 'Alb',
      source: 'anilist', sourceId: '7', lookupState: 'ok',
    });
  });
  it('omits the title when the rule says keep, and drops a cover that is not http(s)', () => {
    const p = buildInfoPatch(entry, 'jjba', info({ title: "JoJo's Bizarre Adventure", cover: 'javascript:alert(1)' }), 'add');
    expect(p).not.toHaveProperty('title');
    expect(p.coverUrl).toBeUndefined();
  });
  it('keeps a creator the user typed unless the creator is the search hint; refetch always overwrites', () => {
    expect(buildInfoPatch({ ...entry, creator: 'Mine' }, 'x', info({ title: 'x' }), 'add')).not.toHaveProperty('creator');
    expect(buildInfoPatch({ ...entry, creator: 'Mine' }, 'x', info({ title: 'x' }), 'refetch').creator).toBe('Studio X');
    expect(buildInfoPatch({ category: 'albums', title: 'x', creator: 'beatles' }, 'x', info({ title: 'x', creator: 'The Beatles' }), 'add').creator).toBe('The Beatles');
  });
  it('replaces a pasted Spotify link with the official title', () => {
    const link = 'https://open.spotify.com/album/abc123';
    expect(buildInfoPatch({ category: 'albums', title: link, creator: '' }, link, info({ title: 'Abbey Road', creator: 'The Beatles' }), 'add').title).toBe('Abbey Road');
  });
});
