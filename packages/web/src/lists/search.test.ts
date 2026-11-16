import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { searchEntries } from './search';

describe('searchEntries', () => {
  it('"pokemon" finds Pokémon in Games and Anime, grouped in nav order', () => {
    const by = {
      games: [makeEntry({ category: 'games', title: 'Pokémon Emerald' }), makeEntry({ category: 'games', title: 'Zelda' })],
      anime: [makeEntry({ title: 'Pokémon' })],
      books: [makeEntry({ category: 'books', title: 'Dune' })],
    };
    const out = searchEntries(by, ['anime', 'movies', 'games', 'books'], 'pokemon');
    expect(out.map((g) => g.category)).toEqual(['anime', 'games']);
    expect(out[1]!.rows.map((e) => e.title)).toEqual(['Pokémon Emerald']);
  });

  it('groups sorted by rating, unrated last', () => {
    const by = { anime: [
      makeEntry({ title: 'Star B' }),
      makeEntry({ title: 'Star A', rating: 6 }),
      makeEntry({ title: 'Star C', rating: 9 }),
    ] };
    expect(searchEntries(by, ['anime'], 'star')[0]!.rows.map((e) => e.title)).toEqual(['Star C', 'Star A', 'Star B']);
  });

  it('empty q → [] (also whitespace), and only the asked lists are searched', () => {
    const by = { anime: [makeEntry({ title: 'Frieren' })], movies: [makeEntry({ category: 'movies', title: 'Frieren Movie' })] };
    expect(searchEntries(by, ['anime'], '')).toEqual([]);
    expect(searchEntries(by, ['anime'], '   ')).toEqual([]);
    expect(searchEntries(by, ['anime'], 'frieren').map((g) => g.category)).toEqual(['anime']);
  });
});
