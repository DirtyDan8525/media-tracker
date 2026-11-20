import { APP_SETTING_DEFAULTS, validateAppSetting, type AppSettingKey, type AppSettings } from '@media-tracker/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi, type Call, type Handler, type MockResponse } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { WHATS_NEW } from '../../whatsNew';

/** A stand-in for the Worker's /api/admin/app routes: validates with the real validators, like the server. */
function adminBackend(extra: Record<string, Handler | MockResponse> = {}) {
  const state = { settings: structuredClone(APP_SETTING_DEFAULTS) as AppSettings, set: [] as AppSettingKey[] };
  const calls: Call[] = mockApi(makeMe({ isAdmin: true }), {
    'GET /api/admin/app': () => ({ body: { settings: state.settings, set: state.set } }),
    'PUT /api/admin/app/:key': (b, _u, p) => {
      const v = validateAppSetting(p.key as AppSettingKey, (b as { value: unknown }).value);
      if (!v.ok) return { status: 400, body: { error: 'invalid' } };
      (state.settings as unknown as Record<string, unknown>)[p.key!] = v.value;
      if (!state.set.includes(p.key as AppSettingKey)) state.set.push(p.key as AppSettingKey);
      return { body: { key: p.key, value: v.value } };
    },
    'DELETE /api/admin/app/:key': (_b, _u, p) => {
      (state.settings as unknown as Record<string, unknown>)[p.key!] = (APP_SETTING_DEFAULTS as unknown as Record<string, unknown>)[p.key!];
      state.set = state.set.filter((k) => k !== p.key);
      return { status: 204 };
    },
    ...extra,
  });
  return { state, calls };
}
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/api/admin/app/'));
beforeEach(() => localStorage.clear());

describe('Admin home (AdminHome)', () => {
  it('lists the sections after Requests, Sign-up links and Members, each opening its sub-page', async () => {
    adminBackend({
      'GET /api/admin': { body: { pending: [], active: [], removed: [] } },
      'GET /api/admin/signup-links': { body: { links: [] } },
      'GET /api/admin/numbers': { body: { members: 6, active7: 4, titles7: 18, messages7: 37, mostRated: [] } },
    });
    renderApp('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    const titles = within(nav).getAllByRole('link').map((a) => within(a).getAllByText(/./)[0]!.textContent);
    expect(titles).toEqual(['Numbers', 'Announcement', 'Switches', 'Lists', 'App text and look', 'Defaults for new people', "What's new / Coming soon / About", 'Photos and voice memos', 'Moderation', 'Lookup tools', 'Backup']);
    expect(await within(nav).findByText('6 members · 4 active this week')).toBeInTheDocument();
    expect(within(nav).getByText('Off')).toBeInTheDocument();
    expect(within(nav).getByText('All on')).toBeInTheDocument();
    expect(within(nav).getByText('9 shown')).toBeInTheDocument();
    expect(within(nav).getByText('Midnight · theme accent')).toBeInTheDocument();
    const order = ['Requests', 'Sign-up links', 'Members', 'More'].map((n) => screen.getByRole('heading', { name: new RegExp(`^${n}`) }));
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Switches/ })).toHaveAttribute('href', '/admin/switches');
  });

  it('is for the admin only: sub-pages send everyone else home', async () => {
    mockApi(makeMe({ isAdmin: false }));
    const { router } = renderApp('/admin/switches');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/list\//));
  });
});

describe('Switches (AD2)', () => {
  it('flipping a switch saves the whole features object and says so', async () => {
    const { calls, state } = adminBackend();
    renderApp('/admin/switches');
    const sw = await screen.findByRole('switch', { name: 'Comments' });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription('Comments on feed posts');
    await userEvent.click(sw);
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.path).toBe('/api/admin/app/features');
    expect((puts(calls)[0]!.body as { value: Record<string, boolean> }).value).toMatchObject({ comments: false, friends: true, signups: true });
    const done = await screen.findByText('Comments is now off.');
    expect(done).toHaveFocus();
    expect(state.settings.features.comments).toBe(false);
  });

  it('a failed save puts the switch back and reports it in an alert', async () => {
    adminBackend({ 'PUT /api/admin/app/:key': { status: 500, body: { error: 'boom' } } });
    renderApp('/admin/switches');
    const sw = await screen.findByRole('switch', { name: 'Messages' });
    await userEvent.click(sw);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the switch");
    expect(sw).toBeChecked();
  });

  it('has a named switch for each feature', async () => {
    adminBackend();
    renderApp('/admin/switches');
    await screen.findByRole('switch', { name: 'Sign-ups open' });
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-labelledby') && document.getElementById(s.getAttribute('aria-labelledby')!)!.textContent))
      .toEqual(['Sign-ups open', 'Friends', 'Activity feed', 'Comments', 'Reactions', 'Messages', 'Close-call questions', 'Walkthrough', 'Install banner', 'Everyone feed shows notes to non-friends', 'Custom lists', 'Photos in chats', 'Voice memos in chats']);
  });

  it('the notes switch is on by default, off saves everyoneNotes: false, and it is in the admin switch list', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/switches');
    const sw = await screen.findByRole('switch', { name: 'Everyone feed shows notes to non-friends' });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]).toMatchObject({ path: '/api/admin/app/features', body: { value: expect.objectContaining({ everyoneNotes: false, feed: true }) } });
    expect(sw).not.toBeChecked();
  });
});

