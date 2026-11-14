import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const rows = (): Entry[] => [
  makeEntry({ id: 'a1', category: 'anime', title: 'Frieren', creator: 'Madhouse', rating: 9.5, coverUrl: 'https://img.example/f.jpg' }),
  makeEntry({ id: 'a2', category: 'anime', title: 'Mushishi', creator: 'Artland', rating: 9 }),
  makeEntry({ id: 'a3', category: 'anime', title: 'Unrated one', rating: null }),
  makeEntry({ id: 'm1', category: 'movies', title: 'Heat', creator: 'Michael Mann', rating: 8.25 }),
  makeEntry({ id: 'al1', category: 'albums', title: 'Blonde', creator: 'Frank Ocean', rating: 9.4 }),
];

describe('Top 5 screen', () => {
  it('shows a block per enabled list in nav order with ranked, linked rows', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 5' })).toBeInTheDocument();
    await screen.findByRole('heading', { level: 2, name: 'Anime' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books']);

    const anime = screen.getByRole('region', { name: 'Anime' });
    const items = within(within(anime).getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2); // the unrated one is left out
    const first = within(items[0]!).getByRole('link', { name: /^1\s+Frieren\s+Madhouse\s+Rating 9\.5$/ });
    expect(first).toHaveAttribute('href', '/entry/a1');
    expect(within(items[1]!).getByRole('link', { name: /^2\s+Mushishi\s+Artland\s+Rating 9\.0$/ })).toHaveAttribute('href', '/entry/a2');

    const movies = screen.getByRole('region', { name: 'Movies' });
    expect(within(movies).getByRole('link', { name: /Heat.*Rating 8\.25/ })).toBeInTheDocument();
  });

  it('says so, with a way on, for a list with nothing rated', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    const tv = await screen.findByRole('region', { name: 'TV Shows' });
    expect(within(tv).getByText('Nothing rated yet.')).toBeInTheDocument();
    expect(within(tv).getByRole('link', { name: 'Go to TV Shows' })).toHaveAttribute('href', '/list/tv');
  });

  it('leaves out a turned-off list', async () => {
    fakeBackend({ entries: rows(), me: makeMe({}, { albums: false }) });
    renderApp('/top5');
    await screen.findByRole('region', { name: 'Anime' });
    expect(screen.queryByRole('region', { name: 'Albums' })).not.toBeInTheDocument();
    expect(screen.queryByText('Blonde')).not.toBeInTheDocument();
  });

  it('shows a retry, not an empty state, when the lists cannot be loaded', async () => {
    let fail = true;
    mockApi(makeMe(), {
      'GET /api/entries': () => (fail ? { status: 500, body: { error: 'boom' } } : { body: rows().filter((e) => e.category === 'anime') }),
    });
    renderApp('/top5');
    expect(await screen.findByText("Couldn't load your lists")).toBeInTheDocument();
    expect(screen.queryByText('Nothing rated yet.')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load your lists")).not.toBeInTheDocument());
  });
});
