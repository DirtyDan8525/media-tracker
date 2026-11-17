import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const item = (id: string, title: string, rating: number) =>
  ({ id, title, rating, typed: rating, tier: 3, priorMean: rating, strength: rating, scoreLocked: false, cover: '', square: false, status: 'Completed' });

describe('Sharpen my ratings (N7, Sharpen board)', () => {
  it('lists every enabled list with its close calls; a session asks them in order, saves each pick and ends with Done', async () => {
    const me = makeMe({}, { songs: false, animeSeasons: false, tvSeasons: false });
    const calls = mockApi(me, {
      'GET /api/ratings/close-counts': { body: { counts: { anime: 2, tv: 1, movies: 0 } } },
      'GET /api/ratings/anime/close': { body: {
        pairs: [['fr', 'mu'], ['fr', 'ka']], total: 2,
        items: [item('fr', 'Frieren', 9.6), item('mu', 'Mushishi', 9.6), item('ka', 'Kaguya', 9.4)],
      } },
      'POST /api/ratings/anime/save': { body: { items: [{ ...item('fr', 'Frieren', 9.62) }, { ...item('mu', 'Mushishi', 9.58) }], entries: [] } },
    });
    const { router } = renderApp('/sharpen');
    expect(await screen.findByText('Pick a list. Only close ratings come up.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Anime, 2 close calls' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TV Shows, 1 close call' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Movies, 0 — all clear' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Songs/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Anime, 2 close calls' }));
    expect(await screen.findByText('Close call 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Which did you like more?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Frieren, 9.6' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ picks: [{ winnerId: 'fr', loserId: 'mu', isTie: false }] });
    expect(await screen.findByText('Close call 2 of 2')).toBeInTheDocument();
    // The second card shows Frieren's new number.
    expect(screen.getByRole('button', { name: 'Frieren, 9.62' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('That was the last one')).toBeInTheDocument();
    expect(screen.getByText('Nudged to break the tie.')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('main')).getAllByRole('button', { name: 'Done' }).at(-1)!);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByText('Pick a list. Only close ratings come up.')).toBeInTheDocument();
  });

  it('a list with no close calls says All clear', async () => {
    mockApi(makeMe(), { 'GET /api/ratings/movies/close': { body: { pairs: [], total: 0, items: [] } } });
    renderApp('/sharpen?list=movies');
    expect(await screen.findByText('All clear')).toBeInTheDocument();
  });
});
