import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const DAN = { id: 'id-dan', username: 'dan', displayName: null, avatarAt: null };
const EMPTY = { friends: [], incoming: [], outgoing: [] };

describe('/add/<code>', () => {
  it('shows "Add @dan as a friend?"; Add → toast "You and @dan are friends" → /u/dan', async () => {
    const calls = mockApi(makeMe({ username: 'ren', id: 'id-ren' }), {
      'GET /api/friends/code/:code': { body: DAN },
      'GET /api/friends': { body: EMPTY },
      'POST /api/friends/add/:code': { body: { relation: 'friend', user: DAN } },
      'GET /api/users/:username': { body: { user: DAN, memberSince: null, relation: 'friend' } },
      'GET /api/users/:username/entries': { body: [] },
    });
    const { router } = renderApp('/add/abc');
    expect(await screen.findByRole('heading', { name: 'Add @dan as a friend?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('You and @dan are friends')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/u/dan'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/friends/add/abc')).toBe(true);
  });

  it('Not now goes home without adding', async () => {
    const calls = mockApi(makeMe({ username: 'ren' }), { 'GET /api/friends/code/:code': { body: DAN }, 'GET /api/friends': { body: EMPTY } });
    const { router } = renderApp('/add/abc');
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('unknown code → "This link no longer works"', async () => {
    mockApi(makeMe(), { 'GET /api/friends/code/:code': { status: 404, body: { error: 'not_found' } }, 'GET /api/friends': { body: EMPTY } });
    renderApp('/add/nope');
    expect(await screen.findByRole('heading', { name: 'This link no longer works' })).toBeInTheDocument();
  });

  it("own code → \"That's your own link\"", async () => {
    mockApi(makeMe(), { 'GET /api/friends/code/:code': { status: 400, body: { error: 'self' } }, 'GET /api/friends': { body: EMPTY } });
    renderApp('/add/mine');
    expect(await screen.findByRole('heading', { name: "That's your own link" })).toBeInTheDocument();
  });

  it('already friends: says so instead of offering Add', async () => {
    mockApi(makeMe(), {
      'GET /api/friends/code/:code': { body: DAN },
      'GET /api/friends': { body: { ...EMPTY, friends: [{ ...DAN, since: '2026-11-01T00:00:00Z' }] } },
    });
    renderApp('/add/abc');
    expect(await screen.findByRole('heading', { name: 'You and @dan are already friends' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('a user without a username opening /add/abc goes to setup, then back to /add/abc', async () => {
    const me = makeMe({ username: null });
    mockApi(me, {
      'PUT /api/me/username': (b) => ({ body: { ...me, username: (b as { username: string }).username } }),
      'GET /api/friends/code/:code': { body: DAN },
      'GET /api/friends': { body: EMPTY },
    });
    const { router } = renderApp('/add/abc');
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup/username'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Username' }), 'ren');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/add/abc'));
    expect(await screen.findByRole('heading', { name: 'Add @dan as a friend?' })).toBeInTheDocument();
    expect(sessionStorage.getItem('mt-after-setup')).toBeNull();
  });
});
