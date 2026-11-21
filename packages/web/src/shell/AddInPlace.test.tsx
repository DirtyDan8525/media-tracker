import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category } from '@media-tracker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';
import { LAST_ADD_KEY, readLastAddList, rememberAddList, resolveAddList } from './lastAddList';

const empty = { 'GET /api/activity': { body: { items: [], next: null } } };
beforeEach(() => { localStorage.clear(); setViewportWidth(390); });
afterEach(() => vi.restoreAllMocks());

const bubble = (name: string | RegExp = /^Add (anime|movie|TV show|album|song|game|book|manga|video)$/) => screen.findByRole('button', { name });
const sheet = async () => {
  await screen.findByRole('textbox', { name: /^(Title|Album|Song|Video|Game|Book)$/ });
  return screen.getByRole('dialog', { name: 'Add' });
};
const addTo = (d: HTMLElement) => within(d).getByRole('button', { name: /^Add to/ });
const submitTitle = async (d: HTMLElement, title: string, extra?: (d: HTMLElement) => Promise<void>) => {
  await userEvent.type(within(d).getByRole('textbox', { name: /^(Title|Album|Song|Video|Game|Book)$/ }), title);
  await extra?.(d);
  await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
};
const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/entries');

describe('lastAddList (pure)', () => {
  const on: Category[] = ['anime', 'movies', 'books'];
  it('uses the stored list when it is still on, else the fallback, else the first list, else null', () => {
    expect(resolveAddList('books', on, 'anime')).toBe('books');
    expect(resolveAddList('games', on, 'movies')).toBe('movies'); // turned off
    expect(resolveAddList(null, on, 'movies')).toBe('movies');
    expect(resolveAddList('nope', on, null)).toBe('anime'); // not a list key
    expect(resolveAddList('list:gone', on, 'tv')).toBe('anime'); // fallback itself off
    expect(resolveAddList('books', [], null)).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => rememberAddList('books')).not.toThrow();
    expect(readLastAddList()).toBeNull();
  });
});

