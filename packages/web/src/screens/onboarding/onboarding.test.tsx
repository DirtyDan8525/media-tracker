import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe } from '../../test/mockApi';
import { InstallBanner } from './InstallBanner';
import { InstallSteps } from './InstallSteps';
import { OnboardingHost } from './OnboardingHost';
import { Walkthrough } from './Walkthrough';

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
    const { unmount } = render(<OnboardingHost />);
    expect(screen.getByRole('dialog', { name: 'Your lists' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    render(<OnboardingHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('skips the install steps when already installed', async () => {
    const restore = standalone(true);
    render(<OnboardingHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    restore();
  });

  it('does not show for a user who has already seen it (seen is per user id)', () => {
    localStorage.setItem('mt-walkthrough-seen:u1', '1');
    render(<OnboardingHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Install steps', () => {
  it('shows both platforms with the manual steps when there is no install event', () => {
    render(<InstallSteps open onClose={() => {}} />);
    const d = within(screen.getByRole('dialog', { name: 'Install the app' }));
    expect(d.getByText('Add to Home Screen')).toBeInTheDocument();
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
    const { unmount } = render(<InstallBanner />);
    expect(screen.getByText('Install Media Tracker')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    expect(screen.getByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
    unmount();
    render(<InstallBanner />);
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
  });

  it('is hidden when already installed (display-mode: standalone)', () => {
    const restore = standalone(true);
    render(<InstallBanner />);
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
    restore();
  });

  it('is hidden when iOS reports navigator.standalone', () => {
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    render(<InstallBanner />);
    expect(screen.queryByText('Install Media Tracker')).not.toBeInTheDocument();
  });

  it('still works when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<InstallBanner />);
    expect(screen.getByText('Install Media Tracker')).toBeInTheDocument();
  });
});
