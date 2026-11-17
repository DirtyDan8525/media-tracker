import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicSettings } from './test/appSettings';
import { fakeBackend, makeEntry } from './test/fakeBackend';
import { makeMe, mockApi } from './test/mockApi';
import { renderApp } from './test/renderApp';
import { setViewportWidth } from './test/viewport';

// Side-nav links end with a cached title count; strip it to compare labels.
const linkNames = (nav: HTMLElement) => within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/(?<=[^\s\d])\d+$/, '').trim());

beforeEach(() => localStorage.clear());

describe('app shell', () => {
  describe('phone bottom bar (Main)', () => {
    const mainNav = () => screen.findByRole('navigation', { name: 'Main' });

    it('the Main nav\'s links read Home, Activity, Search, Friends, More: Friends is tab 4, Messages is not in the bar (Dan, 2026-11-17)', async () => {
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await mainNav();
      expect(within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/\d+/g, ''))).toEqual(['Home', 'Activity', 'Search', 'Friends', 'More']);
      expect(within(nav).queryByRole('link', { name: /Compare/ })).not.toBeInTheDocument();
      const cells = Array.from(nav.children);
      expect(cells).toHaveLength(5);
      expect(cells[2]).toHaveTextContent('Search');
    });

    it('Activity has no count badge when nothing is unread', async () => {
      mockApi(makeMe());
      renderApp('/list/anime');
      const activity = within(await mainNav()).getByRole('link', { name: 'Activity' });
      expect(activity).toHaveAttribute('href', '/activity');
      expect(activity.querySelector('.count-pill')).toBeNull();
      expect(activity).toHaveTextContent(/^Activity$/);
    });

    it('the Activity tab reads "Activity, 3 new" when unread.feed is 3, shows nothing at 0 and "99+" above 99', async () => {
      const unread = { feed: 3, requests: 0 };
      mockApi(makeMe(), { 'GET /api/activity/unread': () => ({ body: unread }) });
      const { queryClient } = renderApp('/list/anime');
      const nav = await mainNav();
      const tab = await within(nav).findByRole('link', { name: 'Activity, 3 new' });
      expect(tab.querySelector('.count-pill')).toHaveTextContent('3');
      unread.feed = 120;
      await queryClient.invalidateQueries({ queryKey: ['activity-unread'] });
      const capped = await within(nav).findByRole('link', { name: 'Activity, 99+ new' });
      expect(capped.querySelector('.count-pill')).toHaveTextContent('99+');
      unread.feed = 0;
      await queryClient.invalidateQueries({ queryKey: ['activity-unread'] });
      await waitFor(() => expect(within(nav).getByRole('link', { name: 'Activity' }).querySelector('.count-pill')).toBeNull());
    });

    it('the Friends tab badge is unread messages + incoming friend requests: "Friends, 3 new", nothing at 0, "99+" above 99; Messages and Top 5 are not in the bar', async () => {
      const unread = { feed: 0, requests: 1, messages: 2 };
      mockApi(makeMe(), { 'GET /api/activity/unread': () => ({ body: unread }) });
      const { queryClient } = renderApp('/list/anime');
      const nav = await mainNav();
      const tab = await within(nav).findByRole('link', { name: 'Friends, 3 new' });
      expect(tab).toHaveAttribute('href', '/friends');
      expect(tab.querySelector('.count-pill')).toHaveTextContent('3');
      expect(within(nav).queryByRole('link', { name: /Messages/ })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('link', { name: /Top 5/ })).not.toBeInTheDocument();
      unread.messages = 120;
      await queryClient.invalidateQueries({ queryKey: ['activity-unread'] });
      expect(await within(nav).findByRole('link', { name: 'Friends, 99+ new' })).toBeInTheDocument();
      unread.messages = 0;
      unread.requests = 0;
      await queryClient.invalidateQueries({ queryKey: ['activity-unread'] });
      await waitFor(() => expect(within(nav).getByRole('link', { name: 'Friends' }).querySelector('.count-pill')).toBeNull());
    });

    it('the profile button has a dot and reads "Profile, 1 friend request" when requests is 1', async () => {
      mockApi(makeMe(), { 'GET /api/activity/unread': { body: { feed: 0, requests: 1 } } });
      renderApp('/list/anime');
      const profile = await screen.findByRole('link', { name: 'Profile, 1 friend request' });
      expect(profile.querySelector('.nav-dot')).not.toBeNull();
    });

    it('Add on /activity navigates to /list/<current> and opens the Add sheet', async () => {
      fakeBackend({ extra: { 'GET /api/activity': { body: { items: [], next: null } } } });
      const { router } = renderApp('/activity');
      const add = (await screen.findByRole('link', { name: 'Add anime' }));
      expect(add).toHaveAttribute('href', '/list/anime?add=1');
      await userEvent.click(add);
      expect(await screen.findByRole('dialog', { name: 'Add' })).toBeInTheDocument();
      await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
      expect(router.state.location.search).toBe('');
    });

    it('Add on the current list keeps its Status and Genre filters', async () => {
      fakeBackend({ entries: [makeEntry({ title: 'Frieren', status: 'Completed', genres: 'Fantasy' })] });
      const { router } = renderApp('/list/anime?status=Completed&genre=Fantasy');
      await screen.findByText('Frieren');
      const add = (await screen.findByRole('link', { name: 'Add anime' }));
      expect(add).toHaveAttribute('href', '/list/anime?status=Completed&genre=Fantasy&add=1');
      await userEvent.click(add);
      expect(await screen.findByRole('dialog', { name: 'Add' })).toBeInTheDocument();
      await waitFor(() => expect(router.state.location.search).toBe('?status=Completed&genre=Fantasy'));
    });

    it('Add from another list or screen carries no filters over', async () => {
      mockApi(makeMe(), { 'GET /api/activity': { body: { items: [], next: null } } });
      const { router } = renderApp('/list/anime?status=Completed');
      await screen.findByRole('heading', { level: 1, name: 'Anime' });
      await router.navigate('/activity?show=you');
      await screen.findByRole('heading', { level: 1, name: 'Activity' });
      expect((await screen.findByRole('link', { name: 'Add anime' }))).toHaveAttribute('href', '/list/anime?add=1');
    });

    it('Add\'s name follows the current list ("Add movie" after visiting /list/movies)', async () => {
      mockApi(makeMe());
      const { router } = renderApp('/list/movies');
      await screen.findByRole('heading', { level: 1, name: 'Movies' });
      await router.navigate('/activity');
      const add = (await screen.findByRole('link', { name: 'Add movie' }));
      expect(add).toHaveAttribute('href', '/list/movies?add=1');
      expect(add).toHaveClass('add-fab');
    });

    it('a stored list that is turned off falls back to the first enabled list', async () => {
      localStorage.setItem('mt-current-list', 'anime');
      mockApi(makeMe({}, { anime: false }));
      renderApp('/activity');
      expect((await screen.findByRole('link', { name: 'Add movie' }))).toHaveAttribute('href', '/list/movies?add=1');
    });

    it('all lists off → no Add bubble (Home still shows)', async () => {
      const off = Object.fromEntries(['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga', 'youtube'].map((c) => [c, false]));
      mockApi(makeMe({}, off));
      renderApp('/activity');
      const nav = await mainNav();
      expect(screen.queryByRole('link', { name: /^Add/ })).not.toBeInTheDocument();
      expect(linkNames(nav)).toEqual(['Home', 'Activity', 'Search', 'Friends', 'More']);
      expect(nav.children).toHaveLength(5);
    });

    it.each([
      ['/search', 'Search'],
      ['/activity', 'Activity'],
      ['/more', 'More'],
      ['/import', 'More'],
      ['/about', 'More'],
      ['/top5', 'More'],
      ['/friends', 'Friends'],
      ['/messages', 'Friends'],
      ['/messages/new', 'Friends'],
      ['/stats', 'More'],
      ['/sharpen', 'More'],
    ])('on %s the current tab is %s', async (path, tab) => {
      mockApi(makeMe(), { 'GET /api/activity': { body: { items: [], next: null } } });
      renderApp(path);
      const nav = await mainNav();
      const current = within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current.map((a) => a.textContent?.replace(/(?<=[^\s\d])\d+$/, '').trim())).toEqual([tab]);
    });

    it('on a list screen only Home is current', async () => {
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await mainNav();
      expect(within(nav).getAllByRole('link').filter((a) => a.hasAttribute('aria-current')).map((a) => a.textContent)).toEqual(['Home']);
    });

    it.each(['/compare', '/retier/anime'])('%s (an old link) lands on Sharpen my ratings', async (path) => {
      mockApi(makeMe(), { 'GET /api/ratings/close-counts': { body: { counts: {} } } });
      const { router } = renderApp(path);
      await waitFor(() => expect(router.state.location.pathname).toBe('/sharpen'));
    });

    it.each(['/list/anime', '/search', '/activity', '/more', '/top5'])('the profile button is on %s', async (path) => {
      mockApi(makeMe(), { 'GET /api/activity': { body: { items: [], next: null } } });
      renderApp(path);
      const profile = await screen.findByRole('link', { name: 'Profile' });
      expect(profile).toHaveAttribute('href', '/profile');
      expect(profile).toHaveClass('profile-btn');
      expect(profile.closest('header')).not.toBeNull();
    });

    it.each(['/settings', '/profile'])('the profile button is not on %s', async (path) => {
      mockApi(makeMe());
      renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
    });

    it('the profile button shows the photo when there is one', async () => {
      mockApi(makeMe({ avatarAt: '2026-11-15T10:00:00Z' }));
      renderApp('/more');
      const profile = await screen.findByRole('link', { name: 'Profile' });
      expect(profile.querySelector('img')).toHaveAttribute('src', `/api/me/avatar?v=${encodeURIComponent('2026-11-15T10:00:00Z')}`);
    });

    it('the list header is a .page-header--bar containing the logo, the h1 and the profile button, and has no cover backdrop', async () => {
      fakeBackend({ entries: [makeEntry({ title: 'Best', rating: 9.5, coverUrl: 'https://img.example/best.jpg' })] });
      renderApp('/list/anime');
      await screen.findByText('Best');
      const bar = document.querySelector<HTMLElement>('.page-header--bar')!;
      expect(bar).not.toBeNull();
      expect(within(bar).getByRole('heading', { level: 1, name: 'Anime' })).toBeInTheDocument();
      expect(within(bar).getByRole('link', { name: 'About Media Tracker' })).toBeInTheDocument();
      expect(within(bar).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
      expect(document.querySelector('.page-header .backdrop')).toBeNull();
      // the sub-line and the chips sit below the band
      expect(bar).not.toContainElement(screen.getByText(/1 title/));
      expect(bar).not.toContainElement(screen.getByRole('button', { name: 'Filters' }));
    });

    it('phone list header: logo button (About Media Tracker) top left, the list dropdown centred, profile button right', async () => {
      mockApi(makeMe());
      const { router } = renderApp('/list/anime');
      await screen.findByRole('heading', { level: 1, name: 'Anime' });
      const bar = document.querySelector<HTMLElement>('.page-header--bar')!;
      const logo = await within(bar).findByRole('link', { name: 'About Media Tracker' });
      expect(logo).toHaveAttribute('href', '/about');
      expect(logo.querySelector('img')).toHaveAttribute('src', '/favicon.svg');
      expect(logo).toHaveClass('page-header__logo');
      const kids = Array.from(bar.children);
      expect(kids[0]).toBe(logo);
      expect(kids[1]).toContainElement(within(bar).getByRole('heading', { level: 1, name: 'Anime' }));
      expect(kids[1]).toHaveClass('page-header__center');
      expect(kids[2]).toContainElement(within(bar).getByRole('link', { name: 'Profile' }));
      await userEvent.click(logo);
      await waitFor(() => expect(router.state.location.pathname).toBe('/about'));
    });

    it('PC: the list header has no logo button (the side nav has About)', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      await screen.findByRole('heading', { level: 1, name: 'Anime' });
      expect(document.querySelector('.page-header__logo')).toBeNull();
    });

    it('PC: the list header is the themed bar too, with no profile button and the Add button', async () => {
      setViewportWidth(1280);
      fakeBackend({ entries: [makeEntry({ title: 'Best', rating: 9.5, coverUrl: 'https://img.example/best.jpg' })] });
      renderApp('/list/anime');
      await screen.findByText('Best');
      const bar = document.querySelector<HTMLElement>('.page-header--bar')!;
      expect(within(bar).getByRole('heading', { level: 1, name: 'Anime' })).toBeInTheDocument();
      expect(within(bar).queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument(); // the side nav's first row is the link
      expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: /^Profile/ })).toHaveLength(1);
      // PC: the header renders no empty actions box for the (phone-only) profile button
      expect(bar.querySelector('.page-header__actions:empty')).toBeNull();
      expect(document.querySelector('.bottom-tabs')).toBeNull();
      expect(screen.getByRole('button', { name: 'Add anime' })).toBeInTheDocument();
    });
  });

  describe('PC side nav (Main, SideNavPC board)', () => {
    const sideNav = () => screen.findByRole('navigation', { name: 'Main' });

    it('the Activity row reads "Activity, 3 new" with the count beside it', async () => {
      setViewportWidth(1280);
      mockApi(makeMe(), { 'GET /api/activity/unread': { body: { feed: 3, requests: 0 } } });
      renderApp('/list/anime');
      const row = await within(await sideNav()).findByRole('link', { name: 'Activity, 3 new' });
      expect(row.querySelector('.count-pill')).toHaveTextContent('3');
    });

    it('reads the PCNav board: brand, Home, Search, Activity, Friends, Messages, Top 5, Stats, Sharpen, the Lists group, Settings, More / About, profile (no Compare, N9)', async () => {
      setViewportWidth(1280);
      mockApi(makeMe({}, { songs: false }));
      renderApp('/list/anime');
      const nav = await sideNav();
      // every row, in document order
      const rows = Array.from(nav.querySelectorAll('a, button')).map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/(?<=[^\s\d])\d+$/, '').trim());
      expect(rows).toEqual([
        'About Media Tracker', 'Home', 'Search', 'Activity', 'Friends', 'Messages', 'Top 5', 'Stats', 'Sharpen my ratings',
        'Anime', 'Movies', 'TV Shows', 'Albums', 'Games', 'Books', 'Manga', 'YouTube',
        'Settings', 'More / About', 'Profile, @dan',
      ]);
      expect(nav.querySelector('.side-nav__label')).toHaveTextContent('Lists');
      expect(nav.querySelectorAll('.side-nav__divider')).toHaveLength(1);
      expect(nav.querySelector('.side-nav__footer')?.lastElementChild).toHaveAttribute('href', '/profile');
      await screen.findByText('No anime yet');
      expect(nav.querySelector('.count-pill')).toBeNull();
    });

    it('PC: Friends and Messages rows carry their own badges (requests, unread), after Activity', async () => {
      setViewportWidth(1280);
      mockApi(makeMe(), { 'GET /api/activity/unread': { body: { feed: 0, requests: 1, messages: 3 } } });
      renderApp('/list/anime');
      const nav = await sideNav();
      const friends = await within(nav).findByRole('link', { name: 'Friends, 1 new' });
      expect(friends).toHaveAttribute('href', '/friends');
      const row = await within(nav).findByRole('link', { name: 'Messages, 3 unread' });
      expect(row).toHaveAttribute('href', '/messages');
      const names = within(nav).getAllByRole('link').map((a) => a.textContent ?? '');
      const at = (label: string) => names.findIndex((n) => n.startsWith(label));
      expect(at('Friends')).toBe(at('Activity') + 1);
      expect(at('Messages')).toBe(at('Friends') + 1);
    });

    it('Top 5, Stats, Sharpen my ratings and Settings are side-nav links; there is no navigation called "Lists"', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await sideNav();
      expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
      for (const [n, href] of [['Top 5', '/top5'], ['Stats', '/stats'], ['Sharpen my ratings', '/sharpen'], ['Settings', '/settings'], ['More / About', '/more']] as const) {
        expect(within(nav).getByRole('link', { name: n })).toHaveAttribute('href', href);
      }
    });

    it('switched-off features leave the side nav: Friends, Messages, Activity and Sharpen my ratings', async () => {
      setViewportWidth(1280);
      fakeBackend({ extra: { 'GET /api/app': { body: publicSettings({ features: { friends: false, messages: false, feed: false, closeCalls: false } }) } } as never });
      renderApp('/list/anime');
      const nav = await sideNav();
      await within(nav).findByRole('link', { name: 'Top 5' });
      for (const n of ['Friends', 'Messages', 'Activity', 'Sharpen my ratings']) expect(within(nav).queryByRole('link', { name: new RegExp(`^${n}`) })).not.toBeInTheDocument();
    });

    it('the Profile row is named "Profile, @dan" (contains its visible text), links to /profile and shows a 36 px avatar and @dan', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      const profile = within(await sideNav()).getByRole('link', { name: 'Profile, @dan' });
      expect(profile).toHaveAttribute('href', '/profile');
      expect(profile).toHaveTextContent('@dan');
      const avatar = profile.querySelector<HTMLElement>('.avatar')!;
      expect(avatar).toHaveStyle({ width: '36px', height: '36px' });
      expect(avatar).toHaveTextContent('D');
    });

    it('the Profile row shows the photo when there is one', async () => {
      setViewportWidth(1280);
      mockApi(makeMe({ avatarAt: '2026-11-15T10:00:00Z' }));
      renderApp('/list/anime');
      const profile = within(await sideNav()).getByRole('link', { name: 'Profile, @dan' });
      expect(profile.querySelector('img')).toHaveAttribute('src', `/api/me/avatar?v=${encodeURIComponent('2026-11-15T10:00:00Z')}`);
    });

    it('a header with only the (phone-only) profile button renders no empty actions box on PC', async () => {
      setViewportWidth(1280);
      fakeBackend({ entries: [makeEntry({ rating: 8 })] });
      renderApp('/top5');
      await screen.findByRole('heading', { level: 1, name: 'Top 5' });
      expect(document.querySelector('.page-header__actions')).toBeNull();
    });

    it('with every list off there is no Lists group', async () => {
      setViewportWidth(1280);
      mockApi(makeMe({}, { anime: false, movies: false, tv: false, albums: false, songs: false, games: false, books: false, manga: false, youtube: false }));
      renderApp('/activity');
      const nav = await sideNav();
      expect(nav.querySelector('.side-nav__label')).toBeNull();
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

    it('season tabs never appear as list rows', async () => {
      setViewportWidth(1280);
      mockApi(makeMe());
      renderApp('/list/anime');
      const nav = await sideNav();
      expect(linkNames(nav)).not.toContain('Anime Seasons');
      expect(linkNames(nav)).toHaveLength(1 + 8 + 9 + 3); // brand, Home..Sharpen (8), 9 lists, Settings, More / About, Profile
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

  it('More has Ratings (Sharpen my ratings, Top 5, Stats), Your data (Import, Export) and App (About) only: no other lists, Settings, Appearance or tier links', async () => {
    mockApi(makeMe({}, { books: false }));
    renderApp('/more');
    expect(await screen.findByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    const main = screen.getByRole('main').querySelector<HTMLElement>('.screen__body')!;
    expect(linkNames(main)).toEqual(['Sharpen my ratings', 'Top 5', 'Stats', 'Import from Google Sheets', "What's new", 'Coming soon', 'About Media Tracker']);
    expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Ratings', 'Your data', 'App']);
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  });

  it('More links to Sharpen my ratings', async () => {
    mockApi(makeMe());
    renderApp('/more');
    await screen.findByRole('heading', { level: 1, name: 'More' });
    const body = screen.getByRole('main').querySelector<HTMLElement>('.screen__body')!;
    expect(within(body).getByRole('link', { name: 'Sharpen my ratings' })).toHaveAttribute('href', '/sharpen');
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