describe('Announcement (AD3)', () => {
  it('saves text, link and end date, previews it, and focuses the result', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/announcement');
    await userEvent.type(await screen.findByLabelText('Text'), 'Server maintenance Sunday 9 pm.');
    expect(screen.getByText('31 / 280')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Preview' })).getByText('Server maintenance Sunday 9 pm.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Link (optional)'), 'https://example.com/s');
    await userEvent.type(screen.getByLabelText('Show until (optional)'), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const ok = await screen.findByText(/Announcement saved/);
    expect(ok).toHaveFocus();
    expect(puts(calls)[0]!.body).toEqual({ value: { text: 'Server maintenance Sunday 9 pm.', link: 'https://example.com/s', endsAt: '2026-12-31' } });
  });

  it('refuses empty text, a bad link and text over 280, with errors tied to the fields', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/announcement');
    const text = await screen.findByLabelText('Text');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Write the announcement first');
    expect(text).toBeInvalid();
    await userEvent.type(text, 'Hi');
    await userEvent.type(screen.getByLabelText('Link (optional)'), 'not a link');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('Link (optional)')).toBeInvalid());
    expect(screen.getAllByText(/Use a full web address/).length).toBeGreaterThan(0);
    expect(puts(calls)).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Link (optional)'));
    await userEvent.clear(text);
    await userEvent.click(text);
    await userEvent.paste('x'.repeat(281));
    expect(screen.getByText(/281 \/ 280/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Keep it to 280 characters');
    expect(puts(calls)).toHaveLength(0);
  });

  it('Turn off removes it', async () => {
    const { calls, state } = adminBackend();
    state.settings.announcement = { id: 'a1', text: 'Hello', link: null, endsAt: null };
    state.set = ['announcement'];
    renderApp('/admin/announcement');
    expect(await screen.findByLabelText('Text')).toHaveValue('Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByText('Announcement turned off.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/app/announcement')).toBe(true);
    expect(screen.getByLabelText('Text')).toHaveValue('');
  });
});

describe('Lists (AD11)', () => {
  const rowNames = () => screen.getAllByRole('listitem').map((li) => within(li).getByText(/^(Anime|Movies|TV Shows|Albums|Songs|Games|Books|Manga|YouTube)/).textContent);

  it('Move down from the ⋯ menu reorders, and Save lists sends order and hidden', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/lists');
    await screen.findByRole('list', { name: 'Lists in order' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Anime' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(rowNames().slice(0, 2)).toEqual(['Movies', 'Anime']);
    await userEvent.click(screen.getByRole('switch', { name: 'Hide Games for everyone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save lists' }));
    await screen.findByText(/Lists saved/);
    expect(puts(calls)[0]!.body).toEqual({ value: { order: ['movies', 'anime', 'tv', 'albums', 'songs', 'games', 'books', 'manga', 'youtube'], hidden: ['games'] } });
    expect(screen.getByText('· 8 shown')).toBeInTheDocument();
  });

  it('the drag handle moves with the arrow keys and keeps focus', async () => {
    adminBackend();
    renderApp('/admin/lists');
    const handle = await screen.findByRole('button', { name: /^Drag Movies to reorder/ });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(rowNames().slice(0, 2)).toEqual(['Movies', 'Anime']);
    expect(screen.getByRole('button', { name: /^Drag Movies to reorder. Position 1 of 9/ })).toHaveFocus();
    expect(screen.getByText(/Movies moved to position 1 of 9/)).toBeInTheDocument();
  });

  it('will not hide the last visible list', async () => {
    const { state } = adminBackend();
    state.settings.lists = { order: state.settings.lists.order, hidden: ['anime', 'movies', 'tv', 'albums', 'songs', 'games', 'books', 'manga'] };
    renderApp('/admin/lists');
    await userEvent.click(await screen.findByRole('switch', { name: 'Hide YouTube for everyone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('At least one list has to stay visible');
  });
});

describe('App text and look (AD5) and Defaults (AD6)', () => {
  it('saves name, welcome text, accent and default theme; the accent reports its contrast', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/look');
    const name = await screen.findByLabelText('App name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Our Shelf');
    await userEvent.type(screen.getByLabelText('Sign-in welcome text'), 'Hi all');
    await userEvent.click(screen.getByRole('radio', { name: 'Gold' }));
    expect(screen.getByText(/Selected: Gold/)).toHaveTextContent(/Selected: Gold\. It passes AA contrast \(4\.5:1\) on Midnight but not on Sakura/);
    await userEvent.selectOptions(screen.getByLabelText('Default theme for new people'), 'Sakura');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('App text and look saved.');
    expect(puts(calls).map((c) => [c.path, c.body])).toEqual([
      ['/api/admin/app/brand', { value: { name: 'Our Shelf', welcome: 'Hi all', accent: '#ffd166' } }],
      ['/api/admin/app/defaults', { value: expect.objectContaining({ theme: 'Sakura' }) }],
    ]);
  });

  it('shows the 40-character counter and refuses an empty name', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/look');
    const name = await screen.findByLabelText('App name');
    expect(screen.getByText('13 / 40')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Give the app a name');
    expect(name).toBeInvalid();
    expect(puts(calls)).toHaveLength(0);
  });

  it('Defaults covers every setting in groups, saves a change at once, and needs one list', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/defaults');
    for (const h of ['Rating', 'Lists', 'Side bar (on a computer)', 'Look', 'Privacy', 'Text size and columns']) expect(await screen.findByRole('heading', { name: h })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Cover viewer' }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ value: expect.objectContaining({ coverViewer: false, theme: 'Midnight', lists: expect.any(Array) }) });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'Sakura');
    await userEvent.click(screen.getByRole('radio', { name: 'On the right' }));
    await userEvent.click(screen.getByRole('switch', { name: 'New titles private' }));
    await waitFor(() => expect(puts(calls)).toHaveLength(4));
    expect(puts(calls)[3]!.body).toEqual({ value: expect.objectContaining({ theme: 'Sakura', navSide: 'right', coverViewer: false, privateByDefault: true }) });
    for (const n of ['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books', 'Manga']) await userEvent.click(screen.getByRole('checkbox', { name: n }));
    await waitFor(() => expect(puts(calls)).toHaveLength(12));
    await userEvent.click(screen.getByRole('checkbox', { name: 'YouTube' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one list');
    expect(puts(calls)).toHaveLength(12);
  });

  it('every per-person row has Reset to built-in and Apply to everyone; device-only rows say "Starting value on new devices" and cannot be applied', async () => {
    adminBackend();
    renderApp('/admin/defaults');
    await screen.findByRole('heading', { name: 'Rating' });
    const applyRows = ['Ask to compare close ratings', 'Lists on', 'Anime seasons', 'TV seasons', 'List order', 'Search', 'Side bar side', 'Side bar folded', 'Cover viewer', 'Theme'];
    for (const r of applyRows) {
      const row = screen.getByRole('group', { name: r });
      expect(within(row).getByRole('button', { name: `Reset ${r} to built-in` })).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: `Apply ${r} to everyone` })).toBeInTheDocument();
    }
    for (const r of ['Side bar width', 'Chat text size', 'Activity text size', 'Table column widths']) {
      const row = screen.getByRole('group', { name: r });
      expect(within(row).getByText(/Starting value on new devices/)).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: /Apply/ })).toBeNull();
      expect(within(row).getByRole('button', { name: `Reset ${r} to built-in` })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('group', { name: 'New titles private' })).queryByRole('button', { name: /Apply/ })).toBeNull();
  });

  it('Apply to everyone asks first ("... for all N people, including those who changed it"), then posts the key; Cancel posts nothing', async () => {
    const { calls } = adminBackend({
      'GET /api/admin/app': () => ({ body: { settings: APP_SETTING_DEFAULTS, set: [], people: 6 } }),
      'POST /api/admin/defaults/apply': () => ({ body: { key: 'theme', people: 6 } }),
    });
    renderApp('/admin/defaults');
    await userEvent.click(await screen.findByRole('button', { name: 'Apply Theme to everyone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply Theme to everyone?' });
    expect(within(dialog).getByText('This changes Theme for all 6 people, including those who changed it.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls.filter((c) => c.path === '/api/admin/defaults/apply')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Apply Theme to everyone' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply to everyone' }));
    expect(await screen.findByText('Theme applied to 6 people.')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/admin/defaults/apply').map((c) => c.body)).toEqual([{ key: 'theme' }]);
  });

  it('Reset to built-in saves the built-in value; a device value saves under device', async () => {
    const { calls, state } = adminBackend();
    state.settings.defaults = { ...state.settings.defaults, theme: 'Sakura', device: { ...state.settings.defaults.device, chatTextSize: 125 } };
    renderApp('/admin/defaults');
    await userEvent.click(await screen.findByRole('button', { name: 'Reset Theme to built-in' }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ value: expect.objectContaining({ theme: 'Midnight' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Reset Chat text size to built-in' }));
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)[1]!.body).toEqual({ value: expect.objectContaining({ device: expect.objectContaining({ chatTextSize: 100 }) }) });
  });
});

describe("What's new / Coming soon / About (AD4)", () => {
  it('starts from the built-in text, saves edits per section, and Use built-in text deletes', async () => {
    const { calls, state } = adminBackend();
    renderApp('/admin/content');
    const version = await screen.findByLabelText('Version name', { selector: '#rel-v-0' });
    expect(version).toHaveValue(WHATS_NEW[0]!.version);
    expect(screen.getAllByText('Showing the built-in text. Saving makes it yours.').length).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: `Add item to version ${WHATS_NEW[0]!.version}` }));
    const newItem = screen.getByLabelText(`Item ${WHATS_NEW[0]!.items.length + 1} of version ${WHATS_NEW[0]!.version}`);
    await userEvent.type(newItem, 'Admin powers');
    await userEvent.click(screen.getByRole('button', { name: "Save what's new" }));
    await screen.findByText("What's new saved.");
    const saved = (puts(calls)[0]!.body as { value: { version: string; items: string[] }[] }).value;
    expect(puts(calls)[0]!.path).toBe('/api/admin/app/whatsNew');
    expect(saved[0]!.items.at(-1)).toBe('Admin powers');
    expect(state.set).toContain('whatsNew');
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    await userEvent.type(screen.getByLabelText(/Coming soon line 3/), 'Year-in-review');
    await userEvent.click(screen.getByRole('button', { name: 'Save coming soon' }));
    await screen.findByText('Coming soon saved.');
    expect((puts(calls)[1]!.body as { value: string[] }).value.at(-1)).toBe('Year-in-review');
    await userEvent.type(screen.getByLabelText('About text'), 'A private shelf.');
    await userEvent.click(screen.getByRole('button', { name: 'Save about' }));
    await screen.findByText('About saved.');
    expect(puts(calls)[2]!.body).toEqual({ value: 'A private shelf.' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Use built-in text' })[0]!);
    await screen.findByText("What's new is back to the built-in text.");
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/app/whatsNew')).toBe(true);
  });

  it('refuses a version with no name, or no items, and says which', async () => {
    const { calls } = adminBackend();
    renderApp('/admin/content');
    await userEvent.click(await screen.findByRole('button', { name: 'Add version' }));
    await userEvent.click(screen.getByRole('button', { name: "Save what's new" }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Version 1 needs a name and a date');
    expect(puts(calls)).toHaveLength(0);
  });
});

describe('Moderation (AD7)', () => {
  const comments = [
    { id: 'c1', body: 'Frieren over Naruto', createdAt: new Date().toISOString(), author: { id: 'u-ren', username: 'ren', displayName: 'Ren', avatarUrl: null, avatarAt: null }, activityId: 'p1', entryId: 'e1', title: 'Frieren', category: 'anime', owner: 'dan' },
    { id: 'c2', body: 'lol no', createdAt: new Date().toISOString(), author: { id: 'u-van', username: 'vance', displayName: null, avatarAt: null }, activityId: null, entryId: 'e2', title: 'Naruto', category: 'anime', owner: null },
  ];

  it('lists recent comments; Delete asks with big buttons, then DELETEs and refreshes', async () => {
    let list = comments;
    const { calls } = adminBackend({
      'GET /api/admin/comments': () => ({ body: { comments: list } }),
      'DELETE /api/comments/:id': (_b: unknown, _u: unknown, p: Record<string, string>) => { list = list.filter((c) => c.id !== p.id); return { status: 204 }; },
    });
    renderApp('/admin/moderation');
    expect(await screen.findByText('Frieren over Naruto')).toBeInTheDocument();
    expect(screen.getByText('on Frieren (@dan)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete comment by Ren' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete this comment?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(within(sheet).getByRole('button', { name: 'Delete comment' })).toHaveClass('btn--big');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(screen.queryByText('Frieren over Naruto')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/comments/c1']);
    expect(screen.getByText('lol no')).toBeInTheDocument();
  });

  it('Cancel sends nothing', async () => {
    const { calls } = adminBackend({ 'GET /api/admin/comments': { body: { comments } } });
    renderApp('/admin/moderation');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete comment by Ren' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('Numbers (AD9)', () => {
  it('shows the four counts and the most-rated top 10', async () => {
    adminBackend({ 'GET /api/admin/numbers': { body: { members: 6, active7: 4, titles7: 18, messages7: 37, mostRated: [
      { title: 'Frieren', category: 'anime', count: 9, average: 9.1 }, { title: 'Hades', category: 'games', count: 8, average: 8.8 },
    ] } } });
    renderApp('/admin/numbers');
    await screen.findByText('Active, 7 days');
    for (const [label, n] of [['Members', '6'], ['Active, 7 days', '4'], ['Titles added', '18'], ['Messages', '37']] as const) {
      expect(within(document.querySelector<HTMLElement>('.admin-stats')!).getByText(label).closest('div')).toHaveTextContent(n);
    }
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('1Frieren · Anime9×');
    expect(within(rows[1]!).getByLabelText('rated by 8 people')).toBeInTheDocument();
  });
});

describe('Lookup tools (AD8)', () => {
  it('Check sources shows OK, Slow, Failing and Not set up with times and errors', async () => {
    adminBackend({ 'POST /api/admin/lookup/check': { body: { sources: [
      { source: 'kitsu', label: 'Kitsu (anime)', query: 'Cowboy Bebop', ok: true, ms: 320 },
      { source: 'tmdb', label: 'TMDB (movies)', query: 'Inception', ok: true, ms: 4100 },
      { source: 'igdb', label: 'IGDB (games)', query: 'Portal 2', ok: false, ms: 80, error: '401 bad credentials' },
      { source: 'steam', label: 'Steam (games)', query: 'Portal 2', ok: null, ms: 0, error: 'not set up' },
    ] } } });
    renderApp('/admin/lookup');
    await userEvent.click(await screen.findByRole('button', { name: 'Check sources' }));
    const list = await screen.findByRole('list', { name: 'Source results' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Kitsu (anime)OK320 ms');
    expect(rows[1]).toHaveTextContent('TMDB (movies)Slow4100 ms');
    expect(rows[2]).toHaveTextContent('IGDB (games)Failing80 ms401 bad credentials');
    expect(rows[3]).toHaveTextContent('Steam (games)Not set up');
  });

  it("Why didn't it find this? posts list and title, and shows each step and the result", async () => {
    const { calls } = adminBackend({ 'POST /api/admin/lookup/explain': { body: {
      category: 'anime', title: 'Sousou no Frieren', found: 'Frieren', cached: null,
      steps: [{ source: 'kitsu', query: 'Sousou no Frieren', results: 0 }, { source: 'anilist', query: 'Frieren', results: 4, chosen: 'Frieren', reason: 'title match' }],
    } } });
    renderApp('/admin/lookup');
    await userEvent.type(await screen.findByLabelText('Title'), 'Sousou no Frieren{Enter}');
    const steps = await screen.findByRole('status', { name: 'Lookup steps' });
    expect(calls.find((c) => c.path === '/api/admin/lookup/explain')!.body).toEqual({ category: 'anime', title: 'Sousou no Frieren' });
    const items = within(steps).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('kitsu “Sousou no Frieren” → 0 results');
    expect(items[1]).toHaveTextContent('anilist “Frieren” → 4 results · chose “Frieren” · title match');
    expect(steps).toHaveTextContent('Result: “Frieren”');
  });

  it('needs a title', async () => {
    adminBackend();
    renderApp('/admin/lookup');
    await userEvent.click(await screen.findByRole('button', { name: 'Explain the lookup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Type the title to look up.');
  });
});

describe('Backup (AD10)', () => {
  let click: ReturnType<typeof vi.spyOn>;
  let downloaded: string[] = [];
  beforeEach(() => {
    downloaded = [];
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:backup';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download); });
  });
  afterEach(() => click.mockRestore());

  it('fetches the backup and saves it as media-tracker-backup-YYYY-MM-DD.json', async () => {
    adminBackend({ 'GET /api/admin/backup': { body: { app: 'media-tracker', tables: {} } } });
    renderApp('/admin/backup');
    await userEvent.click(await screen.findByRole('button', { name: 'Download a backup' }));
    const ok = await screen.findByText(/Backup downloaded/);
    const today = new Date().toISOString().slice(0, 10);
    expect(downloaded).toEqual([`media-tracker-backup-${today}.json`]);
    expect(ok).toHaveTextContent(`Backup downloaded: media-tracker-backup-${today}.json`);
    expect(screen.getByText('Passwords and sign-in tokens are left out.')).toBeInTheDocument();
    expect(screen.getByText('How to restore')).toBeInTheDocument();
  });

  it('says so when the download fails', async () => {
    adminBackend({ 'GET /api/admin/backup': { status: 500, body: { error: 'boom' } } });
    renderApp('/admin/backup');
    await userEvent.click(await screen.findByRole('button', { name: 'Download a backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't download the backup");
    expect(downloaded).toEqual([]);
  });
});

describe('Photos and voice memos (media storage)', () => {
  it('shows storage in use and saves the two clean-up settings', async () => {
    const { calls } = adminBackend({
      'GET /api/admin/media': { body: { bytes: 5 * 1024 * 1024, files: 12, configured: true, people: [{ userId: 'u2', username: 'ren', bytes: 3 * 1024 * 1024 }] } },
    });
    renderApp('/admin/media');
    expect(await screen.findByText('5.0 MB')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('@ren')).toBeInTheDocument();
    const months = screen.getByLabelText('Keep photos and voice memos for (months)');
    const cap = screen.getByLabelText('Storage per person (MB)');
    expect(months).toHaveValue(6);
    expect(cap).toHaveValue(300);
    await userEvent.clear(months);
    await userEvent.type(months, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Months must be a whole number from 1 to 24.');
    await userEvent.clear(months);
    await userEvent.type(months, '3');
    await userEvent.clear(cap);
    await userEvent.type(cap, '500');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts(calls).at(-1)).toMatchObject({ path: '/api/admin/app/media', body: { value: { retentionMonths: 3, capMb: 500 } } }));
  });

  it('says when the server has no storage yet', async () => {
    adminBackend({ 'GET /api/admin/media': { body: { bytes: 0, files: 0, configured: false, people: [] } } });
    renderApp('/admin/media');
    expect(await screen.findByText(/isn't set up on the server yet/)).toBeInTheDocument();
  });
});

describe("Update everyone's app (admin home)", () => {
  it('asks to confirm, posts once, and then says when it was sent', async () => {
    const sent = '2026-11-20T15:55:00.000Z';
    const { calls } = adminBackend({
      'GET /api/admin': { body: { pending: [], active: [], removed: [] } },
      'GET /api/admin/signup-links': { body: { links: [] } },
      'GET /api/admin/numbers': { body: { members: 1, active7: 1, titles7: 0, messages7: 0, mostRated: [] } },
      'POST /api/admin/app/reload': { body: { reloadAt: sent } },
    });
    renderApp('/admin');
    expect(await screen.findByText(/reloads to the newest version the next time they open it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Update everyone's app" }));
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/admin/app/reload')).toHaveLength(0);
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Update everyone' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/admin/app/reload')).toHaveLength(1));
    const time = new Date(sent).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(await screen.findByText(new RegExp(`Sent at ${time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
  });

  it('Cancel sends nothing', async () => {
    const { calls } = adminBackend({
      'GET /api/admin': { body: { pending: [], active: [], removed: [] } },
      'GET /api/admin/signup-links': { body: { links: [] } },
      'GET /api/admin/numbers': { body: { members: 1, active7: 1, titles7: 0, messages7: 0, mostRated: [] } },
    });
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: "Update everyone's app" }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/admin/app/reload')).toHaveLength(0);
  });
});
