import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../design/components/Toast';
import { makeEntry } from '../../test/fakeBackend';
import { makeQueryClient } from '../../test/queryClient';
import { EntryCards } from './EntryCards';
import { EntryTable } from './EntryTable';

const actions = { onRetry: () => {}, onPaste: () => {} };
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={makeQueryClient()}><ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider></QueryClientProvider>,
);

describe('EntryCards', () => {
  it('a private row shows a lock labelled "Private"; a public row has none', () => {
    wrap(<EntryCards label="Anime list" rows={[makeEntry({ title: 'Secret Show', isPrivate: true }), makeEntry({ title: 'Frieren' })]} {...actions} />);
    const [secret, open] = screen.getAllByRole('listitem');
    expect(within(secret!).getByRole('img', { name: 'Private' })).toBeInTheDocument();
    expect(within(open!).queryByRole('img', { name: 'Private' })).not.toBeInTheDocument();
    expect(secret!.querySelector('[data-role="title"]')!.textContent).toBe('Secret Show');
  });
});

describe('EntryTable', () => {
  it('a private row shows a lock labelled "Private"; a public row has none', () => {
    wrap(<EntryTable label="Anime list" showSeasonAvg={false} rows={[makeEntry({ title: 'Secret Show', isPrivate: true }), makeEntry({ title: 'Frieren' })]} {...actions} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByRole('img', { name: 'Private' })).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('img', { name: 'Private' })).not.toBeInTheDocument();
  });
});
