import { describe, expect, test } from 'vitest';
import { compareLists, ratedItems, toCompareItem, unratedFinished, type Category, type Entry, type Status } from '../src/index';

let n = 0;
const entry = (category: Category, title: string, rating: number | null, status: Status | null = null): Entry => ({
  id: `e${++n}`, userId: 'u', category, title, typedTitle: title, status, rating, genres: '', creator: '', album: '',
  coverUrl: `https://img/${n}.jpg`, notes: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none',
  isPrivate: false, notesPrivate: false, source: null, sourceId: null, lookupState: 'ok', importId: null, seasonAvg: null,
  createdAt: '', updatedAt: '',
});

describe('toCompareItem', () => {
  test('cover is coverUrl; square comes from the category', () => {
    const e = entry('albums', 'X', 8);
    expect(toCompareItem(e)).toEqual({ id: e.id, title: 'X', rating: 8, cover: e.coverUrl, square: true });
    expect(toCompareItem(entry('anime', 'Y', 8)).square).toBe(false);
  });
});

describe('ratedItems', () => {
  test('rating desc, then title by collator, then id; unrated dropped', () => {
    const got = ratedItems([entry('anime', 'b', 9), entry('anime', 'A', 9), entry('anime', 'u', null), entry('anime', 'top', 10)]);
    expect(got.map((x) => x.title)).toEqual(['top', 'A', 'b']);
  });
  test('equal title (base sensitivity) falls back to id', () => {
    const x = entry('anime', 'Pokémon', 7), y = entry('anime', 'pokemon', 7);
    expect(ratedItems([y, x]).map((i) => i.id)).toEqual([x.id, y.id].sort());
  });
});

describe('unratedFinished', () => {
  test('Status lists need Completed; lists without Status take any; category order, then title', () => {
    const movie = entry('movies', 'Movie', null);
    const watching = entry('anime', 'Watching', null, 'Watching / In Progress');
    const done = entry('anime', 'Done', null, 'Completed');
    const done2 = entry('anime', 'another', null, 'Completed');
    const rated = entry('anime', 'Rated', 8, 'Completed');
    const blank = entry('movies', '  ', null);
    const got = unratedFinished({ anime: [watching, done, rated, done2], movies: [movie, blank] }, ['movies', 'anime']);
    expect(got.map((x) => [x.category, x.title])).toEqual([['movies', 'Movie'], ['anime', 'another'], ['anime', 'Done']]);
  });
  test('at most 300', () => {
    const many = Array.from({ length: 320 }, (_, i) => entry('songs', `S${i}`, null));
    expect(unratedFinished({ songs: many }, ['songs'])).toHaveLength(300);
  });
});

describe('compareLists', () => {
  test('lists with at least 2 rated entries, in the given order', () => {
    const got = compareLists({
      anime: [entry('anime', 'a', 8), entry('anime', 'b', 7), entry('anime', 'c', null)],
      movies: [entry('movies', 'm', 8), entry('movies', 'n', null)],
      books: [entry('books', 'x', 1), entry('books', 'y', 2), entry('books', 'z', 3)],
    }, ['books', 'movies', 'anime', 'tv']);
    expect(got).toEqual([{ category: 'books', count: 3 }, { category: 'anime', count: 2 }]);
  });
});
