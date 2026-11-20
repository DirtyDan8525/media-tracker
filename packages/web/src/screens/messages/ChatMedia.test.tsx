import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../../test/fakeBackend';
import { friendsOf, REN } from '../../test/friends';
import { ALBERTO, makeConversation, makeMessage, messagesBackend, ME, REN_U } from '../../test/messagesBackend';
import { makeMe } from '../../test/mockApi';
import { publicSettings } from '../../test/appSettings';
import { renderApp } from '../../test/renderApp';
import { resizeImage } from './resizeImage';
import { POSITIONS_KEY, POSITIONS_MAX, savePosition } from './VoicePlayer';

vi.mock('./resizeImage', () => ({ resizeImage: vi.fn(async () => new Blob([new Uint8Array(20)], { type: 'image/jpeg' })) }));

function setup(over: Parameters<typeof messagesBackend>[0] = {}, opts: { media?: boolean; features?: Record<string, boolean>; recentEmoji?: string[] } = {}) {
  const b = messagesBackend(over);
  const { calls } = fakeBackend({
    me: makeMe({ recentEmoji: opts.recentEmoji ?? [] }),
    extra: {
      ...b.handlers,
      'GET /api/friends': { body: friendsOf(REN) },
      'GET /api/app': { body: { ...publicSettings({ features: opts.features }), media: opts.media ?? true } },
    } as never,
  });
  return { ...b, calls };
}

afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('message reactions', () => {
  it('chips under a bubble: one per emoji, a count over 1, mine pressed; tapping mine removes it, another replaces it', async () => {
    const { calls } = setup({ messages: { c1: [makeMessage({ id: 'r1', text: 'react to me', reactions: [{ userId: REN_U.id, emoji: '❤️' }, { userId: ME.id, emoji: '❤️' }, { userId: ALBERTO.id, emoji: '🔥' }] })] } });
    renderApp('/messages/c1');
    await screen.findByText('react to me');
    const group = screen.getByRole('group', { name: 'Reactions' });
    const heart = within(group).getByRole('button', { name: '❤️ 2, yours' });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(heart).toHaveTextContent('2');
    const fire = within(group).getByRole('button', { name: '🔥 1' });
    expect(fire).not.toHaveTextContent('1'); // no count for one
    await userEvent.click(fire);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/conversations/c1/messages/r1/reaction')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ emoji: '🔥' });
    expect(await within(screen.getByRole('group', { name: 'Reactions' })).findByRole('button', { name: '🔥 2, yours' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Reactions' })).getByRole('button', { name: '❤️ 1' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(screen.getByRole('group', { name: 'Reactions' })).getByRole('button', { name: '🔥 2, yours' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/conversations/c1/messages/r1/reaction')).toBe(true));
  });

  it('the menu reacts (the same emoji again removes it), shows who reacted, and a Recent row of your custom emojis', async () => {
    const { calls } = setup({ messages: { c1: [makeMessage({ id: 'r1', text: 'hi', reactions: [{ userId: REN_U.id, emoji: '😂' }] })] } }, { recentEmoji: ['🦊', '🐸'] });
    renderApp('/messages/c1');
    const bubble = (await screen.findByText('hi')).closest('.bubble') as HTMLElement;
    bubble.focus();
    await userEvent.keyboard('{Enter}');
    let menu = screen.getByRole('dialog', { name: 'Message options' });
    expect(within(menu).getByRole('list', { name: 'Who reacted' })).toHaveTextContent('😂: Ren');
    expect(within(within(menu).getByRole('group', { name: 'Recent' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['🦊', '🐸']);
    await userEvent.click(within(within(menu).getByRole('group', { name: 'Recent' })).getByRole('button', { name: '🐸' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ emoji: '🐸' }));
    expect(await screen.findByRole('button', { name: '🐸 1, yours' })).toBeInTheDocument();
    bubble.focus();
    await userEvent.keyboard('{Enter}');
    menu = screen.getByRole('dialog', { name: 'Message options' });
    expect(within(within(menu).getByRole('group', { name: 'Reactions' })).getByRole('button', { name: '❤️' })).toHaveAttribute('aria-pressed', 'false');
    // 🐸 is in Recent and pressed (it is yours): picking it again takes it off
    const frog = within(within(menu).getByRole('group', { name: 'Recent' })).getByRole('button', { name: '🐸' });
    expect(frog).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(frog);
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/reaction'))).toBe(true));
  });

  it('holding a chip shows who reacted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ messages: { c1: [makeMessage({ id: 'r1', text: 'hi', reactions: [{ userId: REN_U.id, emoji: '😂' }, { userId: ME.id, emoji: '😂' }] })] } });
    renderApp('/messages/c1');
    const chip = await screen.findByRole('button', { name: '😂 2, yours' });
    fireEvent.touchStart(chip, { touches: [{ clientX: 1, clientY: 1 }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const sheet = screen.getByRole('dialog', { name: 'Reactions' });
    expect(sheet).toHaveTextContent('😂: Ren, You');
  });

  it('no chips and no reaction picker on a deleted message', async () => {
    setup({ messages: { c1: [makeMessage({ deleted: true, text: '', reactions: [] })] } });
    renderApp('/messages/c1');
    await screen.findByText('Message deleted');
    expect(screen.queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument();
  });
});

describe('compact reply quotes', () => {
  it('shows a "Reply" label and only the first words on one line; photos and voice memos get a word; a group adds the name', async () => {
    const long = 'this is a really long message that goes on and on about the finale and everything after it';
    const q = (id: string, kind: 'text' | 'image' | 'voice', snippet: string) => ({ id, senderId: REN_U.id, senderName: 'Ren', kind, snippet, deleted: false });
    setup({
      conversations: [makeConversation({ kind: 'group', name: 'Trio', members: [ME, REN_U, ALBERTO] })],
      messages: { c1: [
        makeMessage({ id: 'o1', text: long }),
        makeMessage({ senderId: ME.id, text: 'r1', replyTo: q('o1', 'text', long) }),
        makeMessage({ senderId: ME.id, text: 'r2', replyTo: q('p', 'image', '') }),
        makeMessage({ senderId: ME.id, text: 'r3', replyTo: q('v', 'voice', '') }),
      ] },
    });
    renderApp('/messages/c1');
    const r1 = (await screen.findByText('r1')).closest('.bubble') as HTMLElement;
    const text = r1.querySelector('.bubble__quote-text')!.textContent!;
    expect(text.endsWith('…')).toBe(true);
    expect(Array.from(text).length).toBeLessThanOrEqual(41);
    expect(text.split(' ').length).toBeLessThanOrEqual(8);
    expect(r1).not.toHaveTextContent('everything after it');
    expect(within(r1).getByText('Reply', { selector: '.bubble__quote-label' })).toBeInTheDocument();
    expect(within(r1).getByText('Ren', { selector: '.bubble__quote-who' })).toBeInTheDocument();
    expect((screen.getByText('r2').closest('.bubble') as HTMLElement).querySelector('.bubble__quote-text')).toHaveTextContent('📷 Photo');
    expect((screen.getByText('r3').closest('.bubble') as HTMLElement).querySelector('.bubble__quote-text')).toHaveTextContent('🎤 Voice memo');
  });
});

describe('the composer + menu', () => {
  const items = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }));
    return within(screen.getByRole('menu', { name: 'More options' })).getAllByRole('menuitem').map((i) => i.textContent?.trim());
  };

  it('offers a recommendation, a photo and a voice memo when the server has storage and both switches are on', async () => {
    setup();
    renderApp('/messages/c1');
    await waitFor(async () => expect(await items()).toEqual(['Send a recommendation', 'Send a photo', 'Record a voice memo']));
  });

  it('without storage (no MEDIA binding) only the recommendation shows, and there is no file input', async () => {
    setup({}, { media: false });
    renderApp('/messages/c1');
    expect(await items()).toEqual(['Send a recommendation']);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('each switch hides its own item', async () => {
    setup({}, { features: { photos: false } });
    renderApp('/messages/c1');
    await waitFor(async () => { await userEvent.keyboard('{Escape}'); expect(await items()).toEqual(['Send a recommendation', 'Record a voice memo']); });
  });

  it('Escape closes the menu and returns focus to +; arrows move between items', async () => {
    setup();
    renderApp('/messages/c1');
    const plus = await screen.findByRole('button', { name: 'More options' });
    await waitFor(async () => { await userEvent.click(plus); expect(screen.getAllByRole('menuitem')).toHaveLength(3); });
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(plus).toHaveFocus();
  });
});

describe('photos', () => {
  it('Send a photo: the picked file is resized first, then uploaded as raw bytes, and shows in the chat', async () => {
    const { calls } = setup();
    renderApp('/messages/c1');
    await waitFor(async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More options' }));
      expect(screen.getByRole('menuitem', { name: 'Send a photo' })).toBeInTheDocument();
    });
    const input = screen.getByTestId('photo-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Send a photo' }));
    expect(click).toHaveBeenCalled();
    const file = new File([new Uint8Array(5000)], 'IMG_0001.HEIC', { type: 'image/heic' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/conversations/c1/messages/image')).toBe(true));
    expect(resizeImage).toHaveBeenCalledWith(file);
    const post = calls.find((c) => c.path === '/api/conversations/c1/messages/image')!;
    expect((post.init!.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
    expect(post.init!.body).toBeInstanceOf(Blob);
    expect((post.init!.body as Blob).size).toBe(20); // the resized copy, not the original
    expect(await screen.findByRole('img', { name: 'Picture from You' })).toBeInTheDocument();
  });

  it('a file that is not a picture says so and sends nothing', async () => {
    vi.mocked(resizeImage).mockRejectedValueOnce(new Error('decode'));
    const { calls } = setup();
    renderApp('/messages/c1');
    await waitFor(async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More options' }));
      expect(screen.getByRole('menuitem', { name: 'Send a photo' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText("That file isn't a photo that can be sent.")).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/messages/image'))).toBe(false);
  });

  it('expired media reads "Photo expired" / "Voice memo expired"', async () => {
    setup({ messages: { c1: [makeMessage({ kind: 'image', text: '', image: false, expired: true }), makeMessage({ kind: 'voice', text: '', voice: null, expired: true })] } });
    renderApp('/messages/c1');
    expect(await screen.findByText('Photo expired')).toBeInTheDocument();
    expect(screen.getByText('Voice memo expired')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Picture from/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play voice memo/ })).not.toBeInTheDocument();
  });
});

/** A MediaRecorder stand-in: start() records, stop() delivers one chunk and fires onstop. */
class FakeRecorder {
  static supported = ['audio/webm;codecs=opus'];
  static last: FakeRecorder | null = null;
  static isTypeSupported(t: string) { return FakeRecorder.supported.includes(t); }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  options: MediaRecorderOptions;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: MediaStream, o: MediaRecorderOptions) { this.options = o; this.mimeType = o.mimeType ?? ''; FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

describe('voice memos: recording', () => {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream);
  beforeEach(() => {
    FakeRecorder.supported = ['audio/webm;codecs=opus'];
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    getUserMedia.mockClear();
    stopTrack.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const openRecorder = async () => {
    await waitFor(async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More options' }));
      expect(screen.getByRole('menuitem', { name: 'Record a voice memo' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Record a voice memo' }));
  };

  it('asks for the mic only when recording starts, shows a timer, and Send uploads the memo with its length', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = setup();
    renderApp('/messages/c1');
    await screen.findByRole('button', { name: 'More options' });
    expect(getUserMedia).not.toHaveBeenCalled();
    await openRecorder();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await screen.findByRole('group', { name: 'Recording a voice memo' });
    expect(FakeRecorder.last!.options).toMatchObject({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
    expect(screen.getByRole('timer')).toHaveTextContent('0:03 / 2:00');
    await userEvent.click(screen.getByRole('button', { name: 'Send voice memo' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.startsWith('/api/conversations/c1/messages/voice?ms='))).toBe(true));
    const post = calls.find((c) => c.path.startsWith('/api/conversations/c1/messages/voice'))!;
    const ms = Number(new URL(post.path, 'http://x').searchParams.get('ms'));
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThan(5000);
    expect((post.init!.headers as Record<string, string>)['content-type']).toBe('audio/webm');
    expect(stopTrack).toHaveBeenCalled(); // the mic is released
    expect(await screen.findByRole('button', { name: 'Play voice memo from you' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('picks audio/mp4 where only that records (iPhone Safari)', async () => {
    FakeRecorder.supported = ['audio/mp4'];
    setup();
    renderApp('/messages/c1');
    await openRecorder();
    await screen.findByRole('group', { name: 'Recording a voice memo' });
    expect(FakeRecorder.last!.mimeType).toBe('audio/mp4');
  });

  it('stops by itself at 2 minutes and waits for Send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    renderApp('/messages/c1');
    await openRecorder();
    await screen.findByRole('group', { name: 'Recording a voice memo' });
    await act(async () => { await vi.advanceTimersByTimeAsync(121_000); });
    expect(FakeRecorder.last!.state).toBe('inactive');
    expect(screen.getByText('2-minute limit reached')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('timer')).toHaveTextContent('2:00 / 2:00');
  });

  it('Cancel throws the recording away and releases the mic', async () => {
    const { calls } = setup();
    renderApp('/messages/c1');
    await openRecorder();
    await screen.findByRole('group', { name: 'Recording a voice memo' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel recording' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
    expect(calls.some((c) => c.path.includes('/messages/voice'))).toBe(false);
  });

  it('a denied microphone says how to allow it', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    setup();
    renderApp('/messages/c1');
    await openRecorder();
    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access is blocked. Allow it for this site in your browser settings, then try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('a browser that cannot record says so (and never asks for the mic)', async () => {
    FakeRecorder.supported = [];
    setup();
    renderApp('/messages/c1');
    await openRecorder();
    expect(await screen.findByRole('alert')).toHaveTextContent("This browser can't record voice memos.");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe('voice memos: playing', () => {
  // jsdom has no media playback: a minimal one on the prototype.
  const state = new WeakMap<HTMLMediaElement, { paused: boolean; t: number; rate: number }>();
  const st = (el: HTMLMediaElement) => { let s = state.get(el); if (!s) { s = { paused: true, t: 0, rate: 1 }; state.set(el, s); } return s; };
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return st(this).paused; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return st(this).t; }, set(v: number) { st(this).t = v; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', { configurable: true, get() { return st(this).rate; }, set(v: number) { st(this).rate = v; } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { st(this).paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { if (st(this).paused) return; st(this).paused = true; this.dispatchEvent(new Event('pause')); });
  });
  afterEach(() => vi.restoreAllMocks());

  const two = () => [
    makeMessage({ id: 'v1', kind: 'voice', text: '', voice: { durationMs: 60_000 } }),
    makeMessage({ id: 'v2', kind: 'voice', text: '', voice: { durationMs: 30_000 } }),
  ];
  const audioOf = (id: string) => document.querySelector<HTMLAudioElement>(`[data-mid="${id}"] audio`)!;

  it('plays from the file URL without downloading first; one memo at a time', async () => {
    setup({ messages: { c1: two() } });
    renderApp('/messages/c1');
    const [p1, p2] = await screen.findAllByRole('button', { name: 'Play voice memo from Ren' });
    expect(audioOf('v1')).toHaveAttribute('src', '/api/messages/v1/media');
    expect(audioOf('v1')).toHaveAttribute('preload', 'none');
    await userEvent.click(p1!);
    expect(audioOf('v1').paused).toBe(false);
    await userEvent.click(p2!);
    expect(audioOf('v1').paused).toBe(true);
    expect(audioOf('v2').paused).toBe(false);
    expect(screen.getAllByRole('button', { name: 'Pause voice memo from Ren' })).toHaveLength(1);
  });

  it('the slider scrubs: dragging or arrow keys (5 s) set the time and the elapsed text follows', async () => {
    setup({ messages: { c1: [two()[0]!] } });
    renderApp('/messages/c1');
    const slider = await screen.findByRole('slider', { name: 'Position in voice memo from Ren' });
    expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 1:00');
    fireEvent.change(slider, { target: { value: '30' } });
    expect(audioOf('v1').currentTime).toBe(30);
    expect(slider).toHaveAttribute('aria-valuetext', '0:30 of 1:00');
    expect(screen.getByText('0:30 / 1:00')).toBeInTheDocument();
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(audioOf('v1').currentTime).toBe(35);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(audioOf('v1').currentTime).toBe(25);
  });

  it('remembers where you stopped on this device, resumes there after a reload, and forgets it at the end', async () => {
    setup({ messages: { c1: [two()[0]!] } });
    const first = renderApp('/messages/c1');
    const play = await screen.findByRole('button', { name: 'Play voice memo from Ren' });
    await userEvent.click(play);
    const a = audioOf('v1');
    a.currentTime = 42;
    a.dispatchEvent(new Event('timeupdate'));
    await userEvent.click(screen.getByRole('button', { name: 'Pause voice memo from Ren' }));
    expect(JSON.parse(localStorage.getItem(POSITIONS_KEY)!).v1.t).toBe(42);
    first.unmount();
    // "Reopening the chat later": a fresh render reads the saved spot.
    setup({ messages: { c1: [two()[0]!] } });
    renderApp('/messages/c1');
    const slider = await screen.findByRole('slider', { name: 'Position in voice memo from Ren' });
    expect(slider).toHaveAttribute('aria-valuetext', '0:42 of 1:00');
    await userEvent.click(screen.getByRole('button', { name: 'Play voice memo from Ren' }));
    expect(audioOf('v1').currentTime).toBe(42);
    audioOf('v1').dispatchEvent(new Event('ended'));
    expect(JSON.parse(localStorage.getItem(POSITIONS_KEY)!).v1).toBeUndefined();
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 1:00'));
  });

  it('keeps at most 200 saved spots (the oldest go)', () => {
    for (let i = 0; i < POSITIONS_MAX + 5; i++) {
      vi.spyOn(Date, 'now').mockReturnValue(1_000 + i);
      savePosition(`m${i}`, 3);
    }
    const saved = JSON.parse(localStorage.getItem(POSITIONS_KEY)!);
    expect(Object.keys(saved)).toHaveLength(POSITIONS_MAX);
    expect(saved.m0).toBeUndefined();
    expect(saved[`m${POSITIONS_MAX + 4}`]).toBeDefined();
  });

  it('the speed button steps 1x, 1.5x, 2x', async () => {
    setup({ messages: { c1: [two()[0]!] } });
    renderApp('/messages/c1');
    const speed = await screen.findByRole('button', { name: 'Playback speed 1x. Change speed' });
    await userEvent.click(speed);
    expect(audioOf('v1').playbackRate).toBe(1.5);
    await userEvent.click(screen.getByRole('button', { name: 'Playback speed 1.5x. Change speed' }));
    expect(audioOf('v1').playbackRate).toBe(2);
  });
});
