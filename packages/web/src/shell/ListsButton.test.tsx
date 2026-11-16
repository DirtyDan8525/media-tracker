import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '../db/local';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

beforeEach(() => localStorage.clear());

const listsButton = () => screen.findByRole('button', { name: 'Lists' });
const rowNames = (nav: HTMLElement) =>
  within(nav).getAllByRole('link').map((a) => a.querySelector('.lists-menu__label')?.textContent);

describe('Lists button (phone)', () => {
  it('button "Lists" has aria-expanded false→true; the Lists nav shows every enabled list with counts and marks the current one', async () => {
    await localDb.entries.bulkPut([
      makeEntry({ id: 'a1', category: 'anime' }), makeEntry({ id: 'a2', category: 'anime' }),
      makeEntry({ id: 'b1', category: 'books' }),
    ]);
    fakeBackend({ me: makeMe({}, { songs: false }) });
    renderApp('/list/movies');
    await screen.findByRole('heading', { level: 1, name: 'Movies' });
    const button = await listsButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const nav = screen.getByRole('navigation', { name: 'Lists' });
    expect(button).toHaveAttribute('aria-controls', nav.id);
    expect(rowNames(nav)).toEqual(['Anime', 'Movies', 'TV Shows', 'Albums', 'Games', 'Books']);
    const anime = within(nav).getByRole('link', { name: /^Anime/ });
    expect(anime).toHaveAttribute('href', '/list/anime');
    expect(anime).toHaveTextContent('2');
    expect(within(nav).getByRole('link', { name: /^Books/ })).toHaveTextContent('1');
    const current = within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.getAttribute('href'))).toEqual(['/list/movies']);
    // focus moves into the menu, onto the current list
    expect(within(nav).getByRole('link', { name: /^Movies/ })).toHaveFocus();
  });

  it('on a non-list screen the current list (last shown) is the one marked', async () => {
    localStorage.setItem('mt-current-list', 'tv');
    fakeBackend({ extra: { 'GET /api/activity': { body: { items: [], next: null } } } });
    renderApp('/activity');
    await userEvent.click(await listsButton());
    const nav = screen.getByRole('navigation', { name: 'Lists' });
    expect(within(nav).getByRole('link', { name: /^TV Shows/ })).toHaveAttribute('aria-current', 'page');
  });

  it('choosing Books navigates and closes', async () => {
    fakeBackend({ entries: [makeEntry({ category: 'books', title: 'Dune' })] });
    const { router } = renderApp('/list/anime');
    await screen.findByRole('heading', { level: 1, name: 'Anime' });
    const button = await listsButton();
    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Lists' })).getByRole('link', { name: /^Books/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/books'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Books' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('Escape closes and refocuses the button', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const button = await listsButton();
    await userEvent.click(button);
    expect(screen.getByRole('navigation', { name: 'Lists' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('pressing the button again closes the menu', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const button = await listsButton();
    await userEvent.click(button);
    await userEvent.click(button);
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('a tap on the backdrop closes', async () => {
    fakeBackend();
    const { router } = renderApp('/list/anime');
    const button = await listsButton();
    await userEvent.click(button);
    const backdrop = document.querySelector<HTMLElement>('.lists-backdrop')!;
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(backdrop);
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(router.state.location.pathname).toBe('/list/anime');
  });

  it('not rendered on /entry/:id', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'e-1', title: 'Frieren' })] });
    renderApp('/entry/e-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Frieren' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lists' })).not.toBeInTheDocument();
  });

  it('PC has no Lists button (the side nav lists them)', async () => {
    setViewportWidth(1280);
    fakeBackend();
    renderApp('/list/anime');
    await screen.findByRole('heading', { level: 1, name: 'Anime' });
    expect(screen.queryByRole('button', { name: 'Lists' })).not.toBeInTheDocument();
  });
});
