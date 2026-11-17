import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry, Season } from '@media-tracker/shared';
import { describe, expect, it, vi } from 'vitest';
import { ratingSetKey } from '../data/ratings';
import { DETAILS, fakeBackend, makeEntry, makeInfo } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const frieren = (over: Partial<Entry> = {}) => makeEntry({
  id: 'f1', title: "Frieren: Beyond Journey's End", rating: 9.5, status: 'Completed', creator: 'Madhouse', genres: 'Adventure, Drama',
  releaseDate: '2023-09-29', lengthLabel: '28 ep · 24 min', origin: 'TV · Fall 2023', synopsis: 'An elf outlives her party.',
  coverUrl: 'https://img.example/f.jpg', notes: 'so good', source: 'anilist', sourceId: '154587', ...over,
});
const season = (over: Partial<Season>): Season => ({
  id: 's', entryId: 'f1', label: '', rating: null, notes: '', tier: null, priorMean: null, strength: null, scoreLocked: false, ...over,
});
const patches = (calls: { method: string; path: string; body: unknown }[], id = 'f1') =>
  calls.filter((c) => c.method === 'PATCH' && c.path === `/api/entries/${id}`).map((c) => c.body as Record<string, unknown>);

describe('entry details', () => {
  it('shows the cover, title, creator, meta line, origin and genres', async () => {
    fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    expect(await screen.findByRole('heading', { level: 1, name: "Frieren: Beyond Journey's End" })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: "Frieren: Beyond Journey's End cover" })).toHaveAttribute('src', 'https://img.example/f.jpg');
    expect(screen.getByText('Madhouse')).toBeInTheDocument();
    expect(screen.getByText('2023 · 28 ep · 24 min')).toBeInTheDocument();
    expect(screen.getByText('Format: TV · Fall 2023')).toBeInTheDocument();
    expect(screen.getByText('Adventure, Drama')).toBeInTheDocument();
  });

  it('v2: blurs its own cover behind the top of the page, and none without a cover', async () => {
    fakeBackend({ entries: [frieren(), frieren({ id: 'f2', coverUrl: '' })] });
    const { unmount } = renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.backdrop img')).toHaveAttribute('src', 'https://img.example/f.jpg');
    unmount();
    renderApp('/entry/f2');
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.backdrop')).not.toBeInTheDocument();
  });

  it('v2: the rating tile shows a coloured rating badge', async () => {
    fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    expect(await screen.findByLabelText('Rating 9.5')).toHaveClass('rating--lg');
  });

  it('leaves out empty parts of the meta lines', async () => {
    fakeBackend({ entries: [frieren({ releaseDate: '', lengthLabel: '24 min', origin: '' })] });
    renderApp('/entry/f1');
    expect(await screen.findByText('24 min')).toBeInTheDocument();
    expect(screen.queryByText(/^Format:/)).not.toBeInTheDocument();
  });

  it('uses the category\'s origin label', async () => {
    fakeBackend({ entries: [frieren({ category: 'albums', origin: 'Apple Corps', releaseDate: '1969' })] });
    renderApp('/entry/f1');
    expect(await screen.findByText('Label: Apple Corps')).toBeInTheDocument();
  });

  it('offers More only when the synopsis was trimmed with an ellipsis', async () => {
    fakeBackend({ entries: [frieren({ synopsis: 'A long story that goes on and on…', source: null, sourceId: null })] });
    renderApp('/entry/f1');
    const more = await screen.findByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('More is a link to the source page (new tab) when the synopsis was trimmed and the match has a page', async () => {
    fakeBackend({ entries: [frieren({ synopsis: 'A long story that goes on and on…', source: 'anilist', sourceId: '154587' })] });
    renderApp('/entry/f1');
    const more = await within(await screen.findByRole('region', { name: 'Synopsis' })).findByRole('link', { name: 'More' });
    expect(more).toHaveAttribute('href', 'https://anilist.co/anime/154587');
    expect(more).toHaveAttribute('target', '_blank');
    expect(more).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(screen.getByRole('region', { name: 'Synopsis' })).queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('keeps the expand toggle when the source has no page (igdb) and no link when complete', async () => {
    fakeBackend({ entries: [frieren({ synopsis: 'A long story that goes on and on…', source: 'igdb', sourceId: '7346' })] });
    renderApp('/entry/f1');
    const region = await screen.findByRole('region', { name: 'Synopsis' });
    expect(within(region).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(within(region).queryByRole('link', { name: 'More' })).not.toBeInTheDocument();
  });

  it('a complete synopsis has no More link even with a source page', async () => {
    fakeBackend({ entries: [frieren({ synopsis: 'Short.', source: 'anilist', sourceId: '154587' })] });
    renderApp('/entry/f1');
    expect(await within(await screen.findByRole('region', { name: 'Synopsis' })).findByText('Short.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Synopsis' })).queryByRole('link', { name: 'More' })).not.toBeInTheDocument();
  });

  it('has no More for a synopsis that is complete', async () => {
    fakeBackend({ entries: [frieren({ synopsis: 'Short.' })] });
    renderApp('/entry/f1');
    expect(await within(await screen.findByRole('region', { name: 'Synopsis' })).findByText('Short.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('edits the rating, status and notes and saves them', async () => {
    const { calls } = fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    const rating = await screen.findByRole('spinbutton', { name: 'Rating' });
    await userEvent.clear(rating);
    await userEvent.type(rating, '8.5');
    await userEvent.tab();
    await waitFor(() => expect(patches(calls)).toContainEqual({ rating: 8.5 }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Dropped');
    await waitFor(() => expect(patches(calls)).toContainEqual({ status: 'Dropped' }));
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await userEvent.clear(notes);
    await userEvent.type(notes, 'rewatching');
    await userEvent.tab();
    await waitFor(() => expect(patches(calls)).toContainEqual({ notes: 'rewatching' }));
  });

  it('rejects a bad rating inline without saving', async () => {
    const { calls } = fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    const rating = await screen.findByRole('spinbutton', { name: 'Rating' });
    await userEvent.clear(rating);
    await userEvent.type(rating, '12');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('0 to 10');
    expect(patches(calls)).toEqual([]);
  });

  it('has no status control for movies', async () => {
    fakeBackend({ entries: [frieren({ category: 'movies', status: null })] });
    renderApp('/entry/f1');
    await screen.findByRole('spinbutton', { name: 'Rating' });
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('rejects a cover link that is not http(s)', async () => {
    const { calls } = fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    const cover = await screen.findByRole('textbox', { name: 'Cover image link' });
    await userEvent.clear(cover);
    await userEvent.type(cover, 'javascript:alert(1)');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('http://');
    expect(patches(calls)).toEqual([]);
  });

  it('saves private toggles under the approved privacy copy', async () => {
    const { calls } = fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    expect(await screen.findByText("Friends can't see it, its posts or its notes.")).toBeInTheDocument();
    expect(screen.getByText('Friends see the title, not your notes.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Private — only you see this title' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ isPrivate: true }));
    await userEvent.click(screen.getByRole('switch', { name: 'Keep notes private' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ notesPrivate: true }));
  });
});

describe('seasons', () => {
  it('shows the editor with the average, and adds, edits and removes a season', async () => {
    const { calls, seasons } = fakeBackend({
      entries: [frieren()],
      seasons: [season({ id: 's1', label: 'Season 1', rating: 9.5 }), season({ id: 's2', label: 'Season 2', rating: 9 })],
    });
    renderApp('/entry/f1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Seasons/ })).toHaveTextContent('Seasons · avg 9.25'));
    await userEvent.click(screen.getByRole('button', { name: 'Add season' }));
    const label = await screen.findByRole('textbox', { name: 'Season 3 name' });
    expect(label).toHaveValue('Season 3');
    await userEvent.clear(label);
    await userEvent.type(label, 'Finale');
    await userEvent.tab();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path.startsWith('/api/seasons/') && (c.body as { label?: string }).label === 'Finale')).toBe(true));
    const r = screen.getByRole('spinbutton', { name: 'Season 3 rating' });
    await userEvent.type(r, '8');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Seasons/ })).toHaveTextContent('avg 8.83'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove season 1' }));
    await waitFor(() => expect(seasons.find((s) => s.id === 's1')).toBeUndefined());
    expect(screen.getByRole('heading', { name: /^Seasons/ })).toHaveTextContent('avg 8.5');
  });

  it('is hidden when the Anime Seasons tab is off', async () => {
    fakeBackend({ me: makeMe({}, { animeSeasons: false }), entries: [frieren()], seasons: [season({ label: 'Season 1', rating: 9 })] });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: /^Seasons/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add season' })).not.toBeInTheDocument();
  });

  it('is hidden for categories without seasons', async () => {
    fakeBackend({ entries: [frieren({ category: 'movies', status: null })] });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: /^Seasons/ })).not.toBeInTheDocument();
  });
});

