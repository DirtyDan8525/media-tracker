import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const U = (username: string, over: object = {}) => ({ id: `id-${username}`, username, displayName: null, avatarAt: null, ...over });
const DATA = {
  friends: [{ ...U('ren', { displayName: 'Ren' }), since: '2026-11-01T00:00:00Z' }, { ...U('mika'), since: '2026-11-02T00:00:00Z' }],
  incoming: [U('vance')],
  outgoing: [U('alberto')],
};

describe('Friends screen', () => {
  it('lists incoming with Accept / Decline, outgoing with Cancel, friends linking to /u/<username>', async () => {
    mockApi(makeMe(), { 'GET /api/friends': { body: DATA } });
    renderApp('/friends');
    const requests = await screen.findByRole('region', { name: 'Requests' });
    expect(within(requests).getByText('Wants to be friends')).toBeInTheDocument();
    expect(within(requests).getByRole('button', { name: 'Accept @vance' })).toBeInTheDocument();
    expect(within(requests).getByRole('button', { name: 'Decline @vance' })).toBeInTheDocument();
    expect(within(requests).getByText('Requested')).toBeInTheDocument();
    expect(within(requests).getByRole('button', { name: 'Cancel request to @alberto' })).toBeInTheDocument();
    const friends = screen.getByRole('region', { name: 'Friends · 2' });
    expect(within(friends).getByRole('link', { name: /Ren/ })).toHaveAttribute('href', '/u/ren');
    expect(within(friends).getByText('@ren')).toBeInTheDocument();
    expect(within(friends).getByRole('link', { name: /@mika/ })).toHaveAttribute('href', '/u/mika');
  });

  it('Accept POSTs, toasts and refreshes; Decline and Cancel DELETE', async () => {
    let data = DATA;
    const calls = mockApi(makeMe(), {
      'GET /api/friends': () => ({ body: data }),
      'POST /api/friends/:id/accept': () => { data = { ...data, incoming: [] }; return { status: 204 }; },
      'DELETE /api/friends/:id': () => ({ status: 204 }),
    });
    renderApp('/friends');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept @vance' }));
    expect(await screen.findByRole('status')).toHaveTextContent('You and @vance are friends');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/friends/id-vance/accept')).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept @vance' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request to @alberto' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/friends/id-alberto')).toBe(true));
  });

  it('empty: "No friends yet" with Add friend, which opens the sheet', async () => {
    mockApi(makeMe(), { 'GET /api/friends': { body: { friends: [], incoming: [], outgoing: [] } }, 'GET /api/me/invite': { body: { code: 'k3f9x2m8q1ab' } } });
    renderApp('/friends');
    expect(await screen.findByRole('heading', { name: 'No friends yet' })).toBeInTheDocument();
    expect(screen.getByText('Add a friend to see what they rate.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(await screen.findByRole('dialog', { name: 'Add friend' })).toBeInTheDocument();
  });

  it('a failed load says so and Retry loads again', async () => {
    let n = 0;
    mockApi(makeMe(), { 'GET /api/friends': () => (n++ === 0 ? { status: 500, body: { error: 'boom' } } : { body: DATA }) });
    renderApp('/friends');
    expect(await screen.findByRole('heading', { name: "Couldn't load your friends" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Friends · 2' })).toBeInTheDocument();
  });
});
