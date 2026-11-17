# Phase 6b: Notifications (web push)

Dan (2026-11-16): notifications for messages and other activity, with on/off switches in Settings.

## Rulings
- **P1 How.** Standard Web Push from the Worker using `@pushforge/builder` (zero dependencies, WebCrypto, made for Cloudflare Workers). VAPID keys are Worker secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` as the library expects, `VAPID_SUBJECT` = `mailto:` Dan's address); the public key is served to the app by `GET /api/push/key`. With no keys set, push is "not set up" and nothing else changes.
- **P2 Devices.** Migration `0012_push.sql`: `push_subscriptions (endpoint PK, user_id FK CASCADE, p256dh, auth, created_at, last_ok_at)`. `POST /api/push/subscribe` (upsert by endpoint, ≤ 10 per user), `POST /api/push/unsubscribe { endpoint }`. A 404/410 from the push service deletes the subscription.
- **P3 What sends.** New message (not your own; muted if you're viewing that chat isn't knowable server-side — always send, the app suppresses showing it while that chat is focused), friend request received, friend request accepted, comment on your post, reaction on your post (at most one per post per 10 minutes), and for the admin: a new sign-up waiting. Sent after the response via `ctx.waitUntil`, never blocking the request; failures are ignored.
- **P4 Switches.** Settings → Notifications: a master switch ("Notifications on this device", which subscribes/unsubscribes this browser) and per-type switches stored in the user's settings (messages, friend requests, comments, reactions, sign-ups for admin), all on by default. The server checks the type switch before sending.
- **P5 Content.** Title + short body (e.g. "Ren: are we watching Frieren tonight?", "Vance reacted 🔥 to your post"), tag per conversation/post so repeats replace, click opens the right screen (`/messages/:id`, `/activity`, `/friends`, `/admin`). Message text is cut to 120 characters.
- **P6 iPhone.** Web push works only in the installed home-screen app (iOS 16.4+); asking for permission must come from a tap. The app shows "Install the app to get notifications" in Safari, and the switch only in the installed app.
- **P7 Service worker.** vite-plugin-pwa `generateSW` + `workbox.importScripts: ['push-sw.js']` (a small file in `public/`) handling `push` and `notificationclick` (focus an open window and navigate, else open one).
