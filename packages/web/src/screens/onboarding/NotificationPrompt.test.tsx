import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeMe, mockApi } from '../../test/mockApi';
import { makeQueryClient } from '../../test/queryClient';
import { setCoarsePointer, setViewportWidth } from '../../test/viewport';
import { ToastProvider } from '../../design/components/Toast';
import { NotificationPrompt, PROMPT_TIMING } from './NotificationPrompt';
import { OnboardingHost } from './OnboardingHost';

let me = makeMe();
vi.mock('../../shell/SessionGate', () => ({ useSessionMe: () => me }));

const KEY = 'BINvd_szNWQK5NNn9-5QvOD88cFM-aabMgjQUNKdD7d6FOE--6hMQzLfIJn6vGWKgieYqMZmC2ro_Wf4q8vspU4';
const SUB_JSON = { endpoint: 'https://push.test/send/abc', keys: { p256dh: 'p', auth: 'a' } };
const withKey = { 'GET /api/push/key': { body: { key: KEY } }, 'POST /api/push/subscribe': { status: 204 } };

interface Fake { subscribed: boolean; subscribe: Mock<(...a: any[]) => any>; permission: NotificationPermission; request: Mock<(...a: any[]) => any> }
function fakePush(over: Partial<Fake> = {}): Fake {
  const f: Fake = { subscribed: false, permission: 'default', subscribe: vi.fn(), request: vi.fn(), ...over };
  const sub = () => ({ endpoint: SUB_JSON.endpoint, toJSON: () => SUB_JSON, unsubscribe: async () => true });
  f.subscribe.mockImplementation(async () => { f.subscribed = true; return sub(); });
  f.request.mockImplementation(async () => { if (f.permission === 'default') f.permission = 'granted'; return f.permission; });
  const pushManager = { getSubscription: async () => (f.subscribed ? sub() : null), subscribe: f.subscribe };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { get permission() { return f.permission; }, requestPermission: f.request });
  return f;
}

const UA = navigator.userAgent;
const setUA = (ua: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={makeQueryClient()}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);
const dialog = () => screen.queryByRole('dialog', { name: 'Notifications are here' });
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeEach(() => {
  me = makeMe();
  localStorage.clear();
  PROMPT_TIMING.delayMs = 20;
  PROMPT_TIMING.retryMs = 20;
});
afterEach(() => {
  setUA(UA);
  setCoarsePointer(false);
  Reflect.deleteProperty(navigator, 'serviceWorker');
  document.documentElement.classList.remove('kbd-open');
  PROMPT_TIMING.delayMs = 2500;
  PROMPT_TIMING.retryMs = 2000;
});

describe('NotificationPrompt', () => {
  it('shows once on a phone, and "Not now" marks it seen', async () => {
    fakePush();
    mockApi(me, withKey);
    const { unmount } = render(<NotificationPrompt />, { wrapper: wrap });
    expect(await screen.findByRole('dialog', { name: 'Notifications are here' })).toBeInTheDocument();
    expect(screen.getByText(/Get a notification for new messages, friend requests, and comments or reactions on your posts/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(dialog()).not.toBeInTheDocument();
    expect(localStorage.getItem('mt-notify-prompt-seen')).toBe('1');
    unmount();
    render(<NotificationPrompt />, { wrapper: wrap });
    await settle();
    expect(dialog()).not.toBeInTheDocument();
  });

  it('shows on a touch screen even when wide', async () => {
    setViewportWidth(1280);
    setCoarsePointer(true);
    fakePush();
    mockApi(me, withKey);
    render(<NotificationPrompt />, { wrapper: wrap });
    expect(await screen.findByRole('dialog', { name: 'Notifications are here' })).toBeInTheDocument();
  });

  it('"Turn on" subscribes from the tap, says "Notifications on" and marks it seen', async () => {
    const f = fakePush();
    const calls = mockApi(me, withKey);
    render(<NotificationPrompt />, { wrapper: wrap });
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(f.subscribe).toHaveBeenCalledOnce());
    expect(f.request).toHaveBeenCalledOnce();
    expect(calls.find((c) => c.path === '/api/push/subscribe')?.body).toEqual(SUB_JSON);
    expect(await screen.findByText('Notifications on')).toBeInTheDocument();
    expect(dialog()).not.toBeInTheDocument();
    expect(localStorage.getItem('mt-notify-prompt-seen')).toBe('1');
  });

  it('shows the Settings error text when subscribing fails, and stays open', async () => {
    fakePush();
    mockApi(me, { ...withKey, 'POST /api/push/subscribe': { status: 500, body: { error: 'boom' } } });
    render(<NotificationPrompt />, { wrapper: wrap });
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText("Couldn't turn on notifications. Try again.")).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
  });

  it.each([
    ['on a PC', () => { setViewportWidth(1280); fakePush(); mockApi(me, withKey); }],
    ['when already subscribed', () => { fakePush({ subscribed: true }); mockApi(me, withKey); }],
    ['when permission is denied', () => { fakePush({ permission: 'denied' }); mockApi(me, withKey); }],
    ['when the server is not set up', () => { fakePush(); mockApi(me, { 'GET /api/push/key': { status: 503, body: { error: 'not_configured' } } }); }],
    ['when the browser has no push', () => { mockApi(me, withKey); }],
    ['when already seen', () => { localStorage.setItem('mt-notify-prompt-seen', '1'); fakePush(); mockApi(me, withKey); }],
    ['when the person is not active yet', () => { me = makeMe({ status: 'pending' }); fakePush(); mockApi(me, withKey); }],
    ['on iPhone in Safari (not installed)', () => { setUA(IPHONE); fakePush(); mockApi(me, withKey); }],
  ])('is hidden %s', async (_name, arrange) => {
    arrange();
    render(<NotificationPrompt />, { wrapper: wrap });
    await settle();
    expect(dialog()).not.toBeInTheDocument();
  });

  it('waits while the keyboard is open', async () => {
    fakePush();
    mockApi(me, withKey);
    document.documentElement.classList.add('kbd-open');
    render(<NotificationPrompt />, { wrapper: wrap });
    await settle();
    expect(dialog()).not.toBeInTheDocument();
    document.documentElement.classList.remove('kbd-open');
    expect(await screen.findByRole('dialog', { name: 'Notifications are here' })).toBeInTheDocument();
  });

  it('does not overlap the walkthrough or the install steps, and comes after them', async () => {
    fakePush();
    mockApi(me, withKey);
    render(<OnboardingHost />, { wrapper: wrap });
    expect(screen.getByRole('dialog', { name: 'Your lists' })).toBeInTheDocument();
    await settle();
    expect(dialog()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
    await settle();
    expect(dialog()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('dialog', { name: 'Notifications are here' })).toBeInTheDocument();
  });

  it('holds back while another dialog is open', async () => {
    fakePush();
    mockApi(me, withKey);
    localStorage.setItem('mt-walkthrough-seen:u1', '1');
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    render(<OnboardingHost />, { wrapper: wrap });
    await settle();
    expect(dialog()).not.toBeInTheDocument();
    other.remove();
    expect(await screen.findByRole('dialog', { name: 'Notifications are here' })).toBeInTheDocument();
  });
});
