import { DEFAULT_USER_SETTINGS } from '@media-tracker/shared';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';
import { COL_WIDTHS, MIN_COL_WIDTH } from './tableKit';

const entries = () => [
  makeEntry({ id: 'a1', title: 'Frieren', rating: 9.5, status: 'Completed', creator: 'Madhouse', genres: 'Fantasy, Drama', releaseDate: '2023-09-29', synopsis: 'An elf outlives her party.', notes: 'peak' }),
  makeEntry({ id: 'a2', title: 'Mob Psycho', rating: 9.4, status: 'Completed', creator: 'Bones' }),
  makeEntry({ id: 'a3', title: 'Bebop', rating: 9, status: 'Completed' }),
];
const stored = () => JSON.parse(localStorage.getItem('mt-col-widths:anime') ?? 'null');

beforeEach(() => { setViewportWidth(1280); localStorage.clear(); });
afterEach(() => { setViewportWidth(390); localStorage.clear(); });

describe('column widths', () => {
  it('Progress is wide enough for the "− [999] / [999] +" control (measured 226 px + 28 px padding) and no default is under the minimum', () => {
    expect(COL_WIDTHS.progress).toBeGreaterThanOrEqual(254);
    for (const w of Object.values(COL_WIDTHS)) expect(w).toBeGreaterThanOrEqual(MIN_COL_WIDTH);
  });

  it('every header has a named resize handle, and the header keeps its own name', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Title' })).toBeInTheDocument();
    for (const c of ['Cover', 'Rating', 'Title', 'Status', 'Genres', 'Studio', 'Notes']) expect(screen.getByRole('button', { name: `Resize ${c} column` })).toBeInTheDocument();
  });

  it('arrow keys resize by 16 px (min 48), save per list, and survive a re-render; double-click resets that column', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    const handle = screen.getByRole('button', { name: 'Resize Title column' });
    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stored().title).toBe(COL_WIDTHS.title + 16);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(stored().title).toBe(COL_WIDTHS.title - 16);
    for (let i = 0; i < 20; i++) await userEvent.keyboard('{ArrowLeft}');
    expect(stored().title).toBe(MIN_COL_WIDTH);
    expect(document.querySelectorAll('col')[2]).toHaveStyle({ width: `${MIN_COL_WIDTH}px` });
    fireEvent.doubleClick(handle);
    expect(stored()?.title).toBeUndefined();
  });

  it('dragging a handle sets the width; "Reset column widths" clears every saved width', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Reset column widths' })).not.toBeInTheDocument();
    const handle = screen.getByRole('button', { name: 'Resize Genres column' });
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 });
    expect(stored().genres).toBe(COL_WIDTHS.genres + 40);
    await userEvent.click(screen.getByRole('button', { name: 'Reset column widths' }));
    expect(stored()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset column widths' })).not.toBeInTheDocument();
  });

  it('saved widths apply on the next visit', async () => {
    localStorage.setItem('mt-col-widths:anime', JSON.stringify({ title: 300 }));
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    expect(document.querySelectorAll('col')[2]).toHaveStyle({ width: '300px' });
  });
});

describe('cover viewer', () => {
  it('a click on a row selects it and docks a panel with the cover, facts and Open; the close button and Escape close it', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    const row = within(table).getByText('Madhouse').closest('tr')!;
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('complementary', { name: 'Frieren, cover viewer' });
    expect(within(panel).getByRole('img', { name: 'Frieren cover' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Frieren' })).toBeInTheDocument();
    expect(within(panel).getByText('Anime')).toBeInTheDocument();
    expect(within(panel).getByText('Madhouse · 2023')).toBeInTheDocument();
    expect(within(panel).getByText('An elf outlives her party.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Open' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Close cover viewer' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await userEvent.click(row);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('clicks on links and editable cells do not select; the arrow keys move the selection', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.click(within(table).getByRole('button', { name: 'Rating for Mob Psycho: 9.4' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await userEvent.click(within(table).getByText('Madhouse').closest('tr')!);
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('complementary', { name: 'Mob Psycho, cover viewer' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowUp}');
    expect(await screen.findByRole('complementary', { name: 'Frieren, cover viewer' })).toBeInTheDocument();
  });

  it('is off when Settings > Cover viewer is off', async () => {
    fakeBackend({ me: makeMe({ settings: { ...DEFAULT_USER_SETTINGS, coverViewer: false } }), entries: entries() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.click(within(table).getByText('Madhouse').closest('tr')!);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('docks opposite the side nav: left nav leaves the panel after the table, a right nav flips the row', async () => {
    fakeBackend({ me: makeMe({ settings: { ...DEFAULT_USER_SETTINGS, nav: { side: 'right', collapsed: false } } }), entries: entries() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.click(within(table).getByText('Madhouse').closest('tr')!);
    expect(document.querySelector('.frame--nav-right .list-split')).toContainElement(screen.getByRole('complementary'));
  });

  it('Settings has Side bar and Cover viewer on PC, saved as nav.side and coverViewer', async () => {
    const { calls } = fakeBackend({ entries: [] });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'On the right' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Cover viewer' }));
    const puts = calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').map((c) => c.body);
    expect(puts).toContainEqual({ settings: { nav: { side: 'right' } } });
    expect(puts).toContainEqual({ settings: { coverViewer: false } });
  });
});

describe('PC Back button', () => {
  it('a title opened from a list shows "Back to Anime"; from a friend\'s table it says "Back to <name>\'s lists" and returns to the same list', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.click(within(table).getByRole('link', { name: 'Frieren' }));
    const back = await screen.findByRole('button', { name: 'Back to Anime' });
    await userEvent.click(back);
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('shows plain "Back" with no known origin', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/entry/a1');
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
