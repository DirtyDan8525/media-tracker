import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('SettingsScreen', () => {
  it('turning a list off removes it from the list dropdown', async () => {
    const calls = mockApi(makeMe());
    const { router } = renderApp('/settings');
    await userEvent.click(await screen.findByRole('switch', { name: 'Albums' }));
    expect(screen.getByRole('switch', { name: 'Albums' })).not.toBeChecked();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { tabs: { albums: false } } }));

    await router.navigate('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Anime' }));
    const menu = screen.getByRole('menu', { name: 'Switch list' });
    expect(within(menu).queryByRole('menuitem', { name: /^Albums/ })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Songs/ })).toBeInTheDocument();
  });

  it('shows switches for every list and both season tabs', async () => {
    mockApi(makeMe({}, { songs: false }));
    renderApp('/settings');
    for (const name of ['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books', 'Anime Seasons', 'TV Seasons']) {
      expect(await screen.findByRole('switch', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('switch', { name: 'Songs' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Anime Seasons' })).toBeChecked();
  });

  it('turns a tab back on if the save fails', async () => {
    mockApi(makeMe(), { 'PUT /api/me/settings': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('switch', { name: 'Books' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Books' })).toBeChecked());
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your settings");
  });

  it('shows the username, and links to Appearance (the theme) and Comparing', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/settings');
    expect(await screen.findByText('@dan')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Appearance Midnight' })).toHaveAttribute('href', '/settings/appearance');
    expect(screen.getByRole('link', { name: 'Comparing Ask: Both' })).toHaveAttribute('href', '/settings/appearance');
    await userEvent.click(screen.getByRole('link', { name: 'Appearance Midnight' }));
    expect(router.state.location.pathname).toBe('/settings/appearance');
    expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Comparing' })).toBeInTheDocument();
  });

  it('has the rating tier links (Rating tiers, Re-tier review) beside Comparing, reached from Profile', async () => {
    mockApi(makeMe({}, { anime: false }));
    const { router } = renderApp('/profile');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    const section = await screen.findByRole('region', { name: 'Appearance and comparing' });
    expect(within(section).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Appearance Midnight', 'Rating tiers', 'Re-tier review', 'Comparing Ask: Both',
    ]);
    expect(within(section).getByRole('link', { name: 'Rating tiers' })).toHaveAttribute('href', '/settings/tiers');
    // Re-tier review opens the first enabled list.
    expect(within(section).getByRole('link', { name: 'Re-tier review' })).toHaveAttribute('href', '/retier/movies');
  });

  it('changes the username, showing a taken error inline', async () => {
    const me = makeMe();
    let n = 0;
    mockApi(me, {
      'PUT /api/me/username': (b) => (n++ === 0
        ? { status: 409, body: { error: 'taken' } }
        : { body: { ...me, username: (b as { username: string }).username } }),
    });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Change username' }));
    const input = screen.getByRole('textbox', { name: 'Username' });
    await userEvent.clear(input);
    await userEvent.type(input, 'ren');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken. Try another one.');
    await userEvent.clear(input);
    await userEvent.type(input, 'dan2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('@dan2')).toBeInTheDocument();
  });
});

describe('Settings: Export my data', () => {
  let anchors: HTMLAnchorElement[];
  let created: Blob[];
  const revoke = vi.fn();
  beforeEach(() => {
    revoke.mockClear();
    anchors = [];
    created = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (b: Blob) => { created.push(b); return 'blob:export'; } });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this); });
  });
  afterEach(() => {
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  const exported = { entries: [{ id: 'e1', title: 'Frieren' }], seasons: [], settings: { theme: 'Midnight' } };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('fetches /api/export with credentials and downloads it as a dated .json file, then frees the blob', async () => {
    let finish: (r: { body: unknown }) => void = () => {};
    const calls = mockApi(makeMe(), { 'GET /api/export': () => new Promise((r) => { finish = r; }) });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Export my data' }));

    const busy = await screen.findByRole('button', { name: 'Exporting…' });
    expect(busy).toBeDisabled();
    const call = calls.find((c) => c.path === '/api/export');
    expect(call?.method).toBe('GET');
    expect(call?.init?.credentials).toBe('same-origin');

    finish({ body: exported });
    await waitFor(() => expect(anchors).toHaveLength(1));
    const a = anchors[0]!;
    expect(a.download).toMatch(/^media-tracker-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(a.download).toBe(`media-tracker-export-${today()}.json`);
    expect(a.getAttribute('href')).toBe('blob:export');
    expect(created).toHaveLength(1);
    expect(created[0]!.type).toBe('application/json');
    expect(JSON.parse(await created[0]!.text())).toEqual(exported);
    expect(a.isConnected).toBe(false);
    expect(await screen.findByRole('button', { name: 'Export my data' })).toBeEnabled();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:export'), { timeout: 2000 });
  });

  it('a failed export shows the toast and lets you try again', async () => {
    mockApi(makeMe(), { 'GET /api/export': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Export my data' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't export your data. Try again.");
    expect(await screen.findByRole('button', { name: 'Export my data' })).toBeEnabled();
    expect(anchors).toHaveLength(0);
  });

  it('Search setting: a real radio group, defaults to All lists, saves "Only the current list", arrow keys move it', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const group = await screen.findByRole('radiogroup', { name: 'Where Search looks' });
    const all = within(group).getByRole('radio', { name: 'All lists' });
    expect(all.tagName).toBe('INPUT');
    expect(all).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'Only the current list' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { searchScope: 'current' } }));
    expect(within(group).getByRole('radio', { name: 'Only the current list' })).toBeChecked();
    within(group).getByRole('radio', { name: 'Only the current list' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(group).getByRole('radio', { name: 'All lists' })).toBeChecked();
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ settings: { searchScope: 'all' } }));
  });

  it('Back (phone) goes to /profile', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });

  it('Back returns to the previous screen when you came from Profile', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/profile');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });

  it('saves a display name, and Remove (empty) clears it', async () => {
    const me = makeMe();
    const calls = mockApi(me, {
      'PUT /api/me/display-name': (b) => ({ body: { ...me, displayName: (b as { displayName: string | null }).displayName } }),
    });
    renderApp('/settings');
    expect(await screen.findByText('Not set')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change display name' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Display name' }), ' Danny ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Display name saved')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/me/display-name')?.body).toEqual({ displayName: 'Danny' });
    expect(await screen.findByText('Danny')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Change display name' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Display name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/me/display-name').at(-1)?.body).toEqual({ displayName: null }));
    expect(await screen.findByText('Not set')).toBeInTheDocument();
  });

  it('a failed display-name save shows an alert and keeps the form', async () => {
    mockApi(makeMe(), { 'PUT /api/me/display-name': { status: 500, body: { error: 'x' } } });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Change display name' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Display name' }), 'Danny');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your display name");
  });

  it('Copy invite link fetches the code and copies the /add/ link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const calls = mockApi(makeMe(), { 'GET /api/me/invite': { body: { code: 'k3f9x2m8q1ab' } } });
    renderApp('/settings');
    await screen.findByText('Invite link');
    expect(calls.some((c) => c.path === '/api/me/invite')).toBe(false); // nothing is made just by opening Settings
    await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/add/k3f9x2m8q1ab`));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });
});
