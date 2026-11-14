import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { setCompareEnabled } from '../test/flags';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('More (SettingsMore.v2)', () => {
  it('has Import and Export my data under Your data', async () => {
    mockApi(makeMe());
    renderApp('/more');
    const data = await screen.findByRole('region', { name: 'Your data' });
    expect(within(data).getByRole('link', { name: 'Import from Google Sheets' })).toHaveAttribute('href', '/import');
    expect(within(data).getByRole('button', { name: 'Export my data' })).toHaveAccessibleDescription('.json file');
  });

  it('with Compare hidden: Ratings has Top 5 and Stats only, Settings has Appearance without the Ask subtitle, and no queue is fetched', async () => {
    const me = makeMe();
    const calls = mockApi(makeMe({ settings: { ...me.settings, theme: 'Sakura', compareAsk: 'Only for new ratings' } }));
    const { router } = renderApp('/more');
    const ratings = await screen.findByRole('region', { name: 'Ratings' });
    expect(within(ratings).getAllByRole('link').map((a) => a.textContent)).toEqual(['Top 5', 'Stats']);
    const settings = screen.getByRole('region', { name: 'Settings' });
    expect(within(settings).getAllByRole('link').map((a) => a.textContent)).toEqual(['Appearance Sakura']);
    expect(screen.queryByText(/Ask:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Compare/ })).not.toBeInTheDocument();
    await userEvent.click(within(settings).getByRole('link', { name: 'Appearance Sakura' }));
    expect(router.state.location.pathname).toBe('/settings/appearance');
    expect(calls.some((c) => c.path.includes('/api/compare/queue'))).toBe(false);
  });

  it('has Appearance and Comparing rows under Settings that open the Appearance page', async () => {
    setCompareEnabled(true);
    const me = makeMe();
    mockApi(makeMe({ settings: { ...me.settings, theme: 'Sakura', compareAsk: 'Only for new ratings' } }));
    const { router } = renderApp('/more');
    const settings = await screen.findByRole('region', { name: 'Settings' });
    expect(within(settings).getByRole('link', { name: 'Comparing Ask: Only for new ratings' })).toBeInTheDocument();
    await userEvent.click(within(settings).getByRole('link', { name: 'Appearance Sakura' }));
    expect(router.state.location.pathname).toBe('/settings/appearance');
    expect(await screen.findByRole('radio', { name: 'Sakura' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/more');
  });

  it('Back on Appearance returns to Settings when you came from Settings', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/settings');
    await userEvent.click(await screen.findByRole('link', { name: 'Appearance Midnight' }));
    await screen.findByRole('radiogroup', { name: 'Theme' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('Back on Appearance opened directly falls back to More', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/settings/appearance');
    await screen.findByRole('radiogroup', { name: 'Theme' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/more'));
  });
});
