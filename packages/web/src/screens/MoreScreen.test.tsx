import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  it('has Appearance and Comparing rows under Settings that open the Appearance page', async () => {
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
});
