import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('SettingsScreen', () => {
  it('turning a tab off removes it from BottomTabs', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const tabs = await screen.findByRole('navigation', { name: 'Lists' });
    expect(within(tabs).getByRole('link', { name: 'Albums' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Albums' }));

    await waitFor(() => expect(within(tabs).queryByRole('link', { name: 'Albums' })).not.toBeInTheDocument());
    expect(within(tabs).getByRole('link', { name: 'Songs' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Albums' })).not.toBeChecked();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { tabs: { albums: false } } }));
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
    expect(call?.init?.credentials).toBe('include');

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
});
