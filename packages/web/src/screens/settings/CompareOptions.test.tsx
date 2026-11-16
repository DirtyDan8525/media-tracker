import { COMPARE_ASK } from '@media-tracker/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeMe, mockApi, type Call } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setCompareEnabled } from '../../test/flags';

beforeEach(() => setCompareEnabled(true)); // these exercise Compare, which is hidden in the real build

const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').map((c) => c.body);
const withSettings = (over: Partial<ReturnType<typeof makeMe>['settings']>) => {
  const me = makeMe();
  return makeMe({ settings: { ...me.settings, ...over } });
};

describe('Settings: Comparing', () => {
  it('shows only "Ask to compare", with its current value and every choice', async () => {
    mockApi(withSettings({ compareAsk: 'Off' }));
    renderApp('/settings/appearance');
    const section = await screen.findByRole('region', { name: 'Comparing' });
    const ask = within(section).getByRole('combobox', { name: 'Ask to compare' });
    expect(ask).toHaveValue('Off');
    expect(within(ask).getAllByRole('option').map((o) => o.textContent)).toEqual([...COMPARE_ASK]);
    // The Sheet's other three options are gone (Ruling Q1).
    expect(within(section).getAllByRole('combobox')).toHaveLength(1);
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(section).queryByText(/Re-rating style|no room|Compare within/)).not.toBeInTheDocument();
  });

  it('choosing Only for new ratings saves it', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings/appearance');
    const select = await screen.findByRole('combobox', { name: 'Ask to compare' });
    await userEvent.selectOptions(select, 'Only for new ratings');
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { compareAsk: 'Only for new ratings' } }]));
    expect(select).toHaveValue('Only for new ratings');
  });

  it('a failed save shows the toast and the old value comes back', async () => {
    mockApi(makeMe(), { 'PUT /api/me/settings': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings/appearance');
    const select = await screen.findByRole('combobox', { name: 'Ask to compare' });
    await userEvent.selectOptions(select, 'Off');
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your settings. Try again.");
    await waitFor(() => expect(select).toHaveValue('Both'));
  });
});
