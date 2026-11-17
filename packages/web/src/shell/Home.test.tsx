import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/fakeBackend';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

beforeEach(() => { localStorage.clear(); setViewportWidth(390); });
const empty = { 'GET /api/activity': { body: { items: [], next: null } } };
const addBubble = () => screen.queryByRole('link', { name: /^Add (anime|movie|TV show|album|song|game|book)$/ });

describe('Home opens the last list', () => {
  it('/ goes to the remembered list', async () => {
    localStorage.setItem('mt-current-list', 'books');
    fakeBackend();
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/books'));
  });

  it('defaults to Anime with nothing remembered', async () => {
    fakeBackend();
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
  });

  it('falls to the first enabled list when the remembered one is off', async () => {
    localStorage.setItem('mt-current-list', 'anime');
    fakeBackend({ me: makeMe({}, { anime: false }) });
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/movies'));
  });

  it('defaults to Anime when localStorage throws', async () => {
    fakeBackend();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      const { router } = renderApp('/');
      await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    } finally { spy.mockRestore(); }
  });

  it('the Home tab links to / and is current on a list; tapping it from Activity lands on the last list', async () => {
    localStorage.setItem('mt-current-list', 'tv');
    mockApi(makeMe(), empty);
    const { router } = renderApp('/activity');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const home = within(nav).getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).not.toHaveAttribute('aria-current');
    await userEvent.click(home);
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/tv'));
    expect(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('PC side nav has Home (to /) and keeps every list', async () => {
    setViewportWidth(1280);
    mockApi(makeMe(), empty);
    renderApp('/list/anime');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    for (const l of ['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books']) expect(within(nav).getByRole('link', { name: new RegExp(`^${l}`) })).toBeInTheDocument();
  });
});

describe('Add bubble (phone)', () => {
  it.each(['/list/anime', '/activity', '/search'])('shows on %s', async (path) => {
    mockApi(makeMe(), empty);
    renderApp(path);
    await screen.findByRole('navigation', { name: 'Main' });
    const add = await screen.findByRole('link', { name: 'Add anime' });
    expect(add).toHaveClass('add-fab');
    expect(add).toHaveAttribute('href', '/list/anime?add=1');
  });

  it.each([
    '/profile', '/more', '/compare', '/settings', '/settings/appearance', '/settings/tiers', '/admin', '/friends', '/u/ren', '/about', '/top5', '/stats', '/import',
  ])('is hidden on %s', async (path) => {
    mockApi(makeMe({ isAdmin: true }), { ...empty, 'GET /api/friends': { body: { friends: [], incoming: [], outgoing: [] } } });
    renderApp(path);
    await screen.findByRole('navigation', { name: 'Main' });
    await new Promise((r) => setTimeout(r, 30));
    expect(addBubble()).not.toBeInTheDocument();
  });

  it('is not shown on PC (the side nav has + Add)', async () => {
    setViewportWidth(1280);
    mockApi(makeMe(), empty);
    renderApp('/list/anime');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(document.querySelector('.add-fab')).toBeNull();
  });

  it('is not shown when every list is off', async () => {
    const off = Object.fromEntries(['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga'].map((c) => [c, false]));
    mockApi(makeMe({}, off), empty);
    renderApp('/activity');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(document.querySelector('.add-fab')).toBeNull();
  });

  it('lifts toasts only while it shows', async () => {
    mockApi(makeMe(), empty);
    const { router } = renderApp('/activity');
    await screen.findByRole('link', { name: 'Add anime' });
    expect(document.documentElement).toHaveClass('has-add-fab');
    await router.navigate('/more');
    await waitFor(() => expect(document.documentElement).not.toHaveClass('has-add-fab'));
  });
});
