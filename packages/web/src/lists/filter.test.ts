import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { foldText, genreOptions, matchesFilter, normalizeFilter, readFilter, writeFilter, type ListFilter } from './filter';

const none: ListFilter = { q: '', status: '', genre: '' };
const f = (over: Partial<ListFilter>): ListFilter => ({ ...none, ...over });

describe('foldText', () => {
  it('lower-cases, strips accents, collapses whitespace', () => {
    expect(foldText('  Pokémon   GO ')).toBe('pokemon go');
  });
});

describe('matchesFilter', () => {
  it('ignores case and accents', () => {
    expect(matchesFilter(makeEntry({ title: 'Pokémon' }), f({ q: 'pokemon' }))).toBe(true);
    expect(matchesFilter(makeEntry({ title: 'Frieren' }), f({ q: '  frieren ' }))).toBe(true);
    expect(matchesFilter(makeEntry({ title: '進撃の巨人' }), f({ q: '進撃' }))).toBe(true);
  });
  it('folds Latin accents and letters, but keeps Japanese dakuten distinct', () => {
    expect(matchesFilter(makeEntry({ title: 'Pokémon' }), f({ q: 'pokemon' }))).toBe(true);
    expect(matchesFilter(makeEntry({ title: 'が' }), f({ q: 'か' }))).toBe(false);
    expect(matchesFilter(makeEntry({ title: 'か' }), f({ q: 'か' }))).toBe(true);
    expect(matchesFilter(makeEntry({ title: 'Straße' }), f({ q: 'strasse' }))).toBe(true);
    expect(foldText('Ørsted Łódź Æon')).toBe('orsted lodz aeon');
  });
  it('combines q, status and genre', () => {
    const e = makeEntry({ title: 'Frieren', status: 'Completed', genres: 'Fantasy, Drama' });
    expect(matchesFilter(e, f({ q: 'fri', status: 'Completed', genre: 'drama' }))).toBe(true);
    expect(matchesFilter(e, f({ q: 'fri', status: 'Dropped', genre: 'drama' }))).toBe(false);
  });
  it('needs every word, in any order', () => {
    const e = makeEntry({ title: 'Fullmetal Alchemist: Brotherhood' });
    expect(matchesFilter(e, f({ q: 'brotherhood fullmetal' }))).toBe(true);
    expect(matchesFilter(e, f({ q: 'brotherhood naruto' }))).toBe(false);
  });
  it('searches typed title, creator, album and genres', () => {
    const e = makeEntry({ title: 'X', typedTitle: 'typed one', creator: 'Madhouse', album: 'Abbey', genres: 'Action, Drama' });
    for (const q of ['typed', 'madhouse', 'abbey', 'drama']) expect(matchesFilter(e, f({ q }))).toBe(true);
  });
  it('does not throw on regex characters', () => {
    expect(matchesFilter(makeEntry({ title: 'AC/DC' }), f({ q: 'ac/dc' }))).toBe(true);
    expect(matchesFilter(makeEntry({ title: 'A' }), f({ q: '(' }))).toBe(false);
  });
  it('filters by status', () => {
    expect(matchesFilter(makeEntry({ status: 'On Hold' }), f({ status: 'On Hold' }))).toBe(true);
    expect(matchesFilter(makeEntry({ status: 'Dropped' }), f({ status: 'On Hold' }))).toBe(false);
    expect(matchesFilter(makeEntry({ status: null }), f({ status: 'On Hold' }))).toBe(false);
  });
  it('matches a genre exactly, case-insensitively', () => {
    expect(matchesFilter(makeEntry({ genres: 'Action, Drama' }), f({ genre: 'action' }))).toBe(true);
    expect(matchesFilter(makeEntry({ genres: 'Action-Adventure' }), f({ genre: 'action' }))).toBe(false);
  });
});

describe('genreOptions', () => {
  it('counts each genre once per entry, sorted', () => {
    const rows = [makeEntry({ genres: 'Drama, action' }), makeEntry({ genres: 'Action' }), makeEntry({ genres: '' })];
    expect(genreOptions(rows)).toEqual([{ genre: 'action', count: 2 }, { genre: 'Drama', count: 1 }]);
  });
});

describe('URL form', () => {
  it('reads an unknown status as empty', () => {
    expect(readFilter(new URLSearchParams('status=Nope')).status).toBe('');
  });
  it('round-trips and omits empty fields', () => {
    const v = f({ q: 'fri', status: 'On Hold', genre: 'Drama' });
    expect(readFilter(writeFilter(v))).toEqual(v);
    expect(writeFilter(none).toString()).toBe('');
  });
});

describe('writeFilter keeps unrelated params; normalizeFilter drops the impossible', () => {
  it('keeps them', () => {
    expect(writeFilter(f({ q: 'a' }), new URLSearchParams('keep=1&q=old&genre=x')).toString()).toBe('keep=1&q=a');
  });
  it('drops status without a column and unknown genres', () => {
    expect(normalizeFilter(f({ status: 'Dropped', genre: 'nope' }), false, [{ genre: 'Drama' }])).toEqual(none);
    expect(normalizeFilter(f({ status: 'Dropped', genre: 'drama' }), true, [{ genre: 'Drama' }])).toEqual(f({ status: 'Dropped', genre: 'Drama' }));
  });
});
