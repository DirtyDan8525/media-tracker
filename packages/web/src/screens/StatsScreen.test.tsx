import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '@media-tracker/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const rows = (): Entry[] => [
  makeEntry({ category: 'anime', title: 'A', rating: 9, status: 'Watching / In Progress', genres: 'Action, Drama' }),
  makeEntry({ category: 'anime', title: 'B', rating: 8, status: 'Watching / In Progress', genres: 'action' }),
  makeEntry({ category: 'anime', title: 'C', rating: null, status: 'Completed' }),
  makeEntry({ category: 'movies', title: 'M', rating: 7 }),
];

afterEach(() => setViewportWidth(390));

describe('Stats screen', () => {
  it('labels the all-media numbers and charts have text equivalents', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/stats');
    const all = await screen.findByRole('region', { name: 'All media' });
    for (const label of ['Entries', 'Rated', 'Average', 'Completed', 'Highest']) {
      expect(within(all).getByText(label, { selector: 'dt' })).toBeInTheDocument();
    }
    expect(within(all).getByText('4', { selector: 'dd' })).toBeInTheDocument(); // entries
    expect(within(all).getByText('3', { selector: 'dd' })).toBeInTheDocument(); // rated
    expect(within(all).getByRole('img', { name: '3 of 4 rated' })).toBeInTheDocument();
    // distribution as a table
    const dist = screen.getByRole('table', { name: 'Ratings by score' });
    expect(within(dist).getByRole('row', { name: /^9 1$/ })).toBeInTheDocument();
    expect(within(dist).getByRole('row', { name: /^1 0$/ })).toBeInTheDocument();
  });

  it('shows a table by list on PC with column headers, a row per list and an All media row', async () => {
    setViewportWidth(1200);
    fakeBackend({ entries: rows(), me: makeMe({}, { tv: false, albums: false, songs: false, games: false, books: false }) });
    renderApp('/stats');
    const table = await screen.findByRole('table', { name: 'Stats by list' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['List', 'Entries', 'Rated', 'Average', 'Completed', 'Highest']);
    const anime = within(table).getByRole('row', { name: /^Anime/ });
    expect(within(anime).getAllByRole('cell').map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['3', '2', '8.5', '1', '9.0']);
    const movies = within(table).getByRole('row', { name: /^Movies/ });
    expect(within(movies).getAllByRole('cell').map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['1', '1', '7.0', '—', '7.0']);
    expect(within(table).queryByRole('row', { name: /^TV Shows/ })).not.toBeInTheDocument();
    const total = within(table).getByRole('row', { name: /^All media/ });
    expect(within(total).getAllByRole('cell').map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['4', '3', '8.0', '1', '9.0']);
  });

  it('shows a dash for average and highest in a list with nothing rated', async () => {
    setViewportWidth(1200);
    fakeBackend({ entries: [makeEntry({ category: 'movies', rating: null })] });
    renderApp('/stats');
    const table = await screen.findByRole('table', { name: 'Stats by list' });
    const movies = within(table).getByRole('row', { name: /^Movies/ });
    expect(within(movies).getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual(['1', '0', '—', '—', '—']);
  });

  it('lists anime genres with counts and averages, and omits them when Anime is off', async () => {
    fakeBackend({ entries: rows() });
    const { unmount } = renderApp('/stats');
    const genres = await screen.findByRole('table', { name: 'Anime by genre' });
    const action = within(genres).getByRole('row', { name: /^Action/ });
    expect(action).toHaveTextContent('2');
    expect(action).toHaveTextContent('8.5');
    unmount();
    fakeBackend({ entries: rows(), me: makeMe({}, { anime: false }) });
    renderApp('/stats');
    await screen.findByRole('table', { name: 'Stats by list' });
    expect(screen.queryByRole('table', { name: 'Anime by genre' })).not.toBeInTheDocument();
  });

  it('shows a retry, not zeros, when the lists cannot be loaded', async () => {
    let fail = true;
    mockApi(makeMe(), {
      'GET /api/entries': () => (fail ? { status: 500, body: { error: 'boom' } } : { body: [] }),
    });
    renderApp('/stats');
    expect(await screen.findByText("Couldn't load your lists")).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'All media' })).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load your lists")).not.toBeInTheDocument());
  });
});
