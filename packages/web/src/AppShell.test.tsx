import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from './test/fakeBackend';
import { setCompareEnabled } from './test/flags';
import { makeMe, mockApi } from './test/mockApi';
import { renderApp } from './test/renderApp';
import { setViewportWidth } from './test/viewport';

// Side-nav links end with a cached title count; strip it to compare labels.
const linkNames = (nav: HTMLElement) => within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/(?<=[^\s\d])\d+$/, '').trim());

beforeEach(() => localStorage.clear());

describe('app shell', () => {
  describe('phone bottom bar (Main)', () => {
    const mainNav = () => screen.findByRole('navigation', { name: 'Main' });

    it('with the flag off the Main nav\'s links read Add, Activity, Search, More, and slot 4 is an empty aria-hidden cell', async () => {
      const calls = mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await mainNav();
      expect(linkNames(nav)).toEqual(['Add', 'Activity', 'Search', 'More']);
      const cells = Array.from(nav.children);
      expect(cells).toHaveLength(5);
      expect(cells[3]).toHaveAttribute('aria-hidden', 'true');
      expect(cells[3]).toBeEmptyDOMElement();
      expect(cells[2]).toHaveTextContent('Search');
      expect(calls.some((c) => c.path.includes('/api/compare/queue'))).toBe(false);
    });

    it('with the flag on they read Add, Activity, Search, Compare, More, Compare named "Compare, 2 waiting"', async () => {
      setCompareEnabled(true);
      mockApi(makeMe(), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'a', category: 'anime' }, { entryId: 'b', category: 'tv' }] } } });
      renderApp('/list/anime');
      const nav = await mainNav();
      const compare = await within(nav).findByRole('link', { name: 'Compare, 2 waiting' });
      expect(compare).toHaveAttribute('href', '/compare');
      expect(within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/\d+/g, ''))).toEqual(['Add', 'Activity', 'Search', 'Compare', 'More']);
      expect(compare.querySelector('.count-pill')).toHaveTextContent('2');
    });

    it('Activity has no count badge', async () => {
      mockApi(makeMe());
      renderApp('/list/anime');
      const activity = within(await mainNav()).getByRole('link', { name: 'Activity' });
      expect(activity).toHaveAttribute('href', '/activity');
      expect(activity.querySelector('.count-pill')).toBeNull();
      expect(activity).toHaveTextContent(/^Activity$/);
    });

    it('Add on /activity navigates to /list/<current> and opens "Add to Anime"', async () => {
      fakeBackend({ extra: { 'GET /api/activity': { body: { items: [], next: null } } } });
      const { router } = renderApp('/activity');
      const add = within(await mainNav()).getByRole('link', { name: 'Add anime' });
      expect(add).toHaveAttribute('href', '/list/anime?add=1');
      await userEvent.click(add);
      expect(await screen.findByRole('dialog', { name: 'Add to Anime' })).toBeInTheDocument();
      await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
      expect(router.state.location.search).toBe('');
    });

    it('Add\'s name follows the current list ("Add movie" after visiting /list/movies)', async () => {
      mockApi(makeMe());
      const { router } = renderApp('/list/movies');
      await screen.findByRole('heading', { level: 1, name: 'Movies' });
      await router.navigate('/activity');
      const add = within(await mainNav()).getByRole('link', { name: 'Add movie' });
      expect(add).toHaveAttribute('href', '/list/movies?add=1');
      expect(add).toHaveTextContent(/^Add$/);
    });

    it('a stored list that is turned off falls back to the first enabled list', async () => {
      localStorage.setItem('mt-current-list', 'anime');
      mockApi(makeMe({}, { anime: false }));
      renderApp('/activity');
      expect(within(await mainNav()).getByRole('link', { name: 'Add movie' })).toHaveAttribute('href', '/list/movies?add=1');
    });

    it('all lists off → no Add, no Lists button', async () => {
      const off = Object.fromEntries(['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books'].map((c) => [c, false]));
      mockApi(makeMe({}, off));
      renderApp('/activity');
      const nav = await mainNav();
      expect(within(nav).queryByRole('link', { name: /^Add/ })).not.toBeInTheDocument();
      expect(linkNames(nav)).toEqual(['Activity', 'Search', 'More']);
      expect(nav.children).toHaveLength(5);
      expect(screen.queryByRole('button', { name: 'Lists' })).not.toBeInTheDocument();
    });

    it.each([
      ['/search', 'Search'],
      ['/activity', 'Activity'],
      ['/more', 'More'],
      ['/import', 'More'],
      ['/about', 'More'],
      ['/top5', 'More'],
      ['/stats', 'More'],
    ])('on %s the current tab is %s', async (path, tab) => {
      mockApi(makeMe(), { 'GET /api/activity': { body: { items: [], next: null } } });
      renderApp(path);
      const nav = await mainNav();
      const current = within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current.map((a) => a.textContent?.replace(/(?<=[^\s\d])\d+$/, '').trim())).toEqual([tab]);
    });

    it('on a list screen no tab is current', async () => {
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await mainNav();
      expect(within(nav).getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toEqual([]);
    });

    it('on /compare (enabled) the Compare tab is current', async () => {
      setCompareEnabled(true);
      mockApi(makeMe());
      renderApp('/compare');
      const nav = await mainNav();
      expect(within(nav).getByRole('link', { name: /^Compare/ })).toHaveAttribute('aria-current', 'page');
    });

    it.each(['/list/anime', '/search', '/activity', '/more', '/top5'])('the profile button and the Lists button are on %s', async (path) => {
      mockApi(makeMe(), { 'GET /api/activity': { body: { items: [], next: null } } });
      renderApp(path);
      const profile = await screen.findByRole('link', { name: 'Profile' });
      expect(profile).toHaveAttribute('href', '/profile');
      expect(profile).toHaveClass('profile-btn');
      expect(profile.closest('header')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Lists' })).toBeInTheDocument();
    });

    it.each(['/settings', '/profile'])('the profile button is not on %s (the Lists button is)', async (path) => {
      mockApi(makeMe());
      renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lists' })).toBeInTheDocument();
    });

    it('the profile button shows the photo when there is one', async () => {
      mockApi(makeMe({ avatarAt: '2026-11-15T10:00:00Z' }));
      renderApp('/more');
      const profile = await screen.findByRole('link', { name: 'Profile' });
      expect(profile.querySelector('img')).toHaveAttribute('src', `/api/me/avatar?v=${encodeURIComponent('2026-11-15T10:00:00Z')}`);
    });

    it('the list header is a .page-header--bar containing the icon, the h1 and the profile button, and has no cover backdrop', async () => {
      fakeBackend({ entries: [makeEntry({ title: 'Best', rating: 9.5, coverUrl: 'https://img.example/best.jpg' })] });
      renderApp('/list/anime');
      await screen.findByText('Best');
      const bar = document.querySelector<HTMLElement>('.page-header--bar')!;
      expect(bar).not.toBeNull();
      expect(within(bar).getByRole('heading', { level: 1, name: 'Anime' })).toBeInTheDocument();
      expect(bar.querySelector('.page-header__icon svg')).not.toBeNull();
      expect(within(bar).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
      expect(document.querySelector('.page-header .backdrop')).toBeNull();
      // the sub-line and the chips sit below the band
      expect(bar).not.toContainElement(screen.getByText(/1 title/));
      expect(bar).not.toContainElement(screen.getByRole('combobox', { name: 'Status' }));
    });

    it('PC: the list header is the themed bar too, with no profile button and the Add button', async () => {
      setViewportWidth(1280);
      fakeBackend({ entries: [makeEntry({ title: 'Best', rating: 9.5, coverUrl: 'https://img.example/best.jpg' })] });
      renderApp('/list/anime');
      await screen.findByText('Best');
      const bar = document.querySelector<HTMLElement>('.page-header--bar')!;
      expect(within(bar).getByRole('heading', { level: 1, name: 'Anime' })).toBeInTheDocument();
      expect(within(bar).queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument(); // the side nav's first row is the link
      expect(screen.getAllByRole('link', { name: 'Profile' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Lists' })).not.toBeInTheDocument();
      expect(document.querySelector('.bottom-tabs')).toBeNull();
      expect(screen.getByRole('button', { name: 'Add anime' })).toBeInTheDocument();
    });
  });

  describe('PC side nav (Main, SideNavPC board)', () => {
    const sideNav = () => screen.findByRole('navigation', { name: 'Main' });

    it('reads Profile, Add anime, Search, Activity, the enabled lists, then Import, Export my data, About (no Compare while hidden)', async () => {
      setViewportWidth(1280);
      const calls = mockApi(makeMe({}, { songs: false }), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'a', category: 'anime' }] } } });
      renderApp('/list/anime');
      const nav = await sideNav();
      expect(within(nav).queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument();
      // every row, in document order: links and the Export button
      const rows = Array.from(nav.querySelectorAll('a, button')).map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/(?<=[^\s\d])\d+$/, '').trim());
      expect(rows).toEqual([
        'Profile', 'Add anime', 'Search', 'Activity',
        'Anime', 'Movies', 'TV Shows', 'Albums', 'Games', 'Books',
        'Import', 'Export my data', 'About',
      ]);
      await screen.findByText('No anime yet');
      expect(nav.querySelector('.count-pill')).toBeNull();
      expect(calls.some((c) => c.path.includes('/api/compare/queue'))).toBe(false);
    });

    it('no navigation is still called "Lists" on PC, and Top 5, Stats and Settings are not in the side nav', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await sideNav();
      expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
      for (const n of ['Top 5', 'Stats', 'Settings']) expect(within(nav).queryByRole('link', { name: new RegExp(`^${n}`) })).not.toBeInTheDocument();
    });

    it('the Profile row links to /profile and shows a 32 px avatar and @dan', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      const profile = within(await sideNav()).getByRole('link', { name: 'Profile' });
      expect(profile).toHaveAttribute('href', '/profile');
      expect(profile).toHaveTextContent('@dan');
      const avatar = profile.querySelector<HTMLElement>('.avatar')!;
      expect(avatar).toHaveStyle({ width: '32px', height: '32px' });
      expect(avatar).toHaveTextContent('D');
    });

    it('the Profile row shows the photo when there is one', async () => {
      setViewportWidth(1280);
      mockApi(makeMe({ avatarAt: '2026-11-15T10:00:00Z' }));
      renderApp('/list/anime');
      const profile = within(await sideNav()).getByRole('link', { name: 'Profile' });
      expect(profile.querySelector('img')).toHaveAttribute('src', `/api/me/avatar?v=${encodeURIComponent('2026-11-15T10:00:00Z')}`);
    });

    it('Add is a button-styled link to the current list\'s Add sheet', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      const { router } = renderApp('/list/movies');
      const add = within(await sideNav()).getByRole('link', { name: 'Add movie' });
      expect(add).toHaveAttribute('href', '/list/movies?add=1');
      expect(add).toHaveClass('btn', 'btn--primary');
      await userEvent.click(add);
      expect(await screen.findByRole('dialog', { name: 'Add to Movies' })).toBeInTheDocument();
      expect(router.state.location.search).toBe('');
    });

    it('with every list off there is no Add row', async () => {
      setViewportWidth(1280);
      mockApi(makeMe({}, { anime: false, movies: false, tv: false, albums: false, songs: false, games: false, books: false }));
      renderApp('/activity');
      const nav = await sideNav();
      expect(within(nav).queryByRole('link', { name: /^Add/ })).not.toBeInTheDocument();
      expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    });

    it('Search and Activity link to their screens and are current there', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/activity');
      const nav = await sideNav();
      expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/activity');
      expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
      expect(within(nav).getByRole('link', { name: 'Search' })).not.toHaveAttribute('aria-current');
    });

    it('Export my data is the real export button', async () => {
      setViewportWidth(1280);
      const calls = mockApi(makeMe(), { 'GET /api/export': { body: { entries: [] } } });
      renderApp('/list/anime');
      await userEvent.click(within(await sideNav()).getByRole('button', { name: 'Export my data' }));
      await waitFor(() => expect(calls.some((c) => c.path === '/api/export')).toBe(true));
    });

    it('with Compare enabled it comes right after Activity, with the waiting count', async () => {
      setCompareEnabled(true);
      setViewportWidth(1280);
      mockApi(makeMe({}, { songs: false }), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'a', category: 'anime' }, { entryId: 'b', category: 'tv' }] } } });
      renderApp('/list/anime');
      const nav = await sideNav();
      const link = await within(nav).findByRole('link', { name: 'Compare, 2 waiting' });
      expect(link).toHaveAttribute('href', '/compare');
      expect(link.querySelector('.count-pill')).toHaveTextContent('2');
      expect(link.querySelector('svg')).not.toBeNull();
      expect(linkNames(nav)).toEqual(['D@dan', 'Add anime', 'Search', 'Activity', 'Compare', 'Anime', 'Movies', 'TV Shows', 'Albums', 'Games', 'Books', 'Import', 'About']);
      expect(screen.queryByRole('link', { name: 'More' })).not.toBeInTheDocument();
    });

    it('season tabs never appear as list rows', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await sideNav();
      expect(linkNames(nav)).not.toContain('Anime Seasons');
      expect(linkNames(nav)).toHaveLength(4 + 7 + 2); // Profile, Add, Search, Activity + 7 lists + Import, About
    });
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

  it('More has Ratings (Top 5, Stats), Your data (Import, Export) and App (About) only: no other lists, Settings or Appearance (no Compare while hidden)', async () => {
    mockApi(makeMe({}, { books: false }));
    renderApp('/more');
    expect(await screen.findByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    const main = screen.getByRole('main').querySelector<HTMLElement>('.screen__body')!;
    expect(linkNames(main)).toEqual(['Top 5', 'Stats', 'Import from Google Sheets', 'About Media Tracker']);
    expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Ratings', 'Your data', 'App']);
  });

  it('with Compare enabled, More lists Compare first under Ratings', async () => {
    setCompareEnabled(true);
    mockApi(makeMe({}, { books: false }));
    renderApp('/more');
    expect(await screen.findByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    const main = screen.getByRole('main').querySelector<HTMLElement>('.screen__body')!;
    expect(linkNames(main)).toEqual(['Compare', 'Top 5', 'Stats', 'Import from Google Sheets', 'About Media Tracker']);
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  });

  it('More shows the waiting count on Compare', async () => {
    setCompareEnabled(true);
    mockApi(makeMe(), { 'GET /api/compare/queue': { body: { items: [{ entryId: 'a', category: 'anime' }] } } });
    renderApp('/more');
    await screen.findByRole('heading', { level: 1, name: 'More' });
    const body = screen.getByRole('main').querySelector<HTMLElement>('.screen__body')!;
    expect(await within(body).findByRole('link', { name: 'Compare, 1 waiting' })).toHaveAttribute('href', '/compare');
  });

  it('/compare redirects to the home list (replacing the entry) while Compare is hidden', async () => {
    const calls = mockApi(makeMe());
    const { router } = renderApp('/compare');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('heading', { name: 'Compare ratings' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('/api/compare/'))).toBe(false);
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
