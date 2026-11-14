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
    expect(within(all).getByText('Rated', { selector: 'dt' }).closest('div')).toHaveClass('sr-only');
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
    await screen.findByRole('list', { name: 'Stats by list' });
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

  it('shows compact cards per list on a phone, not a table', async () => {
    fakeBackend({ entries: rows(), me: makeMe({}, { tv: false, albums: false, songs: false, games: false, books: false }) });
    renderApp('/stats');
    const cards = await screen.findByRole('list', { name: 'Stats by list' });
    expect(screen.queryByRole('table', { name: 'Stats by list' })).not.toBeInTheDocument();
    const [anime, movies] = within(cards).getAllByRole('listitem');
    expect(within(anime!).getByRole('heading', { name: 'Anime' })).toBeInTheDocument();
    expect(within(anime!).getByText('Completed', { selector: 'dt' }).nextSibling).toHaveTextContent('1');
    expect(within(anime!).getByText('Highest', { selector: 'dt' }).nextSibling).toHaveTextContent('9.0');
    expect(within(anime!).getByLabelText('Rating 8.5')).toBeInTheDocument();
    expect(within(movies!).getByText('Completed', { selector: 'dt' }).nextSibling).toHaveTextContent('—');
  });

  it('shows a skeleton while loading', async () => {
    mockApi(makeMe(), { 'GET /api/entries': () => new Promise(() => {}) });
    renderApp('/stats');
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('says there is nothing to count with no entries, and with every list off', async () => {
    fakeBackend({ entries: [] });
    const { unmount } = renderApp('/stats');
    expect(await screen.findByText('Nothing to count yet')).toBeInTheDocument();
    unmount();
    fakeBackend({ entries: [], me: makeMe({}, { anime: false, movies: false, tv: false, albums: false, songs: false, games: false, books: false }) });
    renderApp('/stats');
    expect(await screen.findByText('Turn a list on in Settings, then add some titles.')).toBeInTheDocument();
  });

  it('keeps the lists that loaded and offers a retry for the ones that did not', async () => {
    let failMovies = true;
    mockApi(makeMe(), {
      'GET /api/entries': (_b, url) => {
        const c = url.searchParams.get('category');
        if (c === 'movies' && failMovies) return { status: 500, body: { error: 'boom' } };
        return { body: rows().filter((e) => e.category === c) };
      },
    });
    renderApp('/stats');
    expect(await screen.findByText("Couldn't load some lists.")).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'All media' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your lists")).not.toBeInTheDocument();
    failMovies = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load some lists.")).not.toBeInTheDocument());
    expect(within(await screen.findByRole('region', { name: 'All media' })).getByText('4', { selector: 'dd' })).toBeInTheDocument();
  });

  it('shows the top 10 genres, with a button to show all when there are more', async () => {
    const many = Array.from({ length: 12 }, (_, i) => makeEntry({ category: 'anime', rating: 5, genres: `Genre ${String(i).padStart(2, '0')}` }));
    fakeBackend({ entries: many });
    renderApp('/stats');
    const genres = await screen.findByRole('table', { name: 'Anime by genre' });
    expect(within(genres).getAllByRole('row')).toHaveLength(11); // header + 10
    await userEvent.click(screen.getByRole('button', { name: 'Show all 12 genres' }));
    expect(within(screen.getByRole('table', { name: 'Anime by genre' })).getAllByRole('row')).toHaveLength(13);
    expect(screen.getByRole('button', { name: 'Show fewer genres' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows no genre button for 10 or fewer genres', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/stats');
    await screen.findByRole('table', { name: 'Anime by genre' });
    expect(screen.queryByRole('button', { name: /genres$/ })).not.toBeInTheDocument();
  });
});
