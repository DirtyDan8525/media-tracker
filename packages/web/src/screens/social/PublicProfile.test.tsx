import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAuthState } from '../../api/auth';
import { authBackend } from '../../test/authBackend';
import { publicSettings } from '../../test/appSettings';
import { makeFriendEntry, REN } from '../../test/friends';
import { makeMe, type Handler, type MockResponse } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const PROFILE = { user: { ...REN, avatarAt: '2026-11-01' }, memberSince: '2026-10-01T00:00:00Z', bio: 'Anime first.', counts: { titles: 3, rated: 2 } };
const ENTRIES = () => [
  makeFriendEntry({ id: 'f1', title: 'Frieren', status: 'Completed', rating: 9, category: 'anime', coverUrl: 'https://img.test/f.jpg', notes: 'peak' }),
  makeFriendEntry({ id: 'f2', title: 'Mob Psycho 100', rating: 8, category: 'anime' }),
  makeFriendEntry({ id: 'f3', title: 'Heat', rating: 7, category: 'movies' }),
];
const publicRoutes = (over: Record<string, Handler | MockResponse> = {}) => ({
  'GET /api/public/:token': { body: PROFILE },
  'GET /api/public/:token/entries': { body: ENTRIES() },
  ...over,
});

beforeEach(() => { resetAuthState(); sessionStorage.clear(); });
afterEach(() => { document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove()); });

describe('/p/:token signed out', () => {
  it('shows the read-only profile: photo, name, @username, bio, tabs Lists / Top 5 / Stats and nothing social', async () => {
    const { calls } = authBackend({ extra: publicRoutes() });
    renderApp(`/p/${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ren' })).toBeInTheDocument();
    expect(screen.getByText('@ren')).toBeInTheDocument();
    expect(screen.getByText('Anime first.')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lists', 'Top 5', 'Stats']);
    expect(await screen.findByText('Frieren')).toBeInTheDocument();
    for (const name of [/message/i, /compare/i, /add friend/i, /remove/i, /edit/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    // The photo comes through the token-scoped route.
    const img = document.querySelector('.friend-id img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/public/${TOKEN}/avatar?v=2026-11-01`);
    // No sign-in screen: the page is outside the session gate.
    expect(screen.queryByRole('tab', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === `/api/public/${TOKEN}/entries`)).toBe(true);
  });

  it('rows are not links (there is no public entry page) and covers load through the token route', async () => {
    authBackend({ extra: publicRoutes() });
    renderApp(`/p/${TOKEN}`);
    await screen.findByText('Frieren');
    expect(screen.queryByRole('link', { name: /Frieren/ })).not.toBeInTheDocument();
    const cover = document.querySelector('img.cover') as HTMLImageElement;
    expect(cover.getAttribute('src')).toBe(`/api/public/${TOKEN}/cover/f1`);
  });

  it('PC: the Lists tab is the read-only table with notes on hover', async () => {
    setViewportWidth(1280);
    try {
      authBackend({ extra: publicRoutes() });
      renderApp(`/p/${TOKEN}`);
      const table = await screen.findByRole('table', { name: 'Anime, @ren' });
      expect(within(table).getByText('peak')).toHaveAttribute('title', 'peak');
      expect(within(table).queryByRole('link')).not.toBeInTheDocument();
      expect(within(table).queryByRole('textbox')).not.toBeInTheDocument();
    } finally {
      setViewportWidth(390);
    }
  });

  it('category chips switch the list; Top 5 and Stats tabs work', async () => {
    authBackend({ extra: publicRoutes() });
    renderApp(`/p/${TOKEN}`);
    await screen.findByText('Frieren');
    await userEvent.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Movies' }));
    expect(await screen.findByText('Heat')).toBeInTheDocument();
    expect(screen.queryByText('Frieren')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Top 5' }));
    expect(await screen.findByRole('heading', { name: 'Anime' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(await screen.findByRole('heading', { name: 'All media' })).toBeInTheDocument();
  });

  it('sets the page title and a noindex robots tag, and removes the tag on leaving', async () => {
    authBackend({ extra: publicRoutes() });
    const { unmount } = renderApp(`/p/${TOKEN}`);
    await screen.findByRole('heading', { level: 1, name: 'Ren' });
    await waitFor(() => expect(document.title).toBe('Ren on Media Tracker'));
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('a "Join Media Tracker" button opens Create account', async () => {
    authBackend({ extra: publicRoutes() });
    const { router } = renderApp(`/p/${TOKEN}`);
    const join = await screen.findByRole('link', { name: 'Join Media Tracker' });
    await userEvent.click(join);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
  });

  it('when sign-ups are closed it says to ask them for an invite link instead', async () => {
    authBackend({ extra: publicRoutes({ 'GET /api/app': { body: publicSettings({ features: { signups: false } }) } }) });
    renderApp(`/p/${TOKEN}`);
    expect(await screen.findByText('Ask Ren for an invite link')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Join Media Tracker' })).not.toBeInTheDocument();
  });

  it('an unknown or turned-off link says so', async () => {
    authBackend({ extra: publicRoutes({ 'GET /api/public/:token': { status: 404, body: { error: 'not_found' } } }) });
    renderApp(`/p/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
  });
});

describe('/p/:token signed in', () => {
  it('shows the same page plus Add friend, which sends a request', async () => {
    const { calls } = authBackend({
      signedIn: true, me: makeMe(),
      extra: publicRoutes({
        'GET /api/users/:username': { body: { user: REN, memberSince: null, relation: 'none' } },
        'POST /api/friends/requests': { body: { relation: 'pending_out' } },
      }),
    });
    renderApp(`/p/${TOKEN}`);
    await screen.findByText('Frieren');
    const add = await screen.findByRole('button', { name: 'Add friend' });
    expect(screen.queryByRole('link', { name: 'Join Media Tracker' })).not.toBeInTheDocument();
    await userEvent.click(add);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/api/friends/requests')?.body).toEqual({ username: 'ren' }));
  });

  it('already friends: a link to their full profile instead of Add friend', async () => {
    authBackend({
      signedIn: true, me: makeMe(),
      extra: publicRoutes({ 'GET /api/users/:username': { body: { user: REN, memberSince: null, relation: 'friend' } } }),
    });
    renderApp(`/p/${TOKEN}`);
    expect(await screen.findByRole('link', { name: 'Open full profile' })).toHaveAttribute('href', '/u/ren');
    expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument();
  });
});
