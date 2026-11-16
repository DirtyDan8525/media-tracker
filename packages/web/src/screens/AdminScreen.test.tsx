import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi, type Call } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const U = (username: string, displayName: string | null = null) => ({ id: `id-${username}`, username, displayName, avatarAt: null });

function adminBackend(requests = 2) {
  const state = {
    pending: [{ ...U('ren', 'Ren'), requestedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, { ...U('mika'), requestedAt: new Date(Date.now() - 26 * 3600_000).toISOString() }],
    active: [{ ...U('dan'), joinedAt: '2026-10-01T00:00:00Z', isAdmin: true }, { ...U('vance'), joinedAt: '2026-10-05T00:00:00Z', isAdmin: false }],
    removed: [U('jo')],
  };
  const move = (id: string, from: 'pending' | 'removed', fn: (u: ReturnType<typeof U>) => unknown) => {
    const i = state[from].findIndex((u) => u.id === id);
    const [u] = state[from].splice(i, 1);
    (state.active as unknown[]).push(fn(u!));
  };
  const calls = mockApi(makeMe({ id: 'id-dan', username: 'dan', isAdmin: true }), {
    'GET /api/admin': () => ({ body: state }),
    'GET /api/activity/unread': () => ({ body: { feed: 0, requests } }),
    'POST /api/admin/users/:id/approve': (_b, _u, p) => {
      if (state.pending.some((u) => u.id === p.id)) move(p.id!, 'pending', (u) => ({ ...u, joinedAt: 'now', isAdmin: false }));
      else move(p.id!, 'removed', (u) => ({ ...u, joinedAt: 'now', isAdmin: false }));
      return { status: 204 };
    },
    'POST /api/admin/users/:id/decline': (_b, _u, p) => { state.pending = state.pending.filter((u) => u.id !== p.id); return { status: 204 }; },
    'POST /api/admin/users/:id/remove': (_b, _u, p) => {
      const u = state.active.find((x) => x.id === p.id)!;
      state.active = state.active.filter((x) => x.id !== p.id);
      state.removed.push(U(u.username));
      return { status: 204 };
    },
    'POST /api/admin/users/:id/reset-link': { body: { link: 'https://mt.example/reset/k3f9x2m8q1ab' } },
  });
  return { state, calls };
}
const posted = (calls: Call[]) => calls.filter((c) => c.method === 'POST').map((c) => c.path);
const section = (name: RegExp) => screen.findByRole('region', { name });

describe('Admin screen', () => {
  it('lists Requests, Members and Removed; your own row says You with no actions', async () => {
    adminBackend();
    renderApp('/admin');
    const req = await section(/^Requests · 2$/);
    expect(within(req).getByText('Ren')).toBeInTheDocument();
    expect(within(req).getByText(/@ren · asked 2 h ago/)).toBeInTheDocument();
    expect(within(req).getByText("@mika")).toBeInTheDocument();
    expect(within(req).getByText("asked 1 d ago")).toBeInTheDocument();
    const members = await section(/^Members · 2$/);
    const dan = within(members).getByText('@dan').closest('li')!;
    expect(within(dan).getByText('You')).toBeInTheDocument();
    expect(within(dan).queryByRole('button')).not.toBeInTheDocument();
    expect(within(members).getByRole('button', { name: 'More actions for @vance' })).toBeInTheDocument();
    const removed = await section(/^Removed · 1$/);
    expect(within(removed).getByRole('button', { name: 'Restore @jo' })).toBeInTheDocument();
    expect(screen.queryByText(/of 50/)).not.toBeInTheDocument();
  });

  it('Approve moves the person to Members', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve @ren' }));
    expect(await screen.findByText('Approved @ren')).toBeInTheDocument();
    expect(posted(calls)).toContain('/api/admin/users/id-ren/approve');
    expect(await section(/^Members · 3$/)).toBeInTheDocument();
    expect(await section(/^Requests · 1$/)).toBeInTheDocument();
  });

  it('Decline asks first, then declines', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline @mika' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline @mika?' });
    expect(posted(calls)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(posted(calls)).toContain('/api/admin/users/id-mika/decline'));
    expect(await section(/^Requests · 1$/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel in the Decline sheet does nothing', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline @mika' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(posted(calls)).toEqual([]);
  });

  it('⋯ → Reset password link shows the link card; Copy copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for @vance' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset password link' }));
    const card = await screen.findByRole('status', { name: 'Reset link' });
    expect(card).toHaveTextContent('Send this to @vance:');
    expect(within(card).getByRole('textbox', { name: 'Reset link' })).toHaveValue('https://mt.example/reset/k3f9x2m8q1ab');
    expect(card).toHaveTextContent('Works once, for 24 hours.');
    expect(posted(calls)).toContain('/api/admin/users/id-vance/reset-link');
    await userEvent.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://mt.example/reset/k3f9x2m8q1ab');
  });

  it('⋯ → Remove access asks first ("They won\'t be able to sign in. Their data stays."), then removes', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for @vance' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove @vance?' });
    expect(within(dialog).getByText("They won't be able to sign in. Their data stays.")).toBeInTheDocument();
    expect(posted(calls)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(posted(calls)).toContain('/api/admin/users/id-vance/remove'));
    expect(await section(/^Removed · 2$/)).toBeInTheDocument();
  });

  it('Restore approves a removed person again', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Restore @jo' }));
    await waitFor(() => expect(posted(calls)).toContain('/api/admin/users/id-jo/approve'));
    expect(await section(/^Members · 3$/)).toBeInTheDocument();
  });

  it('a failed action says so in plain words and keeps the row', async () => {
    adminBackend();
    mockApi(makeMe({ id: 'id-dan', isAdmin: true }), {
      'GET /api/admin': { body: { pending: [{ ...U('ren'), requestedAt: '2026-11-16T00:00:00Z' }], active: [], removed: [] } },
      'POST /api/admin/users/:id/approve': { status: 500, body: { error: 'x' } },
    });
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve @ren' }));
    expect(await screen.findByText("Couldn't approve @ren. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve @ren' })).toBeInTheDocument();
  });

  it('empty Requests says so; load failure offers Retry', async () => {
    mockApi(makeMe({ id: 'id-dan', isAdmin: true }), { 'GET /api/admin': { body: { pending: [], active: [], removed: [] } } });
    renderApp('/admin');
    expect(await screen.findByText('No requests right now.')).toBeInTheDocument();
  });

  it('shows Retry when Admin cannot load', async () => {
    mockApi(makeMe({ isAdmin: true }), { 'GET /api/admin': { status: 500, body: { error: 'x' } } });
    renderApp('/admin');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Unread requests', () => {
  it('More → Admin row carries a dot when the unread requests count is above zero', async () => {
    adminBackend(2);
    renderApp('/more');
    const link = await screen.findByRole('link', { name: /^Admin/ });
    expect(await within(link).findByText('2 new requests')).toBeInTheDocument();
  });

  it('no dot at zero', async () => {
    adminBackend(0);
    renderApp('/more');
    const link = await screen.findByRole('link', { name: /^Admin/ });
    await waitFor(() => expect(within(link).queryByText(/new request/)).not.toBeInTheDocument());
  });
});
