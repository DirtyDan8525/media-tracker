import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const NAMES = ['Adding titles', 'Rating', 'Plan to watch and drag order', 'Episode progress', 'Lists and filters', 'Friends', 'Messages and recommendations',
  'Activity and reactions', 'Public profile link', 'Privacy', 'Installing the app'];

describe('Help & how-tos', () => {
  it('More has a Help & how-tos row and an Install instructions row', async () => {
    mockApi(makeMe());
    renderApp('/more');
    expect(await screen.findByRole('link', { name: 'Help & how-tos' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: 'Install instructions' })).toHaveAttribute('href', '/install');
  });

  it('lists the sections, each a closed collapsible that opens on tap; no Admin section for a non-admin', async () => {
    mockApi(makeMe({ isAdmin: false }));
    renderApp('/help');
    await screen.findByRole('heading', { level: 1, name: 'Help & how-tos' });
    for (const n of NAMES) expect(screen.getByText(n, { selector: 'summary' })).toBeInTheDocument();
    expect(screen.queryByText('Admin', { selector: 'summary' })).not.toBeInTheDocument();
    const summary = screen.getByText('Adding titles', { selector: 'summary' });
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(within(summary.closest('details')!).getByText(/Paste a Spotify link/i)).toBeInTheDocument();
  });

  it('the admin also sees the Admin section', async () => {
    mockApi(makeMe({ isAdmin: true }));
    renderApp('/help');
    expect(await screen.findByText('Admin', { selector: 'summary' })).toBeInTheDocument();
  });

  it('search narrows the sections and says when nothing matches', async () => {
    mockApi(makeMe());
    renderApp('/help');
    const box = await screen.findByRole('searchbox', { name: 'Search help' });
    await userEvent.type(box, 'spotify');
    expect(screen.getByText('Adding titles', { selector: 'summary' })).toBeInTheDocument();
    expect(screen.queryByText('Friends', { selector: 'summary' })).not.toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'zzzzqq');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('Show the walkthrough again re-opens it', async () => {
    mockApi(makeMe());
    renderApp('/help');
    await userEvent.click(await screen.findByRole('button', { name: 'Show the walkthrough again' }));
    expect(screen.getByRole('dialog', { name: 'Your lists' })).toBeInTheDocument();
  });
});

describe('Install instructions', () => {
  it('has three sections: iPhone / iPad, Android and PC', async () => {
    mockApi(makeMe());
    renderApp('/install');
    await screen.findByRole('heading', { level: 1, name: 'Install instructions' });
    const ios = screen.getByRole('region', { name: /iPhone \/ iPad/ });
    expect(within(ios).getAllByText('Add to Home Screen', { selector: 'strong' }).length).toBeGreaterThan(0);
    expect(within(ios).getByText('Open as Web App', { selector: 'strong' })).toBeInTheDocument();
    expect(within(ios).getByText('Edit Actions', { selector: 'strong' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Android/ })).getByText('Install app', { selector: 'strong' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /PC/ })).getByText('Install page as app', { selector: 'strong' })).toBeInTheDocument();
  });
});
