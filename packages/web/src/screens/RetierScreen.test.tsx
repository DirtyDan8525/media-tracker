import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  applyMove, DEFAULT_TIERS, priorFromScore, tierFor, tierRange, type Entry, type SavePayload, type SetItem,
} from '@media-tracker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { Icon } from '../design/components/Icon';
import { makeMe, mockApi, type MockResponse } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

function rated(id: string, rating: number): Entry {
  const tier = tierFor(rating, DEFAULT_TIERS);
  const p = priorFromScore(rating, tierRange(DEFAULT_TIERS, tier));
  return makeEntry({ id, title: id, rating, tier, priorMean: p, strength: p, category: 'anime' });
}
const setItem = (e: Entry): SetItem => ({
  id: e.id, title: e.title, rating: e.rating, tier: e.tier, priorMean: e.priorMean, strength: e.strength,
  scoreLocked: e.scoreLocked, cover: e.coverUrl, square: false, status: e.status,
});

const ROWS = () => [rated('Akira', 9.8), rated('Bebop', 9.5), rated('Dorohedoro', 8.0), rated('Erased', 7.9), rated('FLCL', 6.5), rated('Gantz', 3)];

function setup(opts: { save?: MockResponse; path?: string } = {}) {
  const rows = ROWS();
  const calls = mockApi(makeMe(), {
    'GET /api/entries': () => ({ body: rows }),
    'GET /api/ratings/:set': () => ({ body: { items: rows.map(setItem), comparisons: [] } }),
    'POST /api/ratings/:set/save': opts.save ?? { body: { items: [], entries: [] } },
  });
  const { router } = renderApp(opts.path ?? '/retier/anime');
  return { calls, rows, router };
}
const saves = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/ratings/anime/save').map((c) => c.body as SavePayload);
const section = (name: string) => screen.getByRole('region', { name });

afterEach(() => setViewportWidth(390));

