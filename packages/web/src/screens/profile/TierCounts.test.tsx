import { screen, waitFor } from '@testing-library/react';
import { DEFAULT_TIERS, type Entry, type TierSet } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { tierCounts } from './TierCounts';

const LINE = "Loved 2 · Liked 1 · Fine 1 · Didn't like 1";
const rated = (rating: number | null, over: Partial<Entry> = {}) => makeEntry({ category: 'anime', rating, ...over });
const ratings = (...rs: (number | null)[]) => rs.map((r) => rated(r));
const meWith = (tiers: Record<string, TierSet>) => {
  const me = makeMe();
  me.settings = { ...me.settings, tiers };
  return me;
};

describe('tierCounts', () => {
  const settings = makeMe().settings;

  it('ratings 9.5, 9, 8, 6.5, 3 give Loved 2, Liked 1, Fine 1, Didn\'t like 1 (highest tier first)', () => {
    expect(tierCounts({ anime: ratings(9.5, 9, 8, 6.5, 3) }, ['anime'], settings)).toEqual([
      { name: 'Loved', count: 2 }, { name: 'Liked', count: 1 }, { name: 'Fine', count: 1 }, { name: "Didn't like", count: 1 },
    ]);
  });

  it("unrated entries don't count", () => {
    const counts = tierCounts({ anime: ratings(9.5, null, null, 3) }, ['anime'], settings);
    expect(counts.map((c) => c.count)).toEqual([1, 0, 0, 1]);
  });

  it('only the enabled lists count', () => {
    const by = { anime: ratings(9.5), movies: ratings(9.5, 3) };
    expect(tierCounts(by, ['anime'], settings).map((c) => c.count)).toEqual([1, 0, 0, 0]);
  });

  it("each list's own bounds decide: 7 is Fine by default but Liked when Movies' Liked starts at 6.5", () => {
    const own: TierSet = { names: DEFAULT_TIERS.names, bounds: [3, 6.5, 9] };
    const s = { ...settings, tiers: { movies: own } };
    const by = { anime: [rated(7)], movies: [rated(7, { category: 'movies' })] };
    expect(tierCounts(by, ['anime', 'movies'], s).map((c) => c.count)).toEqual([0, 1, 1, 0]);
  });

  it('a rated row with no stored tier is placed by its list\'s tiers; a stored tier wins', () => {
    const by = { anime: [rated(9.5, { tier: null }), rated(9.5, { tier: 1 })] };
    expect(tierCounts(by, ['anime'], settings).map((c) => c.count)).toEqual([1, 0, 1, 0]);
  });

  it('a list with its own tier names gives the default names', () => {
    const own: TierSet = { names: ['Meh', 'OK', 'Good', 'Great'], bounds: [6, 7.5, 9] };
    const counts = tierCounts({ anime: ratings(9.5) }, ['anime', 'movies'], { ...settings, tiers: { anime: own } });
    expect(counts.map((c) => c.name)).toEqual(['Loved', 'Liked', 'Fine', "Didn't like"]);
  });

  it('when every enabled list shares custom names they are used', () => {
    const own: TierSet = { names: ['Meh', 'OK', 'Good', 'Great'], bounds: [6, 7.5, 9] };
    const counts = tierCounts({ anime: ratings(9.5) }, ['anime', 'movies'], { ...settings, tiers: { anime: own, movies: own } });
    expect(counts.map((c) => c.name)).toEqual(['Great', 'Good', 'OK', 'Meh']);
  });
});

describe('Profile: tier counts', () => {
  it('reads as one muted line and a small bar, over the rated titles', async () => {
    fakeBackend({ me: makeMe(), entries: [...ratings(9.5, 9, 8, 6.5, 3, null)] });
    renderApp('/profile');
    const bar = await screen.findByRole('img', { name: LINE });
    expect(bar.querySelectorAll('span')).toHaveLength(4);
    expect(screen.getByText(LINE)).toBeInTheDocument();
  });

  it('shows nothing until a title is rated', async () => {
    fakeBackend({ me: makeMe(), entries: ratings(null, null) });
    renderApp('/profile');
    await screen.findByText('@dan');
    await screen.findByText('2'); // the lists loaded
    expect(screen.queryByText(/Loved/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Loved/ })).not.toBeInTheDocument();
  });

  it("uses a list's own tier bounds", async () => {
    const own: TierSet = { names: DEFAULT_TIERS.names, bounds: [3, 6.5, 9] };
    fakeBackend({ me: meWith({ anime: own }), entries: ratings(7) });
    renderApp('/profile');
    await waitFor(() => expect(screen.getByText("Loved 0 · Liked 1 · Fine 0 · Didn't like 0")).toBeInTheDocument());
  });
});