describe('Add on Activity opens in place', () => {
  it('opens the sheet on top of Activity, on the last list added to, without navigating', async () => {
    localStorage.setItem(LAST_ADD_KEY, 'books');
    fakeBackend({ extra: empty });
    const { router } = renderApp('/activity');
    const fab = await bubble('Add book');
    expect(fab).toHaveClass('add-fab');
    expect(fab).not.toHaveAttribute('href');
    await userEvent.click(fab);
    const d = await sheet();
    expect(addTo(d)).toHaveTextContent('Books');
    expect(router.state.location.pathname).toBe('/activity');
    expect(router.state.location.search).toBe('');
  });

  it('falls back to the current list with nothing remembered, and when the remembered list is off', async () => {
    localStorage.setItem('mt-current-list', 'movies');
    fakeBackend({ extra: empty });
    const first = renderApp('/activity');
    await userEvent.click(await bubble('Add movie'));
    expect(addTo(await sheet())).toHaveTextContent('Movies');
    first.unmount();

    localStorage.setItem(LAST_ADD_KEY, 'games');
    fakeBackend({ me: makeMe({}, { games: false }), extra: empty });
    renderApp('/activity');
    await userEvent.click(await bubble('Add movie'));
    expect(addTo(await sheet())).toHaveTextContent('Movies');
  });

  it('works with localStorage unavailable (falls back to the default list)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    fakeBackend({ extra: empty });
    renderApp('/activity');
    await userEvent.click(await bubble('Add anime'));
    expect(addTo(await sheet())).toHaveTextContent('Anime');
  });

  it('adding stays on Activity, toasts "Added to <List> · Open", remembers the list, and Open goes to the title', async () => {
    const { calls } = fakeBackend({ extra: empty });
    const { router } = renderApp('/activity');
    await userEvent.click(await bubble('Add anime'));
    const d = await sheet();
    await userEvent.click(addTo(d));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Add to' })).getByRole('menuitemradio', { name: /^Books/ }));
    await submitTitle(d, 'Dune');
    const toast = await screen.findByRole('status');
    await waitFor(() => expect(toast).toHaveTextContent('Added to Books · Open'));
    expect(router.state.location.pathname).toBe('/activity');
    expect(localStorage.getItem(LAST_ADD_KEY)).toBe('books');
    expect(posts(calls)[0]!.body).toMatchObject({ category: 'books', title: 'Dune' });
    // the bubble now offers the list you used
    expect(await bubble('Add book')).toBeInTheDocument();
    await userEvent.click(within(toast).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/entry\/./));
  });

  it('the next Add (from Search too) preselects that list; a list screen still uses its own list', async () => {
    localStorage.setItem(LAST_ADD_KEY, 'books');
    fakeBackend({ extra: empty });
    const { router } = renderApp('/search');
    await userEvent.click(await bubble('Add book'));
    expect(addTo(await sheet())).toHaveTextContent('Books');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add' })).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await router.navigate('/list/movies');
    await userEvent.click(await screen.findByRole('link', { name: 'Add movie' }));
    expect(addTo(await sheet())).toHaveTextContent('Movies');
    expect(router.state.location.pathname).toBe('/list/movies');
  });

  it('adding from a list also remembers its list for the next Activity Add', async () => {
    fakeBackend({ extra: empty });
    const { router } = renderApp('/list/movies');
    await userEvent.click(await screen.findByRole('link', { name: 'Add movie' }));
    await submitTitle(await sheet(), 'Arrival');
    await waitFor(() => expect(localStorage.getItem(LAST_ADD_KEY)).toBe('movies'));
    await router.navigate('/activity');
    expect(await bubble('Add movie')).toBeInTheDocument();
  });

  it('keeps the duplicate confirm: Cancel adds nothing, Add again adds it, both without leaving Activity', async () => {
    const { entries, calls } = fakeBackend({ entries: [makeEntry({ category: 'anime', title: 'Frieren' })], extra: empty });
    const { router } = renderApp('/activity');
    const attempt = async () => {
      await userEvent.click(await bubble('Add anime'));
      await submitTitle(await sheet(), 'Frieren');
      return screen.findByRole('dialog', { name: 'Already on your list' });
    };
    let ask = await attempt();
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(entries).toHaveLength(1);
    expect(screen.queryByText(/^Added to/)).not.toBeInTheDocument();
    ask = await attempt();
    await userEvent.click(within(ask).getByRole('button', { name: 'Add again' }));
    await waitFor(() => expect(entries).toHaveLength(2));
    expect(await screen.findByText(/Added to Anime/)).toBeInTheDocument();
    expect(posts(calls).at(-1)!.body).toMatchObject({ allowDuplicate: true });
    expect(router.state.location.pathname).toBe('/activity');
  });

  it('keeps rate-on-complete: a rated add asks about close ratings on Activity', async () => {
    const arcane = { id: 'arc', title: 'Arcane', rating: 9.6, typed: 9.6, tier: 3, priorMean: 9.6, strength: 9.6, scoreLocked: false, cover: '', square: false, status: 'Completed' };
    const me = makeMe();
    me.settings = { ...me.settings, compareAsk: 'Both' };
    fakeBackend({
      me,
      extra: {
        ...empty,
        'GET /api/ratings/anime/close/:id': (_b: unknown, _u: URL, p: Record<string, string>) => ({ body: { item: { ...arcane, id: p.id, title: 'Frieren', status: null }, others: [arcane] } }),
      },
    });
    const { router } = renderApp('/activity');
    await userEvent.click(await bubble('Add anime'));
    await submitTitle(await sheet(), 'Frieren', (d) => userEvent.type(within(d).getByRole('spinbutton', { name: 'Rating' }), '9.6'));
    expect(await screen.findByRole('dialog', { name: 'Close call' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/activity');
  });
});
