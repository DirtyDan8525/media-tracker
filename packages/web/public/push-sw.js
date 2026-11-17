// Web push (Phase 6b, P5, P7). Pulled into the generated service worker with workbox importScripts.
// Payload: { title, body, tag, url }. A new notification with the same tag replaces the old one.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Media Tracker', body: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil((async () => {
    // A chat that is open and in front already shows the message: stay silent for it.
    if (url.startsWith('/messages/')) {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (open.some((c) => c.visibilityState === 'visible' && new URL(c.url).pathname === url)) return;
    }
    await self.registration.showNotification(data.title || 'Media Tracker', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      try {
        await client.focus();
        if (new URL(client.url).pathname !== url && 'navigate' in client) await client.navigate(url);
        return;
      } catch (e) {
        // fall through to a new window
      }
    }
    await self.clients.openWindow(url);
  })());
});
