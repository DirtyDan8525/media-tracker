import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry, Season } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { DETAILS, fakeBackend, makeEntry, makeInfo } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const frieren = (over: Partial<Entry> = {}) => makeEntry({
  id: 'f1', title: "Frieren: Beyond Journey's End", rating: 9.5, status: 'Completed', creator: 'Madhouse', genres: 'Adventure, Drama',
  releaseDate: '2023-09-29', lengthLabel: '28 ep · 24 min', origin: 'TV · Fall 2023', synopsis: 'An elf outlives her party.',
  coverUrl: 'https://img.example/f.jpg', notes: 'so good', source: 'anilist', sourceId: '154587', ...over,
});
const season = (over: Partial<Season>): Season => ({ id: 's', entryId: 'f1', label: '', rating: null, notes: '', ...over });
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
    fakeBackend({ entries: [frieren({ synopsis: 'A long story that goes on and on…' })] });
    renderApp('/entry/f1');
    const more = await screen.findByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
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

  it('saves private toggles and says they are not enforced yet', async () => {
    const { calls } = fakeBackend({ entries: [frieren()] });
    renderApp('/entry/f1');
    expect(await screen.findByText('Private items are hidden from friends (coming soon)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Keep this title private' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ isPrivate: true }));
    await userEvent.click(screen.getByRole('switch', { name: 'Keep my notes private' }));
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
      source: 'anilist', sourceId: '999', lookupState: 'ok',
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
    expect(bodies[0]).toMatchObject({ lookupState: 'ok', source: 'anilist', sourceId: '2' });
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

