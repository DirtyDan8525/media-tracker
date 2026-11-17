import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { makeMe, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

// The feature is paused in the app (NOTIFICATIONS_ENABLED = false); these tests run with it on.
vi.mock('./NotificationsSection', async (orig) => ({ ...(await orig<typeof import('./NotificationsSection')>()), NOTIFICATIONS_ENABLED: true }));

// Phase 6b (P4, P6): the Notifications section of Settings.
const KEY = 'BINvd_szNWQK5NNn9-5QvOD88cFM-aabMgjQUNKdD7d6FOE--6hMQzLfIJn6vGWKgieYqMZmC2ro_Wf4q8vspU4';
const SUB_JSON = { endpoint: 'https://push.test/send/abc', keys: { p256dh: 'p', auth: 'a' } };

interface Fake { subscribed: boolean; subscribe: Mock<(...a: any[]) => any>; unsubscribe: Mock<(...a: any[]) => any>; permission: NotificationPermission; request: Mock<(...a: any[]) => any> }

/** A browser with push: serviceWorker.ready -> pushManager, window.PushManager, window.Notification. */
function fakePush(over: Partial<Fake> = {}): Fake {
  const f: Fake = { subscribed: false, permission: 'default', subscribe: vi.fn(), unsubscribe: vi.fn(), request: vi.fn(), ...over };
  const sub = () => ({ endpoint: SUB_JSON.endpoint, toJSON: () => SUB_JSON, unsubscribe: async () => { f.subscribed = false; f.unsubscribe(); return true; } });
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

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => {
  setUA(UA);
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.unstubAllGlobals();
});

const section = async () => within(await screen.findByRole('region', { name: 'Notifications' }));
const withKey = { 'GET /api/push/key': { body: { key: KEY } } };

describe('Settings > Notifications', () => {
  it('says "Not set up yet" when the server has no keys', async () => {
    fakePush();
    mockApi(makeMe(), { 'GET /api/push/key': { status: 503, body: { error: 'not_configured' } } });
    renderApp('/settings');
    expect(await (await section()).findByText('Not set up yet')).toBeInTheDocument();
    expect((await section()).queryByRole('switch')).not.toBeInTheDocument();
  });

  it('in Safari on iPhone (not installed) offers the install steps instead of a switch', async () => {
    setUA(IPHONE);
    mockApi(makeMe(), withKey);
    renderApp('/settings');
    const s = await section();
    expect(s.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(s.getByRole('button', { name: 'Install the app to get notifications' }));
    expect(await screen.findByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
  });

  it('in the installed iPhone app shows the switch', async () => {
    setUA(IPHONE);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    fakePush();
    mockApi(makeMe(), withKey);
    renderApp('/settings');
    expect(await (await section()).findByRole('switch', { name: 'Notifications on this device' })).not.toBeChecked();
  });

  it('turning it on from a tap asks permission, subscribes with the key and posts the subscription', async () => {
    const f = fakePush();
    const calls = mockApi(makeMe(), { ...withKey, 'POST /api/push/subscribe': { status: 204 } });
    renderApp('/settings');
    const master = await (await section()).findByRole('switch', { name: 'Notifications on this device' });
    expect(master).not.toBeChecked();
    await userEvent.click(master);
    await waitFor(() => expect(master).toBeChecked());
    expect(f.request).toHaveBeenCalledTimes(1);
    const opts = f.subscribe.mock.calls[0]![0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toHaveLength(65);
    expect(opts.applicationServerKey[0]).toBe(0x04);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/push/subscribe')?.body).toEqual(SUB_JSON);
  });

  it('turning it off unsubscribes this browser and tells the server', async () => {
    const f = fakePush({ subscribed: true, permission: 'granted' });
    const calls = mockApi(makeMe(), { ...withKey, 'POST /api/push/unsubscribe': { status: 204 } });
    renderApp('/settings');
    const master = await (await section()).findByRole('switch', { name: 'Notifications on this device' });
    await waitFor(() => expect(master).toBeChecked());
    await userEvent.click(master);
    await waitFor(() => expect(master).not.toBeChecked());
    expect(f.unsubscribe).toHaveBeenCalled();
    expect(calls.find((c) => c.path === '/api/push/unsubscribe')?.body).toEqual({ endpoint: SUB_JSON.endpoint });
  });

  it('does not subscribe when the permission is refused', async () => {
    const f = fakePush();
    f.request.mockImplementation(async () => { f.permission = 'denied'; return 'denied'; });
    const calls = mockApi(makeMe(), withKey);
    renderApp('/settings');
    const master = await (await section()).findByRole('switch', { name: 'Notifications on this device' });
    await userEvent.click(master);
    await waitFor(() => expect(f.request).toHaveBeenCalled());
    expect(f.subscribe).not.toHaveBeenCalled();
    expect(calls.some((c) => c.path === '/api/push/subscribe')).toBe(false);
    expect(await (await section()).findByText(/blocked in your browser settings/)).toBeInTheDocument();
  });

  it('per-type switches default on, save to settings.notify, and sign-ups show for the admin only', async () => {
    fakePush();
    const calls = mockApi(makeMe(), withKey);
    const { unmount } = renderApp('/settings');
    const s = await section();
    for (const name of ['Messages', 'Friend requests', 'Comments on my posts', 'Reactions to my posts']) {
      expect(await s.findByRole('switch', { name })).toBeChecked();
    }
    expect(s.queryByRole('switch', { name: 'New sign-ups waiting' })).not.toBeInTheDocument();
    await userEvent.click(s.getByRole('switch', { name: 'Reactions to my posts' }));
    expect(s.getByRole('switch', { name: 'Reactions to my posts' })).not.toBeChecked();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ settings: { notify: { reactions: false } } }));
    unmount();

    mockApi(makeMe({ isAdmin: true }), withKey);
    renderApp('/settings');
    expect(await (await section()).findByRole('switch', { name: 'New sign-ups waiting' })).toBeChecked();
  });
});
