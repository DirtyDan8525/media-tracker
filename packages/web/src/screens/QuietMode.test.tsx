import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatQuietUntil } from '../data/quiet';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const meQuiet = (quietUntil: string | null) => {
  const me = makeMe();
  return { ...me, settings: { ...me.settings, quietUntil } };
};
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

afterEach(() => { vi.useRealTimers(); setViewportWidth(390); });

describe('formatQuietUntil', () => {
  it('says today or tomorrow with the time', () => {
    const now = new Date(2026, 10, 20, 15, 40);
    expect(formatQuietUntil(new Date(2026, 10, 21, 15, 40), now)).toBe('3:40 PM tomorrow');
    expect(formatQuietUntil(new Date(2026, 10, 20, 21, 5), now)).toBe('9:05 PM today');
    expect(formatQuietUntil(new Date(2026, 10, 23, 8, 0), now)).toBe('8:00 AM Monday');
  });
});

describe('Quiet mode switch (Settings)', () => {
  it('is off by default; turning it on saves now + 24 h and shows "On until ... tomorrow"', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const sw = await screen.findByRole('switch', { name: "Quiet mode: don't post my changes to Activity" });
    expect(sw).not.toBeChecked();
    const before = Date.now();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeDefined());
    const sent = (calls.find((c) => c.method === 'PUT')!.body as { settings: { quietUntil: string } }).settings.quietUntil;
    expect(Date.parse(sent) - before).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
    expect(Date.parse(sent) - before).toBeLessThan(24 * 3_600_000 + 5000);
    expect(await screen.findByText(/^On until \d{1,2}:\d{2} (AM|PM) (today|tomorrow)$/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Quiet mode/ })).toBeChecked();
  });

  it('shows the time while active and turning it off sends null', async () => {
    const calls = mockApi(meQuiet(hoursAhead(5)));
    renderApp('/settings');
    const sw = await screen.findByRole('switch', { name: /Quiet mode/ });
    expect(sw).toBeChecked();
    expect(screen.getByText(/^On until /)).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { quietUntil: null } }));
    expect(screen.queryByText(/^On until /)).not.toBeInTheDocument();
  });

  it('an expired time reads as off', async () => {
    mockApi(meQuiet(hoursAhead(-1)));
    renderApp('/settings');
    expect(await screen.findByRole('switch', { name: /Quiet mode/ })).not.toBeChecked();
    expect(screen.queryByText(/^On until /)).not.toBeInTheDocument();
  });
});

describe('Quiet mode banner', () => {
  it('shows on the phone and on PC while on, with only a Turn off action', async () => {
    mockApi(meQuiet(hoursAhead(3)));
    renderApp('/list/anime');
    const banner = await screen.findByText("Quiet mode is on: your changes aren't posted.");
    const region = banner.closest('.quiet-banner') as HTMLElement;
    expect(within(region).getAllByRole('button')).toHaveLength(1);
    expect(within(region).getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('shows on PC too', async () => {
    setViewportWidth(1280);
    mockApi(meQuiet(hoursAhead(3)));
    renderApp('/list/anime');
    expect(await screen.findByText("Quiet mode is on: your changes aren't posted.")).toBeInTheDocument();
  });

  it('is absent when off or expired', async () => {
    mockApi(meQuiet(hoursAhead(-2)));
    renderApp('/list/anime');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByText(/Quiet mode is on/)).not.toBeInTheDocument();
  });

  it('Turn off clears it and the banner goes', async () => {
    const calls = mockApi(meQuiet(hoursAhead(3)));
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { quietUntil: null } }));
    await waitFor(() => expect(screen.queryByText(/Quiet mode is on/)).not.toBeInTheDocument());
  });

  it('goes away by itself at the expiry time', async () => {
    mockApi(meQuiet(new Date(Date.now() + 1500).toISOString()));
    renderApp('/list/anime');
    expect(await screen.findByText(/Quiet mode is on/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Quiet mode is on/)).not.toBeInTheDocument(), { timeout: 4000 });
  });
});
