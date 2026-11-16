import { screen, waitFor, within } from '@testing-library/react';
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

  it('has the sections Ratings (Compare, Top 5, Stats), Your data and App (What is new, Coming soon, About), and nothing else', async () => {
    mockApi(makeMe({ isAdmin: false }));
    renderApp('/more');
    await screen.findByRole('region', { name: 'Ratings' });
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Ratings', 'Your data', 'App']);
    expect(within(screen.getByRole('region', { name: 'Ratings' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Compare', 'Top 5', 'Stats']);
    expect(within(screen.getByRole('region', { name: 'App' })).getAllByRole('link').map((a) => a.textContent)).toEqual(["What's new", 'Coming soon', 'About Media Tracker']);
  });

  it('How to use the app re-opens the walkthrough', async () => {
    mockApi(makeMe());
    renderApp('/more');
    await userEvent.click(await screen.findByRole('button', { name: 'How to use the app' }));
    expect(screen.getByRole('dialog', { name: 'Your lists' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no Settings, Appearance, tier or Other lists rows (those live under Profile → Settings), even with lists beyond the fourth enabled', async () => {
    mockApi(makeMe());
    renderApp('/more');
    await screen.findByRole('region', { name: 'Ratings' });
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Other lists' })).not.toBeInTheDocument();
    for (const name of [/^Settings/, /^Appearance/, /^Comparing/, /^Rating tiers/, /^Re-tier review/, /^Books/, /^Songs/, /^Games/]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('Back on Appearance returns to Settings when you came from Settings', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/settings');
    await userEvent.click(await screen.findByRole('link', { name: 'Appearance Midnight' }));
    await screen.findByRole('radiogroup', { name: 'Theme' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('Back on Appearance opened directly falls back to Settings', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/settings/appearance');
    await screen.findByRole('radiogroup', { name: 'Theme' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('the admin gets an Admin row linking to /admin', async () => {
    mockApi(makeMe({ isAdmin: true }));
    renderApp('/more');
    const region = await screen.findByRole('region', { name: 'Admin' });
    expect(within(region).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('a non-admin has no Admin row, and /admin sends them home', async () => {
    mockApi(makeMe({ isAdmin: false }));
    const { router } = renderApp('/more');
    await screen.findByRole('region', { name: 'Ratings' });
    expect(screen.queryByRole('region', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    await router.navigate('/admin');
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/anime'));
    expect(screen.queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument();
  });
});
