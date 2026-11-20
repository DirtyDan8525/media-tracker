import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../../test/friends';
import { messagesBackend } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

const MINE = 'https://img.example/mine.jpg';
const MINE_LOW = 'https://img.example/mine-low.jpg'; // not in the Top 5 of its list
const THEIRS = 'https://img.example/theirs.jpg';

function setup() {
  const b = messagesBackend();
  const mine = [...[9, 8, 7, 6, 5].map((r, i) => makeEntry({ title: `Top ${i}`, rating: r, coverUrl: MINE })), makeEntry({ title: 'Low', rating: 3, coverUrl: MINE_LOW })];
  fakeBackend({
    me: makeMe(), entries: mine,
    extra: {
      ...b.handlers, 'GET /api/friends': { body: friendsOf(REN) },
      'GET /api/users/:u/entries': { body: [makeFriendEntry({ title: 'T', rating: 10, coverUrl: THEIRS })] },
    } as never,
  });
}

describe('Messages backdrop on PC', () => {
  it('an open chat has a blurred cover from my top titles or theirs, never one outside the Top 5', async () => {
    setViewportWidth(1280);
    setup();
    const { container } = renderApp('/messages/c1');
    await screen.findByRole('heading', { level: 1, name: 'Ren' });
    await waitFor(() => expect(container.querySelector('.chat-page .backdrop--side img')).not.toBeNull());
    const src = container.querySelector('.chat-page .backdrop--side img')!.getAttribute('src')!;
    expect([MINE, THEIRS]).toContain(src);
  });

  it('the Messages list uses one of my top titles, and stays put when the screen re-renders', async () => {
    setViewportWidth(1280);
    setup();
    const { container } = renderApp('/messages');
    await waitFor(() => expect(container.querySelector('.messages-col')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('.messages-screen .backdrop--side img')).not.toBeNull());
    const img = () => container.querySelector('.messages-screen .backdrop--side img')!.getAttribute('src');
    expect(img()).toBe(MINE);
    expect(container.querySelector('.messages-screen .backdrop--side')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the phone has no backdrop', async () => {
    setViewportWidth(390);
    setup();
    const { container } = renderApp('/messages/c1');
    await screen.findByRole('heading', { level: 1, name: 'Ren' });
    expect(container.querySelector('.backdrop')).toBeNull();
  });
});
