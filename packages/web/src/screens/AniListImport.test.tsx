import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportRow } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';

const gql = (media: object[]) => ({ data: { MediaListCollection: { lists: [{ entries: media }] } } });
const item = (id: number, title: string, extra: object = {}) => ({
  status: 'COMPLETED', score: 8, progress: 12, notes: null, private: false, repeat: 0,
  startedAt: { year: null, month: null, day: null }, completedAt: { year: null, month: null, day: null },
  media: {
    id, title: { romaji: title, english: title }, episodes: 12, chapters: 12, coverImage: { large: null }, startDate: { year: 2020 },
    genres: [], studios: { nodes: [] }, staff: { nodes: [] },
  },
  ...extra,
});
const ANIME = gql([item(1, 'Anime One'), item(2, 'Anime Two'), item(3, 'Anime Three')]);
const MANGA = gql([item(10, 'Manga One')]);
const GRAPHQL = 'POST https://graphql.anilist.co/';

type Reply = { status?: number; body: unknown };
/** Answers AniList by the `type` variable (anime first, then manga). */
function backend(anilist: (type: string, user: string) => Reply, entries: ReturnType<typeof makeEntry>[] = []) {
  return fakeBackend({
    entries,
    extra: {
      [GRAPHQL]: (b) => {
        const { variables } = b as { variables: { type: string; user: string } };
        return anilist(variables.type, variables.user);
      },
      'POST /api/import': (b) => ({ body: { inserted: (b as { rows: unknown[] }).rows.length } }),
      'DELETE /api/import/:id': { body: { deleted: 4 } },
    },
  });
}
const ok = (type: string) => ({ body: type === 'ANIME' ? ANIME : MANGA });
const aniCalls = (calls: { method: string; path: string; body?: unknown }[]) => calls.filter((c) => c.method === 'POST' && typeof (c.body as { query?: unknown } | undefined)?.query === 'string');
const importPosts = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/import').map((c) => c.body as { importId: string; rows: ImportRow[] });

async function lookUp(name: string) {
  await userEvent.type(await screen.findByLabelText('AniList username'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
}

describe('Import from AniList', () => {
  it('looks up, summarises, imports through POST /api/import and can undo', async () => {
    const { calls } = backend(ok);
    renderApp('/import');
    await lookUp('dan8525');
    expect(await screen.findByText('Anime 3')).toBeInTheDocument();
    expect(screen.getByText('Manga 1')).toBeInTheDocument();
    expect(aniCalls(calls)).toHaveLength(2);
    expect(screen.queryByText(/already on your lists/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import 4 titles' }));
    expect(await screen.findByText('Imported 4 titles')).toBeInTheDocument();
    const posts = importPosts(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.rows.map((r) => r.title)).toEqual(['Anime One', 'Anime Two', 'Anime Three', 'Manga One']);
    expect(posts[0]!.rows[0]).toMatchObject({ source: 'anilist', sourceId: '1', status: 'Completed', rating: 8, progress: 12 });

    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `/api/import/${posts[0]!.importId}`)).toBe(true);
  });

  it('unchecking Manga imports only the anime rows', async () => {
    const { calls } = backend(ok);
    renderApp('/import');
    await lookUp('dan8525');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Manga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import 3 titles' }));
    await screen.findByText('Imported 3 titles');
    expect(importPosts(calls)[0]!.rows.map((r) => r.category)).toEqual(['anime', 'anime', 'anime']);
  });

  it('disables Import with both lists unchecked', async () => {
    backend(ok);
    renderApp('/import');
    await lookUp('dan8525');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Anime' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Manga' }));
    expect(screen.getByRole('button', { name: 'Import 0 titles' })).toBeDisabled();
  });

  it('skips titles already on the lists and says how many', async () => {
    const { calls } = backend(ok, [
      makeEntry({ id: 'e1', category: 'anime', title: 'Different Title', source: 'anilist', sourceId: '2' }),
      makeEntry({ id: 'e2', category: 'manga', title: 'manga one!', creator: '' }),
    ]);
    renderApp('/import');
    await lookUp('dan8525');
    expect(await screen.findByText('Anime 2')).toBeInTheDocument();
    expect(screen.getByText('Manga 0')).toBeInTheDocument();
    expect(screen.getByText('2 already on your lists — skipped')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Manga' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 titles' }));
    await screen.findByText('Imported 2 titles');
    expect(importPosts(calls)[0]!.rows.map((r) => r.title)).toEqual(['Anime One', 'Anime Three']);
  });

  it('shows a clear message for not found, private, busy and unreachable', async () => {
    const replies: Record<string, Reply> = {
      ghost_user: { status: 404, body: { data: { MediaListCollection: null }, errors: [{ message: 'User not found', status: 404 }] } },
      secret_user: { status: 403, body: { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 403 }] } },
      busy_user: { status: 429, body: { errors: [{ message: 'Too Many Requests.', status: 429 }] } },
      down_user: { status: 500, body: {} },
    };
    const expected: Record<string, RegExp> = {
      ghost_user: /No AniList user called "ghost_user"/,
      secret_user: /private/i,
      busy_user: /try again in a minute/i,
      down_user: /Couldn't reach AniList/,
    };
    backend((_t, u) => replies[u]!);
    renderApp('/import');
    for (const name of Object.keys(replies)) {
      await userEvent.clear(await screen.findByLabelText('AniList username'));
      await lookUp(name);
      expect(await screen.findByText(expected[name]!)).toBeInTheDocument();
    }
  });

  it('refuses an invalid name without calling the Worker', async () => {
    const { calls } = backend(ok);
    renderApp('/import');
    await lookUp('no spaces!');
    expect(await screen.findByRole('alert')).toHaveTextContent(/2 to 20 letters, digits or underscores/);
    expect(aniCalls(calls)).toHaveLength(0);
  });
});
