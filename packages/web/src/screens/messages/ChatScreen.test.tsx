import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { friendsOf, REN } from '../../test/friends';
import { ALBERTO, FRIEREN_REC, makeConversation, makeMessage, messagesBackend, ME, REN_U, VANCE } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

vi.mock('./resizeImage', () => ({ resizeImage: vi.fn(async () => new Blob([new Uint8Array(20)], { type: 'image/jpeg' })) }));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function setup(over: Parameters<typeof messagesBackend>[0] = {}, extra: Record<string, unknown> = {}, entries = [] as ReturnType<typeof makeEntry>[]) {
  const b = messagesBackend(over);
  const { calls } = fakeBackend({ me: makeMe(), entries, extra: { ...b.handlers, 'GET /api/friends': { body: friendsOf(REN) }, ...extra } as never });
  return { ...b, calls };
}

afterEach(() => vi.useRealTimers());

describe('Chat', () => {
  it('shows day separators, mine on the right and theirs on the left, with times', async () => {
    setup({
      messages: {
        c1: [
          makeMessage({ senderId: REN_U.id, text: 'old news', createdAt: hoursAgo(50) }),
          makeMessage({ senderId: REN_U.id, text: 'ok are we doing Frieren tonight?', createdAt: hoursAgo(1) }),
          makeMessage({ senderId: ME.id, text: 'yes! 8pm', createdAt: hoursAgo(0.5) }),
        ],
      },
    });
    renderApp('/messages/c1');
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(within(list).getByText('Today')).toBeInTheDocument();
    const mine = within(list).getByText('yes! 8pm').closest('li')!;
    expect(mine).toHaveClass('bubble-row--mine');
    expect(within(list).getByText('ok are we doing Frieren tonight?').closest('li')).not.toHaveClass('bubble-row--mine');
    expect(within(list).getByText('old news')).toBeInTheDocument();
    expect(mine.querySelector('time')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Ren' })).toBeInTheDocument();
  });

  it('a group shows the name and avatar above theirs once per run, and the members under the title', async () => {
    setup({
      conversations: [makeConversation({ kind: 'group', name: 'Anime night', members: [ME, REN_U, ALBERTO] })],
      messages: {
        c1: [
          makeMessage({ senderId: REN_U.id, text: 'one' }), makeMessage({ senderId: REN_U.id, text: 'two' }), makeMessage({ senderId: ALBERTO.id, text: 'three' }),
        ],
      },
    });
    renderApp('/messages/c1');
    const list = await screen.findByRole('list', { name: 'Messages' });
    expect(screen.getByRole('heading', { level: 1, name: 'Anime night' })).toBeInTheDocument();
    expect(screen.getByText('You, Ren, @alberto · 3 members')).toBeInTheDocument();
    expect(list.querySelectorAll('.bubble__who')).toHaveLength(2);
    expect(within(list).getByText('Ren', { selector: '.bubble__who' })).toBeInTheDocument();
    expect(within(list).getByText('@alberto', { selector: '.bubble__who' })).toBeInTheDocument();
  });

  it('a deleted message reads "Message deleted"', async () => {
    setup({ messages: { c1: [makeMessage({ deleted: true, text: '' })] } });
    renderApp('/messages/c1');
    expect(await screen.findByText('Message deleted')).toBeInTheDocument();
  });

  it('a picture opens full size on tap', async () => {
    setup({ messages: { c1: [makeMessage({ kind: 'image', text: '', image: true, id: 'pic1' })] } });
    renderApp('/messages/c1');
    const img = await screen.findByRole('img', { name: 'Picture from Ren' });
    expect(img).toHaveAttribute('src', '/api/messages/pic1/image');
    await userEvent.click(screen.getByRole('button', { name: 'Open picture from Ren full size' }));
    const dialog = await screen.findByRole('dialog', { name: 'Picture' });
    expect(within(dialog).getByRole('img', { name: 'Picture from Ren, full size' })).toHaveAttribute('src', '/api/messages/pic1/image');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('a recommendation card', () => {
    const rec = () => makeMessage({ kind: 'rec', rec: FRIEREN_REC, text: 'you HAVE to watch this' });

    it('shows cover area, title, list, their rating and note; Add to mine adds it as Plan to watch', async () => {
      const { calls } = setup({ messages: { c1: [rec()] } });
      renderApp('/messages/c1');
      const card = await screen.findByRole('article', { name: 'Recommendation: Frieren' });
      expect(within(card).getByText('Anime · Madhouse')).toBeInTheDocument();
      expect(within(card).getByText('Ren rated')).toBeInTheDocument();
      expect(within(card).getByLabelText('Rating 9.0')).toBeInTheDocument();
      expect(within(card).getByText('“you HAVE to watch this”')).toBeInTheDocument();
      await userEvent.click(within(card).getByRole('button', { name: 'Add to mine' }));
      await waitFor(() => expect(within(card).getByRole('link', { name: 'On your list' })).toBeInTheDocument());
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/entries')!;
      expect(post.body).toMatchObject({ category: 'anime', title: 'Frieren', status: 'Plan to watch' });
      expect(post.body).not.toHaveProperty('rating');
    });

    it('a title already on your list shows "On your list" as a link, not Add to mine', async () => {
      const mine = makeEntry({ id: 'mine1', category: 'anime', title: 'Frieren', creator: 'Madhouse' });
      setup({ messages: { c1: [rec()] } }, {}, [mine]);
      renderApp('/messages/c1');
      const card = await screen.findByRole('article', { name: 'Recommendation: Frieren' });
      expect(await within(card).findByRole('link', { name: 'On your list' })).toHaveAttribute('href', '/entry/mine1');
      expect(within(card).queryByRole('button', { name: 'Add to mine' })).not.toBeInTheDocument();
    });

    it('your own rec has no Add to mine', async () => {
      setup({ messages: { c1: [makeMessage({ kind: 'rec', rec: FRIEREN_REC, text: '', senderId: ME.id })] } });
      renderApp('/messages/c1');
      const card = await screen.findByRole('article', { name: 'Recommendation: Frieren' });
      expect(within(card).getByText('You rated')).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Add to mine' })).not.toBeInTheDocument();
    });
  });

  it('deleting your own message: ⋯ opens a confirm sheet with big buttons; Delete turns it into "Message deleted"', async () => {
    setup({ messages: { c1: [makeMessage({ senderId: ME.id, text: 'oops' }), makeMessage({ senderId: REN_U.id, text: 'theirs' })] } });
    renderApp('/messages/c1');
    await screen.findByText('oops');
    // Only your own messages have options.
    expect(screen.getAllByRole('button', { name: 'Message options' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Message options' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete this message?' });
    expect(within(sheet).getByRole('button', { name: 'Delete message' })).toHaveClass('btn--big');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('oops')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Message options' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(screen.queryByText('oops')).not.toBeInTheDocument());
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("the admin can delete anyone's message (AD7); the confirm sheet is the same", async () => {
    const b = messagesBackend({ messages: { c1: [makeMessage({ senderId: REN_U.id, text: 'rude thing' })] } });
    fakeBackend({ me: makeMe({ isAdmin: true }), extra: { ...b.handlers, 'GET /api/friends': { body: friendsOf(REN) } } as never });
    renderApp('/messages/c1');
    await screen.findByText('rude thing');
    await userEvent.click(screen.getByRole('button', { name: "Message options for Ren's message" }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this message?' })).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(screen.queryByText('rude thing')).not.toBeInTheDocument());
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
  });

  it('a former friend\'s direct chat is read-only: a notice, no composer', async () => {
    setup({ conversations: [makeConversation({ readOnly: true })], messages: { c1: [makeMessage({ text: 'bye' })] } });
    renderApp('/messages/c1');
    expect(await screen.findByText('bye')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('You and Ren are no longer friends, so this chat is read-only.');
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('a chat you are not in says so, with a way back', async () => {
    setup({ conversations: [] });
    renderApp('/messages/nope');
    expect(await screen.findByText("We couldn't find that chat")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Messages' })).toHaveAttribute('href', '/messages');
  });

  it('older messages load on demand', async () => {
    const b = setup({ messages: { c1: Array.from({ length: 5 }, (_, i) => makeMessage({ text: `msg ${i}` })) } });
    b.state.pageSize = 3;
    renderApp('/messages/c1');
    await screen.findByText('msg 4');
    expect(screen.queryByText('msg 0')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }));
    expect(await screen.findByText('msg 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).not.toBeInTheDocument();
    const texts = within(screen.getByRole('list', { name: 'Messages' })).getAllByText(/^msg/).map((e) => e.textContent);
    expect(texts).toEqual(['msg 0', 'msg 1', 'msg 2', 'msg 3', 'msg 4']);
  });

  describe('composer', () => {
    it('Send posts the trimmed text and shows it at once; the field clears', async () => {
      const { calls } = setup();
      renderApp('/messages/c1');
      const field = await screen.findByRole('textbox', { name: 'Message' });
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      await userEvent.type(field, '  see you friday!  ');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('see you friday!')).toBeInTheDocument();
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/conversations/c1/messages')?.body).toEqual({ text: 'see you friday!' });
      expect(field).toHaveValue('');
    });

    it('PC: Enter sends, Shift+Enter is a new line', async () => {
      setViewportWidth(1280);
      const { calls } = setup();
      renderApp('/messages/c1');
      const field = await screen.findByRole('textbox', { name: 'Message' });
      await userEvent.type(field, 'line one{Shift>}{Enter}{/Shift}line two');
      expect(field).toHaveValue('line one\nline two');
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      await userEvent.type(field, '{Enter}');
      await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'))?.body).toEqual({ text: 'line one\nline two' }));
    });

    it('phone: Enter is a new line, not Send', async () => {
      const { calls } = setup();
      renderApp('/messages/c1');
      const field = await screen.findByRole('textbox', { name: 'Message' });
      await userEvent.type(field, 'a{Enter}b');
      expect(field).toHaveValue('a\nb');
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    });

    it('a counter appears near the 2000 limit and Send is off past it', async () => {
      setup();
      renderApp('/messages/c1');
      const field = await screen.findByRole('textbox', { name: 'Message' });
      expect(screen.queryByText(/\/ 2000/)).not.toBeInTheDocument();
      await userEvent.click(field);
      await userEvent.paste('x'.repeat(1850));
      expect(screen.getByText('1850 / 2000')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      await userEvent.paste('x'.repeat(200));
      expect(screen.getByText('2050 / 2000 · too long')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('a rate limit (429) shows a toast and keeps what you typed', async () => {
      setup({ sendFail: { status: 429, body: { error: 'rate_limited' } } });
      renderApp('/messages/c1');
      const field = await screen.findByRole('textbox', { name: 'Message' });
      await userEvent.type(field, 'spam');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText("You're sending too fast. Wait a minute and try again.")).toBeInTheDocument();
      expect(field).toHaveValue('spam');
    });

    it('no picture option: the composer has no Photo item and no file input (sending pictures is hidden)', async () => {
      setup();
      renderApp('/messages/c1');
      await screen.findByRole('textbox', { name: 'Message' });
      expect(screen.queryByRole('button', { name: 'Add to message' })).not.toBeInTheDocument();
      expect(screen.queryByText('Photo')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Choose a photo')).not.toBeInTheDocument();
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it('Recommend: one button opens a picker that searches ALL your lists and sends the title with your rating and a note', async () => {
      const entries = [makeEntry({ id: 'a1', category: 'anime', title: 'Cowboy Bebop', rating: 8.5, creator: 'Sunrise' }), makeEntry({ id: 'm1', category: 'movies', title: 'Heat', rating: 7 })];
      const { calls } = setup({}, {}, entries);
      renderApp('/messages/c1');
      await screen.findByRole('textbox', { name: 'Message' });
      await userEvent.click(screen.getByRole('button', { name: 'Recommend' }));
      const picker = await screen.findByRole('dialog', { name: 'Recommend a title' });
      // no list chips: titles of every list are in one list, and the search filters across them
      expect(within(picker).queryByRole('group', { name: 'List' })).not.toBeInTheDocument();
      expect(await within(picker).findByRole('button', { name: /^Heat/ })).toBeInTheDocument();
      await userEvent.type(within(picker).getByRole('searchbox', { name: 'Search your lists' }), 'bebop');
      expect(within(picker).queryByRole('button', { name: /^Heat/ })).not.toBeInTheDocument();
      await userEvent.type(within(picker).getByRole('textbox', { name: 'Add a note (optional)' }), 'watch it!');
      await userEvent.click(await within(picker).findByRole('button', { name: /^Cowboy Bebop/ }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/conversations/c1/messages')!;
      expect(post.body).toMatchObject({ text: 'watch it!', rec: { category: 'anime', title: 'Cowboy Bebop', rating: 8.5, creator: 'Sunrise' } });
      expect(await screen.findByRole('article', { name: 'Recommendation: Cowboy Bebop' })).toBeInTheDocument();
    });
  });

  describe('polling and announcements', () => {
    it('checks for new messages every 5 s and announces them politely (not your own, not the first load)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const b = setup({ messages: { c1: [makeMessage({ text: 'first' })] } });
      renderApp('/messages/c1');
      await screen.findByText('first');
      const live = document.querySelector('.chat__live')!;
      expect(live).toHaveAttribute('aria-live', 'polite');
      expect(live).toHaveTextContent('');
      b.messages.c1!.push(makeMessage({ senderId: REN_U.id, text: 'you there?' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(5_200); });
      expect(await screen.findByText('you there?')).toBeInTheDocument();
      expect(live).toHaveTextContent('Ren: you there?');
    });

    it('opening the chat refreshes the unread badge (the first page marks it read)', async () => {
      const b = setup({ messages: { c1: [makeMessage({ text: 'hi' })] } });
      b.state.unread = 1;
      const { queryClient } = renderApp('/messages/c1');
      await screen.findByText('hi');
      await waitFor(() => expect((queryClient.getQueryData(['activity-unread']) as { messages: number } | undefined)?.messages).toBe(0));
    });
  });

  describe('group menu', () => {
    const group = () => makeConversation({ kind: 'group', name: 'Anime night', members: [ME, REN_U, ALBERTO] });

    it('a direct chat has no group menu', async () => {
      setup();
      renderApp('/messages/c1');
      await screen.findByRole('textbox', { name: 'Message' });
      expect(screen.queryByRole('button', { name: 'Group options' })).not.toBeInTheDocument();
    });

    it('⋯ offers Rename, Add people and Leave', async () => {
      setup({ conversations: [group()] });
      renderApp('/messages/c1');
      await userEvent.click(await screen.findByRole('button', { name: 'Group options' }));
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Add people', 'Leave']);
    });

    it('Rename saves the new name into the header', async () => {
      const { calls } = setup({ conversations: [group()] });
      renderApp('/messages/c1');
      await userEvent.click(await screen.findByRole('button', { name: 'Group options' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      const sheet = await screen.findByRole('dialog', { name: 'Rename group' });
      const field = within(sheet).getByLabelText('Group name');
      expect(field).toHaveFocus();
      await userEvent.clear(field);
      await userEvent.type(field, 'Elden crew');
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Elden crew' })).toBeInTheDocument();
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Elden crew' });
    });

    it('Add people lists only your friends who are not in yet', async () => {
      const friends = { friends: [REN, { id: 'id-van', username: 'vance', displayName: 'Vance', avatarAt: null }].map((u) => ({ ...u, since: '2026-11-03T10:00:00Z' })), incoming: [], outgoing: [] };
      const { calls } = setup({ conversations: [group()] }, { 'GET /api/friends': { body: friends } });
      renderApp('/messages/c1');
      await userEvent.click(await screen.findByRole('button', { name: 'Group options' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Add people' }));
      const sheet = await screen.findByRole('dialog', { name: 'Add people' });
      expect(await within(sheet).findByRole('checkbox', { name: /Vance/ })).toBeInTheDocument();
      expect(within(sheet).queryByRole('checkbox', { name: /Ren/ })).not.toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('checkbox', { name: /Vance/ }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Add 1' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/members'))?.body).toEqual({ userIds: ['id-van'] });
      expect(await screen.findByText(/members$/)).toHaveTextContent('4 members');
      expect(VANCE.id).toBe('id-van');
    });

    it('Leave asks first (big buttons), then returns to Messages', async () => {
      const { calls } = setup({ conversations: [group()] });
      const { router } = renderApp('/messages/c1');
      await userEvent.click(await screen.findByRole('button', { name: 'Group options' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Leave' }));
      const sheet = await screen.findByRole('dialog', { name: 'Leave this group?' });
      expect(within(sheet).getByRole('button', { name: 'Cancel' })).toHaveClass('btn--big');
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      await userEvent.click(within(sheet).getByRole('button', { name: 'Leave group' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/messages'));
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/conversations/c1/members/me')).toBe(true);
    });
  });
});
