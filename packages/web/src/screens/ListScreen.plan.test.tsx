import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const planned = (title: string, planOrder: number | null, over = {}) =>
  makeEntry({ title, status: 'Plan to watch', planOrder, rating: null, genres: 'Action', ...over });
const done = (title: string, rating: number, over = {}) => makeEntry({ title, status: 'Completed', rating, genres: 'Action', ...over });

const titles = () => Array.from(document.querySelectorAll('[aria-label$=" list"] [data-role="title"]')).map((t) => t.textContent);
const orderCalls = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PUT' && c.path === '/api/entries/plan-order').map((c) => c.body);
const putOrder = () => ({ 'PUT /api/entries/plan-order': { status: 204 } });

beforeEach(() => {
  localStorage.clear();
  setViewportWidth(390);
});

describe('compact filters (phone)', () => {
  const rows = () => fakeBackend({ entries: [
    done('Frieren', 9, { genres: 'Fantasy, Adventure' }), done('Bleach', 8, { status: 'Dropped', genres: 'Action' }),
    done('Pokémon', 7, { status: 'On Hold', genres: 'Adventure' }), planned('Dungeon Meshi', 1),
  ] });

  it('the Filters button counts active filters, chips remove them', async () => {
    rows();
    renderApp('/list/anime?status=Dropped&genre=Action');
    await screen.findByText('Bleach');
    expect(titles()).toEqual(['Bleach']);
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Dropped' }));
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove filter Dropped' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Action' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(titles()).toHaveLength(4);
  });

  it('the sheet: Status and Genres chips filter live, "Show N" counts, Clear resets', async () => {
    rows();
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByRole('button', { name: 'Show 4' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Dropped' }));
    expect(within(sheet).getByRole('button', { name: 'Dropped' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Show 1' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'All' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Adventure' }));
    expect(within(sheet).getByRole('button', { name: 'Show 2' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Clear' }));
    expect(within(sheet).getByRole('button', { name: 'Show 4' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Dropped' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show 1' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(titles()).toEqual(['Bleach']);
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toHaveFocus();
  });

  it('a list without a Status column has no Plan to watch switch and no Status in the sheet', async () => {
    fakeBackend({ entries: [makeEntry({ category: 'albums', title: 'Heat', rating: 8, genres: 'Crime', status: null })] });
    renderApp('/list/albums');
    await screen.findByText('Heat');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(sheet).queryByText('Status')).not.toBeInTheDocument();
    expect(within(sheet).getByText('Genres')).toBeInTheDocument();
  });

  it('PC keeps its wider layout and has the switch', async () => {
    setViewportWidth(1200);
    rows();
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    expect(screen.getByRole('searchbox', { name: 'Filter Anime' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Plan to watch' })).toBeInTheDocument();
  });

  it('games say Plan to play', async () => {
    fakeBackend({ entries: [makeEntry({ category: 'games', title: 'Celeste', status: 'Plan to watch', planOrder: 1 })] });
    renderApp('/list/games');
    await screen.findByText('Celeste');
    expect(screen.getByRole('switch', { name: 'Plan to play' })).toBeInTheDocument();
  });
});

describe('Plan to watch view', () => {
  const rows = () => fakeBackend({ extra: putOrder(), entries: [
    done('Frieren', 9), planned('Vinland Saga S2', 2), planned('Dungeon Meshi', 1), planned('Kaiju No. 8', 3),
    planned('Placed Later', null, { createdAt: '2026-05-01T00:00:00Z' }),
  ] });

  it('the switch shows only planned titles in plan order, with positions, "Up next" and no rating badge', async () => {
    rows();
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
    expect(screen.getByRole('switch', { name: 'Plan to watch' })).toHaveAttribute('aria-checked', 'true');
    expect(titles()).toEqual(['Dungeon Meshi', 'Vinland Saga S2', 'Kaiju No. 8', 'Placed Later']);
    expect(screen.getByText('4 planned · your watch order')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Anime list' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Up next');
    expect(items[0]).toHaveTextContent('Position 1');
    expect(items[1]).not.toHaveTextContent('Up next');
    expect(screen.getAllByText('Up next')).toHaveLength(1);
    expect(screen.queryByText(/^\d+\.\d$/)).not.toBeInTheDocument(); // no rating badges
    expect(screen.getByRole('button', { name: 'Reorder Dungeon Meshi' })).toBeInTheDocument();
    // off again: everything, sorted as before
    await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
    expect(titles()).toHaveLength(5);
    expect(titles()[0]).toBe('Frieren');
  });

  it('remembers the switch per list on this device', async () => {
    rows();
    const first = renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
    expect(localStorage.getItem('mt:plan-view:anime')).toBe('1');
    first.unmount();
    renderApp('/list/anime');
    await screen.findByText('Dungeon Meshi');
    expect(screen.getByRole('switch', { name: 'Plan to watch' })).toHaveAttribute('aria-checked', 'true');
    expect(titles()).not.toContain('Frieren');
  });

  it('works when storage throws', async () => {
    rows();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('denied'); };
    try {
      renderApp('/list/anime');
      await screen.findByText('Frieren');
      await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
      expect(titles()).toHaveLength(4);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('shows an empty state when nothing is planned', async () => {
    fakeBackend({ entries: [done('Frieren', 9)] });
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument();
  });

  it('the Filters sheet in this view has Genres but no Status or Sort', async () => {
    rows();
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByText('Genres')).toBeInTheDocument();
    expect(within(sheet).queryByText('Status')).not.toBeInTheDocument();
    expect(within(sheet).queryByText('Sort')).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Show 4' })).toBeInTheDocument();
  });

  describe('reordering', () => {
    const open = async () => {
      const backend = rows();
      renderApp('/list/anime');
      await screen.findByText('Frieren');
      await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
      return backend;
    };

    it('⋯ menu: Move down saves the whole order and the row moves', async () => {
      const { calls } = await open();
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Dungeon Meshi' }));
      const menu = screen.getByRole('menu', { name: 'Move Dungeon Meshi' });
      expect(within(menu).getByRole('menuitem', { name: 'Move to top' })).toBeDisabled();
      expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
      expect(titles()).toEqual(['Vinland Saga S2', 'Dungeon Meshi', 'Kaiju No. 8', 'Placed Later']);
      await waitFor(() => expect(orderCalls(calls)).toHaveLength(1));
      const ids = (orderCalls(calls)[0] as { category: string; ids: string[] });
      expect(ids.category).toBe('anime');
      expect(ids.ids).toHaveLength(4);
      expect(screen.getByText('Moved Dungeon Meshi to position 2 of 4')).toBeInTheDocument();
      // focus is back on the same row's ⋯ button
      expect(screen.getByRole('button', { name: 'More actions for Dungeon Meshi' })).toHaveFocus();
    });

    it('⋯ menu: Move to top, and Move down is disabled on the last row', async () => {
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Kaiju No. 8' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move to top' }));
      expect(titles()).toEqual(['Kaiju No. 8', 'Dungeon Meshi', 'Vinland Saga S2', 'Placed Later']);
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Placed Later' }));
      expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'More actions for Placed Later' })).toHaveFocus();
    });

    it('keyboard: arrow keys on the handle move the row', async () => {
      const { calls } = await open();
      screen.getByRole('button', { name: 'Reorder Vinland Saga S2' }).focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(titles()).toEqual(['Vinland Saga S2', 'Dungeon Meshi', 'Kaiju No. 8', 'Placed Later']);
      await userEvent.keyboard('{ArrowUp}'); // already first: nothing more to save
      await userEvent.keyboard('{End}');
      expect(titles()).toEqual(['Dungeon Meshi', 'Kaiju No. 8', 'Placed Later', 'Vinland Saga S2']);
      await waitFor(() => expect(orderCalls(calls).length).toBeGreaterThanOrEqual(1));
      await waitFor(() => expect((orderCalls(calls).at(-1) as { ids: string[] }).ids).toHaveLength(4));
      expect(screen.getByRole('button', { name: 'Reorder Vinland Saga S2' })).toHaveFocus();
    });

    it('dragging the handle past the next row drops it there', async () => {
      const { calls } = await open();
      const rowEls = within(screen.getByRole('list', { name: 'Anime list' })).getAllByRole('listitem');
      rowEls.forEach((li) => { li.getBoundingClientRect = () => ({ height: 70, top: 0, bottom: 70, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) }); });
      const handle = screen.getByRole('button', { name: 'Reorder Dungeon Meshi' });
      fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'touch', clientY: 100, button: 0 });
      fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'touch', clientY: 250 });
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch', clientY: 250 });
      await waitFor(() => expect(titles()).toEqual(['Vinland Saga S2', 'Kaiju No. 8', 'Dungeon Meshi', 'Placed Later']));
      await waitFor(() => expect(orderCalls(calls)).toHaveLength(1));
    });

    it('a drag that ends where it started saves nothing', async () => {
      const { calls } = await open();
      const handle = screen.getByRole('button', { name: 'Reorder Dungeon Meshi' });
      fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', clientY: 100, button: 0 });
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse', clientY: 100 });
      expect(titles()[0]).toBe('Dungeon Meshi');
      expect(orderCalls(calls)).toHaveLength(0);
    });

    it('a failed save puts the old order back and says so', async () => {
      const backend = fakeBackend({ extra: { 'PUT /api/entries/plan-order': { status: 500, body: { error: 'boom' } } }, entries: [
        planned('One', 1), planned('Two', 2),
      ] });
      void backend;
      renderApp('/list/anime');
      await screen.findByText('One');
      await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
      await userEvent.click(screen.getByRole('button', { name: 'More actions for One' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
      expect(await screen.findByText("Couldn't save the new order")).toBeInTheDocument();
      expect(titles()).toEqual(['One', 'Two']);
    });

    it('while a search or genre filter hides titles, nothing can be moved but positions stay true', async () => {
      await open();
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search Anime' }), 'kaiju');
      await waitFor(() => expect(titles()).toEqual(['Kaiju No. 8']));
      const li = within(screen.getByRole('list', { name: 'Anime list' })).getAllByRole('listitem')[0]!;
      expect(li).toHaveTextContent('Position 3');
      expect(screen.queryByRole('button', { name: /^Reorder/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument();
      expect(screen.getByText('Clear the search and filters to change the order.')).toBeInTheDocument();
    });
  });

  it('PC: the switch shows the same planned list', async () => {
    setViewportWidth(1200);
    fakeBackend({ extra: putOrder(), entries: [done('Frieren', 9), planned('Dungeon Meshi', 1)] });
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('switch', { name: 'Plan to watch' }));
    expect(titles()).toEqual(['Dungeon Meshi']);
    expect(screen.queryByRole('combobox', { name: 'Sort' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
  });
});
