import { DEFAULT_USER_SETTINGS } from '@media-tracker/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

beforeEach(() => { setViewportWidth(1280); localStorage.clear(); });
afterEach(() => { setViewportWidth(390); localStorage.clear(); });

const anime = () => [
  makeEntry({ id: 'a1', title: 'Frieren', rating: 9.5, status: 'Completed', creator: 'Madhouse' }),
  makeEntry({ id: 'a2', title: 'Mob Psycho', rating: 9.4, status: 'Completed', creator: 'Bones' }),
];
const rowOf = (table: HTMLElement, text: string) => within(table).getByText(text).closest('tr')!;

describe('cover viewer: on by default, shown on hover and focus', () => {
  it('is on for everyone who has not changed it', () => {
    expect(DEFAULT_USER_SETTINGS.coverViewer).toBe(true);
  });

  it('hovering a row shows that title after a short pause, not at once; moving away before it settles shows nothing', async () => {
    fakeBackend({ entries: anime() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.hover(rowOf(table, 'Madhouse'));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(await screen.findByRole('complementary', { name: 'Frieren, cover viewer' })).toBeInTheDocument();
    // sweeping across the next row without resting on it
    await userEvent.unhover(rowOf(table, 'Madhouse'));
    await userEvent.hover(rowOf(table, 'Bones'));
    await userEvent.unhover(rowOf(table, 'Bones'));
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByRole('complementary', { name: 'Frieren, cover viewer' })).toBeInTheDocument();
  });

  it('resting on another row switches the viewer; focusing a row does the same; a click selects at once', async () => {
    fakeBackend({ entries: anime() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.hover(rowOf(table, 'Bones'));
    expect(await screen.findByRole('complementary', { name: 'Mob Psycho, cover viewer' })).toBeInTheDocument();
    fireEvent.focus(rowOf(table, 'Madhouse'));
    expect(await screen.findByRole('complementary', { name: 'Frieren, cover viewer' })).toBeInTheDocument();
    await userEvent.click(rowOf(table, 'Bones'));
    expect(screen.getByRole('complementary', { name: 'Mob Psycho, cover viewer' })).toBeInTheDocument();
    expect(rowOf(table, 'Bones')).toHaveAttribute('aria-selected', 'true');
  });

  it('does nothing on hover when Settings > Cover viewer is off', async () => {
    fakeBackend({ me: makeMe({ settings: { ...DEFAULT_USER_SETTINGS, coverViewer: false } }), entries: anime() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.hover(rowOf(table, 'Madhouse'));
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('carries a small note "You can hide this in Settings." whose link goes to the Cover viewer setting', async () => {
    fakeBackend({ entries: anime() });
    renderApp('/list/anime');
    const table = await screen.findByRole('table');
    await userEvent.click(rowOf(table, 'Madhouse'));
    const viewer = screen.getByRole('complementary');
    const note = viewer.querySelector('.cover-viewer__note')!;
    expect(note).toHaveTextContent('You can hide this in Settings.');
    expect(within(note as HTMLElement).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings#cover-viewer');
    expect(viewer.lastElementChild).toBe(note);
    await userEvent.click(within(note as HTMLElement).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('switch', { name: 'Cover viewer' })).toBeInTheDocument();
  });
});

describe('cover viewer: the title\'s buttons', () => {
  const show = async (entry: Parameters<typeof makeEntry>[0], extra: Record<string, unknown> = {}) => {
    const { calls } = fakeBackend({ entries: [makeEntry({ id: 'x1', ...entry })], extra: { 'GET /api/spotify/link': { body: { url: null } }, 'GET /api/preview': { body: { url: 'https://cdn.example/clip.mp3' } }, 'GET /api/trailer': { body: { youtubeId: 'Way9Dexny3w' } }, ...extra } as never });
    const list = (entry!.category as string) ?? 'anime';
    renderApp(`/list/${list}`);
    const table = await screen.findByRole('table');
    await userEvent.hover(table.querySelector('tr[data-row]')!);
    const viewer = await screen.findByRole('complementary');
    return { calls, viewer };
  };

  it('songs and albums: Open in Spotify and Play preview, no trailer', async () => {
    const { viewer } = await show({ category: 'songs', title: 'Halo', creator: 'Beyonce' });
    expect(await within(viewer).findByRole('link', { name: 'Open in Spotify' })).toBeInTheDocument();
    expect(await within(viewer).findByRole('button', { name: /Play preview/ })).toBeInTheDocument();
    expect(within(viewer).queryByRole('button', { name: /Play trailer/ })).not.toBeInTheDocument();
  });

  it.each([['movies', 'Dune'], ['tv', 'Severance'], ['anime', 'Frieren']] as const)('%s: Play trailer only', async (category, title) => {
    const { viewer } = await show({ category, title });
    expect(await within(viewer).findByRole('button', { name: '▶ Play trailer' })).toBeInTheDocument();
    expect(within(viewer).queryByRole('link', { name: 'Open in Spotify' })).not.toBeInTheDocument();
  });

  it('YouTube: Watch on YouTube', async () => {
    const { viewer } = await show({ category: 'youtube', title: 'A video', source: 'youtube', sourceId: 'dQw4w9WgXcQ' });
    expect(await within(viewer).findByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', expect.stringContaining('dQw4w9WgXcQ'));
  });

  it('books have no buttons, and nothing is fetched until the title has settled', async () => {
    const { calls, viewer } = await show({ category: 'books', title: 'Dune' });
    await new Promise((r) => setTimeout(r, 400));
    expect(viewer.querySelector('.cover-viewer__actions')).toBeNull();
    expect(calls.filter((c) => /trailer|preview|spotify/.test(c.path))).toHaveLength(0);
  });

  it('moving quickly through rows asks for nothing until one stays', async () => {
    const { calls } = fakeBackend({ entries: [makeEntry({ id: 'm1', category: 'movies', title: 'One' }), makeEntry({ id: 'm2', category: 'movies', title: 'Two' })], extra: { 'GET /api/trailer': { body: { youtubeId: 'Way9Dexny3w' } } } });
    renderApp('/list/movies');
    const table = await screen.findByRole('table');
    await userEvent.click(rowOf(table, 'One'));
    await userEvent.click(rowOf(table, 'Two'));
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith('/api/trailer'))).toHaveLength(1));
    expect(calls.find((c) => c.path.startsWith('/api/trailer'))!.path).toContain('title=Two');
  });
});