describe('seasons: ratings are re-fitted by the Worker', () => {
  it('a season rating change reloads the seasons and the season set (the Worker re-fits the others)', async () => {
    const { calls } = fakeBackend({ entries: [frieren()], seasons: [season({ id: 's1', label: 'Season 1', rating: 9.5 }), season({ id: 's2', label: 'Season 2', rating: 9 })] });
    const { queryClient } = renderApp('/entry/f1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Seasons/ })).toHaveTextContent('avg 9.25'));
    queryClient.setQueryData(ratingSetKey('anime_seasons'), { items: [], comparisons: [] });
    const before = calls.length;
    const r = screen.getByRole('spinbutton', { name: 'Season 2 rating' });
    await userEvent.clear(r);
    await userEvent.type(r, '8');
    await userEvent.tab();
    await waitFor(() => expect(calls.slice(before).some((c) => c.method === 'GET' && c.path === '/api/entries/f1/seasons')).toBe(true));
    expect(queryClient.getQueryState(ratingSetKey('anime_seasons'))!.isInvalidated).toBe(true);
  });

  it('removing a season reloads the season set and the parent list', async () => {
    const { calls } = fakeBackend({ entries: [frieren()], seasons: [season({ id: 's1', label: 'Season 1', rating: 9.5 }), season({ id: 's2', label: 'Season 2', rating: 9 })] });
    const { queryClient } = renderApp('/entry/f1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Seasons/ })).toHaveTextContent('avg 9.25'));
    queryClient.setQueryData(ratingSetKey('anime_seasons'), { items: [], comparisons: [] });
    const before = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Remove season 1' }));
    await waitFor(() => expect(calls.slice(before).some((c) => c.method === 'GET' && c.path === '/api/entries?category=anime')).toBe(true));
    expect(queryClient.getQueryState(ratingSetKey('anime_seasons'))!.isInvalidated).toBe(true);
  });

  it('a season delete that conflicts (409) is tried once more', async () => {
    let n = 0;
    const { seasons } = fakeBackend({
      entries: [frieren()], seasons: [season({ id: 's1', label: 'Season 1', rating: 9.5 })],
      extra: { 'DELETE /api/seasons/:id': () => (++n === 1 ? { status: 409, body: { error: 'conflict' } } : { status: 204 }) },
    });
    renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove season 1' }));
    await waitFor(() => expect(n).toBe(2));
    expect(screen.queryByText("Couldn't save that change")).not.toBeInTheDocument();
    expect(seasons).toHaveLength(1); // the extra handler stands in for the fake's own delete
  });
});

describe('Back and delete', () => {
  it('Back returns to the list with its search kept when there is in-app history', async () => {
    fakeBackend({ entries: [frieren()] });
    const { router } = renderApp('/list/anime?q=fri');
    await router.navigate('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(router.state.location.search).toBe('?q=fri');
  });

  it('Back goes to the category list when the entry page is the first screen', async () => {
    fakeBackend({ entries: [frieren()] });
    const { router } = renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
  });

  it('deleting an entry reloads its rating sets (the Worker re-fits its neighbours)', async () => {
    fakeBackend({ entries: [frieren()] });
    const { queryClient } = renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1 });
    queryClient.setQueryData(ratingSetKey('anime'), { items: [], comparisons: [] });
    queryClient.setQueryData(ratingSetKey('anime_seasons'), { items: [], comparisons: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const d = await screen.findByRole('dialog', { name: 'Delete this entry?' });
    await userEvent.click(within(d).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(queryClient.getQueryState(ratingSetKey('anime'))!.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(ratingSetKey('anime_seasons'))!.isInvalidated).toBe(true);
  });

  it('a delete that conflicts (409) is tried once more', async () => {
    let n = 0;
    const { router } = (() => {
      fakeBackend({ entries: [frieren()], extra: { 'DELETE /api/entries/:id': () => (++n === 1 ? { status: 409, body: { error: 'conflict' } } : { status: 204 }) } });
      return renderApp('/entry/f1');
    })();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const d = await screen.findByRole('dialog', { name: 'Delete this entry?' });
    await userEvent.click(within(d).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(n).toBe(2);
  });
});

describe('Re-fetch', () => {
  it('overwrites the lookup fields and details but never rating, status or notes', async () => {
    const { calls, entries } = fakeBackend({
      entries: [frieren({ title: 'frieren', typedTitle: 'frieren', creator: 'old', genres: 'old', coverUrl: 'https://old.example/x.jpg' })],
      lookup: () => ({ body: { info: makeInfo({ title: "Frieren: Beyond Journey's End", creator: 'Madhouse', album: 'Alb', genres: 'Fantasy', cover: 'https://img.example/new.jpg', sourceId: '999' }) } }),
      details: () => ({ body: { details: DETAILS } }),
    });
    renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Re-fetch' }));
    const d = await screen.findByRole('dialog', { name: 'Re-fetch' });
    await userEvent.click(within(d).getByRole('button', { name: 'Look it up' }));
    await waitFor(() => expect(entries[0]).toMatchObject({ ...DETAILS, detailsState: 'filled' }));
    expect(entries[0]).toMatchObject({
      title: "Frieren: Beyond Journey's End", creator: 'Madhouse', genres: 'Fantasy', album: 'Alb', coverUrl: 'https://img.example/new.jpg',
      source: 'kitsu', sourceId: '999', lookupState: 'ok',
    });
    expect(entries[0]).toMatchObject({ rating: 9.5, status: 'Completed', notes: 'so good' });
    for (const p of patches(calls)) {
      expect(p).not.toHaveProperty('rating');
      expect(p).not.toHaveProperty('status');
      expect(p).not.toHaveProperty('notes');
    }
    expect(calls.find((c) => c.path === '/api/lookup')?.body).toEqual({ category: 'anime', term: 'frieren', typedTitle: 'frieren', hint: '' });
  });

  it('uses the optional search term instead of the title', async () => {
    const { calls } = fakeBackend({ entries: [frieren()], lookup: () => ({ body: { info: makeInfo() } }) });
    renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Re-fetch' }));
    const d = await screen.findByRole('dialog', { name: 'Re-fetch' });
    await userEvent.type(within(d).getByRole('textbox', { name: 'Search term (optional)' }), 'sousou no frieren');
    await userEvent.click(within(d).getByRole('button', { name: 'Look it up' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/lookup')?.body).toMatchObject({ term: 'sousou no frieren' }));
  });

  it('says so, and changes nothing, when nothing is found', async () => {
    const { entries } = fakeBackend({ entries: [frieren()], lookup: () => ({ body: { info: null } }) });
    renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Re-fetch' }));
    const d = await screen.findByRole('dialog', { name: 'Re-fetch' });
    await userEvent.click(within(d).getByRole('button', { name: 'Look it up' }));
    expect(await screen.findByText("Couldn't find a match")).toBeInTheDocument();
    expect(entries[0]).toMatchObject({ title: "Frieren: Beyond Journey's End", coverUrl: 'https://img.example/f.jpg' });
  });
});

describe('Delete', () => {
  it('asks first, then deletes and goes back to the list', async () => {
    const { calls, entries } = fakeBackend({ entries: [frieren()] });
    const { router } = renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const d = await screen.findByRole('dialog', { name: 'Delete this entry?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(d).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(entries).toHaveLength(0);
  });

  it('Cancel keeps the entry', async () => {
    const { calls } = fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const d = await screen.findByRole('dialog', { name: 'Delete this entry?' });
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('missing entry', () => {
  it('says it could not be found', async () => {
    fakeBackend({ entries: [] });
    renderApp('/entry/nope');
    expect(await screen.findByText("We couldn't find that entry")).toBeInTheDocument();
  });
});

describe('entry details: Pick the right match', () => {
  const review = () => frieren({ id: 'r1', title: 'Frieren', creator: '', detailsState: 'needs_review', synopsis: '', releaseDate: '', lengthLabel: '', origin: '', source: null, sourceId: null });
  const choices = [
    makeInfo({ title: 'Frieren: Beyond Journey\'s End', sourceId: '1' }),
    makeInfo({ title: 'Frieren Specials', sourceId: '2' }),
  ];

  it('is offered only for entries that need a pick', async () => {
    fakeBackend({ entries: [frieren({ detailsState: 'filled' })] });
    renderApp('/entry/f1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Pick the right match' })).not.toBeInTheDocument();
  });

  it('opens the picker with a fresh lookup; choosing applies the match and the details, and the button goes away', async () => {
    const { calls } = fakeBackend({
      entries: [review()],
      lookup: () => ({ body: { info: { ...choices[0]!, choices } } }),
      details: () => ({ body: { details: DETAILS } }),
    });
    renderApp('/entry/r1');
    await userEvent.click(await screen.findByRole('button', { name: 'Pick the right match' }));
    const picker = await screen.findByRole('dialog', { name: 'Which one did you mean?' });
    expect(calls.filter((c) => c.path === '/api/lookup')).toHaveLength(1);
    await userEvent.click(within(picker).getByRole('button', { name: 'Frieren Specials' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pick the right match' })).not.toBeInTheDocument());
    const bodies = patches(calls, 'r1');
    expect(bodies[0]).toMatchObject({ lookupState: 'ok', source: 'kitsu', sourceId: '2' });
    expect(bodies.some((b) => b.detailsState === 'filled')).toBe(true);
    expect(within(await screen.findByRole('region', { name: 'Synopsis' })).getByText('An elf outlives her party.')).toBeInTheDocument();
  });

  it('the match is saved as done even when the source has no details to add', async () => {
    const { calls } = fakeBackend({
      entries: [review()],
      lookup: () => ({ body: { info: { ...choices[0]!, choices } } }),
      details: () => ({ body: { details: null } }),
    });
    renderApp('/entry/r1');
    await userEvent.click(await screen.findByRole('button', { name: 'Pick the right match' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Frieren Specials' }));
    await waitFor(() => expect(patches(calls, 'r1').some((b) => b.detailsState === 'filled')).toBe(true));
  });

  it('says so when nothing is found, and leaves the entry alone', async () => {
    const { calls } = fakeBackend({ entries: [review()], lookup: () => ({ body: { info: null } }) });
    renderApp('/entry/r1');
    await userEvent.click(await screen.findByRole('button', { name: 'Pick the right match' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't find a match");
    expect(patches(calls, 'r1')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Pick the right match' })).toBeInTheDocument();
  });
});

describe('entry details: number-first rating tile (Rulings N1, N6, N8)', () => {
  const nudged = (over: Partial<Entry> = {}) => frieren({ rating: 9.62, typed: 9.6, tier: 3, priorMean: 9.6, strength: 9.62, ...over });
  const closeRoutes = {
    'GET /api/ratings/anime/close/:id': (_b: unknown, _u: URL, p: Record<string, string>) => ({ body: {
      item: { id: p.id, title: 'Frieren', rating: 9.2, typed: 9.2, tier: 3, priorMean: 9.2, strength: 9.2, scoreLocked: false, cover: '', square: false, status: 'Completed' },
      others: [{ id: 'arc', title: 'Arcane', rating: 9.2, typed: 9.2, tier: 3, priorMean: 9.2, strength: 9.2, scoreLocked: false, cover: '', square: false, status: 'Completed' }],
    } }),
  };

  it('has no tier chips and no Lock switch', async () => {
    fakeBackend({ entries: [nudged()] });
    renderApp('/entry/f1');
    await screen.findByRole('spinbutton', { name: 'Rating' });
    expect(screen.queryByRole('group', { name: 'Tier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Lock score' })).not.toBeInTheDocument();
  });

  it('the field holds the typed number; the badge and a hint show the nudged one', async () => {
    fakeBackend({ entries: [nudged()] });
    renderApp('/entry/f1');
    expect(await screen.findByRole('spinbutton', { name: 'Rating' })).toHaveValue(9.6);
    expect(screen.getByText('You typed 9.6; a close call nudged it to 9.62.')).toBeInTheDocument();
  });

  it('retyping the typed number posts nothing; a different number PATCHes { rating } only', async () => {
    const { calls } = fakeBackend({ entries: [nudged()] });
    renderApp('/entry/f1');
    const rating = await screen.findByRole('spinbutton', { name: 'Rating' });
    await userEvent.clear(rating);
    await userEvent.type(rating, '9.60');
    await userEvent.tab();
    await userEvent.clear(rating);
    await userEvent.type(rating, '9');
    await userEvent.tab();
    await waitFor(() => expect(patches(calls)).toEqual([{ rating: 9 }]));
  });

  it('a saved rating with a close title opens the close-call sheet over the entry', async () => {
    const { calls } = fakeBackend({ entries: [frieren({ rating: 8, typed: 8 })], extra: closeRoutes });
    renderApp('/entry/f1');
    const rating = await screen.findByRole('spinbutton', { name: 'Rating' });
    await userEvent.clear(rating);
    await userEvent.type(rating, '9.2');
    await userEvent.tab();
    const sheet = await screen.findByRole('dialog', { name: 'Close call' });
    expect(within(sheet).getByRole('button', { name: 'Arcane, 9.2' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/ratings/anime/close/f1')).toBe(true);
  });

  it('with "Ask me to compare close ratings" off, nothing is asked', async () => {
    const me = makeMe();
    me.settings = { ...me.settings, compareAsk: 'Off' };
    const { calls } = fakeBackend({ me, entries: [frieren({ rating: 8, typed: 8 })], extra: closeRoutes });
    renderApp('/entry/f1');
    const rating = await screen.findByRole('spinbutton', { name: 'Rating' });
    await userEvent.clear(rating);
    await userEvent.type(rating, '9.2');
    await userEvent.tab();
    await waitFor(() => expect(patches(calls)).toEqual([{ rating: 9.2 }]));
    expect(calls.some((c) => c.path.includes('/close/'))).toBe(false);
  });

  it('a Plan to watch title has no rating field (N8)', async () => {
    fakeBackend({ entries: [frieren({ status: 'Plan to watch', rating: null })] });
    renderApp('/entry/f1');
    await screen.findByRole('combobox', { name: 'Status' });
    expect(screen.queryByRole('spinbutton', { name: 'Rating' })).not.toBeInTheDocument();
  });

describe('YouTube', () => {
  it('a video has a "Watch on YouTube" link to the video', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'yt1', category: 'youtube', title: 'Never Gonna Give You Up', source: 'youtube', sourceId: 'dQw4w9WgXcQ' })] });
    renderApp('/entry/yt1');
    const link = await screen.findByRole('link', { name: 'Watch on YouTube' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
});
