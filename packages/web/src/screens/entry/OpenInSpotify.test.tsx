import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeEntry } from '../../test/fakeBackend';
import { mockFetch } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import { OpenInSpotify } from './OpenInSpotify';

const SEARCH = 'https://open.spotify.com/search/Halo%20Beyonc%C3%A9';
const song = makeEntry({ category: 'songs', title: 'Halo', creator: 'Beyoncé', source: 'deezer', sourceId: 'track:1' });
const show = (entry: Parameters<typeof OpenInSpotify>[0]['entry']) =>
  render(<QueryClientProvider client={makeQueryClient()}><OpenInSpotify entry={entry} /></QueryClientProvider>);
const link = () => screen.getByRole('link', { name: 'Open in Spotify' });

describe('OpenInSpotify', () => {
  it('uses the direct url the Worker finds, the search link until then', async () => {
    const calls = mockFetch({ 'GET /api/spotify/link': { body: { url: 'https://open.spotify.com/track/abc' } } });
    show(song);
    expect(link()).toHaveAttribute('href', SEARCH);
    await waitFor(() => expect(link()).toHaveAttribute('href', 'https://open.spotify.com/track/abc'));
    expect(calls[0]!.path).toBe('/api/spotify/link?kind=track&title=Halo&artist=Beyonc%C3%A9');
  });

  it('asks for an album with kind=album', async () => {
    const calls = mockFetch({ 'GET /api/spotify/link': { body: { url: null } } });
    show({ ...song, category: 'albums', title: 'Lemonade' });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.path).toContain('kind=album&title=Lemonade');
  });

  it('keeps the search link when the Worker has no match', async () => {
    const calls = mockFetch({ 'GET /api/spotify/link': { body: { url: null } } });
    show(song);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(link()).toHaveAttribute('href', SEARCH);
  });

  it('keeps the search link on an error (such as 401)', async () => {
    const calls = mockFetch({ 'GET /api/spotify/link': { status: 401, body: { error: 'unauthorized' } } });
    show(song);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(link()).toHaveAttribute('href', SEARCH);
  });

  it('a Spotify match links straight to it without asking the Worker', () => {
    const calls = mockFetch({});
    show({ ...song, source: 'spotify', sourceId: 'track:xyz' });
    expect(link()).toHaveAttribute('href', 'https://open.spotify.com/track/xyz');
    expect(calls).toHaveLength(0);
  });

  it('shows nothing for other lists and asks nothing', () => {
    const calls = mockFetch({});
    show({ ...song, category: 'anime' });
    expect(screen.queryByRole('link')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
