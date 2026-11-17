import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../../test/friends';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

const PROFILE = { user: REN, memberSince: '2026-10-01T00:00:00Z', relation: 'friend' };
const ENTRIES = () => [
  makeFriendEntry({ id: 'f1', title: 'Frieren', status: 'Completed', rating: 9, category: 'anime' }),
  makeFriendEntry({ id: 'f2', title: 'Mob Psycho 100', status: 'Watching / In Progress', rating: 8.5, category: 'anime' }),
  makeFriendEntry({ id: 'f3', title: 'Heat', rating: 7, category: 'movies' }),
  makeFriendEntry({ id: 'f4', title: 'Unrated one', rating: null, category: 'anime' }),
];
function backend(over: Record<string, never> | Record<string, unknown> = {}) {
  return fakeBackend({
    me: makeMe(),
    extra: {
      'GET /api/users/:username': { body: PROFILE },
      'GET /api/users/:username/entries': { body: ENTRIES() },
      'GET /api/friends': { body: friendsOf(REN) },
      ...over,
    } as never,
  });
}

describe('Friend profile', () => {
  it('shows tabs Lists / Top 5 / Stats / Compare and read-only rows without edit controls', async () => {
    backend();
    renderApp('/u/ren');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ren' })).toBeInTheDocument();
    expect(screen.getByText('@ren')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lists', 'Top 5', 'Stats', 'Compare']);
    expect(screen.getByRole('tab', { name: 'Lists' })).toHaveAttribute('aria-selected', 'true');
    const row = await screen.findByRole('link', { name: 'Frieren, Completed, rated 9.0' });
    expect(row).toHaveAttribute('href', '/u/ren/entry/f1');
    expect(screen.getByRole('link', { name: 'Mob Psycho 100, Watching / In Progress, rated 8.5' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();
  });

  it('on PC the Lists tab is a read-only table like your own list, with notes', async () => {
    setViewportWidth(1280);
    try {
      backend({ 'GET /api/users/:username/entries': { body: [makeFriendEntry({ id: 'f1', title: 'Frieren', status: 'Completed', rating: 9, category: 'anime', notes: 'peak' })] } });
      renderApp('/u/ren');
      const table = await screen.findByRole('table', { name: 'Anime, @ren' });
      expect(within(table).getByRole('link', { name: 'Frieren' })).toHaveAttribute('href', '/u/ren/entry/f1');
      expect(within(table).getByText('peak')).toHaveAttribute('title', 'peak');
      expect(within(table).queryByRole('textbox')).not.toBeInTheDocument();
    } finally {
      setViewportWidth(390);
    }
  });

  it('tiles count titles, rated, average and the month you became friends', async () => {
    backend();
    renderApp('/u/ren');
    const tile = async (label: string) => (await screen.findByText(label)).closest('div')!.textContent;
    await waitFor(async () => expect(await tile('Titles')).toBe('Titles4'));
    expect(await tile('Rated')).toBe('Rated3');
    expect(await tile('Avg')).toBe('Avg8.2');
    expect(await tile('Friends since')).toBe('Friends sinceNov 2026');
  });

  it('chips are the categories they have; choosing one switches the rows', async () => {
    backend();
    renderApp('/u/ren');
    await screen.findByRole('link', { name: /Frieren/ });
    const chips = screen.getByRole('group', { name: 'Category' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Anime', 'Movies']);
    await userEvent.click(within(chips).getByRole('button', { name: 'Movies' }));
    expect(await screen.findByRole('link', { name: 'Heat, rated 7.0' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Frieren/ })).not.toBeInTheDocument();
  });

  it('Top 5 and Stats tabs show their figures', async () => {
    backend();
    renderApp('/u/ren');
    await userEvent.click(await screen.findByRole('tab', { name: 'Top 5' }));
    const anime = await screen.findByRole('region', { name: 'Anime' });
    expect(within(anime).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/u/ren/entry/f1', '/u/ren/entry/f2']);
    await userEvent.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(await screen.findByRole('region', { name: 'All media' })).toHaveTextContent('Entries4');
    expect(screen.getByRole('list', { name: 'Stats by list' })).toBeInTheDocument();
  });

  it("a stranger's profile shows only the header and Add friend, and never asks for their entries", async () => {
    const { calls } = backend({
      'GET /api/users/:username': { body: { user: { ...REN, id: 'id-vance', username: 'vance', displayName: null }, memberSince: null, relation: 'none' } },
      'POST /api/friends/requests': { body: { relation: 'pending_out' } },
    });
    renderApp('/u/vance');
    expect(await screen.findByRole('heading', { level: 1, name: '@vance' })).toBeInTheDocument();
    expect(screen.getByText('Not friends yet')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/friends/requests')?.body).toEqual({ username: 'vance' }));
    expect(calls.some((c) => c.path.includes('/entries'))).toBe(false);
  });

  it('a pending request from them offers Accept', async () => {
    const { calls } = backend({
      'GET /api/users/:username': { body: { user: REN, memberSince: null, relation: 'pending_in' } },
      'POST /api/friends/:id/accept': { status: 204 },
    });
    renderApp('/u/ren');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/friends/id-ren/accept')).toBe(true));
  });

  it('Remove friend asks first, then DELETEs and goes back to /friends', async () => {
    const { calls } = backend({ 'DELETE /api/friends/:id': { status: 204 } });
    const { router } = renderApp('/u/ren');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove friend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Ren?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove friend' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/friends'));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/friends/id-ren')).toBe(true);
  });

  it('Cancel in the confirm removes nothing; Escape closes the menu', async () => {
    const { calls } = backend();
    renderApp('/u/ren');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove friend' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('unknown username → "We couldn\'t find that person"; yourself → /profile', async () => {
    backend({ 'GET /api/users/:username': { status: 404, body: { error: 'not_found' } } });
    const { router } = renderApp('/u/nobody');
    expect(await screen.findByRole('heading', { name: "We couldn't find that person" })).toBeInTheDocument();
    await router.navigate('/u/dan');
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });

  it('a friend with nothing visible says so; a failed load offers Retry', async () => {
    backend({ 'GET /api/users/:username/entries': { body: [] } });
    renderApp('/u/ren');
    expect(await screen.findByRole('heading', { name: "Ren hasn't shared anything yet" })).toBeInTheDocument();
  });

  it('failed entries load → Retry', async () => {
    let n = 0;
    backend({ 'GET /api/users/:username/entries': () => (n++ === 0 ? { status: 500, body: { error: 'x' } } : { body: ENTRIES() }) });
    renderApp('/u/ren');
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Frieren/ })).toBeInTheDocument();
  });
});

void makeEntry;
