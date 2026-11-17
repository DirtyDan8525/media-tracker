# Phase 6: Messages, group chats, pictures, recommendations

From docs/plans/phase5-requests.md item 11 (Dan, 2026-11-16/17). Notifications (web push) and the Admin powers come after this.

## Rulings

- **M1 Data.** New migration `0011_messages.sql`:
  - `conversations (id PK, kind 'direct'|'group', name NULL, created_by FK users, created_at, last_message_at)`
  - `conversation_members (conversation_id FK CASCADE, user_id FK users CASCADE, joined_at, last_read_at NULL, PRIMARY KEY (conversation_id, user_id))`
  - `messages (id PK, conversation_id FK CASCADE, sender_id FK users CASCADE, kind 'text'|'image'|'rec', body TEXT, rec_json TEXT NULL, image_key TEXT NULL, created_at, deleted_at NULL)` with index `(conversation_id, created_at)`.
  - A direct chat is unique per pair (look up before creating).
- **M2 Who.** Only active users. A direct chat needs the two to be accepted friends. A group: its creator picks 1–19 of their friends (max 20 members); any member can add their own friends, rename it and leave; nobody is removed by others (the admin can delete accounts). Unfriending doesn't remove anyone from an existing group; a former friend's direct chat becomes read-only.
- **M3 Reading.** Only members read a conversation, its messages and its pictures (404 otherwise). Messages page newest-first, 50 per page, `before` cursor. Opening a chat sets `last_read_at`. Unread: `GET /api/activity/unread` gains `messages` (number of conversations with messages after your `last_read_at`, not sent by you).
- **M4 Delivery.** Polling, no extra Cloudflare setup: an open chat checks every 5 s while visible; the Messages list on open/focus and every 30 s; the unread badge with the feed's existing poll. (Live updates via a Durable Object can replace polling later.)
- **M5 Sending.** Text 1–2000 characters (trimmed). Rate limit 30 messages per minute per user (429). You can delete your own message (soft: "Message deleted"). Each send bumps `last_message_at`.
- **M6 Pictures.** Stored in Cloudflare R2 (binding `MEDIA`, bucket `media-tracker-media`). The phone/PC resizes before upload (longest side ≤ 1600 px, JPEG ~0.82, ≤ 1.5 MB); the Worker accepts `image/jpeg|png|webp` ≤ 5 MB, checks magic bytes, stores `msg/<conversation>/<id>`, and serves it only to members (`private, max-age=31536000, immutable`). With no `MEDIA` binding, sending a picture answers 503 `not_configured` and the button says "Pictures need setup". Deleting a message deletes its picture.
- **M7 Recommendations.** **Share** on any title's page (yours or a friend's) → pick friends and/or groups → optional note → sends `kind 'rec'` with a snapshot `{category, title, creator, coverUrl, rating (yours, if any), source, sourceId}` plus the note as body. In a chat, a **Recommend** button picks a title from your lists. The card shows cover, title, list, the sender's rating and note, and **Add to mine** (adds it as Plan to watch / Plan to read; "On your list" with a link if you have it). Messages has a **Recommended to you** view: recs you received, newest first, with Add to mine.
- **M8 Where.** On phones **Messages replaces Top 5 in the bottom bar** (Home, Activity, Search, Messages, More; unread badge on the tab; Top 5 goes back into More) (Dan, 2026-11-17). A Messages row in the PC side nav. A friend's profile gets **Message**. Routes: `/messages`, `/messages/:id`, `/messages/new`, `/messages/recommended`.
- **M9 Admin.** Delete account removes the user's messages via cascade; groups keep going.

## Tasks
- **T0 Wireframes** (approval gate for the web): `MessagesList`, `Chat` (text, picture, rec card, deleted), `NewChat` (pick friends → group name), `ShareRec` (Share sheet), `Recommended`.
- **T1 Server** (parallel with T0): migration, API (`/api/conversations…`, `/api/messages…`), unread count, R2 pictures, tests for every rule incl. membership and friendship checks, query counts, rate limit. SETUP: R2 bucket steps.
- **T2 Web** after approval.
