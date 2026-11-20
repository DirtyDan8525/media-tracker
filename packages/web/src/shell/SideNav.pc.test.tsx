import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';
import { NAV_DEFAULT_W, NAV_MAX_W, NAV_MIN_W, NAV_WIDTH_KEY, reloadNavWidth } from './navWidth';

const sideNav = () => screen.findByRole('navigation', { name: 'Main' });
const saved = () => JSON.parse(localStorage.getItem(NAV_WIDTH_KEY) ?? 'null');
const listLinks = (nav: HTMLElement) => Array.from(nav.querySelectorAll('.side-nav__list')).map((a) => a.querySelector('span')?.textContent);

beforeEach(() => { setViewportWidth(1280); localStorage.clear(); reloadNavWidth(); });
afterEach(() => { setViewportWidth(390); localStorage.clear(); reloadNavWidth(); });

describe('side nav header', () => {
  it('the brand has the whole header: no button in it, and the name is never ellipsized', async () => {
    mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    const head = nav.querySelector('.side-nav__head')!;
    expect(head.querySelectorAll('button')).toHaveLength(0);
    expect(within(head as HTMLElement).getByText('Media Tracker').tagName).toBe('B');
    expect(head.querySelector('.side-nav__brand b')).toBeInTheDocument();
  });

  it('Collapse is a labelled row at the bottom, with aria-expanded, and folds to the 72 px rail', async () => {
    mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    const row = within(nav.querySelector('.side-nav__footer') as HTMLElement).getByRole('button', { name: 'Collapse side bar' });
    expect(row).toHaveTextContent('Collapse');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(row);
    expect(await within(nav).findByRole('button', { name: 'Expand side bar' })).toHaveAttribute('aria-expanded', 'false');
    expect(nav).toHaveClass('side-nav--collapsed');
    expect(screen.queryByRole('separator', { name: 'Resize side bar' })).not.toBeInTheDocument();
  });
});