describe('Re-tier review', () => {
  beforeEach(() => setViewportWidth(390));

  it('lists every rated title under its tier with counts, and says what it is for', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Loved · 2' });
    expect(screen.getByRole('heading', { name: 'Liked · 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fine · 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Didn't like · 1" })).toBeInTheDocument();
    expect(within(section('Loved · 2')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Akira'), expect.stringContaining('Bebop'),
    ]);
    expect(within(section('Loved · 2')).getByLabelText('Rating 9.8')).toBeInTheDocument();
    expect(screen.getByText(/Scores from the Sheet may have been lowered by its old compare system/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save (0 moved)' })).toBeDisabled();
  });

  it('phone: Move to… Loved marks the row "was Liked" and Save posts { moves: [{ id, tier: 3 }] }', async () => {
    const { calls } = setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Dorohedoro to…' }));
    const dialog = await screen.findByRole('dialog', { name: /Move .?Dorohedoro.? to…/ });
    await userEvent.click(within(dialog).getByRole('button', { name: /^Loved/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const loved = section('Loved · 3');
    const row = within(loved).getByText('Dorohedoro').closest('li')!;
    expect(row).toHaveTextContent('was Liked');
    // keeps its rough place: the prior comes from its shown score, clamped into the new tier
    const moved = applyMove(setItem(ROWS()[2]!), 3, DEFAULT_TIERS);
    expect(within(row).getByLabelText(`Rating ${moved.rating!.toFixed(1)}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    await waitFor(() => expect(saves(calls)).toEqual([{ picks: [], moves: [{ id: 'Dorohedoro', tier: 3 }], done: [] }]));
  });

  it('a move back to the original tier restores the title and drops it; a same-tier move does nothing', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    const move = async (title: string, tier: RegExp) => {
      await userEvent.click(screen.getByRole('button', { name: `Move ${title} to…` }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: tier }));
    };
    await move('Erased', /^Liked/); // its own tier
    expect(screen.getByRole('button', { name: 'Save (0 moved)' })).toBeDisabled();
    await move('Erased', /^Fine/);
    expect(screen.getByRole('button', { name: 'Save (1 moved)' })).toBeEnabled();
    await move('Erased', /^Loved/); // moved again: still one title moved
    expect(screen.getByRole('button', { name: 'Save (1 moved)' })).toBeEnabled();
    await move('Erased', /^Liked/); // back home
    expect(screen.getByRole('button', { name: 'Save (0 moved)' })).toBeDisabled();
    const row = within(section('Liked · 2')).getByText('Erased').closest('li')!;
    expect(row).not.toHaveTextContent('was');
    expect(within(row).getByLabelText('Rating 7.9')).toBeInTheDocument();
  });

  it('PC: dropping a row on another section moves it', async () => {
    setViewportWidth(1024);
    const { calls } = setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    const row = screen.getByText('Erased').closest('li')!;
    expect(row).toHaveAttribute('draggable', 'true');
    const target = section('Fine · 1');
    fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, getData: () => 'Erased', effectAllowed: '' } });
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: '' } });
    fireEvent.drop(target, { dataTransfer: { getData: () => 'Erased' } });
    expect(await screen.findByRole('heading', { name: 'Fine · 2' })).toBeInTheDocument();
    expect(within(section('Fine · 2')).getByText('Erased').closest('li')).toHaveTextContent('was Liked');
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    await waitFor(() => expect(saves(calls)).toEqual([{ picks: [], moves: [{ id: 'Erased', tier: 1 }], done: [] }]));
  });

  it('PC: the Move to… menu is the keyboard path, and the move is announced', async () => {
    setViewportWidth(1024);
    setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    const menu = await screen.findByRole('menu', { name: 'Move Erased to' });
    await userEvent.keyboard('{ArrowDown}{Enter}'); // Loved is first and has focus; the second item is Fine
    expect(menu).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fine · 2' })).toBeInTheDocument();
    expect(screen.getByText('Moved Erased to Fine.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Erased to…' })).toHaveFocus();
  });

  it('a failed save keeps the moves and shows the toast', async () => {
    const { calls } = setup({ save: { status: 500, body: { error: 'boom' } } });
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Fine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    expect(await screen.findByText("Couldn't save your moves. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save (1 moved)' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Fine · 2' })).toBeInTheDocument();
    expect(saves(calls)).toHaveLength(1);
  });

  it('a 409 is retried once through the existing save path', async () => {
    let n = 0;
    const rows = ROWS();
    const calls = mockApi(makeMe(), {
      'GET /api/entries': () => ({ body: rows }),
      'GET /api/ratings/:set': () => ({ body: { items: rows.map(setItem), comparisons: [] } }),
      'POST /api/ratings/:set/save': () => (++n === 1 ? { status: 409, body: { error: 'conflict' } } : { body: { items: [], entries: [] } }),
    });
    renderApp('/retier/anime');
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Fine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save (0 moved)' })).toBeDisabled());
    expect(saves(calls)).toHaveLength(2);
  });

  it('list chips switch the list', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    const chips = within(screen.getByRole('navigation', { name: 'Lists to re-tier' }));
    expect(chips.getByRole('link', { name: 'Anime' })).toHaveAttribute('aria-current', 'page');
    expect(chips.getByRole('link', { name: 'Movies' })).toHaveAttribute('href', '/retier/movies');
  });

  it('Settings links to the review, on the first enabled list, with its own icon', async () => {
    mockApi(makeMe({}, { anime: false }), { 'GET /api/entries': () => ({ body: [] }) });
    renderApp('/settings');
    const link = await screen.findByRole('link', { name: 'Re-tier review' });
    expect(link).toHaveAttribute('href', '/retier/movies');
    const icon = render(<Icon name="stats" />).container.innerHTML;
    expect(link.querySelector('svg')!.outerHTML).not.toBe(icon);
  });

  it('the route sends a disabled list to the first enabled one', async () => {
    mockApi(makeMe({}, { anime: false }), {
      'GET /api/entries': () => ({ body: [] }),
      'GET /api/ratings/:set': () => ({ body: { items: [], comparisons: [] } }),
    });
    const { router } = renderApp('/retier/anime');
    await waitFor(() => expect(router.state.location.pathname).toBe('/retier/movies'));
    const seasons = renderApp('/retier/anime_seasons');
    await waitFor(() => expect(seasons.router.state.location.pathname).toBe('/retier/movies'));
  });

  it('while a save is in flight the moves are locked, and nothing made after it is lost', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const rows = ROWS();
    mockApi(makeMe(), {
      'GET /api/entries': () => ({ body: rows }),
      'GET /api/ratings/:set': () => ({ body: { items: rows.map(setItem), comparisons: [] } }),
      'POST /api/ratings/:set/save': async () => { await gate; return { body: { items: [], entries: [] } }; },
    });
    setViewportWidth(1024);
    renderApp('/retier/anime');
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Fine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    expect(screen.getByRole('button', { name: 'Move Dorohedoro to…' })).toBeDisabled();
    expect(screen.getByText('Dorohedoro').closest('li')).toHaveAttribute('draggable', 'false');
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Dorohedoro to…' })).toBeEnabled());
  });

  it('if the reload after a save fails, the moves stay and an error says so', async () => {
    const rows = ROWS();
    let loads = 0;
    mockApi(makeMe(), {
      'GET /api/entries': () => ({ body: rows }),
      'GET /api/ratings/:set': () => (++loads === 1 ? { body: { items: rows.map(setItem), comparisons: [] } } : { status: 500, body: { error: 'boom' } }),
      'POST /api/ratings/:set/save': { body: { items: [], entries: [] } },
    });
    renderApp('/retier/anime');
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Fine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Saved, but couldn't reload/);
    expect(screen.getByRole('heading', { name: 'Fine · 2' })).toBeInTheDocument(); // the move is still on screen
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled(); // already saved: no second send
  });

  it('leaving with unsaved moves asks first: chips, Back and the nav; Keep editing stays, Discard goes', async () => {
    const { calls, router } = setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Fine/ }));
    const chips = within(screen.getByRole('navigation', { name: 'Lists to re-tier' }));
    await userEvent.click(chips.getByRole('link', { name: 'Movies' }));
    const ask = await screen.findByRole('dialog', { name: 'Discard your moves?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fine · 2' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard your moves?' })).getByRole('button', { name: 'Discard moves' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(saves(calls)).toHaveLength(0);
  });

  it('with no moves, leaving does not ask', async () => {
    const { router } = setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    const chips = within(screen.getByRole('navigation', { name: 'Lists to re-tier' }));
    await userEvent.click(chips.getByRole('link', { name: 'Movies' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/retier/movies'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('PC: the dragged row is marked while it is dragged, and not after', async () => {
    setViewportWidth(1024);
    setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    const row = screen.getByText('Erased').closest('li')!;
    fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, getData: () => 'Erased', effectAllowed: '' } });
    expect(row).toHaveClass('is-dragging');
    fireEvent.dragEnd(row);
    expect(row).not.toHaveClass('is-dragging');
  });

  it('a save that conflicts twice keeps the moves and says the ratings changed elsewhere', async () => {
    const { calls } = setup({ save: { status: 409, body: { error: 'conflict' } } });
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Fine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    expect(await screen.findByText(/Your ratings changed elsewhere\. Your moves are still here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save (1 moved)' })).toBeEnabled();
    expect(saves(calls).length).toBeGreaterThan(0);
  });

  it('season chips: Anime Seasons loads its own set and saves against it', async () => {
    const seasonRows = [rated('Akira S1', 9.4), rated('Akira S2', 6.2)];
    const calls = mockApi(makeMe(), {
      'GET /api/entries': () => ({ body: ROWS() }),
      'GET /api/ratings/anime': () => ({ body: { items: ROWS().map(setItem), comparisons: [] } }),
      'GET /api/ratings/anime_seasons': () => ({ body: { items: seasonRows.map(setItem), comparisons: [] } }),
      'POST /api/ratings/:set/save': { body: { items: [], entries: [] } },
    });
    renderApp('/retier/anime');
    await screen.findByRole('heading', { name: 'Liked · 2' });
    const chips = within(screen.getByRole('navigation', { name: 'Lists to re-tier' }));
    expect(chips.getByRole('link', { name: 'Anime Seasons' })).toHaveAttribute('href', '/retier/anime_seasons');
    expect(chips.getByRole('link', { name: 'TV Seasons' })).toHaveAttribute('href', '/retier/tv_seasons');
    await userEvent.click(chips.getByRole('link', { name: 'Anime Seasons' }));
    await screen.findByRole('heading', { name: 'Loved · 1' });
    expect(screen.getByRole('heading', { name: 'Fine · 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move Akira S2 to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Liked/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save (1 moved)' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/ratings/anime_seasons/save')).toBe(true));
  });

  it('an empty set says what to do; a load error offers Retry', async () => {
    let fail = true;
    mockApi(makeMe(), {
      'GET /api/entries': () => ({ body: [] }),
      'GET /api/ratings/:set': () => (fail ? { status: 500, body: { error: 'boom' } } : { body: { items: [], comparisons: [] } }),
    });
    renderApp('/retier/anime');
    expect(await screen.findByText("Couldn't load your ratings")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nothing to check yet')).toBeInTheDocument();
    expect(screen.getByText(/Rate a few, then come back/)).toBeInTheDocument();
  });

  it('phone: after a move from the sheet, focus is on the row\'s Move button and the move is announced', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Liked · 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Erased to…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Fine/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Erased to…' })).toHaveFocus());
    expect(screen.getByText('Moved Erased to Fine.')).toHaveAttribute('role', 'status');
  });
});
