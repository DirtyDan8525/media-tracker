import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from './test/mockApi';
import { renderApp } from './test/renderApp';
import { setViewportWidth } from './test/viewport';

// Side-nav links end with a cached title count; strip it to compare labels.
const linkNames = (nav: HTMLElement) => within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/(?<=[^\s\d])\d+$/, '').trim());

describe('app shell', () => {
  it('phone shows the first 4 enabled lists + More', async () => {
    mockApi(makeMe({}, { movies: false }));
    renderApp('/list/anime');
    const nav = await screen.findByRole('navigation', { name: 'Lists' });
    expect(linkNames(nav)).toEqual(['Anime', 'TV', 'Albums', 'Songs', 'More']);
    expect(within(nav).getByRole('link', { name: 'Anime' })).toHaveAttribute('aria-current', 'page');
  });

  it('PC side nav shows every enabled list, then Import, Settings, About', async () => {
    setViewportWidth(1280);
    mockApi(makeMe({}, { songs: false }));
    renderApp('/list/anime');
    const nav = await screen.findByRole('navigation', { name: 'Lists' });
    expect(linkNames(nav)).toEqual(['Anime', 'Movies', 'TV Shows', 'Albums', 'Games', 'Books', 'Compare', 'Top 5', 'Stats', 'Import', 'Settings', 'About']);
    expect(screen.queryByRole('link', { name: 'More' })).not.toBeInTheDocument();
  });

  it('PC side nav shows the waiting count beside Compare', async () => {
    setViewportWidth(1280);
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'a', category: 'anime' }, { entryId: 'b', category: 'tv' }] } } });
    renderApp('/list/anime');
    const nav = await screen.findByRole('navigation', { name: 'Lists' });
    const link = await within(nav).findByRole('link', { name: 'Compare, 2 waiting' });
    expect(link).toHaveAttribute('href', '/compare');
    expect(link.querySelector('.count-pill')).toHaveTextContent('2');
    for (const n of ['Compare', 'Top 5', 'Stats']) expect(within(nav).getByRole('link', { name: new RegExp(`^${n}`) }).querySelector('svg')).not.toBeNull();
  });

  it('season tabs never appear as list tabs', async () => {
    setViewportWidth(1280);
    mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await screen.findByRole('navigation', { name: 'Lists' });
    expect(linkNames(nav)).not.toContain('Anime Seasons');
    expect(linkNames(nav)).toHaveLength(13);
  });

  it('/ redirects to the first enabled list', async () => {
    mockApi(makeMe({}, { anime: false }));
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/movies'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Movies' })).toBeInTheDocument();
  });

  it('the placeholder list screen shows its empty state', async () => {
    mockApi(makeMe());
    renderApp('/list/games');
    expect(await screen.findByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
    expect(await screen.findByText('No games yet')).toBeInTheDocument();
  });

  it('More lists the other enabled lists, then Import, Settings and About', async () => {
    mockApi(makeMe({}, { books: false }));
    renderApp('/more');
    expect(await screen.findByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(linkNames(main)).toEqual(['Songs', 'Games', 'Compare', 'Top 5', 'Stats', 'Import from Google Sheets', 'Settings', 'About Media Tracker']);
    expect(within(main).getByRole('heading', { name: 'Ratings' })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Lists' });
    expect(within(tabs).getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  });

  it('More shows the waiting count on Compare', async () => {
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'a', category: 'anime' }] } } });
    renderApp('/more');
    expect(await screen.findByRole('link', { name: 'Compare, 1 waiting' })).toHaveAttribute('href', '/compare');
  });

  it.each(['/compare', '/top5', '/stats'])('on %s the phone More tab is current', async (path) => {
    mockApi(makeMe());
    renderApp(path);
    const tabs = await screen.findByRole('navigation', { name: 'Lists' });
    expect(within(tabs).getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  });

  it('an unknown list redirects home', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/list/podcasts');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
  });

  it('applies the theme from the user settings', async () => {
    const me = makeMe();
    me.settings.theme = 'Sakura';
    mockApi(me);
    renderApp('/about');
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#fff7f9'));
  });
});
