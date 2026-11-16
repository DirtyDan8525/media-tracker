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
    links: [
      { id: 'l-unused', createdAt: new Date(Date.now() - 3600_000).toISOString(), expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(), status: 'unused', usedBy: null, usedAt: null },
      { id: 'l-used', createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), status: 'used', usedBy: 'vance', usedAt: new Date(Date.now() - 86_400_000).toISOString() },
      { id: 'l-expired', createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), status: 'expired', usedBy: null, usedAt: null },
      { id: 'l-revoked', createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), status: 'revoked', usedBy: null, usedAt: null },
    ] as { id: string; createdAt: string; expiresAt: string; status: string; usedBy: string | null; usedAt: string | null }[],
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
    'POST /api/admin/users/:id/delete': (_b, _u, p) => {
      if (p.id === 'id-dan') return { status: 400, body: { error: 'self' } };
      state.active = state.active.filter((x) => x.id !== p.id);
      state.removed = state.removed.filter((x) => x.id !== p.id);
      return { status: 204 };
    },
    'GET /api/admin/signup-links': () => ({ body: { links: state.links } }),
    'POST /api/admin/signup-links': () => {
      const l = { id: 'new1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: 'unused', usedBy: null, usedAt: null };
      state.links = [l, ...state.links];
      return { body: { id: 'new1', link: 'https://mt.example/join/T0KEN', expiresAt: l.expiresAt } };
    },
    'DELETE /api/admin/signup-links/:id': (_b, _u, p) => {
      state.links = state.links.map((l) => (l.id === p.id ? { ...l, status: 'revoked' } : l));
      return { status: 204 };
    },
  });
  return { state, calls };
}
/** Admin's confirm sheets (the welcome walkthrough may be open as another dialog). */
const CONFIRM_NAME = /^(Decline|Remove|Delete) @/;
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
    expect(screen.queryByRole('dialog', { name: CONFIRM_NAME })).not.toBeInTheDocument();
  });

  it('Cancel in the Decline sheet does nothing', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline @mika' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Decline @mika?' })).getByRole('button', { name: 'Cancel' }));
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

describe('Sign-up links', () => {
  it('Make a sign-up link shows the link with Copy and "Works once, for 7 days", and lists it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { calls } = adminBackend();
    renderApp('/admin');
    const card = await section(/^Sign-up links/);
    await userEvent.click(within(card).getByRole('button', { name: 'Make a sign-up link' }));
    const result = await screen.findByRole('status', { name: 'Sign-up link' });
    expect(within(result).getByRole('textbox', { name: 'Sign-up link' })).toHaveValue('https://mt.example/join/T0KEN');
    expect(result).toHaveTextContent('Works once, for 7 days');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/signup-links')).toBe(true);
    await userEvent.click(within(result).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://mt.example/join/T0KEN');
    // the new link joins the list (unused, with Revoke)
    await waitFor(() => expect(within(card).getAllByRole('button', { name: 'Revoke link' })).toHaveLength(2));
  });

  it('lists recent links with a status each; only unused ones have Revoke; no token is shown', async () => {
    adminBackend();
    renderApp('/admin');
    const card = await section(/^Sign-up links/);
    const items = await within(card).findAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Unused');
    expect(items[1]).toHaveTextContent('Used by @vance');
    expect(items[2]).toHaveTextContent('Expired');
    expect(items[3]).toHaveTextContent('Revoked');
    expect(within(items[0]!).getByRole('button', { name: 'Revoke link' })).toBeInTheDocument();
    for (const i of [1, 2, 3]) expect(within(items[i]!).queryByRole('button')).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent(/\/join\//);
  });

  it('Revoke turns an unused link into Revoked', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    const card = await section(/^Sign-up links/);
    await userEvent.click(await within(card).findByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/signup-links/l-unused')).toBe(true));
    await waitFor(() => expect(within(card).queryByRole('button', { name: 'Revoke link' })).not.toBeInTheDocument());
    expect((await within(card).findAllByRole('listitem'))[0]).toHaveTextContent('Revoked');
  });

  it('says so when no link has been made yet, and when a link could not be made', async () => {
    mockApi(makeMe({ id: 'id-dan', isAdmin: true }), {
      'GET /api/admin': { body: { pending: [], active: [], removed: [] } },
      'GET /api/admin/signup-links': { body: { links: [] } },
      'POST /api/admin/signup-links': { status: 500, body: { error: 'x' } },
    });
    renderApp('/admin');
    const card = await section(/^Sign-up links/);
    expect(await within(card).findByText('No links yet.')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Make a sign-up link' }));
    expect(await screen.findByText("Couldn't make a sign-up link. Check your connection and try again.")).toBeInTheDocument();
  });
});

describe('Delete account', () => {
  it('⋯ → Delete account asks "Delete @vance and all their lists? This can\'t be undone.", then deletes', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for @vance' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete @vance?' });
    expect(within(dialog).getByText("Delete @vance and all their lists? This can't be undone.")).toBeInTheDocument();
    expect(posted(calls).filter((p) => p.endsWith('/delete'))).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    await waitFor(() => expect(posted(calls)).toContain('/api/admin/users/id-vance/delete'));
    expect(await screen.findByText('Deleted @vance')).toBeInTheDocument();
    expect(await section(/^Members · 1$/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: CONFIRM_NAME })).not.toBeInTheDocument();
  });

  it('Cancel deletes nothing; your own row has no menu', async () => {
    const { calls } = adminBackend();
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for @vance' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete @vance?' })).getByRole('button', { name: 'Cancel' }));
    expect(posted(calls).filter((p) => p.endsWith('/delete'))).toEqual([]);
    expect(screen.queryByRole('button', { name: 'More actions for @dan' })).not.toBeInTheDocument();
  });

  it('a failed delete says so and keeps the row', async () => {
    mockApi(makeMe({ id: 'id-dan', isAdmin: true }), {
      'GET /api/admin': { body: { pending: [], active: [{ ...U('dan'), joinedAt: 'x', isAdmin: true }, { ...U('vance'), joinedAt: 'x', isAdmin: false }], removed: [] } },
      'GET /api/admin/signup-links': { body: { links: [] } },
      'POST /api/admin/users/:id/delete': { status: 500, body: { error: 'x' } },
    });
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for @vance' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete @vance?' })).getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText("Couldn't delete @vance. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for @vance' })).toBeInTheDocument();
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
