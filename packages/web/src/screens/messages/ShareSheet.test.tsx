import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../../test/friends';
import { ALBERTO, makeConversation, messagesBackend, ME, REN_U, VANCE } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const frieren = () => makeEntry({ id: 'f1', category: 'anime', title: 'Frieren', rating: 9, creator: 'Madhouse', coverUrl: 'https://img.example/f.jpg', source: 'kitsu', sourceId: '154587' });
const VAN = { id: 'id-van', username: 'vance', displayName: 'Vance', avatarAt: null };

function setup(extra: Record<string, unknown> = {}) {
  const b = messagesBackend({
    conversations: [makeConversation(), makeConversation({ id: 'g1', kind: 'group', name: 'Anime night', members: [ME, REN_U, ALBERTO] })],
  });
  const { calls } = fakeBackend({ me: makeMe(), entries: [frieren()], extra: { ...b.handlers, 'GET /api/friends': { body: friendsOf(REN, VAN) }, ...extra } as never });
  return { calls, ...b, VANCE };
}

describe('Share on a title page', () => {
  it('your title: Share opens a sheet with friends and groups to check, a note, and "Send to N"', async () => {
    const { calls } = setup();
    renderApp('/entry/f1');
    const share = await screen.findByRole('button', { name: 'Share Frieren' });
    expect(share).toHaveTextContent('Share'); // a text label next to the icon, not just an icon
    expect(share.querySelector('svg')).not.toBeNull();
    await userEvent.click(share);
    const sheet = await screen.findByRole('dialog', { name: 'Recommend Frieren' });
    expect(sheet).toHaveTextContent('your rating 9.0 shows on the card');
    expect(await within(sheet).findByRole('checkbox', { name: /Ren/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('checkbox', { name: /Anime night/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Ren/ }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Anime night/ }));
    await userEvent.type(within(sheet).getByLabelText('Add a note (optional)'), 'you HAVE to watch this');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send to 2' }));
    expect(await screen.findByText('Sent to 2')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const sends = calls.filter((c) => c.method === 'POST' && /\/api\/conversations\/[^/]+\/messages$/.test(c.path));
    expect(sends.map((c) => c.path).sort()).toEqual(['/api/conversations/c1/messages', '/api/conversations/g1/messages']);
    expect(sends[0]!.body).toEqual({
      rec: { category: 'anime', title: 'Frieren', creator: 'Madhouse', coverUrl: 'https://img.example/f.jpg', rating: 9, source: 'kitsu', sourceId: '154587' },
      text: 'you HAVE to watch this',
    });
    // Ren's direct chat was opened (found) first.
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/conversations' && JSON.stringify(c.body) === JSON.stringify({ userIds: ['id-ren'] }))).toBe(true);
  });

  it('closing the sheet with Escape sends nothing and returns focus to Share', async () => {
    const { calls } = setup();
    renderApp('/entry/f1');
    const share = await screen.findByRole('button', { name: /^Share / });
    await userEvent.click(share);
    await screen.findByRole('dialog', { name: 'Recommend Frieren' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(share).toHaveFocus();
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false);
  });

  it('a rate limit on every send says so and keeps the sheet open', async () => {
    setup({ 'POST /api/conversations/:id/messages': { status: 429, body: { error: 'rate_limited' } } });
    renderApp('/entry/f1');
    await userEvent.click(await screen.findByRole('button', { name: /^Share / }));
    const sheet = await screen.findByRole('dialog', { name: 'Recommend Frieren' });
    await userEvent.click(await within(sheet).findByRole('checkbox', { name: /Ren/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send to 1' }));
    expect(await screen.findByText("You're sending too fast. Wait a minute and try again.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Recommend Frieren' })).toBeInTheDocument();
  });

  it("a friend's title: Share sends it without a rating (it is not yours)", async () => {
    const { calls } = setup({
      'GET /api/users/:username/entries/:id': { body: { entry: makeFriendEntry({ id: 'fe1', title: 'Heat', category: 'movies', rating: 7 }), seasons: [] } },
    });
    renderApp('/u/ren/entry/fe1');
    await userEvent.click(await screen.findByRole('button', { name: /^Share / }));
    const sheet = await screen.findByRole('dialog', { name: 'Recommend Heat' });
    await userEvent.click(await within(sheet).findByRole('checkbox', { name: /Ren/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send to 1' }));
    await screen.findByText('Sent to 1');
    const send = calls.find((c) => c.method === 'POST' && c.path === '/api/conversations/c1/messages')!;
    expect(send.body).toMatchObject({ rec: { category: 'movies', title: 'Heat', rating: null } });
  });
});
