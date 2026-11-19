import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMe, mockApi, type MockResponse } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const LINK = 'https://app.test/p/AbCdEfGhIjKlMnOpQrStUv';
const NOTE = 'Anyone with the link can see your lists, ratings and notes — not private titles or private notes.';

function backend(on: boolean, over: Record<string, MockResponse> = {}) {
  const state = { on };
  const calls = mockApi(makeMe(), {
    'GET /api/me/public-link': () => ({ body: { on: state.on } }),
    'POST /api/me/public-link': () => { state.on = true; return { body: { link: LINK } }; },
    'DELETE /api/me/public-link': () => { state.on = false; return { status: 204 }; },
    ...over,
  });
  return { calls, state };
}
const section = async () => {
  const sw = await screen.findByRole('switch', { name: 'Public profile link' });
  return { sw, box: sw.closest('.public-link') as HTMLElement };
};

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'share'); });

describe('Settings > Public profile link', () => {
  it('is off by default and shows the privacy note', async () => {
    backend(false);
    renderApp('/settings');
    const { sw } = await section();
    await waitFor(() => expect(sw).not.toBeChecked());
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy public link' })).not.toBeInTheDocument();
  });

  it('turning it on makes a link and shows it once, with Copy, Share and Make a new link', async () => {
    const { calls } = backend(false);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp('/settings');
    const { sw } = await section();
    await waitFor(() => expect(sw).not.toBeChecked());
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/me/public-link')).toBe(true));
    expect(await screen.findByDisplayValue(LINK)).toHaveAttribute('readonly');
    expect(sw).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Copy public link' }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    await userEvent.click(screen.getByRole('button', { name: 'Share public link' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: LINK }));
    expect(screen.getByRole('button', { name: 'Make a new link' })).toBeInTheDocument();
  });

  it('on from before: the link cannot be shown again, so it offers Make a new link (the old one stops working)', async () => {
    const { calls } = backend(true);
    renderApp('/settings');
    const { sw, box } = await section();
    await waitFor(() => expect(sw).toBeChecked());
    expect(within(box).queryByDisplayValue(LINK)).not.toBeInTheDocument();
    expect(within(box).getByText(/shown only once/)).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Make a new link' }));
    expect(await within(box).findByDisplayValue(LINK)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/me/public-link')).toHaveLength(1);
  });

  it('no Share button when the device cannot share', async () => {
    backend(false);
    renderApp('/settings');
    const { sw } = await section();
    await waitFor(() => expect(sw).not.toBeChecked());
    await userEvent.click(sw);
    await screen.findByDisplayValue(LINK);
    expect(screen.queryByRole('button', { name: 'Share public link' })).not.toBeInTheDocument();
  });

  it('turning it off deletes the link and hides it', async () => {
    const { calls } = backend(true);
    renderApp('/settings');
    const { sw } = await section();
    await waitFor(() => expect(sw).toBeChecked());
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/me/public-link')).toBe(true));
    await waitFor(() => expect(sw).not.toBeChecked());
    expect(screen.queryByRole('button', { name: 'Make a new link' })).not.toBeInTheDocument();
  });

  it('a failed save says so and leaves the switch as it was', async () => {
    backend(false, { 'POST /api/me/public-link': { status: 500, body: { error: 'internal_error' } } });
    renderApp('/settings');
    const { sw } = await section();
    await waitFor(() => expect(sw).not.toBeChecked());
    await userEvent.click(sw);
    expect(await screen.findByText("Couldn't change your public link. Try again.")).toBeInTheDocument();
    expect(sw).not.toBeChecked();
  });
});
