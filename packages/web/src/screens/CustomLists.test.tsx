import { NEW_LIST_DEFAULTS, customKey, type CustomList, type Entry } from '@media-tracker/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../test/friends';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

// Phase 7: custom lists (wireframe Phase7.wf.html section 3; placement per Dan, 2026-11-20).
const list = (over: Partial<CustomList> = {}): CustomList => {
  const id = over.id ?? 'rest000001';
  return {
    ...NEW_LIST_DEFAULTS, id, key: customKey(id), name: 'Restaurants', noun: 'restaurant', icon: '🍜', creatorLabel: 'Cuisine',
    hasStatus: true, statusWords: 'try', showTags: false, showLink: true, createdAt: '2026-11-20T00:00:00Z', ...over,
  };
};
const R = list();
const KEY = R.key;

/** fakeBackend plus the custom lists routes (an in-memory copy, like the Worker). */
function backend(opts: { lists?: CustomList[]; entries?: Entry[]; features?: Record<string, boolean>; extra?: Record<string, unknown> } = {}) {
  let lists = [...(opts.lists ?? [])];
  let me = makeMe({ customLists: lists });
  let made = 0;
  const b = fakeBackend({
    me,
    entries: opts.entries,
    extra: {
      'GET /api/me': () => ({ body: me }),
      ...(opts.features ? { 'GET /api/app': { body: { features: opts.features } } } : {}),
      'POST /api/lists': (body: unknown) => {
        if (lists.length >= 6) return { status: 409, body: { error: 'limit', max: 6, message: 'You can have up to 6 custom lists. Delete one to make another.' } };
        const id = `new${String(++made).padStart(7, '0')}`;
        const l: CustomList = { ...NEW_LIST_DEFAULTS, ...(body as object), id, key: customKey(id), createdAt: `2026-11-20T0${made}:00:00Z` };
        lists = [...lists, l];
        me = { ...me, customLists: lists };
        return { status: 201, body: { list: l, lists } };
      },
      'PATCH /api/lists/:id': (body: unknown, _u: URL, p: Record<string, string>) => {
        lists = lists.map((l) => (l.id === p.id ? { ...l, ...(body as object) } : l));
        me = { ...me, customLists: lists };
        return { body: { list: lists.find((l) => l.id === p.id), lists } };
      },
      'DELETE /api/lists/:id': (_b: unknown, _u: URL, p: Record<string, string>) => {
        lists = lists.filter((l) => l.id !== p.id);
        me = { ...me, customLists: lists };
        return { body: { lists } };
      },
      ...opts.extra,
    } as never,
  });
  return b;
}

beforeEach(() => localStorage.clear());
afterEach(() => setViewportWidth(390));

describe('Settings → Tabs', () => {
  it('has "+ New list" right below the switches; a custom list\'s switch row has Edit and Delete', async () => {
    backend({ lists: [R] });
    renderApp('/settings');
    const tabs = await screen.findByRole('region', { name: 'Tabs' });
    const sw = within(tabs).getByRole('switch', { name: '🍜 Restaurants' });
    expect(sw).toBeChecked();
    expect(within(tabs).getByRole('link', { name: 'Edit Restaurants' })).toHaveAttribute('href', `/settings/lists/${R.id}`);
    expect(within(tabs).getByRole('button', { name: 'Delete Restaurants' })).toBeInTheDocument();
    // Built-in lists have no Edit or Delete.
    expect(within(tabs).queryByRole('link', { name: 'Edit Anime' })).not.toBeInTheDocument();
    const add = within(tabs).getByRole('link', { name: 'New list' });
    expect(add).toHaveAttribute('href', '/settings/lists/new');
    // Below the switches: after the last one in document order.
    const switches = within(tabs).getAllByRole('switch');
    expect(switches[switches.length - 1]!.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('creates a list from Settings: the form posts it, then the new list opens with its emoji and noun', async () => {
    const { calls } = backend();
    const { router } = renderApp('/settings');
    await userEvent.click(await screen.findByRole('link', { name: 'New list' }));
    await screen.findByRole('heading', { level: 1, name: 'New list' });
    await userEvent.type(screen.getByLabelText('Name'), 'Restaurants');
    await userEvent.type(screen.getByLabelText('One item is a…'), 'restaurant');
    expect(screen.getByText('The Add button says “Add restaurant”.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Icon/), '🍜');
    await userEvent.click(screen.getByRole('checkbox', { name: /Second line/ }));
    await userEvent.type(screen.getByLabelText('called'), 'Cuisine');
    await userEvent.click(screen.getByRole('radio', { name: 'Want to try / Been' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Link/ }));
    expect(screen.getByRole('radio', { name: 'None — type it in' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/list\/c_new/));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/lists')?.body).toEqual({
      ...NEW_LIST_DEFAULTS, name: 'Restaurants', noun: 'restaurant', icon: '🍜', creatorLabel: 'Cuisine', statusWords: 'try', showLink: true,
    });
    const h1 = await screen.findByRole('heading', { level: 1, name: /Restaurants/ });
    expect(h1).toHaveTextContent('🍜 Restaurants');
    expect(await screen.findByText('Nothing on Restaurants yet')).toBeInTheDocument();
  });

  it('edits a list (only the changed form is sent) and deletes one after its name is typed', async () => {
    const { calls } = backend({ lists: [R] });
    renderApp(`/settings/lists/${R.id}`);
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Restaurants');
    await userEvent.clear(name);
    await userEvent.type(name, 'Places');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === `/api/lists/${R.id}`)).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ name: 'Places', noun: 'restaurant', creatorLabel: 'Cuisine' });

    // Delete from Settings: the button stays off until the name is typed.
    renderApp('/settings');
    const tabs = await screen.findByRole('region', { name: 'Tabs' });
    await userEvent.click(await within(tabs).findByRole('button', { name: 'Delete Places' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Places?' });
    const del = within(dialog).getByRole('button', { name: 'Delete list' });
    expect(del).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'plac');
    expect(del).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'es');
    expect(del).toBeEnabled();
    await userEvent.click(del);
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === `/api/lists/${R.id}`)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('switch', { name: /Places/ })).not.toBeInTheDocument());
  });

  it('at 6 lists the button is off and says why; with the admin switch off there is no button, but lists keep working', async () => {
    const six = Array.from({ length: 6 }, (_, i) => list({ id: `list00000${i}`, name: `List ${i}` }));
    backend({ lists: six });
    renderApp('/settings');
    const tabs = await screen.findByRole('region', { name: 'Tabs' });
    const btn = await within(tabs).findByRole('button', { name: 'New list' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription('You can have up to 6 custom lists. Delete one to make another.');
  });

  it('with the admin switch off there are no New list buttons (Settings or More), and existing lists still show', async () => {
    backend({ lists: [R], features: { customLists: false } });
    renderApp('/settings');
    const tabs = await screen.findByRole('region', { name: 'Tabs' });
    await within(tabs).findByRole('switch', { name: '🍜 Restaurants' });
    await waitFor(() => expect(within(tabs).queryByRole('link', { name: 'New list' })).not.toBeInTheDocument());
    renderApp('/more');
    await screen.findAllByRole('region', { name: 'Ratings' });
    expect(screen.queryByRole('link', { name: 'New list' })).not.toBeInTheDocument();
  });
});

