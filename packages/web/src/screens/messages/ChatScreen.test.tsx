import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('a group shows the name above the run and the picture beside its last bubble, and the members under the title', async () => {
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
    // one picture per run, on its last bubble: Ren's run is "one","two" (picture on "two"), Alberto's is "three"
    const avatarRows = [...list.querySelectorAll('.bubble-row')].map((r) => r.querySelector('.bubble-row__avatar .avatar') !== null);
    expect(avatarRows).toEqual([false, true, true]);
    expect(list.querySelector('.bubble-row__avatar .avatar')!.closest('li')).toHaveTextContent('two');
  });

  it('a direct chat shows their picture once per run (28 px), none beside mine; a long pause or a day starts a new run with more space', async () => {
    setup({
      messages: {
        c1: [
          makeMessage({ senderId: REN_U.id, text: 'a', createdAt: hoursAgo(3) }),
          makeMessage({ senderId: REN_U.id, text: 'b', createdAt: new Date(Date.now() - 3 * 3_600_000 + 60_000).toISOString() }),
          makeMessage({ senderId: REN_U.id, text: 'c', createdAt: hoursAgo(2) }),
          makeMessage({ senderId: ME.id, text: 'd', createdAt: hoursAgo(1) }),
        ],
      },
    });
    renderApp('/messages/c1');
    const list = await screen.findByRole('list', { name: 'Messages' });
    const row = (t: string) => within(list).getByText(t).closest('li')!;
    expect(row('a').querySelector('.avatar')).toBeNull();
    expect(row('b').querySelector('.avatar')).not.toBeNull(); // a, b is a run; the 2 h pause ends it
    expect(row('b').querySelector('.avatar')).toHaveStyle({ width: '28px', height: '28px' });
    expect(row('c').querySelector('.avatar')).not.toBeNull();
    expect(row('d').querySelector('.avatar')).toBeNull();
    // more space only where a run starts (not on the first one under a day label)
    expect(row('a')).not.toHaveClass('bubble-row--first');
    expect(row('b')).not.toHaveClass('bubble-row--first');
    expect(row('c')).toHaveClass('bubble-row--first');
    expect(row('d')).toHaveClass('bubble-row--first');
  });

  it("my bubbles use the theme's accent and its readable text colour through CSS variables", async () => {
    setup({ messages: { c1: [makeMessage({ senderId: ME.id, text: 'mine' })] } });
    renderApp('/messages/c1');
    await screen.findByText('mine');
    const chat = document.querySelector<HTMLElement>('.screen.chat')!;
    expect(chat.style.getPropertyValue('--bubble-mine-bg')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(chat.style.getPropertyValue('--bubble-mine-text')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(screen.getByText('mine').closest('.bubble')).toHaveClass('bubble--mine');
  });

  describe('text size', () => {
    afterEach(() => window.localStorage.clear());

    it('the Aa button steps the chat text through 5 sizes (85%-140%), saved on this device', async () => {
      setup({ messages: { c1: [makeMessage({ text: 'hello' })] } });
      renderApp('/messages/c1');
      await screen.findByText('hello');
      const chat = () => document.querySelector<HTMLElement>('.screen.chat')!;
      expect(chat().style.getPropertyValue('--chat-scale')).toBe('1');
      await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
      const group = screen.getByRole('group', { name: 'Text size' });
      expect(within(group).getByText('100%')).toBeInTheDocument();
      await userEvent.click(within(group).getByRole('button', { name: 'Bigger text' }));
      await userEvent.click(within(group).getByRole('button', { name: 'Bigger text' }));
      await userEvent.click(within(group).getByRole('button', { name: 'Bigger text' }));
      expect(within(group).getByText('140%')).toBeInTheDocument();
      expect(within(group).getByRole('button', { name: 'Bigger text' })).toHaveAttribute('aria-disabled', 'true');
      expect(chat().style.getPropertyValue('--chat-scale')).toBe('1.4');
      expect(window.localStorage.getItem('chat-text-size')).toBe('140');
      await userEvent.click(within(group).getByRole('button', { name: 'Smaller text' }));
      await userEvent.click(within(group).getByRole('button', { name: 'Smaller text' }));
      await userEvent.click(within(group).getByRole('button', { name: 'Smaller text' }));
      await userEvent.click(within(group).getByRole('button', { name: 'Smaller text' }));
      expect(within(group).getByText('85%')).toBeInTheDocument();
      expect(within(group).getByRole('button', { name: 'Smaller text' })).toHaveAttribute('aria-disabled', 'true');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: 'Text size' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Text size' })).toHaveFocus();
    });

    it('starts from the saved size; broken storage falls back to 100% without crashing', async () => {
      window.localStorage.setItem('chat-text-size', '115');
      setup({ messages: { c1: [makeMessage({ text: 'hello' })] } });
      const { unmount } = renderApp('/messages/c1');
      await screen.findByText('hello');
      expect(document.querySelector<HTMLElement>('.screen.chat')!.style.getPropertyValue('--chat-scale')).toBe('1.15');
      unmount();
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
      renderApp('/messages/c1');
      await screen.findByText('hello');
      expect(document.querySelector<HTMLElement>('.screen.chat')!.style.getPropertyValue('--chat-scale')).toBe('1');
      await userEvent.click(screen.getByRole('button', { name: 'Text size' }));
      await userEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
      expect(document.querySelector<HTMLElement>('.screen.chat')!.style.getPropertyValue('--chat-scale')).toBe('1.15');
      spy.mockRestore();
      set.mockRestore();
    });
  });

  describe('replying', () => {
    const two = () => [
      makeMessage({ id: 'o1', senderId: REN_U.id, text: 'want to watch Frieren tonight?' }),
      makeMessage({ id: 'o2', senderId: ME.id, text: 'my own line' }),
    ];

    it('the Reply button (hover, or keyboard) puts "Replying to <name>: <snippet>" over the composer; ✕ and Escape cancel', async () => {
      setup({ messages: { c1: two() } });
      renderApp('/messages/c1');
      await screen.findByText('want to watch Frieren tonight?');
      await userEvent.click(screen.getByRole('button', { name: "Reply to Ren's message" }));
      const bar = screen.getByRole('group', { name: 'Replying to' });
      expect(bar).toHaveTextContent('Replying to Ren: want to watch Frieren tonight?');
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
      await userEvent.click(within(bar).getByRole('button', { name: 'Cancel reply' }));
      expect(screen.queryByRole('group', { name: 'Replying to' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Reply to your own message' }));
      expect(screen.getByRole('group', { name: 'Replying to' })).toHaveTextContent('Replying to yourself: my own line');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: 'Replying to' })).not.toBeInTheDocument();
    });

    it('the Reply button is reachable by keyboard (Tab) and Enter starts the reply', async () => {
      setup({ messages: { c1: [two()[0]!] } });
      renderApp('/messages/c1');
      await screen.findByText('want to watch Frieren tonight?');
      const reply = screen.getByRole('button', { name: "Reply to Ren's message" });
      reply.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('group', { name: 'Replying to' })).toBeInTheDocument();
    });

    it('long-press on a touch screen starts a reply; moving away or lifting early does not', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      setup({ messages: { c1: two() } });
      renderApp('/messages/c1');
      const bubble = (await screen.findByText('want to watch Frieren tonight?')).closest('.bubble')!;
      fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      fireEvent.pointerUp(bubble, { pointerType: 'touch' });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.queryByRole('group', { name: 'Replying to' })).not.toBeInTheDocument();
      fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerMove(bubble, { pointerType: 'touch', clientX: 10, clientY: 60 });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.queryByRole('group', { name: 'Replying to' })).not.toBeInTheDocument();
      fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(screen.getByRole('group', { name: 'Replying to' })).toHaveTextContent('Replying to Ren');
      // a mouse press-and-hold does nothing
      fireEvent.pointerUp(bubble, { pointerType: 'touch' });
    });

    it('sends replyTo with the message and shows the quote above it; the bar clears', async () => {
      const { calls } = setup({ messages: { c1: two() } });
      renderApp('/messages/c1');
      await screen.findByText('want to watch Frieren tonight?');
      await userEvent.click(screen.getByRole('button', { name: "Reply to Ren's message" }));
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'yes please');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
      const sent = (await screen.findByText('yes please')).closest('.bubble')!;
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/conversations/c1/messages')?.body).toEqual({ text: 'yes please', replyTo: 'o1' });
      expect(within(sent as HTMLElement).getByText('Ren')).toBeInTheDocument();
      expect(within(sent as HTMLElement).getByText('want to watch Frieren tonight?')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Replying to' })).not.toBeInTheDocument();
    });

    it('tapping a quote scrolls to the original, marks it briefly and focuses it; a quote of an unloaded message is not a button', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      const q = (id: string) => ({ id, senderId: REN_U.id, senderName: 'Ren', kind: 'text' as const, snippet: 'want to watch Frieren tonight?', deleted: false });
      setup({ messages: { c1: [...two(), makeMessage({ senderId: ME.id, text: 'replying', replyTo: q('o1') }), makeMessage({ senderId: ME.id, text: 'far one', replyTo: q('way-back') })] } });
      renderApp('/messages/c1');
      const bubble = (await screen.findByText('replying')).closest('.bubble') as HTMLElement;
      await userEvent.click(within(bubble).getByRole('button', { name: /In reply to Ren: want to watch Frieren tonight\?\. Go to that message/ }));
      const original = document.querySelector<HTMLElement>('[data-mid="o1"]')!;
      expect(scrollIntoView).toHaveBeenCalled();
      expect(original).toHaveClass('is-flash');
      expect(original).toHaveFocus();
      await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
      expect(original).not.toHaveClass('is-flash');
      const far = (screen.getByText('far one').closest('.bubble')) as HTMLElement;
      expect(within(far).queryByRole('button', { name: /In reply to/ })).not.toBeInTheDocument();
      expect(within(far).getByText('want to watch Frieren tonight?')).toBeInTheDocument();
    });

    it('a deleted original reads "Original message deleted"; deleting a message updates quotes of it at once', async () => {
      const gone = { id: 'x', senderId: '', senderName: '', kind: 'text' as const, snippet: '', deleted: true };
      setup({ messages: { c1: [makeMessage({ senderId: ME.id, text: 'target', id: 'tgt' }), makeMessage({ senderId: REN_U.id, text: 'late reply', replyTo: { id: 'tgt', senderId: ME.id, senderName: 'dan', kind: 'text', snippet: 'target', deleted: false } }), makeMessage({ text: 'older', replyTo: gone })] } });
      renderApp('/messages/c1');
      expect(await screen.findByText('Original message deleted')).toBeInTheDocument();
      expect(screen.getByText('You')).toBeInTheDocument(); // my own message quoted
      await userEvent.click(screen.getByRole('button', { name: 'Message options' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete message' }));
      await waitFor(() => expect(screen.getAllByText('Original message deleted')).toHaveLength(2));
    });

    it('no Reply button on a deleted message or in a read-only chat', async () => {
      setup({ messages: { c1: [makeMessage({ deleted: true, text: '' })] } });
      renderApp('/messages/c1');
      await screen.findByText('Message deleted');
      expect(screen.queryByRole('button', { name: /^Reply to/ })).not.toBeInTheDocument();
    });

    it('a reply whose original is gone drops the bar and says so', async () => {
      const b = setup({ messages: { c1: two() } });
      renderApp('/messages/c1');
      await screen.findByText('want to watch Frieren tonight?');
      await userEvent.click(screen.getByRole('button', { name: "Reply to Ren's message" }));
      b.messages.c1![0]!.deleted = true;
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'hello?');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText("That message is gone, so it can't be replied to.")).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Replying to' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello?');
    });
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

    it('a "Recommendation" label sits above the card, on both sides', async () => {
      setup({ messages: { c1: [rec(), makeMessage({ kind: 'rec', rec: FRIEREN_REC, text: '', senderId: ME.id })] } });
      renderApp('/messages/c1');
      await screen.findAllByRole('article', { name: 'Recommendation: Frieren' });
      const labels = [...document.querySelectorAll('.bubble__label')];
      expect(labels).toHaveLength(2);
      for (const l of labels) {
        expect(l).toHaveTextContent('Recommendation');
        expect(l.nextElementSibling).toBe(l.closest('.bubble')!.querySelector('article'));
      }
    });

    it('tapping a card I sent opens my own entry (its entry, or the one with that title)', async () => {
      const mine = makeEntry({ id: 'mine-fr', category: 'anime', title: 'Frieren', creator: 'Madhouse' });
      setup({ messages: { c1: [makeMessage({ kind: 'rec', rec: { ...FRIEREN_REC, entryId: 'mine-fr' }, text: '', senderId: ME.id }), makeMessage({ kind: 'rec', rec: FRIEREN_REC, text: '', senderId: ME.id })] } }, {}, [mine]);
      renderApp('/messages/c1');
      const cards = await screen.findAllByRole('article', { name: 'Recommendation: Frieren' });
      await waitFor(() => expect(within(cards[0]!).getByRole('link', { name: /Frieren/ })).toHaveAttribute('href', '/entry/mine-fr'));
      expect(await within(cards[1]!).findByRole('link', { name: /Frieren/ })).toHaveAttribute('href', '/entry/mine-fr');
    });

    it('a sent card whose title is not on my list is not a link', async () => {
      setup({ messages: { c1: [makeMessage({ kind: 'rec', rec: FRIEREN_REC, text: '', senderId: ME.id })] } });
      renderApp('/messages/c1');
      const card = await screen.findByRole('article', { name: 'Recommendation: Frieren' });
      expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    });

    it("tapping a received card opens the sender's title (their entry page)", async () => {
      setup({ messages: { c1: [makeMessage({ kind: 'rec', rec: { ...FRIEREN_REC, entryId: 'ren-e1' }, text: 'hey' })] } });
      renderApp('/messages/c1');
      const card = await screen.findByRole('article', { name: 'Recommendation: Frieren' });
      expect(within(card).getByRole('link', { name: /Frieren/ })).toHaveAttribute('href', '/u/ren/entry/ren-e1');
      expect(within(card).getByRole('button', { name: 'Add to mine' })).toBeInTheDocument();
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

  it('PC: an open chat has a Back button that goes back to where you came from (the Messages list)', async () => {
    setViewportWidth(1280);
    setup();
    renderApp('/messages');
    await userEvent.click(await screen.findByRole('link', { name: /Ren/ }));
    const back = await screen.findByRole('button', { name: /^Back/ });
    expect(back).toHaveClass('back-link');
    await userEvent.click(back);
    expect(await screen.findByRole('list', { name: 'Chats' })).toBeInTheDocument();
  });

  it('phone: the round Back arrow stays', async () => {
    setup();
    renderApp('/messages/c1');
    expect(await screen.findByRole('button', { name: 'Back' })).toHaveClass('back-btn');
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
      expect(screen.getByRole('button', { name: 'Recommend' })).toHaveAttribute('title', 'Recommend');
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
