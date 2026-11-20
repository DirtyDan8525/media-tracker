import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEntry } from '../../test/fakeBackend';
import { mockFetch } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import { PlayPreview, fmtClock } from './PlayPreview';

const MP3 = 'https://cdnt-preview.dzcdn.net/a.mp3?hdnea=x';
const song = makeEntry({ category: 'songs', title: 'Blinding Lights', creator: 'The Weeknd', source: 'deezer', sourceId: 'track:9' });
const show = (entry = song) => render(<QueryClientProvider client={makeQueryClient()}><PlayPreview entry={entry} /></QueryClientProvider>);

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
beforeEach(() => {
  play = vi.fn(function (this: HTMLMediaElement) { fireEvent.play(this); return Promise.resolve(); });
  pause = vi.fn(function (this: HTMLMediaElement) { fireEvent.pause(this); });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => !play.mock.calls.length || pause.mock.calls.length >= play.mock.calls.length });
});
afterEach(() => vi.unstubAllGlobals());

describe('PlayPreview', () => {
  it('formats the clock', () => {
    expect(fmtClock(11.4)).toBe('0:11');
    expect(fmtClock(30)).toBe('0:30');
    expect(fmtClock(NaN)).toBe('0:00');
  });

  it('shows nothing until a url comes back, and nothing when there is none', async () => {
    const calls = mockFetch({ 'GET /api/preview': { body: { url: null } } });
    show();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Play preview/ })).not.toBeInTheDocument();
  });

  it('is hidden for other lists and on a 404', async () => {
    const calls = mockFetch({});
    show(makeEntry({ category: 'anime', title: 'Frieren' }));
    show();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Play preview/ })).not.toBeInTheDocument();
  });

  it('asks with the kind and the entry\'s Deezer id; shows the button; plays and pauses in a mini player', async () => {
    const calls = mockFetch({ 'GET /api/preview': { body: { url: MP3 } } });
    const { container } = show();
    const btn = await screen.findByRole('button', { name: '▶ Play preview' });
    expect(calls[0]!.path).toBe('/api/preview?kind=track&title=Blinding%20Lights&artist=The%20Weeknd&id=track%3A9');
    const audio = container.querySelector('audio')!;
    expect(audio).toHaveAttribute('src', MP3);
    await userEvent.click(btn);
    expect(play).toHaveBeenCalledTimes(1);
    const pauseBtn = await screen.findByRole('button', { name: 'Pause preview' });
    expect(screen.getByText('0:00 / 0:30')).toBeInTheDocument();
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 11 });
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('0:11 / 0:30')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Preview progress' })).toHaveAttribute('aria-valuenow', '11');
    await userEvent.click(pauseBtn);
    expect(pause).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('albums ask with kind=album', async () => {
    const calls = mockFetch({ 'GET /api/preview': { body: { url: null } } });
    show(makeEntry({ category: 'albums', title: 'Lemonade', creator: 'Beyoncé' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.path).toBe('/api/preview?kind=album&title=Lemonade&artist=Beyonc%C3%A9');
  });

  it('only one preview plays at a time, and leaving the page stops it', async () => {
    mockFetch({ 'GET /api/preview': { body: { url: MP3 } } });
    const qc = makeQueryClient();
    const two = (
      <QueryClientProvider client={qc}>
        <PlayPreview entry={song} />
        <PlayPreview entry={{ ...song, title: 'Other' }} />
      </QueryClientProvider>
    );
    const { container, unmount } = render(two);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '▶ Play preview' })).toHaveLength(2));
    const buttons = screen.getAllByRole('button', { name: '▶ Play preview' });
    await userEvent.click(buttons[0]!);
    expect(await screen.findByRole('button', { name: 'Pause preview' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '▶ Play preview' }));
    // the first one stopped (back to its start button), the second is the one playing
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Pause preview' })).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: '▶ Play preview' })).toHaveLength(1);
    expect(container.querySelectorAll('.preview__player')).toHaveLength(1);
    const before = pause.mock.calls.length;
    act(() => unmount());
    expect(pause.mock.calls.length).toBeGreaterThan(before);
  });
});