describe('More (phone)', () => {
  it('has a New list row and a note linking to Settings → Tabs, which brings Tabs into view and focuses it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    backend();
    const { router } = renderApp('/more');
    const section = await screen.findByRole('region', { name: 'Lists' });
    expect(within(section).getByRole('link', { name: 'New list' })).toHaveAttribute('href', '/settings/lists/new');
    expect(section).toHaveTextContent('To turn lists on or off, edit or delete them, go to Settings.');
    await userEvent.click(within(section).getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(router.state.location.hash).toBe('#tabs');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Tabs' })).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
  });

  it('New list from More opens the form', async () => {
    backend();
    renderApp('/more');
    await userEvent.click(await screen.findByRole('link', { name: 'New list' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'New list' })).toBeInTheDocument();
  });
});

describe('a custom list', () => {
  it('PC table shows its own columns: Name, Cuisine, Status in its words, Link; no Cover or Genres', async () => {
    setViewportWidth(1280);
    backend({ lists: [R], entries: [
      makeEntry({ id: 'r1', category: KEY, title: "Joe's Pho", creator: 'Vietnamese', status: 'Completed', rating: 9.1, link: 'https://joes.example' }),
      makeEntry({ id: 'r2', category: KEY, title: 'Sushi Ten', creator: 'Japanese', status: 'Plan to watch' }),
    ] });
    renderApp(`/list/${KEY}`);
    const table = await screen.findByRole('table');
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(heads).toEqual(expect.arrayContaining(['Rating', 'Name', 'Status', 'Cuisine', 'Link', 'Notes']));
    expect(heads).not.toContain('Cover');
    expect(heads).not.toContain('Genres');
    expect(heads).not.toContain('Tags');
    expect(within(table).getByText('Been')).toBeInTheDocument();
    expect(within(table).getByText('Want to try')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /Open the link for Joe's Pho/ })).toHaveAttribute('href', 'https://joes.example');
    expect(screen.getByRole('button', { name: 'Add restaurant' })).toBeInTheDocument();
  });

  it('Add "type it in": saves what was typed with its link, never looks it up', async () => {
    const { calls } = backend({ lists: [R] });
    renderApp(`/list/${KEY}`);
    await screen.findByRole('navigation', { name: 'Main' });
    await userEvent.click(await screen.findByRole('link', { name: 'Add restaurant' }));
    await screen.findByRole('textbox', { name: 'Name' });
    const dialog = screen.getByRole('dialog', { name: 'Add' });
    expect(within(dialog).getByText('Type it in: it is saved just as you write it.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Name'), "Joe's Pho");
    await userEvent.type(within(dialog).getByLabelText(/^Cuisine/), 'Vietnamese');
    await userEvent.type(within(dialog).getByLabelText(/^Link/), 'not a link');
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(/^Link/));
    await userEvent.type(within(dialog).getByLabelText(/^Link/), 'https://joes.example');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Been' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await screen.findByText("Joe's Pho");
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/entries')?.body).toEqual({
      category: KEY, title: "Joe's Pho", typedTitle: "Joe's Pho", lookupState: 'ok', creator: 'Vietnamese', link: 'https://joes.example', status: 'Completed',
    });
    expect(calls.some((c) => c.path === '/api/lookup')).toBe(false);
  });

  it('a list that is not yours goes home', async () => {
    backend();
    const { router } = renderApp(`/list/${KEY}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
  });
});

describe('where lists appear', () => {
  it('PC side nav lists it last with its emoji; Reorder lists can move it but has nothing to make lists', async () => {
    setViewportWidth(1280);
    backend({ lists: [R] });
    renderApp('/list/anime');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const names = Array.from(nav.querySelectorAll('.side-nav__list')).map((a) => a.querySelector('span')?.textContent);
    expect(names[names.length - 1]).toBe('🍜 Restaurants');
    expect(within(nav).queryByRole('link', { name: /New list/ })).not.toBeInTheDocument();
    await userEvent.click(within(nav).getByRole('button', { name: 'Reorder lists' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reorder lists' });
    expect(within(dialog).getByText('🍜 Restaurants')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move Restaurants up' })).toBeEnabled();
    expect(within(dialog).queryByRole('link', { name: /New list/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /New list/ })).not.toBeInTheDocument();
  });

  it('the phone list dropdown includes it, scrolls the current list into view, and its height is capped', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    backend({ lists: [R, list({ id: 'bars000001', name: 'Bars', icon: '' })] });
    renderApp(`/list/${KEY}`);
    const heading = await screen.findByRole('heading', { level: 1, name: '🍜 Restaurants' });
    await userEvent.click(within(heading).getByRole('button'));
    const menu = screen.getByRole('menu', { name: 'Switch list' });
    const labels = within(menu).getAllByRole('menuitem').map((i) => i.querySelector('.list-menu__label')?.textContent);
    expect(labels.slice(-2)).toEqual(['🍜 Restaurants', 'Bars']);
    const current = within(menu).getByRole('menuitem', { name: /Restaurants/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(current).toHaveFocus());
    expect(scroll.mock.contexts).toContain(current);
    // Keyboard still moves through the list.
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: /Bars/ })).toHaveFocus();
    // The panel never grows past about nine rows or 60vh, and scrolls inside itself.
    const css = readFileSync(join(process.cwd(), 'src/design/list-menu.css'), 'utf8');
    const panel = /\.list-menu__panel \{([^}]*)\}/.exec(css)![1]!;
    expect(panel).toContain('max-height: min(var(--list-menu-cap), 60vh)');
    expect(panel).toContain('overflow-y: auto');
    expect(panel).toContain('overscroll-behavior: contain');
    expect(panel).toMatch(/--list-menu-cap: calc\(9 \* var\(--tap\)/);
  });

  it('Top 5 and Search include it', async () => {
    backend({ lists: [R], entries: [makeEntry({ id: 'r1', category: KEY, title: "Joe's Pho", rating: 9.1 })] });
    renderApp('/top5');
    expect(await screen.findByRole('heading', { level: 2, name: 'Restaurants' })).toBeInTheDocument();
    renderApp('/search?q=pho');
    expect(await screen.findByRole('heading', { level: 2, name: /Restaurants/ })).toBeInTheDocument();
  });
});

describe("a friend's custom list", () => {
  const theirs = list({ id: 'theirs0001', name: 'Coffee', icon: '☕', noun: 'café', statusWords: 'try', creatorLabel: 'Area' });
  const rows = () => [
    makeFriendEntry({ id: 'c1', category: theirs.key, title: 'Bean There', creator: 'Downtown', status: 'Completed', rating: 8.8 }),
    makeFriendEntry({ id: 'a1', category: 'anime', title: 'Frieren', rating: 9 }),
  ];
  const friendBackend = () => backend({ extra: {
    'GET /api/users/:username': { body: { user: REN, memberSince: null, relation: 'friend', lists: [theirs] } },
    'GET /api/users/:username/entries': { body: rows() },
    'GET /api/users/:username/entries/:id': { body: { entry: rows()[0], seasons: [], list: theirs } },
    'GET /api/friends': { body: friendsOf(REN) },
  } });

  it('shows on their profile with its name and words', async () => {
    friendBackend();
    renderApp('/u/ren');
    await screen.findByRole('heading', { level: 1, name: 'Ren' });
    await userEvent.click(await screen.findByRole('button', { name: '☕ Coffee' }));
    expect(await screen.findByText('Bean There')).toBeInTheDocument();
    expect(screen.getByText('Been')).toBeInTheDocument();
  });

  it('their title page says it is on their own list, with no Add to mine', async () => {
    friendBackend();
    renderApp('/u/ren/entry/c1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bean There' })).toBeInTheDocument();
    expect(screen.getByText(/on their own list, Coffee/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to mine' })).not.toBeInTheDocument();
  });
});
