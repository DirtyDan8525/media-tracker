import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  it('shows the username and the current theme picked', async () => {
    mockApi(makeMe());
    renderApp('/settings');
    expect(await screen.findByText('@dan')).toBeInTheDocument();
    expect(screen.queryByText('Theme: Midnight')).not.toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: 'Theme' })).getByRole('radio', { name: 'Midnight' })).toBeChecked();
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
