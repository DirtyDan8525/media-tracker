import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// public/push-sw.js (P5, P7): loaded into a fake service-worker scope.
const code = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');

function load(clients: { url: string; visibilityState: string; focus?: () => Promise<void>; navigate?: (u: string) => Promise<void> }[]) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: any }[] = [];
  const openWindow = vi.fn(async () => undefined);
  const scope = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    registration: { showNotification: async (title: string, opts: unknown) => { shown.push({ title, opts }); } },
    clients: { matchAll: async () => clients, openWindow },
    location: { origin: 'https://app.test' },
  };
  new Function('self', code)(scope);
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers[type]!({ ...event, waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
  };
  return { shown, openWindow, dispatch };
}
const push = (data: unknown) => ({ data: { json: () => data, text: () => JSON.stringify(data) } });

describe('push-sw.js', () => {
  it('shows the notification with title, body, tag and the click url', async () => {
    const sw = load([]);
    await sw.dispatch('push', push({ title: 'Ren', body: 'are we watching Frieren?', tag: 'chat-1', url: '/messages/1' }));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe('Ren');
    expect(sw.shown[0]!.opts).toMatchObject({ body: 'are we watching Frieren?', tag: 'chat-1', icon: '/icon-192.png', data: { url: '/messages/1' } });
  });

  it('stays silent for a chat that is open and visible, but not for other screens or hidden windows', async () => {
    const open = load([{ url: 'https://app.test/messages/1', visibilityState: 'visible' }]);
    await open.dispatch('push', push({ title: 'Ren', body: 'hi', tag: 'chat-1', url: '/messages/1' }));
    expect(open.shown).toHaveLength(0);
    await open.dispatch('push', push({ title: 'Ren', body: 'hi', tag: 'chat-2', url: '/messages/2' }));
    expect(open.shown).toHaveLength(1);
    const hidden = load([{ url: 'https://app.test/messages/1', visibilityState: 'hidden' }]);
    await hidden.dispatch('push', push({ title: 'Ren', body: 'hi', tag: 'chat-1', url: '/messages/1' }));
    expect(hidden.shown).toHaveLength(1);
  });

  it('a click focuses an open window and navigates it, else opens one', async () => {
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const close = vi.fn();
    const withWin = load([{ url: 'https://app.test/list/anime', visibilityState: 'hidden', focus, navigate }]);
    await withWin.dispatch('notificationclick', { notification: { close, data: { url: '/friends' } } });
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/friends');
    expect(withWin.openWindow).not.toHaveBeenCalled();
    const none = load([]);
    await none.dispatch('notificationclick', { notification: { close, data: { url: '/admin' } } });
    expect(none.openWindow).toHaveBeenCalledWith('/admin');
  });
});
