import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../../test/friends';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const THEIRS = () => [
  makeFriendEntry({ id: 't1', title: 'Mob Psycho 100', rating: 5, source: 'kitsu', sourceId: '1' }),
  makeFriendEntry({ id: 't2', title: 'Steins;Gate', rating: 6 }),
  makeFriendEntry({ id: 't3', title: 'Vinland Saga', rating: 8.5 }),
  makeFriendEntry({ id: 't4', title: 'Odd Taxi', rating: 8 }),
  makeFriendEntry({ id: 't5', title: 'Their private-to-me', rating: null }),
  makeFriendEntry({ id: 't6', title: 'Heat', rating: 7, category: 'movies' }),
];
const MINE = () => [
  makeEntry({ id: 'm1', title: 'Mob Psycho 100', rating: 9, source: 'kitsu', sourceId: '1' }),
  makeEntry({ id: 'm2', title: 'Steins Gate', rating: 8.5 }),
  makeEntry({ id: 'm3', title: 'Secret show', rating: 9, isPrivate: true }),
  makeEntry({ id: 'm4', title: 'Odd Taxi', rating: null }), // yours, unrated: it is still "yours"
];
function backend(mine = MINE(), extra: Record<string, unknown> = {}) {
  return fakeBackend({
    me: makeMe(),
    entries: mine,
    extra: {
      'GET /api/users/:username': { body: { user: REN, memberSince: null, relation: 'friend' } },
      'GET /api/users/:username/entries': { body: THEIRS() },
      'GET /api/friends': { body: friendsOf(REN) },
      ...extra,
    } as never,
  });
}

describe('Compare with a friend', () => {
  it('Both rated lists the biggest gap first: "You 9.0 · Ren 5.0"', async () => {
    backend();
    renderApp('/u/ren?tab=compare');
    const both = await screen.findByRole('region', { name: 'Both rated' });
    const links = within(both).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Mob Psycho 100: You 9.0, Ren 5.0',
      'Steins;Gate: You 8.5, Ren 6.0',
    ]);
    expect(links[0]).toHaveAttribute('href', '/entry/m1');
    expect(within(both).getByText('Differ by 4.0')).toBeInTheDocument();
    expect(within(both).getByText('Differ by 2.5')).toBeInTheDocument();
  });

  it('Theirs, not yours lists their best titles you have no match for, with Add to mine; your private titles never appear', async () => {
    backend();
    renderApp('/u/ren?tab=compare');
    const theirs = await screen.findByRole('region', { name: 'Theirs, not yours' });
    expect(within(theirs).getByText('Vinland Saga')).toBeInTheDocument();
    expect(within(theirs).getByRole('button', { name: 'Add Vinland Saga to mine' })).toBeInTheDocument();
    expect(within(theirs).queryByText('Odd Taxi')).not.toBeInTheDocument(); // on your list (unrated)
    expect(within(theirs).queryByText('Mob Psycho 100')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret show')).not.toBeInTheDocument();
  });

  it("a title only you rated privately doesn't count as both rated", async () => {
    backend([makeEntry({ id: 'p1', title: 'Vinland Saga', rating: 9, isPrivate: true })]);
    renderApp('/u/ren?tab=compare');
    const both = await screen.findByRole('region', { name: 'Both rated' });
    expect(within(both).queryByRole('link')).not.toBeInTheDocument();
    expect(within(both).getByText("Nothing you've both rated in Anime yet.")).toBeInTheDocument();
    // yours but private: still yours, so it is not offered as new either
    expect(within(screen.getByRole('region', { name: 'Theirs, not yours' })).queryByText('Vinland Saga')).not.toBeInTheDocument();
  });

  it('Add to mine adds it and swaps the button for a link to your new entry', async () => {
    const { calls } = backend();
    renderApp('/u/ren?tab=compare');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Vinland Saga to mine' }));
    const link = await screen.findByRole('link', { name: 'On your list' });
    expect(link.getAttribute('href')).toMatch(/^\/entry\/e\d+$/);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/entries')!.body).toMatchObject({ title: 'Vinland Saga', status: 'Plan to watch' });
  });

  it('switching the category compares that list', async () => {
    backend([...MINE(), makeEntry({ id: 'h1', category: 'movies', title: 'Heat', rating: 3 })]);
    renderApp('/u/ren?tab=compare');
    await screen.findByRole('region', { name: 'Both rated' });
    await userEvent.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Movies' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Heat: You 3.0, Ren 7.0' })).toBeInTheDocument());
  });

  it('empty states are friendly', async () => {
    backend([]);
    renderApp('/u/ren?tab=compare');
    expect(await screen.findByText("Nothing you've both rated in Anime yet.")).toBeInTheDocument();
  });

  it('nothing to add: says so', async () => {
    backend(THEIRS().filter((t) => t.category === 'anime').map((t) => makeEntry({ title: t.title, rating: 1 })));
    renderApp('/u/ren?tab=compare');
    expect(await screen.findByText('Nothing from Ren to add in Anime right now.')).toBeInTheDocument();
  });
});
