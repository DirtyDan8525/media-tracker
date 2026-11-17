import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi, type Call } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').map((c) => c.body);
const withAsk = (compareAsk: string) => { const me = makeMe(); return makeMe({ settings: { ...me.settings, compareAsk } }); };
const toggle = async () => within(await screen.findByRole('region', { name: 'Ratings' })).getByRole('switch', { name: 'Ask me to compare close ratings' });

describe('Settings: Ask me to compare close ratings (N9)', () => {
  it.each([['Both', true], ['Only for new ratings', true], ['Only when I start it', false], ['Off', false]])(
    'compareAsk %s reads as %s', async (ask, on) => {
      mockApi(withAsk(ask));
      renderApp('/settings');
      if (on) expect(await toggle()).toBeChecked(); else expect(await toggle()).not.toBeChecked();
    });

  it('turning it off saves Off; on saves Both', async () => {
    const calls = mockApi(withAsk('Both'));
    renderApp('/settings');
    await userEvent.click(await toggle());
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { compareAsk: 'Off' } }]));
    await userEvent.click(await toggle());
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { compareAsk: 'Off' } }, { settings: { compareAsk: 'Both' } }]));
  });

  it('links to Sharpen my ratings', async () => {
    mockApi(makeMe());
    renderApp('/settings');
    expect(within(await screen.findByRole('region', { name: 'Ratings' })).getByRole('link', { name: 'Sharpen my ratings' })).toHaveAttribute('href', '/sharpen');
  });
});
