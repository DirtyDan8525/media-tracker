import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

const entries = () => [
  makeEntry({ id: 'a1', title: 'Frieren', rating: 9.5, status: 'Completed', tags: ['With Ren', 'Comfy'], startedAt: '2025-09-29', finishedAt: '2026-03-22', rewatches: 2 }),
  makeEntry({ id: 'a2', title: 'Bebop', rating: 9, status: 'Completed' }),
];
const stored = () => JSON.parse(localStorage.getItem('mt-columns:anime') ?? 'null');
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

beforeEach(() => { setViewportWidth(1280); localStorage.clear(); });
afterEach(() => { setViewportWidth(390); localStorage.clear(); });

describe('Columns menu (PC table)', () => {
  it('starts with the extra columns off and lists the five choices', async () => {
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    for (const c of ['Tags', 'Started', 'Finished', 'Rewatches', 'Airing']) expect(headers()).not.toContain(c);
    const button = screen.getByRole('button', { name: 'Columns' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    const group = screen.getByRole('group', { name: 'Show columns' });
    expect(within(group).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Tags', 'Started', 'Finished', 'Rewatches', 'Airing']);
    for (const box of within(group).getAllByRole('checkbox')) expect(box).not.toBeChecked();
  });

  it('switching columns on shows them before Notes, with the values, and remembers them per list', async () => {
    fakeBackend({ entries: entries() });
    const { unmount } = renderApp('/list/anime');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tags' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Started' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rewatches' }));
    expect(stored()).toEqual(['tags', 'started', 'rewatches']);
    const hs = headers();
    expect(hs.slice(-4)).toEqual(['Tags', 'Started', 'Rewatches', 'Notes']);
    const row = screen.getByRole('link', { name: 'Frieren' }).closest('tr')!;
    expect(within(row).getByText('With Ren')).toBeInTheDocument();
    expect(within(row).getByText('Sep 29, 2025')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    unmount();
    renderApp('/list/anime');
    await screen.findByRole('table');
    expect(headers().slice(-4)).toEqual(['Tags', 'Started', 'Rewatches', 'Notes']);
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tags' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Started' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rewatches' }));
    expect(localStorage.getItem('mt-columns:anime')).toBeNull();
  });

  it('Escape closes the menu and returns focus to its button; Airing is only offered on anime and TV', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'm1', category: 'movies', title: 'Heat', rating: 8 })] });
    renderApp('/list/movies');
    await screen.findByRole('table');
    const button = screen.getByRole('button', { name: 'Columns' });
    await userEvent.click(button);
    expect(screen.queryByRole('checkbox', { name: 'Airing' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Show columns' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('survives unreadable saved choices', async () => {
    localStorage.setItem('mt-columns:anime', '{nope');
    fakeBackend({ entries: entries() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    expect(headers()).not.toContain('Tags');
  });

  it('shows an airing word for a TV title', async () => {
    localStorage.setItem('mt-columns:tv', JSON.stringify(['airing']));
    fakeBackend({ entries: [makeEntry({ id: 't1', category: 'tv', title: 'Severance', rating: 9, lengthLabel: '50 min episodes · Running' })] });
    renderApp('/list/tv');
    await screen.findByRole('table');
    expect(screen.getByText('Still airing')).toBeInTheDocument();
  });
});
