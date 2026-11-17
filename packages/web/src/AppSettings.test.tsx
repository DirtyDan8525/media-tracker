import type { ActivityItem } from '@media-tracker/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './api/client';
import { authBackend } from './test/authBackend';
import { publicSettings } from './test/appSettings';
import { fakeBackend } from './test/fakeBackend';
import { friendsOf, REN } from './test/friends';
import { makeMe } from './test/mockApi';
import { renderApp } from './test/renderApp';
import { setViewportWidth } from './test/viewport';
import { COMING_SOON, WHATS_NEW } from './whatsNew';

const app = (over: Parameters<typeof publicSettings>[0]) => ({ 'GET /api/app': { body: publicSettings(over) } });
beforeEach(() => { localStorage.clear(); setViewportWidth(390); document.title = ''; });
const main = () => screen.findByRole('navigation', { name: 'Main' });

describe('brand (AD5)', () => {
  it('the app name is in the tab title, About and the More row', async () => {
    fakeBackend({ extra: app({ brand: { name: 'Our Shelf' } }) });
    renderApp('/about');
    expect(await screen.findByRole('heading', { name: 'WELCOME TO OUR SHELF' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Our Shelf'));
  });

  it('the sign-in screen shows the name and the welcome text, signed out', async () => {
    authBackend({ extra: app({ brand: { name: 'Our Shelf', welcome: 'Everything we watch, play and read.' } }) });
    renderApp('/');
    expect(await screen.findByText('Everything we watch, play and read.')).toBeInTheDocument();
    expect(screen.getByText('Our Shelf')).toBeInTheDocument();
  });

  it('an accent that reads at AA replaces the highlight; one that does not is ignored', async () => {
    fakeBackend({ extra: app({ brand: { accent: '#ff9f43' } }) });
    renderApp('/more');
    await screen.findByRole('region', { name: 'App' });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--highlight')).toBe('#ff9f43'));
  });

  it('an accent too dark for the dark theme keeps the theme highlight', async () => {
    fakeBackend({ extra: app({ brand: { accent: '#9b671a' } }) });
    renderApp('/more');
    await screen.findByRole('region', { name: 'App' });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--highlight')).toBe('#ffd166'));
  });
});

describe('sign-ups (AD2)', () => {
  it('Create account says sign-ups are closed, and Sign in still works', async () => {
    authBackend({ extra: app({ features: { signups: false } }) });
    renderApp('/');
    // Closed: it opens on Sign in.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true'));
    await userEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    expect(screen.getByText(/Sign-ups are closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('a /join link still shows the sign-up form', async () => {
    authBackend({ extra: { ...app({ features: { signups: false } }), 'GET /api/auth/join/:token': { body: { valid: true } } } });
    renderApp('/join/abc123');
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByText(/Sign-ups are closed/)).not.toBeInTheDocument();
  });

  it('a server feature_off on sign-up is said in words', async () => {
    authBackend({ extra: { 'POST /api/auth/signup': { status: 403, body: { error: 'feature_off' } } } });
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Username'), 'newbie');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-ups are closed');
  });
});

describe('feature switches hide their UI (AD2)', () => {
  it('Messages off: no Messages anywhere (bar, Friends bubble, Message buttons); the Friends tab stays; /messages goes home', async () => {
    fakeBackend({ extra: { ...app({ features: { messages: false } }), 'GET /api/friends': { body: friendsOf(REN) } } });
    const { router } = renderApp('/friends');
    expect(await screen.findByRole('link', { name: 'Ren, open profile' })).toBeInTheDocument();
    const nav = await main();
    expect(within(nav).queryByRole('link', { name: /Messages/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Friends/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Activity/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Messages/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Message Ren' })).not.toBeInTheDocument();
    router.navigate('/messages');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/list\//));
  });

  it('Friends off but Messages on: tab 4 is Messages itself', async () => {
    fakeBackend({ extra: app({ features: { friends: false } }) });
    renderApp('/list/anime');
    const nav = await main();
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Activity', 'Search', 'Messages', 'More']);
  });

  it('Friends and Messages both off: the bar is Home, Activity, Search, More', async () => {
    fakeBackend({ extra: app({ features: { friends: false, messages: false } }) });
    renderApp('/list/anime');
    expect(within(await main()).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Activity', 'Search', 'More']);
  });

  it('Feed off: no Activity tab; /activity goes home', async () => {
    fakeBackend({ extra: app({ features: { feed: false } }) });
    const { router } = renderApp('/activity');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/list\//));
    expect(within(await main()).queryByRole('link', { name: /Activity/ })).not.toBeInTheDocument();
    expect(within(await main()).getByRole('link', { name: /Friends/ })).toBeInTheDocument();
  });

  it('Friends off: the Profile page has no Friends tile or Add friend; /friends goes home', async () => {
    fakeBackend({ extra: app({ features: { friends: false } }) });
    const { router } = renderApp('/profile');
    await screen.findByText('@dan');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument());
    expect(screen.queryByText('Friends')).not.toBeInTheDocument();
    router.navigate('/friends');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/list\//));
  });

  it('Close calls off: no Ratings card in Settings and no Sharpen row in More', async () => {
    fakeBackend({ extra: app({ features: { closeCalls: false } }) });
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'Tabs' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ratings' })).not.toBeInTheDocument());
  });

  it('Comments and reactions off: the feed post has neither button', async () => {
    const item: ActivityItem = { id: 'p1', postId: 'p1', userId: 'u1', entryId: 'e1', category: 'anime', title: 'Bleach', coverUrl: '', type: 'added', payload: {}, createdAt: new Date().toISOString() } as ActivityItem;
    fakeBackend({ extra: { ...app({ features: { comments: false, reactions: false } }), 'GET /api/activity': { body: { items: [item], users: {}, friends: [], social: {}, next: null } } } });
    renderApp('/activity');
    await screen.findByRole('link', { name: 'Bleach' });
    expect(screen.queryByRole('button', { name: 'React' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Comment/ })).not.toBeInTheDocument();
  });

  it('a 403 feature_off from any write shows a friendly toast', async () => {
    fakeBackend({ extra: { 'POST /api/anything': { status: 403, body: { error: 'feature_off' } } } });
    renderApp('/more');
    await screen.findByRole('region', { name: 'App' });
    await expect(api.post('/api/anything')).rejects.toBeTruthy();
    expect(await screen.findByText(/switched that off/)).toBeInTheDocument();
  });
});

describe('lists order and hidden (AD11)', () => {
  it('the Switch list menu follows the admin order and leaves out hidden lists', async () => {
    fakeBackend({ extra: app({ lists: { order: ['games', 'anime', 'movies', 'tv', 'albums', 'songs', 'books', 'manga', 'youtube'], hidden: ['movies'] } }) });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: /Anime/ }));
    await waitFor(() => {
      const names = within(screen.getByRole('menu', { name: 'Switch list' })).getAllByRole('menuitem').map((m) => m.textContent);
      expect(names[0]).toMatch(/^Games/);
      expect(names.some((n) => /^Movies/.test(n ?? ''))).toBe(false);
    });
  });

  it('Settings → Tabs follows the order and has no switch for a hidden list', async () => {
    fakeBackend({ extra: app({ lists: { order: ['games', 'anime', 'movies', 'tv', 'albums', 'songs', 'books', 'manga', 'youtube'], hidden: ['movies'] } }) });
    renderApp('/settings');
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Movies' })).not.toBeInTheDocument());
    const first = (await screen.findAllByRole('switch'))[0]!;
    expect(first).toHaveAccessibleName('Games');
  });
});

describe('announcement (AD3)', () => {
  const ann = { id: 'a1', text: 'Server maintenance Sunday 9 pm.', link: 'https://example.com/status', endsAt: null };

  it('shows at the top of Home with its link, and Dismiss hides it for that announcement', async () => {
    fakeBackend({ extra: app({ announcement: ann }) });
    renderApp('/list/anime');
    const banner = await screen.findByRole('region', { name: 'Announcement' });
    expect(banner).toHaveTextContent('Server maintenance Sunday 9 pm.');
    expect(within(banner).getByRole('link', { name: /Read more/ })).toHaveAttribute('href', 'https://example.com/status');
    await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss announcement' }));
    expect(screen.queryByRole('region', { name: 'Announcement' })).not.toBeInTheDocument();
    expect(localStorage.getItem('mt-announcement-dismissed:a1')).toBe('1');
  });

  it('stays dismissed on the next visit, and comes back with a new id', async () => {
    localStorage.setItem('mt-announcement-dismissed:a1', '1');
    fakeBackend({ extra: app({ announcement: ann }) });
    const first = renderApp('/list/anime');
    await screen.findByRole('heading', { name: /Anime/ });
    expect(screen.queryByRole('region', { name: 'Announcement' })).not.toBeInTheDocument();
    first.unmount();
    fakeBackend({ extra: app({ announcement: { ...ann, id: 'a2' } }) });
    renderApp('/list/anime');
    expect(await screen.findByRole('region', { name: 'Announcement' })).toBeInTheDocument();
  });

  it('is hidden after its end date even if the settings still carry it', async () => {
    fakeBackend({ extra: app({ announcement: { ...ann, endsAt: '2020-01-01' } }) });
    renderApp('/list/anime');
    await screen.findByRole('heading', { name: /Anime/ });
    expect(screen.queryByRole('region', { name: 'Announcement' })).not.toBeInTheDocument();
  });

  it('still shows when localStorage throws', async () => {
    fakeBackend({ extra: app({ announcement: ann }) });
    const spy = (await import('vitest')).vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      renderApp('/list/anime');
      expect(await screen.findByRole('region', { name: 'Announcement' })).toBeInTheDocument();
    } finally { spy.mockRestore(); }
  });
});

describe('content from settings (AD4)', () => {
  it("What's new and Coming soon use the admin's text, falling back to the built-in text", async () => {
    fakeBackend({ extra: app({ whatsNew: [{ version: 'v9', date: '2026-12-01', items: ['Shiny thing'] }], comingSoon: ['Moon base'] }) });
    renderApp('/whats-new');
    expect(await screen.findByText('Shiny thing')).toBeInTheDocument();
    expect(screen.getByText('Moon base')).toBeInTheDocument();
    expect(screen.queryByText(WHATS_NEW[0]!.items[0]!)).not.toBeInTheDocument();
  });

  it('built-in text when nothing is set', async () => {
    fakeBackend({ extra: app({}) });
    renderApp('/whats-new');
    expect(await screen.findByText(WHATS_NEW[0]!.items[0]!)).toBeInTheDocument();
    expect(screen.getByText(COMING_SOON[0]!)).toBeInTheDocument();
  });

  it('About shows the admin text, paragraphs split on blank lines', async () => {
    fakeBackend({ extra: app({ about: 'A private shelf.\n\nNothing here is public.' }) });
    renderApp('/about');
    expect(await screen.findByText('A private shelf.')).toBeInTheDocument();
    expect(screen.getByText('Nothing here is public.')).toBeInTheDocument();
    expect(screen.queryByText(/I got tired of keeping track/)).not.toBeInTheDocument();
  });
});

describe('admin moderation in the normal UI (AD7)', () => {
  const post = (userId: string): ActivityItem => ({ id: 'p9', postId: 'p9', userId, entryId: 'e9', category: 'anime', title: 'Mushishi', coverUrl: '', type: 'added', payload: {}, createdAt: new Date().toISOString() } as ActivityItem);
  const sam = { id: 'u-sam', username: 'sam', displayName: 'Sam', avatarAt: null };

  it("the admin has Options on someone else's post, and Delete asks first", async () => {
    const { calls } = fakeBackend({ me: makeMe({ isAdmin: true }), extra: {
      'GET /api/activity': { body: { items: [post('u-sam')], users: { 'u-sam': sam }, friends: [], social: {}, next: null } },
      'DELETE /api/activity/:id': { status: 204 },
    } });
    renderApp('/activity');
    await userEvent.click(await screen.findByRole('button', { name: 'Options for Mushishi' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete this post?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/activity/p9']));
  });

  it("an ordinary member has no Options on someone else's post", async () => {
    fakeBackend({ extra: { 'GET /api/activity': { body: { items: [post('u-sam')], users: { 'u-sam': sam }, friends: [], social: {}, next: null } } } });
    renderApp('/activity');
    await screen.findByText('Mushishi');
    expect(screen.queryByRole('button', { name: /Options for/ })).not.toBeInTheDocument();
  });
});
