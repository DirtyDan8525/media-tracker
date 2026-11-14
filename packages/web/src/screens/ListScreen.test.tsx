import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry, LookupInfo } from '@media-tracker/shared';
import { describe, expect, it } from 'vitest';
import { DETAILS, fakeBackend, makeEntry, makeInfo } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const titles = () =>
  within(screen.getByRole('list', { name: /list$/i }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-role="title"]')?.textContent);

/** Sheets load lazily: wait for a field inside, not just the dialog frame (which shows skeletons first). */
async function sheet(field: { role: 'textbox'; name: string | RegExp }, dialogName: string | RegExp) {
  await screen.findByRole(field.role, { name: field.name });
  return screen.getByRole('dialog', { name: dialogName });
}
const findAddSheet = () => sheet({ role: 'textbox', name: /^(Title|Album|Song)$/ }, /^Add to /);
const findPicker = () => sheet({ role: 'textbox', name: 'Search again' }, 'Which one did you mean?');
const findPaste = () => sheet({ role: 'textbox', name: 'Image link' }, 'Paste image link');

async function openAdd(label = /^Add anime$/i) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  return findAddSheet();
}

async function addTitle(typed: string, dialog?: HTMLElement) {
  const d = dialog ?? (await openAdd());
  await userEvent.type(within(d).getByRole('textbox', { name: /^(Title|Album|Song)$/ }), typed);
  await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
}

const choice = (title: string, over: Partial<LookupInfo> = {}) => makeInfo({ title, sourceId: title, ...over });
const lastPatch = (calls: { method: string; path: string; body: unknown }[], id?: string) =>
  [...calls].reverse().find((c) => c.method === 'PATCH' && (!id || c.path === `/api/entries/${id}`));

