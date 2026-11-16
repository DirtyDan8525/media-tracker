import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { COMING_SOON, WHATS_NEW } from '../whatsNew';

describe('What\'s new', () => {
  it('More has What\'s new and Coming soon rows that open /whats-new', async () => {
    mockApi(makeMe());
    const { router } = renderApp('/more');
    const app = within(await screen.findByRole('region', { name: 'App' }));
    expect(app.getByRole('link', { name: "What's new" })).toHaveAttribute('href', '/whats-new');
    await userEvent.click(app.getByRole('link', { name: 'Coming soon' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/whats-new'));
  });

  it('lists every release and the coming-soon items from whatsNew.ts', async () => {
    mockApi(makeMe());
    renderApp('/whats-new');
    const now = within(await screen.findByRole('region', { name: "What's new" }));
    for (const r of WHATS_NEW) {
      expect(now.getByRole('heading', { name: new RegExp(r.version) })).toBeInTheDocument();
      for (const item of r.items) expect(now.getByText(item)).toBeInTheDocument();
    }
    const soon = within(screen.getByRole('region', { name: 'Coming soon' }));
    for (const item of COMING_SOON) expect(soon.getByText(item)).toBeInTheDocument();
  });

  it('covers Phase 4 and Phase 5, and Messages and notifications are coming soon', () => {
    expect(WHATS_NEW.map((r) => r.version)).toEqual(['Phase 5', 'Phase 4']);
    expect(COMING_SOON).toEqual(['Messages with friends', 'Notifications']);
  });
});
