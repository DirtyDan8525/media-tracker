import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';

describe('EntrySocial on your own entry', () => {
  it('shows the reaction chips and "Comment (2)", toggles a reaction and opens the thread for the entry', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Comment (2)' }));
    expect(await screen.findByRole('dialog', { name: 'Comments' })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/comments?entryId=e-fr')).toBe(true));
  });

  it('has the same React control: quick emoji and typed emoji, one-emoji error', async () => {
    const entry = makeEntry({ id: 'e-fr', title: 'Frieren' });
    const { calls } = fakeBackend({ entries: [entry], extra: {
      'GET /api/reactions': { body: { reactions: {}, mine: [], comments: 0 } },
      'POST /api/reactions': { body: { reactions: { '🔥': 1 }, mine: ['🔥'], comments: 0 } },
    } });
    renderApp('/entry/e-fr');
    expect(await screen.findByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    await userEvent.click(screen.getByRole('button', { name: 'More emojis' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Type any emoji' }), 'ab');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Just one emoji, please.');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Type any emoji' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Type any emoji' }), '🔥');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/api/reactions')!.body).toEqual({ entryId: 'e-fr', emoji: '🔥' }));
  });

  it('is left out when the entry is private (nobody else can see it)', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'e-s', title: 'Secret Show', isPrivate: true })] });
    renderApp('/entry/e-s');
    await screen.findByRole('switch', { name: 'Private — only you see this title' });
    expect(screen.queryByRole('button', { name: 'React' })).not.toBeInTheDocument();
  });
});