describe('list order', () => {
  it('sorts by rating, highest first, unrated last, then title', async () => {
    fakeBackend({ entries: [
      makeEntry({ title: 'A', rating: null }), makeEntry({ title: 'C', rating: 7 }),
      makeEntry({ title: 'B', rating: 9.5 }), makeEntry({ title: 'D', rating: 7 }),
    ] });
    renderApp('/list/anime');
    await screen.findByText('B');
    expect(titles()).toEqual(['B', 'C', 'D', 'A']);
  });

  it('sorting by release date puts 2023-09-29 before 1998 and undated entries last', async () => {
    fakeBackend({ entries: [
      makeEntry({ title: 'Old', rating: 9, releaseDate: '1998' }), makeEntry({ title: 'None', rating: 10 }),
      makeEntry({ title: 'New', rating: 1, releaseDate: '2023-09-29' }),
    ] });
    renderApp('/list/anime');
    await screen.findByText('Old');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Release date');
    expect(titles()).toEqual(['New', 'Old', 'None']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Title');
    expect(titles()).toEqual(['New', 'None', 'Old']);
  });
});

describe('adding an entry', () => {
  it('saves a pending row at once, then fills the cover and creator from a single match', async () => {
    let release: (v: { body: unknown }) => void = () => {};
    const { calls } = fakeBackend({ lookup: () => new Promise((r) => { release = r; }) });
    renderApp('/list/anime');
    await addTitle('frieren');
    // the sheet is closed and the pending row is there before the lookup returns
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Looking it up…')).toBeInTheDocument();
    expect(titles()).toEqual(['frieren']);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/entries')?.body).toMatchObject({
      category: 'anime', title: 'frieren', lookupState: 'pending',
    });

    release({ body: { info: makeInfo({ title: "Frieren: Beyond Journey's End" }) } });
    expect(await screen.findByRole('img', { name: "Frieren: Beyond Journey's End cover" })).toHaveAttribute('src', 'https://img.example/cover.jpg');
    expect(screen.getByText(/Madhouse/)).toBeInTheDocument();
    expect(titles()).toEqual(["Frieren: Beyond Journey's End"]);
    expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument();
    expect(lastPatch(calls)?.body).toMatchObject({ coverUrl: 'https://img.example/cover.jpg', creator: 'Madhouse', lookupState: 'ok', title: "Frieren: Beyond Journey's End" });
  });

  it('sends the typed creator and rating, and the lookup term follows creatorIsSearchHint', async () => {
    const { calls } = fakeBackend();
    renderApp('/list/albums');
    const d = await openAdd(/^Add album$/i);
    await userEvent.type(within(d).getByRole('textbox', { name: 'Album' }), 'Abbey Road');
    await userEvent.type(within(d).getByRole('textbox', { name: /^Artist/ }), 'The Beatles');
    const slider = within(d).getByRole('slider', { name: 'Rating' });
    expect(slider).toHaveAttribute('aria-valuetext', 'Unrated');
    fireEvent.change(slider, { target: { value: '9.5' } });
    expect(slider).toHaveAttribute('aria-valuetext', '9.5');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/lookup')).toBe(true));
    expect(calls.find((c) => c.path === '/api/entries')?.body).toMatchObject({ title: 'Abbey Road', creator: 'The Beatles', rating: 9.5 });
    expect(calls.find((c) => c.path === '/api/lookup')?.body).toEqual({
      category: 'albums', term: 'Abbey Road The Beatles', typedTitle: 'Abbey Road', hint: 'The Beatles',
    });
  });

  it('leaves a title unrated unless the slider is moved, and hides empty creator for categories without one', async () => {
    const { calls } = fakeBackend();
    renderApp('/list/tv');
    const d = await openAdd(/^Add TV show$/i);
    expect(within(d).queryByRole('textbox', { name: /optional/ })).not.toBeInTheDocument();
    await userEvent.type(within(d).getByRole('textbox', { name: 'Title' }), 'Dark');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/entries' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/api/entries')?.body).not.toHaveProperty('rating');
  });

  it('shows status chips for anime but not for movies', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const d = await openAdd();
    expect(within(d).getByRole('button', { name: 'Completed' })).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Close' }));
    fakeBackend();
    renderApp('/list/movies');
    const d2 = await openAdd(/^Add movie$/i);
    expect(within(d2).queryByRole('button', { name: 'Completed' })).not.toBeInTheDocument();
    expect(within(d2).getByRole('slider', { name: 'Rating' })).toBeInTheDocument();
  });

  it('sends the chosen status', async () => {
    const { calls } = fakeBackend();
    renderApp('/list/anime');
    const d = await openAdd();
    await userEvent.type(within(d).getByRole('textbox', { name: 'Title' }), 'x');
    await userEvent.click(within(d).getByRole('button', { name: 'Dropped' }));
    expect(within(d).getByRole('button', { name: 'Dropped' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/entries')?.body).toMatchObject({ status: 'Dropped' }));
  });

  it('returns focus to the Add button when the sheet closes', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const d = await openAdd();
    await userEvent.click(within(d).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Add anime$/i })).toHaveFocus();
  });

  it('does not add a blank title', async () => {
    fakeBackend();
    renderApp('/list/anime');
    const d = await openAdd();
    expect(within(d).getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('keeps the typed title when the official one is untrusted and unlike it', async () => {
    const { calls } = fakeBackend({ lookup: () => ({ body: { info: makeInfo({ title: "JoJo's Bizarre Adventure", trusted: false }) } }) });
    renderApp('/list/anime');
    await addTitle('jjba');
    await waitFor(() => expect(screen.queryByText('Looking it up…')).not.toBeInTheDocument());
    await waitFor(() => expect(lastPatch(calls)?.body).toMatchObject({ lookupState: 'ok' }));
    expect(lastPatch(calls)?.body).not.toHaveProperty('title');
    expect(titles()).toEqual(['jjba']);
  });

  it('toasts when the title is already on the list, and still saves it', async () => {
    const { entries } = fakeBackend({ entries: [makeEntry({ category: 'albums', title: 'Abbey Road', creator: 'The Beatles' })] });
    renderApp('/list/albums');
    const d = await openAdd(/^Add album$/i);
    await userEvent.type(within(d).getByRole('textbox', { name: 'Album' }), 'abbey road');
    await userEvent.type(within(d).getByRole('textbox', { name: /^Artist/ }), 'the beatles');
    await userEvent.click(within(d).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Already on your Albums list')).toBeInTheDocument();
    expect(entries).toHaveLength(2);
  });

  it('leaves the entry saved as "Couldn\'t find it" with Retry and Paste image link when the lookup fails', async () => {
    const { calls } = fakeBackend({ lookup: () => ({ status: 500, body: { error: 'boom' } }) });
    renderApp('/list/anime');
    await addTitle('kaiju no 8 s2');
    expect(await screen.findByText("Couldn't find it")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste image link' })).toBeInTheDocument();
    expect(titles()).toEqual(['kaiju no 8 s2']);
    await waitFor(() => expect(lastPatch(calls)?.body).toEqual({ lookupState: 'not_found' }));
  });

  it('treats "nothing found" the same way', async () => {
    fakeBackend({ lookup: () => ({ body: { info: null } }) });
    renderApp('/list/anime');
    await addTitle('zzzz');
    expect(await screen.findByText("Couldn't find it")).toBeInTheDocument();
  });

  it('Retry looks the title up again and fills the row', async () => {
    const { calls } = fakeBackend({
      entries: [makeEntry({ title: 'frieren', lookupState: 'not_found' })],
      lookup: () => ({ body: { info: makeInfo({ title: 'Frieren' }) } }),
    });
    renderApp('/list/anime');
    expect(await screen.findByText("Couldn't find it")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Frieren cover' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't find it")).not.toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/lookup')?.body).toMatchObject({ term: 'frieren', typedTitle: 'frieren' });
  });
});

describe('Paste image link', () => {
  const setup = () => {
    const be = fakeBackend({ entries: [makeEntry({ title: 'kaiju', lookupState: 'not_found' })] });
    renderApp('/list/anime');
    return be;
  };

  it('rejects a link that is not http(s) and sends nothing', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Paste image link' }));
    const d = await findPaste();
    await userEvent.type(within(d).getByRole('textbox', { name: 'Image link' }), 'ftp://example.com/a.jpg');
    await userEvent.click(within(d).getByRole('button', { name: 'Save' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Enter a link that starts with http:// or https://');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('saves an https link as the cover and marks the lookup ok', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Paste image link' }));
    const d = await findPaste();
    await userEvent.type(within(d).getByRole('textbox', { name: 'Image link' }), 'https://img.example/k.jpg');
    await userEvent.click(within(d).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('img', { name: 'kaiju cover' })).toHaveAttribute('src', 'https://img.example/k.jpg');
    expect(lastPatch(calls)?.body).toEqual({ coverUrl: 'https://img.example/k.jpg', lookupState: 'ok' });
    expect(screen.queryByText("Couldn't find it")).not.toBeInTheDocument();
  });
});

describe('the picker', () => {
  const three = [choice('Frieren', { sub: 'TV · 2023' }), choice('Frieren Movie', { sub: 'Movie' }), choice('Frieren: Beyond Journey’s End', { sub: 'TV · 2023 · Madhouse' })];
  const lookup3 = () => ({ body: { info: { ...three[0]!, choices: three } } });

  it('opens with 3 choices, and choosing the 2nd saves the 2nd\'s title', async () => {
    const { calls } = fakeBackend({ lookup: lookup3 });
    renderApp('/list/anime');
    await addTitle('frieren');
    const d = await findPicker();
    expect(within(d).getByText('You typed "frieren"')).toBeInTheDocument();
    const cards = within(d).getAllByRole('button').filter((b) => three.some((c) => c.title === b.getAttribute('aria-label')));
    expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual(['Frieren', 'Frieren Movie', 'Frieren: Beyond Journey’s End']);
    await userEvent.click(within(d).getByRole('button', { name: 'Frieren Movie' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(titles()).toEqual(['Frieren Movie']));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ title: 'Frieren Movie', sourceId: 'Frieren Movie', lookupState: 'ok' });
  });

  it('lists the closest match first with a "Closest match" badge', async () => {
    const mixed = [choice('Frieren: Special Edition Collection'), choice('frieren'), choice('Sousou no Frieren')];
    fakeBackend({ lookup: () => ({ body: { info: { ...mixed[0]!, choices: mixed } } }) });
    renderApp('/list/anime');
    await addTitle('frieren');
    const d = await findPicker();
    const first = within(within(d).getByRole('list', { name: 'Matches' })).getAllByRole('button')[0]!;
    expect(first).toHaveAttribute('aria-label', 'frieren');
    expect(within(first).getByText('Closest match')).toBeInTheDocument();
    expect(within(d).getAllByText('Closest match')).toHaveLength(1);
  });

  it('"None of these" keeps the typed title and leaves Retry available', async () => {
    const { calls } = fakeBackend({ lookup: lookup3 });
    renderApp('/list/anime');
    await addTitle('frieren');
    const d = await findPicker();
    await userEvent.click(within(d).getByRole('button', { name: 'None of these — keep what I typed' }));
    expect(await screen.findByText("Couldn't find it")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(titles()).toEqual(['frieren']);
    expect(lastPatch(calls)?.body).toEqual({ lookupState: 'not_found' });
  });

  it('the search box runs the lookup again with the new words', async () => {
    const queries: string[] = [];
    fakeBackend({
      lookup: (b) => {
        queries.push(b.term);
        return queries.length === 1
          ? { body: { info: { ...three[0]!, choices: three } } }
          : { body: { info: { ...choice('Sousou no Frieren'), choices: [choice('Sousou no Frieren'), choice('Sousou no Frieren OVA')] } } };
      },
    });
    renderApp('/list/anime');
    await addTitle('frieren');
    const d = await findPicker();
    const box = within(d).getByRole('textbox', { name: 'Search again' });
    expect(box).toHaveValue('frieren');
    await userEvent.clear(box);
    await userEvent.type(box, 'sousou no frieren');
    await userEvent.click(within(d).getByRole('button', { name: 'Search' }));
    expect(await within(d).findByRole('button', { name: 'Sousou no Frieren OVA' })).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: 'Frieren Movie' })).not.toBeInTheDocument();
    expect(queries).toEqual(['frieren', 'sousou no frieren']);
  });

  it('says so when a new search finds nothing, and keeps the old choices out of the way', async () => {
    let n = 0;
    fakeBackend({ lookup: () => (n++ === 0 ? { body: { info: { ...three[0]!, choices: three } } } : { body: { info: null } }) });
    renderApp('/list/anime');
    await addTitle('frieren');
    const d = await findPicker();
    await userEvent.click(within(d).getByRole('button', { name: 'Search' }));
    expect(await within(d).findByText('Nothing found. Try different words.')).toBeInTheDocument();
  });

  it('after a pick, the details call fills release date, length, origin and synopsis', async () => {
    const { entries, calls } = fakeBackend({ lookup: lookup3, details: () => ({ body: { details: DETAILS } }) });
    renderApp('/list/anime');
    await addTitle('frieren');
    await userEvent.click(await screen.findByRole('button', { name: 'Frieren Movie' }));
    await waitFor(() => expect(entries[0]).toMatchObject({ ...DETAILS, detailsState: 'filled' }));
    expect(calls.find((c) => c.path === '/api/lookup/details')?.body).toEqual({ source: 'kitsu', sourceId: 'Frieren Movie' });
  });

  it('if the details call fails, the entry keeps its cover and title and no error shows', async () => {
    const { entries } = fakeBackend({ lookup: lookup3, details: () => ({ status: 500, body: { error: 'boom' } }) });
    renderApp('/list/anime');
    await addTitle('frieren');
    await userEvent.click(await screen.findByRole('button', { name: 'Frieren Movie' }));
    expect(await screen.findByRole('img', { name: 'Frieren Movie cover' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(entries[0]).toMatchObject({ title: 'Frieren Movie', coverUrl: 'https://img.example/cover.jpg', lookupState: 'ok', detailsState: 'none', releaseDate: '' });
    expect(document.querySelector('.toast-region')!).toBeEmptyDOMElement();
  });

  it('also fills details after an automatic single match', async () => {
    const { entries } = fakeBackend({ lookup: () => ({ body: { info: makeInfo() } }), details: () => ({ body: { details: DETAILS } }) });
    renderApp('/list/anime');
    await addTitle('official');
    await waitFor(() => expect(entries[0]).toMatchObject({ synopsis: DETAILS.synopsis, detailsState: 'filled' }));
  });
});

describe('PC table', () => {
  const rows = (over: Partial<Entry> = {}) => [makeEntry({ title: 'Mob Psycho', rating: 9.4, status: 'Completed', notes: 'wow', ...over })];

  it('shows a table with the Season Avg column only while the Anime Seasons tab is on', async () => {
    setViewportWidth(1024);
    fakeBackend({ entries: rows() });
    renderApp('/list/anime');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Season Avg' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Studio' })).toBeInTheDocument();
  });

  it('omits Season Avg when the seasons tab is off, and Status for movies', async () => {
    setViewportWidth(1024);
    fakeBackend({ me: makeMe({}, { animeSeasons: false }), entries: rows() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: 'Season Avg' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('has no Status column for movies', async () => {
    setViewportWidth(1024);
    fakeBackend({ entries: rows({ category: 'movies', status: null }) });
    renderApp('/list/movies');
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Season Avg' })).not.toBeInTheDocument();
  });

  it('edits a rating inline and saves on Enter', async () => {
    setViewportWidth(1024);
    const { calls } = fakeBackend({ entries: rows() });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Rating for Mob Psycho: 9.4' }));
    const input = screen.getByRole('spinbutton', { name: 'Rating for Mob Psycho' });
    await userEvent.clear(input);
    await userEvent.type(input, '8.25{Enter}');
    expect(await screen.findByRole('button', { name: 'Rating for Mob Psycho: 8.25' })).toBeInTheDocument();
    expect(lastPatch(calls)?.body).toEqual({ rating: 8.25 });
  });

  it('rejects an out-of-range rating inline without saving, and Escape cancels', async () => {
    setViewportWidth(1024);
    const { calls } = fakeBackend({ entries: rows() });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Rating for Mob Psycho: 9.4' }));
    const input = screen.getByRole('spinbutton', { name: 'Rating for Mob Psycho' });
    await userEvent.clear(input);
    await userEvent.type(input, '11{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('0 to 10');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Rating for Mob Psycho: 9.4' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('rolls the rating back and toasts when the server answers 400', async () => {
    setViewportWidth(1024);
    fakeBackend({ entries: rows(), patchFail: () => ({ status: 400, body: { error: 'invalid' } }) });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Rating for Mob Psycho: 9.4' }));
    const input = screen.getByRole('spinbutton', { name: 'Rating for Mob Psycho' });
    await userEvent.clear(input);
    await userEvent.type(input, '5{Enter}');
    expect(await screen.findByText("Couldn't save that change")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rating for Mob Psycho: 9.4' })).toBeInTheDocument();
  });

  it('edits status with a select and notes in place', async () => {
    setViewportWidth(1024);
    const { calls } = fakeBackend({ entries: rows() });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Status for Mob Psycho: Completed' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status for Mob Psycho' }), 'On Hold');
    expect(await screen.findByRole('button', { name: 'Status for Mob Psycho: On Hold' })).toBeInTheDocument();
    expect(lastPatch(calls)?.body).toEqual({ status: 'On Hold' });

    await userEvent.click(screen.getByRole('button', { name: 'Notes for Mob Psycho: wow' }));
    const notes = screen.getByRole('textbox', { name: 'Notes for Mob Psycho' });
    await userEvent.clear(notes);
    await userEvent.type(notes, 'rewatch me');
    await userEvent.tab(); // blur saves
    expect(await screen.findByRole('button', { name: 'Notes for Mob Psycho: rewatch me' })).toBeInTheDocument();
    expect(lastPatch(calls)?.body).toEqual({ notes: 'rewatch me' });
  });

  it('arrow keys move between rows in the same column', async () => {
    setViewportWidth(1024);
    fakeBackend({ entries: [makeEntry({ title: 'One', rating: 9 }), makeEntry({ title: 'Two', rating: 8 })] });
    renderApp('/list/anime');
    const one = await screen.findByRole('button', { name: 'Rating for One: 9.0' });
    one.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Rating for Two: 8.0' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(one).toHaveFocus();
  });

  it('shows the pending and not-found rows in the table too', async () => {
    setViewportWidth(1024);
    fakeBackend({ entries: [makeEntry({ title: 'lost', lookupState: 'not_found' })] });
    renderApp('/list/anime');
    expect(await screen.findByText("Couldn't find it")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('list basics', () => {
  it('shows a stale pending row (no lookup running) as not found so it cannot spin forever', async () => {
    fakeBackend({ entries: [makeEntry({ title: 'old', lookupState: 'pending' })] });
    renderApp('/list/anime');
    expect(await screen.findByText("Couldn't find it")).toBeInTheDocument();
  });

  it('links a row to its details', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'abc', title: 'Frieren', rating: 9 })] });
    const { router } = renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('link', { name: /Frieren/ }));
    expect(router.state.location.pathname).toBe('/entry/abc');
  });
});

describe('v2 look', () => {
  const headerBackdrop = () => document.querySelector<HTMLImageElement>('.page-header .backdrop img');

  it("the list header's backdrop is the highest-rated title's cover", async () => {
    fakeBackend({ entries: [
      makeEntry({ title: 'Seven', rating: 7, coverUrl: 'https://img.example/seven.jpg' }),
      makeEntry({ title: 'Best', rating: 9.5, coverUrl: 'https://img.example/best.jpg' }),
      makeEntry({ title: 'Unrated', rating: null, coverUrl: 'https://img.example/none.jpg' }),
    ] });
    renderApp('/list/anime');
    await screen.findByText('Best');
    expect(headerBackdrop()).toHaveAttribute('src', 'https://img.example/best.jpg');
    // the sort chosen doesn't change it
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Title');
    expect(headerBackdrop()).toHaveAttribute('src', 'https://img.example/best.jpg');
  });

  it('skips a top-rated title that has no cover', async () => {
    fakeBackend({ entries: [
      makeEntry({ title: 'Top', rating: 10, coverUrl: '' }),
      makeEntry({ title: 'Next', rating: 8, coverUrl: 'https://img.example/next.jpg' }),
    ] });
    renderApp('/list/anime');
    await screen.findByText('Top');
    expect(headerBackdrop()).toHaveAttribute('src', 'https://img.example/next.jpg');
  });

  it('no rated titles: no backdrop', async () => {
    fakeBackend({ entries: [makeEntry({ title: 'Plain', rating: null, coverUrl: 'https://img.example/p.jpg' })] });
    renderApp('/list/anime');
    await screen.findByText('Plain');
    expect(document.querySelector('.backdrop')).not.toBeInTheDocument();
  });

  it('phone list covers are the v2 size (56 px posters, 56 px squares)', async () => {
    fakeBackend({ entries: [
      makeEntry({ title: 'Poster', rating: 9, coverUrl: 'https://img.example/p.jpg' }),
      makeEntry({ title: 'Blank', rating: 8, coverUrl: '' }),
    ] });
    renderApp('/list/anime');
    const img = await screen.findByRole('img', { name: 'Poster cover' });
    expect(img).toHaveAttribute('width', '56');
    expect(img.style.width).toBe('56px');
    expect(screen.getByRole('img', { name: 'Blank cover' }).style.width).toBe('56px');
  });
});

describe('search and filters', () => {
  const three = () => fakeBackend({ entries: [
    makeEntry({ title: 'Frieren', rating: 9, status: 'Completed', genres: 'Fantasy, Adventure', creator: 'Madhouse' }),
    makeEntry({ title: 'Pokémon', rating: 7, status: 'On Hold', genres: 'Adventure' }),
    makeEntry({ title: 'Bleach', rating: 8, status: 'Dropped', genres: 'Action' }),
  ] });
  const openSearch = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Search' })); return screen.findByRole('searchbox', { name: 'Search Anime' }); };

  it('typing filters, updates the URL with replace, and shows "1 of 3 titles"', async () => {
    three();
    const { router } = renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.type(await openSearch(), 'fri');
    expect(titles()).toEqual(['Frieren']);
    expect(router.state.location.search).toBe('?q=fri');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByText('1 of 3 titles')).toBeInTheDocument();
  });

  it('ignores accents and case, and starts from the URL', async () => {
    three();
    renderApp('/list/anime?q=POKEMON');
    await screen.findByText('Pokémon');
    expect(titles()).toEqual(['Pokémon']);
    expect(screen.getByRole('searchbox', { name: 'Search Anime' })).toHaveValue('POKEMON');
  });

  it('Status filter narrows, and is absent on Movies', async () => {
    three();
    const { unmount } = renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Status: On Hold');
    expect(titles()).toEqual(['Pokémon']);
    unmount();
    fakeBackend({ entries: [makeEntry({ category: 'movies', title: 'Heat', genres: 'Crime' })] });
    renderApp('/list/movies');
    await screen.findByText('Heat');
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Genre' })).toBeInTheDocument();
  });

  it('Genre filter narrows; sorting applies after filtering', async () => {
    three();
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Genre' }), 'Adventure (2)');
    expect(titles()).toEqual(['Frieren', 'Pokémon']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Title');
    expect(titles()).toEqual(['Frieren', 'Pokémon']);
  });

  it('no matches: friendly state, and Clear search and filters restores every row', async () => {
    three();
    const { router } = renderApp('/list/anime?q=zzz&status=Dropped');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    expect(screen.getByText('Nothing in Anime matches your search.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(titles()).toHaveLength(3);
    expect(router.state.location.search).toBe('');
  });

  it('Escape clears and closes the phone search', async () => {
    three();
    renderApp('/list/anime');
    const box = await openSearch();
    await userEvent.type(box, 'bl{Escape}');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(titles()).toHaveLength(3);
  });

  it('PC: the filter box is always there and "/" focuses it', async () => {
    setViewportWidth(1200);
    three();
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    const box = screen.getByRole('searchbox', { name: 'Filter Anime' });
    expect(box).toHaveAttribute('placeholder', 'Filter titles, studios, genres…');
    await userEvent.keyboard('/');
    expect(box).toHaveFocus();
    await userEvent.keyboard('/');
    expect(box).toHaveValue('/');
    setViewportWidth(390);
  });
});
