import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { makeFriendEntry, REN } from '../../test/friends';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

vi.mock('./EntrySocial', () => ({ EntrySocial: ({ entryId, ownerId }: { entryId: string; ownerId: string }) => <div data-testid="social">{entryId}|{ownerId}</div> }));

const THEIRS = (over = {}) => makeFriendEntry({
  id: 'f1', title: 'Frieren', category: 'anime', status: 'Completed', rating: 9, creator: 'Madhouse', genres: 'Adventure, Fantasy',
  releaseDate: '2023-09-29', lengthLabel: '28 ep', synopsis: 'An elf outlives her party.', source: 'kitsu', sourceId: '154587',
  coverUrl: 'https://img.example/f.jpg', origin: 'TV', detailsState: 'filled', notes: 'Loved the pacing.', ...over,
});
const body = (e = THEIRS(), seasons: object[] = []) => ({ 'GET /api/users/:username/entries/:id': { body: { entry: e, seasons } } });

describe('Friend entry detail', () => {
  it('shows their entry read-only with notes, reactions and comments', async () => {
    fakeBackend({ me: makeMe(), extra: body(THEIRS(), [{ id: 's1', label: 'Season 1', rating: 9, notes: 'Best arc' }]) as never });
    renderApp('/u/ren/entry/f1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Frieren' })).toBeInTheDocument();
    expect(screen.getByText('Madhouse')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Rating 9.0')).toHaveLength(2); // theirs, and the season
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Loved the pacing.')).toBeInTheDocument();
    expect(screen.getByText('Best arc')).toBeInTheDocument();
    expect(screen.getByTestId('social')).toHaveTextContent('f1|id-ren');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows no Notes section when notes is null (private)', async () => {
    fakeBackend({ me: makeMe(), extra: body(THEIRS({ notes: null })) as never });
    renderApp('/u/ren/entry/f1');
    await screen.findByRole('heading', { name: 'Frieren' });
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('Add to mine POSTs the friend\'s fields with status "Plan to watch" and no rating, then opens the new entry', async () => {
    const { calls } = fakeBackend({ me: makeMe(), extra: body() as never });
    const { router } = renderApp('/u/ren/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to mine' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/entry\/e\d+$/));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/entries')!;
    expect(post.body).toEqual({
      category: 'anime', title: 'Frieren', creator: 'Madhouse', album: '', coverUrl: 'https://img.example/f.jpg', genres: 'Adventure, Fantasy',
      releaseDate: '2023-09-29', synopsis: 'An elf outlives her party.', lengthLabel: '28 ep', origin: 'TV', source: 'kitsu', sourceId: '154587',
      lookupState: 'ok', detailsState: 'filled', status: 'Plan to watch',
    });
    expect(post.body).not.toHaveProperty('rating');
    expect(post.body).not.toHaveProperty('notes');
  });

  it('lists without a Status send none', async () => {
    const { calls } = fakeBackend({ me: makeMe(), extra: body(THEIRS({ category: 'albums', status: null, title: 'Kid A', creator: 'Radiohead' })) as never });
    renderApp('/u/ren/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to mine' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/entries')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/entries')!.body).not.toHaveProperty('status');
  });

  it('a title already on your list → "Already on your list" with a link, and nothing is added', async () => {
    const { calls } = fakeBackend({ me: makeMe(), entries: [makeEntry({ id: 'mine1', category: 'anime', title: 'Frieren' })], extra: body() as never });
    renderApp('/u/ren/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to mine' }));
    const note = await screen.findByText(/Already on your list/);
    expect(note.closest('p')!.querySelector('a')).toHaveAttribute('href', '/entry/mine1');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/entries')).toBe(false);
  });

  it("the server's duplicateOf also counts: the row it made is removed", async () => {
    const { calls } = fakeBackend({
      me: makeMe(),
      extra: {
        ...body(),
        'POST /api/entries': { status: 201, body: { entry: makeEntry({ id: 'newdup' }), duplicateOf: 'mine9' } },
        'DELETE /api/entries/:id': { status: 204 },
      } as never,
    });
    renderApp('/u/ren/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to mine' }));
    expect((await screen.findByText(/Already on your list/)).closest('p')!.querySelector('a')).toHaveAttribute('href', '/entry/mine9');
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/entries/newdup')).toBe(true);
  });

  it('a failed add toasts and keeps the button', async () => {
    fakeBackend({ me: makeMe(), extra: { ...body(), 'POST /api/entries': { status: 500, body: { error: 'x' } } } as never });
    renderApp('/u/ren/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to mine' }));
    expect(await screen.findByText("Couldn't add it. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to mine' })).toBeEnabled();
  });

  it('not visible any more → 404 message', async () => {
    fakeBackend({ me: makeMe(), extra: { 'GET /api/users/:username/entries/:id': { status: 404, body: { error: 'not_found' } } } as never });
    renderApp('/u/ren/entry/gone');
    expect(await screen.findByRole('heading', { name: "We couldn't find that title" })).toBeInTheDocument();
  });

  it('a friend\'s song or album has an Open in Spotify link (direct when matched from Spotify, else a search)', async () => {
    fakeBackend({ me: makeMe(), extra: body(THEIRS({ category: 'songs', status: null, title: 'Time', creator: 'Pink Floyd', source: 'spotify', sourceId: 'track:1XyZ' })) as never });
    const { unmount } = renderApp('/u/ren/entry/f1');
    const link = await screen.findByRole('link', { name: 'Open in Spotify' });
    expect(link).toHaveAttribute('href', 'https://open.spotify.com/track/1XyZ');
    expect(link).toHaveAttribute('target', '_blank');
    unmount();
    fakeBackend({ me: makeMe(), extra: body(THEIRS({ category: 'albums', status: null, title: 'Kid A', creator: 'Radiohead', source: 'deezer', sourceId: 'album:12' })) as never });
    renderApp('/u/ren/entry/f1');
    expect(await screen.findByRole('link', { name: 'Open in Spotify' })).toHaveAttribute('href', 'https://open.spotify.com/search/Kid%20A%20Radiohead');
  });
});

void REN;
