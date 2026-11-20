import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeEntry } from '../../test/fakeBackend';
import { mockFetch } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import { PlayTrailer } from './PlayTrailer';

const movie = makeEntry({ category: 'movies', title: 'Dune: Part Two', releaseDate: '2024-03-01', source: 'tmdb', sourceId: '693134' });
const show = (entry = movie) => render(<QueryClientProvider client={makeQueryClient()}><PlayTrailer entry={entry} /></QueryClientProvider>);

describe('PlayTrailer', () => {
  it('hides the button without a trailer, and for other lists', async () => {
    const calls = mockFetch({ 'GET /api/trailer': { body: { youtubeId: null } } });
    show();
    show(makeEntry({ category: 'songs', title: 'Halo' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Play trailer/ })).not.toBeInTheDocument();
  });

  it('asks with kind, title, year and the TMDB id; opens a sheet with the nocookie embed; Close removes the iframe', async () => {
    const calls = mockFetch({ 'GET /api/trailer': { body: { youtubeId: 'Way9Dexny3w' } } });
    show();
    const btn = await screen.findByRole('button', { name: '▶ Play trailer' });
    expect(calls[0]!.path).toBe('/api/trailer?kind=movie&title=Dune%3A%20Part%20Two&year=2024&id=693134');
    expect(document.querySelector('iframe')).toBeNull(); // not loaded until opened
    await userEvent.click(btn);
    const frame = await waitFor(() => { const f = document.querySelector('iframe'); expect(f).not.toBeNull(); return f; }).then(() => document.querySelector('iframe')!);
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/Way9Dexny3w?autoplay=1');
    expect(frame).toHaveAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    expect(frame).toHaveAttribute('allowfullscreen');
    const dialog = screen.getByRole('dialog');
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.classList.contains('btn'))!);
    expect(dialog).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('TV and anime use their kinds, without a mismatched stored id', async () => {
    const calls = mockFetch({ 'GET /api/trailer': { body: { youtubeId: null } } });
    show(makeEntry({ category: 'tv', title: 'Severance', releaseDate: '2022-02-18', source: 'tvmaze', sourceId: '44' }));
    show(makeEntry({ category: 'anime', title: 'Frieren', releaseDate: '', source: 'anilist', sourceId: '154587' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.path).sort()).toEqual(['/api/trailer?kind=anime&title=Frieren&year=', '/api/trailer?kind=tv&title=Severance&year=2022']);
  });
});
