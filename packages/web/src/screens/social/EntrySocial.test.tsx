import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';

describe('EntrySocial on your own entry', () => {
  it('shows the reactions and "2 comments", toggles a reaction and opens the thread for the entry', async () => {
    const entry = makeEntry({ id: 'e-fr', title: 'Frieren' });
    const { calls } = fakeBackend({ entries: [entry], extra: {
      'GET /api/reactions': { body: { reactions: { '👏': 2 }, mine: [], comments: 2 } },
      'POST /api/reactions': { body: { reactions: { '👏': 3 }, mine: ['👏'], comments: 2 } },
      'GET /api/comments': { body: [] },
    } });
    renderApp('/entry/e-fr');
    const clap = await screen.findByRole('button', { name: '👏 2' });
    await userEvent.click(clap);
    expect(await screen.findByRole('button', { name: '👏 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/reactions')!.body).toEqual({ entryId: 'e-fr', emoji: '👏' });
    await userEvent.click(screen.getByRole('button', { name: '2 comments' }));
    expect(await screen.findByRole('dialog', { name: 'Comments' })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/comments?entryId=e-fr')).toBe(true));
  });

  it('is left out when the entry is private (nobody else can see it)', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'e-s', title: 'Secret Show', isPrivate: true })] });
    renderApp('/entry/e-s');
    await screen.findByRole('switch', { name: 'Private — only you see this title' });
    expect(screen.queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument();
  });
});
