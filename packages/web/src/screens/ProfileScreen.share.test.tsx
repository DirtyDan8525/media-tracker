import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi, type MockResponse } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

const LINK = 'https://app.test/p/AbCdEfGhIjKlMnOpQrStUv';
const CONFIRM = 'This makes a link anyone can open to see your lists, ratings and notes (not private titles or private notes). You can turn it off in Edit profile.';

type State = { on: boolean; legacy: boolean };
function backend(state: State, over: Record<string, MockResponse> = {}) {
  const calls = mockApi(makeMe(), {
    'GET /api/me/public-link': () => ({ body: !state.on ? { on: false } : state.legacy ? { on: true, link: null, legacy: true } : { on: true, link: LINK } }),
    'POST /api/me/public-link': () => { state.on = true; state.legacy = false; return { body: { link: LINK } }; },
    ...over,
  });
  const posts = () => calls.filter((c) => c.method === 'POST' && c.path === '/api/me/public-link').length;
  return { posts };
}
const shareBtn = () => screen.findByRole('button', { name: 'Share your profile' });
const canShare = () => { const share = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'share', { value: share, configurable: true }); return share; };
const canCopy = () => { const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); return writeText; };

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'share'); });

describe('Profile: Share your public link', () => {
  it('first use: asks first, then makes the link and shares it with title, text and url', async () => {
    const share = canShare();
    const { posts } = backend({ on: false, legacy: false });
    renderApp('/profile');
    await userEvent.click(await shareBtn());
    const sheet = await screen.findByRole('dialog', { name: 'Share your profile?' });
    expect(within(sheet).getByText(CONFIRM)).toBeInTheDocument();
    expect(posts()).toBe(0);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share).toHaveBeenCalledWith({ title: expect.any(String), text: expect.stringMatching(/^My lists on .+/), url: LINK });
    expect(posts()).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'Share your profile?' })).not.toBeInTheDocument();
  });

  it('Cancel makes no link and shares nothing', async () => {
    const share = canShare();
    const { posts } = backend({ on: false, legacy: false });
    renderApp('/profile');
    await userEvent.click(await shareBtn());
    const sheet = await screen.findByRole('dialog', { name: 'Share your profile?' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Share your profile?' })).not.toBeInTheDocument();
    expect(posts()).toBe(0);
    expect(share).not.toHaveBeenCalled();
  });

  it('without device sharing it copies the link and says "Link copied"', async () => {
    const writeText = canCopy();
    backend({ on: false, legacy: false });
    renderApp('/profile');
    await userEvent.click(await shareBtn());
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Share your profile?' })).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('a link that already exists is shared straight away, with no confirm and no new link', async () => {
    const share = canShare();
    const { posts } = backend({ on: true, legacy: false });
    renderApp('/profile');
    await userEvent.click(await shareBtn());
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: LINK })));
    expect(screen.queryByRole('dialog', { name: 'Share your profile?' })).not.toBeInTheDocument();
    expect(posts()).toBe(0);
  });

  it('an old link (made before links were stored) goes through the confirm and makes a new one', async () => {
    const share = canShare();
    const { posts } = backend({ on: true, legacy: true });
    renderApp('/profile');
    await userEvent.click(await shareBtn());
    const sheet = await screen.findByRole('dialog', { name: 'Share your profile?' });
    expect(posts()).toBe(0);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: LINK })));
    expect(posts()).toBe(1);
  });

  it('a failed link says so and shares nothing', async () => {
    const share = canShare();
    backend({ on: false, legacy: false }, { 'POST /api/me/public-link': { status: 500, body: { error: 'internal_error' } } });
    renderApp('/profile');
    await userEvent.click(await shareBtn());
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Share your profile?' })).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText("Couldn't make your link. Try again.")).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });
});
