import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '../db/local';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

beforeEach(() => localStorage.clear());

const trigger = (name = 'Anime') => screen.findByRole('button', { name });

describe('list title dropdown (phone and PC)', () => {
  it('the h1 holds a menu button named for the list; the menu lists every enabled list with counts and marks the current one', async () => {
    await localDb.entries.bulkPut([
      makeEntry({ id: 'a1', category: 'anime' }), makeEntry({ id: 'a2', category: 'anime' }), makeEntry({ id: 'b1', category: 'books' }),
    ]);
    fakeBackend({ me: makeMe({}, { songs: false }) });
    renderApp('/list/movies');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Movies' });
    const button = within(heading).getByRole('button', { name: 'Movies' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Switch list' });
    expect(button).toHaveAttribute('aria-controls', menu.id);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.querySelector('.list-menu__label')?.textContent)).toEqual(['Anime', 'Movies', 'TV Shows', 'Albums', 'Games', 'Books']);
    expect(within(menu).getByRole('menuitem', { name: /^Anime/ })).toHaveTextContent('2');
    expect(within(menu).getByRole('menuitem', { name: /^Books/ })).toHaveTextContent('1');
    expect(items.filter((i) => i.getAttribute('aria-current') === 'true').map((i) => i.getAttribute('href'))).toEqual(['/list/movies']);
    expect(items[1]).toHaveFocus(); // focus lands on the current list
  });

  it('choosing a list navigates and remembers it', async () => {
    fakeBackend({ entries: [makeEntry({ category: 'books', title: 'Dune' })] });
    const { router } = renderApp('/list/anime');
    await userEvent.click(await trigger());
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Books/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/books'));
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(localStorage.getItem('mt-current-list')).toBe('books');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keyboard: Enter opens, arrows wrap, Home/End jump, Escape closes and focus returns to the trigger', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const button = await trigger();
    button.focus();
    await userEvent.keyboard('{Enter}');
    const items = () => within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items()[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items()[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(items()[items().length - 1]).toHaveFocus(); // wrapped
    await userEvent.keyboard('{Home}');
    expect(items()[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(items()[items().length - 1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('ArrowDown on the closed trigger opens the menu; a tap outside closes it', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const button = await trigger();
    button.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('the trigger and items carry the 44 px tap-target classes', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const button = await trigger();
    expect(button).toHaveClass('list-menu__trigger');
    await userEvent.click(button);
    for (const i of within(screen.getByRole('menu')).getAllByRole('menuitem')) expect(i).toHaveClass('list-menu__item');
  });
});
