import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeMe, mockFetch } from '../../test/mockApi';
import { publicSettings } from '../../test/appSettings';
import { makeQueryClient } from '../../test/queryClient';
import { InstallBanner } from './InstallBanner';
import { InstallSteps } from './InstallSteps';
import { OnboardingHost } from './OnboardingHost';
import { Walkthrough } from './Walkthrough';

/** The banner and the host read the admin's switches (GET /api/app), so they need a query client. */
const Q = ({ children }: { children: ReactNode }) => <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>;

vi.mock('../../shell/SessionGate', () => ({ useSessionMe: () => makeMe() }));

function standalone(on: boolean) {
  const orig = window.matchMedia;
  window.matchMedia = ((q: string) => (q.includes('display-mode') ? { ...orig(q), matches: on } : orig(q))) as typeof window.matchMedia;
  return () => { window.matchMedia = orig; };
}

beforeEach(() => localStorage.clear());

describe('Walkthrough', () => {
  it('has four cards with Next, a Start on the last, and Skip', async () => {
    const done = vi.fn();
    render(<Walkthrough onDone={done} />);
    expect(screen.getByRole('dialog', { name: 'Your lists' })).toBeInTheDocument();
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Add anything' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Rate and compare' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Friends and Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(done).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(done).toHaveBeenCalledOnce();
  });

  it('Skip finishes at once', async () => {
    const done = vi.fn();
    render(<Walkthrough onDone={done} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(done).toHaveBeenCalledOnce();
  });
});

describe('OnboardingHost', () => {
  it('shows the walkthrough once, then the install steps, and never again for that user', async () => {
    const { unmount } = render(<OnboardingHost />, { wrapper: Q });
    expect(screen.getByRole('dialog', { name: 'Your lists' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    render(<OnboardingHost />, { wrapper: Q });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('skips the install steps when already installed', async () => {
    const restore = standalone(true);
    render(<OnboardingHost />, { wrapper: Q });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    restore();
  });

  it('does not show for a user who has already seen it (seen is per user id)', () => {
    localStorage.setItem('mt-walkthrough-seen:u1', '1');
    render(<OnboardingHost />, { wrapper: Q });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Install steps', () => {
  it('shows both platforms with the manual steps when there is no install event', () => {
    render(<InstallSteps open onClose={() => {}} />);
    const d = within(screen.getByRole('dialog', { name: 'Install the app' }));
    expect(d.getAllByText('Add to Home Screen').length).toBeGreaterThan(0);
    expect(d.getByText('Edit Actions')).toBeInTheDocument();
    expect(d.getByText('Install app')).toBeInTheDocument();
    expect(d.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('offers an Install button when the browser sent beforeinstallprompt, and calls its prompt', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    render(<InstallSteps open onClose={() => {}} />);
    act(() => { window.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalledOnce();
  });
});

describe('InstallBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows "Install Media Tracker", opens the steps, and ✕ dismisses it for good', async () => {
    const { unmount } = render(<InstallBanner />, { wrapper: Q });
    expect(screen.getByText('Install Media Tracker')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    expect(screen.getByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
    unmount();
    render(<InstallBanner />, { wrapper: Q });
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
  });

  it('is hidden when already installed (display-mode: standalone)', () => {
    const restore = standalone(true);
    render(<InstallBanner />, { wrapper: Q });
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
    restore();
  });

  it('is hidden when iOS reports navigator.standalone', () => {
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    render(<InstallBanner />, { wrapper: Q });
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
  });

  it('still works when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<InstallBanner />, { wrapper: Q });
    expect(screen.getByText('Install Media Tracker')).toBeInTheDocument();
  });
});

describe('switched off by the admin (AD2)', () => {
  it('the install banner is gone when its switch is off', async () => {
    mockFetch({ 'GET /api/app': { body: publicSettings({ features: { installBanner: false } }) } });
    render(<InstallBanner />, { wrapper: Q });
    await waitFor(() => expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument());
  });

  it('the first-run walkthrough is skipped when its switch is off', async () => {
    mockFetch({ 'GET /api/app': { body: publicSettings({ features: { walkthrough: false } }) } });
    render(<OnboardingHost />, { wrapper: Q });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('the install banner shows the admin\'s app name', async () => {
    mockFetch({ 'GET /api/app': { body: publicSettings({ brand: { name: 'Our Shelf' } }) } });
    render(<InstallBanner />, { wrapper: Q });
    expect(await screen.findByText('Install Our Shelf')).toBeInTheDocument();
  });
});