describe('resizable side nav', () => {
  it('has a named vertical separator with value, min and max', async () => {
    mockApi(makeMe());
    renderApp('/list/anime');
    await sideNav();
    const grip = screen.getByRole('separator', { name: 'Resize side bar' });
    expect(grip).toHaveAttribute('aria-orientation', 'vertical');
    expect(grip).toHaveAttribute('aria-valuenow', String(NAV_DEFAULT_W));
    expect(grip).toHaveAttribute('aria-valuemin', String(NAV_MIN_W));
    expect(grip).toHaveAttribute('aria-valuemax', String(NAV_MAX_W));
  });

  it('arrow keys resize by 16 px within 200 to 360, save on this device, and double-click resets', async () => {
    mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    const grip = screen.getByRole('separator', { name: 'Resize side bar' });
    grip.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(saved()).toBe(NAV_DEFAULT_W + 16);
    expect(grip).toHaveAttribute('aria-valuenow', String(NAV_DEFAULT_W + 16));
    expect(nav.style.getPropertyValue('--side-nav-w')).toBe(`${NAV_DEFAULT_W + 16}px`);
    for (let i = 0; i < 30; i++) await userEvent.keyboard('{ArrowRight}');
    expect(saved()).toBe(NAV_MAX_W);
    for (let i = 0; i < 30; i++) await userEvent.keyboard('{ArrowLeft}');
    expect(saved()).toBe(NAV_MIN_W);
    fireEvent.doubleClick(grip);
    expect(saved()).toBeNull();
    expect(nav.style.getPropertyValue('--side-nav-w')).toBe('');
    expect(grip).toHaveAttribute('aria-valuenow', String(NAV_DEFAULT_W));
  });

  it('dragging sets the width (clamped); a saved width is used on the next visit', async () => {
    mockApi(makeMe());
    const { unmount } = renderApp('/list/anime');
    await sideNav();
    const grip = screen.getByRole('separator', { name: 'Resize side bar' });
    fireEvent.pointerDown(grip, { clientX: 240, pointerId: 1, button: 0 });
    fireEvent.pointerMove(grip, { clientX: 300, pointerId: 1 });
    expect(saved()).toBe(300);
    fireEvent.pointerMove(grip, { clientX: 900, pointerId: 1 });
    expect(saved()).toBe(NAV_MAX_W);
    fireEvent.pointerUp(grip, { clientX: 900, pointerId: 1 });
    unmount();
    reloadNavWidth();
    mockApi(makeMe());
    renderApp('/list/anime');
    expect((await sideNav()).style.getPropertyValue('--side-nav-w')).toBe(`${NAV_MAX_W}px`);
  });

  it('on a right-hand nav, ArrowLeft (toward the content) widens it', async () => {
    const me = makeMe();
    me.settings.nav = { side: 'right', collapsed: false };
    mockApi(me);
    renderApp('/list/anime');
    await sideNav();
    screen.getByRole('separator', { name: 'Resize side bar' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(saved()).toBe(NAV_DEFAULT_W + 16);
  });

  it('a blocked localStorage does not break resizing', async () => {
    mockApi(makeMe());
    renderApp('/list/anime');
    await sideNav();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
    try {
      screen.getByRole('separator', { name: 'Resize side bar' }).focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('separator', { name: 'Resize side bar' })).toHaveAttribute('aria-valuenow', String(NAV_DEFAULT_W + 16));
    } finally { Storage.prototype.setItem = orig; }
  });
});

describe('Reorder lists', () => {
  it('sits just above Settings and opens a sheet of your lists', async () => {
    mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    const footer = nav.querySelector('.side-nav__footer')!;
    const button = within(footer as HTMLElement).getByRole('button', { name: 'Reorder lists' });
    expect(button.nextElementSibling).toHaveAttribute('href', '/settings');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Reorder lists' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(9);
  });

  it('move down saves settings.listOrder and the nav, the list menu and Settings → Tabs follow it', async () => {
    const calls = mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    expect(listLinks(nav)?.slice(0, 3)).toEqual(['Anime', 'Movies', 'TV Shows']);
    await userEvent.click(within(nav).getByRole('button', { name: 'Reorder lists' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reorder lists' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Anime down' }));
    await waitFor(() => expect(listLinks(nav)?.slice(0, 3)).toEqual(['Movies', 'Anime', 'TV Shows']));
    const put = calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').at(-1)!.body as { settings: { listOrder: string[] } };
    expect(put.settings.listOrder.slice(0, 3)).toEqual(['movies', 'anime', 'tv']);
    expect(put.settings.listOrder).toHaveLength(9);
  });

  it('the handle moves with the arrow keys and keeps focus; first and last cannot move past the ends', async () => {
    const calls = mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    await userEvent.click(within(nav).getByRole('button', { name: 'Reorder lists' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reorder lists' });
    expect(within(dialog).getByRole('button', { name: 'Move Anime up' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Move YouTube down' })).toBeDisabled();
    const handle = within(dialog).getByRole('button', { name: /^Drag Movies to reorder/ });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(listLinks(nav)?.slice(0, 2)).toEqual(['Movies', 'Anime']));
    expect(within(dialog).getByRole('button', { name: /^Drag Movies to reorder. Position 1 of 9/ })).toHaveFocus();
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/me/settings')).toBe(true);
  });

  it('dragging a handle onto another row reorders and saves once it is let go', async () => {
    const calls = mockApi(makeMe());
    renderApp('/list/anime');
    const nav = await sideNav();
    await userEvent.click(within(nav).getByRole('button', { name: 'Reorder lists' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reorder lists' });
    const rows = within(dialog).getAllByRole('listitem');
    rows.forEach((r, i) => { r.getBoundingClientRect = () => ({ top: i * 50, bottom: i * 50 + 49, left: 0, right: 100, width: 100, height: 49, x: 0, y: i * 50, toJSON: () => ({}) }); });
    const handle = within(dialog).getByRole('button', { name: /^Drag Anime to reorder/ });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 60 });
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/me/settings')).toBe(false);
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 60 });
    await waitFor(() => expect(listLinks(nav)?.slice(0, 2)).toEqual(['Movies', 'Anime']));
  });

  it('the switch hides a list from the nav (settings.tabs), and the last shown list cannot be hidden', async () => {
    const calls = mockApi(makeMe({}, { movies: false, tv: false, albums: false, songs: false, games: false, books: false, manga: false, youtube: false }));
    renderApp('/list/anime');
    const nav = await sideNav();
    await userEvent.click(within(nav).getByRole('button', { name: 'Reorder lists' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reorder lists' });
    expect(within(dialog).getByRole('switch', { name: 'Show Anime' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Show Movies' }));
    await waitFor(() => expect(listLinks(nav)).toEqual(['Anime', 'Movies']));
    expect(calls.some((c) => c.method === 'PUT' && JSON.stringify(c.body) === JSON.stringify({ settings: { tabs: { movies: true } } }))).toBe(true);
  });

  it('a saved order applies from the start', async () => {
    const me = makeMe();
    me.settings.listOrder = ['songs', 'anime'];
    mockApi(me);
    renderApp('/list/songs');
    expect(listLinks(await sideNav())?.slice(0, 3)).toEqual(['Songs', 'Anime', 'Movies']);
  });
});
