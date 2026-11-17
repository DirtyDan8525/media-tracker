# Media Tracker App, Phase 4 (Social): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends: Dan approves people from an Admin screen (the Worker edits the Access policy), people add each other by username or invite link, see each other's lists read-only, compare ratings, and react to and comment on each other's activity, with private entries and private notes enforced on the server.

**Architecture:** One Worker module, `social/visibility.ts`, owns the rule "owner, or accepted friend and not private" as a pure `canView` plus the matching SQL fragment; every friend-visible route filters with the fragment and maps rows through `toFriendEntry`, which re-checks `canView` and drops private notes and every pick-derived field. Activity rows get a `post_id` written at insert time (the 10-minute merge moves from read time to write time, so a post has a stable id that reactions and comments can point at). Friend data is online only (TanStack Query, no Dexie); comparisons and group Top 5 are pure shared functions run on the device over the server-filtered rows.

**Tech Stack:** As Phase 3 (TypeScript, Hono, Cloudflare Workers + D1, React, React Router, TanStack Query, Dexie, Vitest, Testing Library, Playwright). No new dependencies. The Worker calls the Cloudflare REST API with `fetch`.

**Spec:** `docs/specs/decisions-2026-11-15.md` (incl. "Amendments") wins over `docs/specs/spec-v1.2-social-excerpt.md`; executors read both. **Do not** plan or build from `docs/specs/media-tracker-app-spec.md` (out of date). Also binding: `docs/decisions-phase3.md` (incl. the 3b rulings B1–B24, which this plan amends only where a ruling below says so), `docs/decisions-phase3c.md`, `docs/design-notes.md`, the approved boards in `docs/design/mockups/*.v2.dc.html` and `*.wf.dc.html`.

## Global Constraints

- npm commands run as `npx -y npm@11 …`. Work on branch `phase4`, cut from `phase3b-nav`.
- D1: ≤ 100 bound parameters per statement; ≤ 50 queries per invocation (each statement in `db.batch()` counts; sign-in costs up to 3). Lists of ids travel as one JSON parameter through `json_each`. Every new route's comment states its query count, and its test asserts it with `spyD1`.
- **Visibility (spec §4):** a viewer sees an entry if they own it, or are an accepted friend of the owner and the entry isn't private. Notes are omitted when `notes_private`. Private entries never create feed posts visible to others and never appear in comparisons or group Top 5 (either side). **Comparisons (picks) are never readable by anyone but their owner**; friend responses carry no `strength`, `priorMean`, `scoreLocked` or comparison rows.
- Every friend-visible response goes through `social/visibility.ts`. A route that reads another user's rows without it is a review failure.
- Friendships go both ways and can be removed. A pending friend is not a friend.
- Reactions: exactly `REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏']`. Comments: 1–500 characters after trimming (`COMMENT_MAX = 500`).
- Feed: posts for new ratings, status changes and re-ratings (Compare's "re-rated" rule from 3c stays); changes to one entry within 10 minutes of the post's first change are one post; imports and note edits post nothing.
- Only the admin (`users.is_admin`) reaches `/api/admin/*`. Access free plan: 50 users (`ACCESS_SEATS = 50`).
- UI: calm v2 style, Inter only, tap targets ≥ 44 px, every control named, motion inside `prefers-reduced-motion: no-preference`, WCAG AA, friendly empty / loading / error states with a next step. UI tasks (9–12) wait for Task 0 approval.
- Out of scope: web push (Phase 6), the iPhone sign-in swap (Phase 5; only the check in Task 1 is here), Admin's lookup health and diagnose (§5.6, not friends), revoking someone's access (see Open questions).

## Review Focus

1. **An entry turned private after friends saw it.** Its posts, reactions, comments and cover must disappear for friends at once (read-time filter, not write-time). Test in Task 5 and Task 6.
2. **A pending or removed friend.** Unfriending (either side) or a declined request must cut every friend read at once, including the avatar and the cover proxy. Test in Task 2's matrix.
3. **Opening `/add/<code>` as a brand-new user.** Access sign-in, then username setup, must still land on the add screen (today setup sends you home). Test in Task 9.
4. **A post that keeps changing.** Rating 7 → 8 at 12:00 and 8 → 9 at 12:08 is one post (7 → 9); a change at 12:11 is a new post; reactions on the first post stay on it. Test in Task 5.
5. **The Cloudflare policy already holds the email, or Cloudflare fails.** No second PUT and no duplicate rule; a 4xx/5xx or timeout is shown as "Cloudflare refused: <message>" and nothing is recorded as approved. Test in Task 7.

## Rulings

- **S1 — Cloudflare API for admin invites (cited).** The Access policy Dan made in SETUP §9 is a *reusable* policy. The Worker:
  1. `GET https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/access/policies/{ACCESS_POLICY_ID}` ("Get an Access reusable policy"; accepted permissions "Access: Apps and Policies Write" or "Access: Apps and Policies Read").
  2. If no `include` rule is `{ "email": { "email": <same, case-insensitive> } }`, `PUT` the same path ("Update an Access reusable policy"; accepted permission "Access: Apps and Policies Write"; `decision`, `include` and `name` are required, so it is a full replace). Body: the GET's `result` with `id`, `created_at`, `updated_at`, `app_count`, `reusable` removed and `include` = old include + `{ "email": { "email": "<email>" } }` ("EmailRule … Matches a specific email").
  3. Header `Authorization: Bearer <CF_API_TOKEN>`, `Content-Type: application/json`, 8 s timeout each. Success = HTTP 2xx and `success: true`; otherwise 502 `{ error: 'cloudflare', message: errors[0].message }`.
  The token is a custom API token with **Account → Access: Apps and Policies → Edit** (the permissions reference lists "Access: Apps and Policies Edit — Grants write access to Cloudflare Access applications and policies"), scoped to Dan's account only. Sources: developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/methods/get/ and …/methods/update/, and developers.cloudflare.com/fundamentals/api/reference/permissions/. Config: secret `CF_API_TOKEN`; vars `CF_ACCOUNT_ID`, `ACCESS_POLICY_ID`. Missing any → 503 `not_configured`. Cost if wrong: SETUP's probe (Task 7) fails before Dan relies on it.
- **S2 — the link Dan sends** is `<origin>/add/<Dan's invite code>`: it opens the app (Access asks the friend to sign in) and, after username setup, offers "Add @dan". Approving an email also writes `invites (email, created_at)` so Admin can list approved-but-not-joined people.
- **S3 — friendships table:** one row per pair, `user_a < user_b` (CHECK), `status 'pending' | 'accepted'`, `requested_by`, `created_at`, `accepted_at`. Request by username: creates pending; if the other side already asked you, it becomes accepted. Invite link: accepted straight away (the link owner consented by sharing it). Decline, cancel and remove are all `DELETE` of the row.
- **S4 — invite codes:** `users.invite_code`, 12 chars from `[a-z0-9]` via `crypto.getRandomValues`, unique index, created on first `GET /api/me/invite`. Regenerate replaces it; the old link answers 404 `not_found` ("This link no longer works").
- **S5 — posts.** `activity.post_id` (nullable). A new row looks for its user's newest *anchor* row (`post_id IS NULL`) for the same entry with `created_at >= now − 10 min`; if found, `post_id` = that anchor's id, else NULL (it is an anchor). A post's id is its anchor's id; its rows are `COALESCE(post_id, id)`. Rows from before migration 0006 stay one post each (Dan's old You history shows unmerged; cost: cosmetic). `foldPosts` replaces `mergeActivity` (same first-`from` / last-`to` rules, grouped by post id, `key` = post id). Amends B15.
- **S6 — feed scope:** `GET /api/activity?show=you|friends|everyone` (default `everyone`; amends B24's default). **Amended by Dan 2026-11-16: Everyone = all active users.** `everyone` shows posts of ALL active users (`users.status = 'active'`), friends or not, plus your own; `friends` stays friends only; `you` unchanged. Others' posts appear only when the entry is not private (yours always show) and the folded post has a rating or status change; a bare "added" shows only in You; pending and removed users never appear. `ActivityPage.friends` lists which authors are your friends: the web links a friend's title to their entry page, but a non-friend's title is plain text (entry pages stay friends-only) and their name links to `/u/<username>` (Add friend). Pages are 30 posts by anchor `(created_at, id)`.
- **S7 — reactions and comments** point at exactly one of `activity_id` (a post id) or `entry_id` (CHECK). Allowed when the viewer can see the entry behind the target. **Amended by Dan 2026-11-16: Everyone = all active users:** an `activity_id` target is open to its owner and to anyone for a non-private entry's post by an active user (`resolveTarget`, `canViewPost`); `entry_id` targets stay friends-only. Deleting your own comment follows the same rule per target kind. Reactions toggle (unique per user, target, emoji). Comments are soft-deleted (`deleted_at`), by their author or by the entry's owner; deleted ones are not returned. Lists are oldest first, at most 200.
- **S10 — deleting posts (Dan 2026-11-16):** `DELETE /api/activity/:postId` (anchor id, owner only, 404 otherwise) and `POST /api/activity/delete { postIds }` (1-100 anchor ids, owner only, ids that aren't yours ignored) delete the anchor, every row with `post_id` = it, and the posts' reactions and comments, in one batch; the entry stays on the list. Web: ⋯ "Delete post" on your posts, and Select mode on You with "Delete N posts"; both confirm first.
- **S8 — unread:** `users.feed_seen_at`. `GET /api/activity/unread` → `{ feed, requests }`: `feed` = visible friends' posts plus others' comments and reactions on your posts and entries, all newer than `feed_seen_at`, capped at 99; `requests` = incoming pending. `POST /api/activity/seen` sets `feed_seen_at = now`; the Activity screen calls it when Everyone or Friends is shown. Badge: count on the Activity tab / side-nav row (`"Activity, 3 new"`); a dot on the profile button when `requests > 0`. Polled on window focus and every 60 s while visible.
- **S9 — the visibility module** (`packages/worker/src/social/visibility.ts`): `relationOf` (one query), pure `canView(rel, entry)` and `canEdit(viewerId, ownerId)` (owner only; every existing write route keeps its `user_id = ?` guard), SQL `FRIEND_IDS_SQL` and `visibleEntrySql(alias)`, and `toFriendEntry`. A test runs the same matrix through the pure function and the SQL fragment and requires them to agree. **Amended by Dan 2026-11-16: Everyone = all active users:** the module adds `canViewPost` / `feedVisibleSql` (own, or non-private by an active user) for feed posts and post threads only; `canView` / `visibleEntrySql` (friends-only) still guard entries, friend lists and the Friends scope. S8's unread count stays friends-only.
- **S10 — friend profile:** `/u/:username` with tabs Lists (one chip row of the categories they have visible entries in), Top 5, Stats, Compare. A non-friend sees only the header and "Add friend" / "Requested" / "Accept". The friend entry detail `/u/:username/entry/:id` is read-only with seasons, notes (unless private), reactions, comments and **Add to mine**.
- **S11 — Add to mine** posts the friend's title to `POST /api/entries` with `category, title, creator, album, coverUrl, genres, releaseDate, synopsis, lengthLabel, origin, source, sourceId, lookupState: 'ok', detailsState`, no rating, and `status: 'Plan to watch'` on lists with Status (`statusLabel` shows "Plan to play/read"). The existing `duplicateOf` answer shows "Already on your list" with a link instead. Then it opens your new entry.
- **S12 — comparisons** (shared, pure): two titles match when both have `source` and `sourceId` and they are equal, or when `normTitle(title)` is equal within the same category. **Both rated** = rated on both sides, sorted by `|mine − theirs|` desc, then title. **Theirs, not yours** = their rated titles with no match among *any* of your entries (private ones included, which leaks nothing), by their rating desc, top 20. **Group Top 5** per category = you plus every friend, mean rating of each matched title, at least 2 raters (`GROUP_MIN_RATERS = 2`), ties by more raters then title. Your own private entries are left out of all three too.
- **S13 — friend avatars and covers.** `GET /api/users/:id/avatar` answers for self or an accepted friend (404 otherwise, same as no photo). The cover proxy accepts a URL that is the `cover_url` of any entry the viewer can see (`visibleEntrySql`), not just their own (amends B18).
- **S14 — display name:** `PUT /api/me/display-name { displayName: string | null }` (trimmed, 1–40 chars, or null). Friends' names show as display name, else `@username`.

---

## File Structure

```
packages/worker/migrations/0006_social.sql
packages/worker/src/social/visibility.ts   relationOf, canView, canEdit, FRIEND_IDS_SQL, visibleEntrySql, toFriendEntry, publicUser
packages/worker/src/api/friends.ts         /api/friends*, /api/users*, /api/me/invite, /api/me/display-name
packages/worker/src/api/social.ts          /api/reactions, /api/comments
packages/worker/src/api/admin.ts           /api/admin*, requireAdmin
packages/worker/src/cloudflare/access.ts   allowEmail(env, email)
packages/worker/src/api/activity.ts        (modify) post_id writes, scoped feed, unread, seen
packages/shared/src/social.ts              REACTIONS, COMMENT_MAX, PublicUser, Relation, FriendEntry, Comment, PostSocial, …
packages/shared/src/compareFriends.ts      matchKeyOf, bothRated, theirsNotYours, groupTop5
packages/shared/src/activity.ts            (modify) foldPosts replaces mergeActivity
packages/web/src/data/social.ts            hooks: useFriends, useProfile, useFriendEntries, useFeed, useUnread, useComments, mutations
packages/web/src/screens/social/           FriendsScreen, AddFriendSheet, AddByCodeScreen, FriendProfile, FriendEntryDetail, CompareWithFriend, CommentsSheet, ReactionBar
packages/web/src/screens/AdminScreen.tsx
```

---

### Task 0: Wireframe mockups (approval gate, no code)

**Deliverable:** cheap wireframe-level boards in the calm v2 style (Midnight, existing tokens, Inter, placeholder covers, no new graphics), hand-written small HTML against `packages/web/src/design/tokens.css` like the `*.wf.dc.html` set, saved to `docs/design/mockups/` and added to `canvas.json`:
- `FriendProfile.wf.dc.html` (phone): banner + avatar + display name / @username, tiles (Titles, Rated, Avg, Friends since), tabs Lists / Top 5 / Stats / Compare, read-only rows; a "Remove friend" item in a ⋯ menu. Inset: a non-friend's header with "Add friend".
- `Friends.wf.dc.html` (phone): "Requests" (incoming with Accept / Decline, outgoing with Cancel), then "Friends · 3" rows; empty state.
- `AddFriend.wf.dc.html` (phone): the Add friend sheet (username field with one match "@ren · Add", "Your invite link" with Copy / Share / "Make a new link"), plus the `/add/<code>` screen "Add @dan as a friend?".
- `Feed.wf.dc.html` (phone): Activity on Everyone with friends' posts ("Ren rated **Frieren** 9.0"), each with the 6-emoji reaction bar (counts, yours highlighted) and "2 comments"; the comments sheet open (list, own comment with Delete, 500-char field with counter).
- `CompareFriend.wf.dc.html` (phone): Compare tab with "Both rated" (two badges side by side, biggest disagreement first) and "Theirs, not yours" (with Add to mine); inset: Top 5 screen's "Mine | Friends" toggle showing a group Top 5 row ("8.9 · 3 ratings").
- `EntryPrivacy.wf.dc.html` (phone): the entry detail's privacy card ("Private — only you see this title", "Keep notes private") and a list row with a lock icon.
- `Admin.wf.dc.html` (phone): email field + Approve, the result with the link and Copy, "Approved · 4 of 50", rows "ren@… · Joined as @ren" / "vance@… · Not joined yet".

- [ ] **Step 1:** Build the seven boards from the copy in Tasks 9–12.
- [ ] **Step 2:** Send them to Dan; record approval and changes in `docs/design-notes.md` under "Phase 4 mockups".
- [ ] **Step 3:** Tasks 9–12 wait for approval. **Tasks 1–8 run in parallel with the mockups.**

### Task 1: iPhone sign-in check (manual, Dan) — **parallel-safe**

No code. Learns the Phase 5 risk before the UI is done.

- [ ] **Step 1:** Dan adds one iPhone friend's email to the "Dan only" policy by hand (Zero Trust → Access → Policies → edit → Include → Emails).
- [ ] **Step 2:** The friend, in Safari: opens the app address, signs in with the emailed code, picks a username; then Share → **Add to Home Screen**, opens the icon. Record yes/no for: (a) the icon opens signed in; (b) after force-closing and reopening it is still signed in; (c) the next day it is still signed in, or shows sign-in and gets through; (d) the Log out → sign back in loop works.
- [ ] **Step 3:** Write the four answers and the iOS version in `docs/decisions-phase4.md` under "iPhone check". Any "no" goes to Dan as a Phase 5 note; it does not block Phase 4.

### Task 2: Migration, shared social types and the visibility module — **parallel-safe**

**Files:**
- Create: `packages/worker/migrations/0006_social.sql`, `packages/worker/src/social/visibility.ts`, `packages/shared/src/social.ts`
- Modify: `packages/shared/src/index.ts`, `packages/worker/src/env.ts` (`CF_API_TOKEN?`, `CF_ACCOUNT_ID?`, `ACCESS_POLICY_ID?`)
- Test: `packages/worker/test/visibility.test.ts`

**Interfaces:**
- Migration: `users` + `invite_code TEXT`, `feed_seen_at TEXT`, `CREATE UNIQUE INDEX idx_users_invite ON users(invite_code)`; `activity` + `post_id TEXT`, `CREATE INDEX idx_activity_entry ON activity(user_id, entry_id, created_at)`; `friendships (user_a, user_b REFERENCES users ON DELETE CASCADE, status CHECK IN ('pending','accepted'), requested_by, created_at, accepted_at, PRIMARY KEY (user_a, user_b), CHECK (user_a < user_b))` + index on `user_b`; `reactions (id, activity_id REFERENCES activity ON DELETE CASCADE, entry_id REFERENCES entries ON DELETE CASCADE, user_id REFERENCES users ON DELETE CASCADE, emoji, created_at, CHECK ((activity_id IS NULL) <> (entry_id IS NULL)))` with partial unique indexes `(activity_id, user_id, emoji) WHERE activity_id IS NOT NULL` and the entry one; `comments (id, activity_id, entry_id, user_id, body, created_at, deleted_at)`, same FKs and CHECK, indexes on each target; `invites (email TEXT PRIMARY KEY, created_at TEXT NOT NULL)`. `entries.is_private` / `notes_private` already exist (0001); nothing to add.
- Produces (shared): `REACTIONS`, `type Reaction`, `COMMENT_MAX = 500`, `ACCESS_SEATS = 50`, `GROUP_MIN_RATERS = 2`; `interface PublicUser { id: string; username: string; displayName: string | null; avatarAt: string | null }`; `type Relation = 'self' | 'friend' | 'pending_out' | 'pending_in' | 'none'`; `type FriendEntry = Pick<Entry, 'id' | 'userId' | 'category' | 'title' | 'status' | 'rating' | 'tier' | 'genres' | 'creator' | 'album' | 'coverUrl' | 'releaseDate' | 'synopsis' | 'lengthLabel' | 'origin' | 'detailsState' | 'source' | 'sourceId' | 'seasonAvg' | 'createdAt'> & { notes: string | null }`; `type Target = { activityId: string } | { entryId: string }`; `interface Comment { id: string; author: PublicUser; body: string; createdAt: string; canDelete: boolean }`; `interface PostSocial { reactions: Partial<Record<Reaction, number>>; mine: Reaction[]; comments: number }`.
- Produces (worker, `visibility.ts`): `relationOf(db, viewerId: string, ownerId: string): Promise<Relation>` (1 query; 0 when equal); `canView(rel: Relation, entry: { isPrivate: boolean }): boolean`; `canEdit(viewerId: string, ownerId: string): boolean`; `FRIEND_IDS_SQL(param: string): string` (accepted friends' ids of the user bound at `param`, e.g. `'?1'`); `visibleEntrySql(alias: string, viewerParam: string): string` = `(${alias}.user_id = V OR (${alias}.is_private = 0 AND ${alias}.user_id IN (FRIEND_IDS)))`; `toFriendEntry(row: EntryRow, rel: Relation): FriendEntry` (throws if `!canView`; `notes: null` when `notes_private`); `publicUser(row): PublicUser`; `pair(a, b): [string, string]` (sorted).

- [ ] **Step 1: Write the failing tests** (`visibility.test.ts`; users A, B, C, D; A–B accepted, A–C pending requested by A, A–D none; A has a public entry with notes, a public entry with private notes, a private entry):
  - `canView matrix`: self sees all 3; friend B sees 2; pending C and stranger D see 0; B gets `notes: null` for the private-notes one and the text for the other.
  - `SQL agrees with canView`: for each viewer, `SELECT id FROM entries e WHERE e.user_id = ?2 AND ${visibleEntrySql('e', '?1')}` returns exactly the ids `canView` allows.
  - `relationOf` returns `friend`, `pending_out` (A→C), `pending_in` (C→A), `none`, `self`.
  - `toFriendEntry` output has no `strength`, `priorMean`, `scoreLocked`, `notesPrivate`, `isPrivate`, `importId`, `typedTitle` keys and throws for a private row.
  - `canEdit('B', 'A')` false.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- visibility`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, the shared types and `visibility.ts`.
- [ ] **Step 4: Run** `npx -y npm@11 test -w packages/worker` and `npx -y npm@11 run typecheck`. Expected: PASS (0001–0005 tests unchanged).
- [ ] **Step 5: Commit** `feat(social): migration 0006 and the visibility rule`.

### Task 3: Friends API (requests, invite codes, search, display name, avatars) — **parallel-safe**

**Files:**
- Create: `packages/worker/src/api/friends.ts`
- Modify: `packages/worker/src/index.ts` (mount `/friends`, `/users`), `packages/worker/src/api/me.ts` (`/invite`, `/display-name`; `meBody` + `displayName`), `packages/worker/src/auth/access.ts` (SELECT `display_name`), `packages/web/src/api/types.ts` (`Me.displayName`), `packages/web/src/test/mockApi.ts` (`makeMe` default `displayName: null`)
- Test: `packages/worker/test/friends.test.ts`

**Interfaces:**
- Consumes: `relationOf`, `pair`, `publicUser`, `FRIEND_IDS_SQL` (Task 2).
- Produces:
  - `GET /api/friends` → `{ friends: (PublicUser & { since: string })[]; incoming: PublicUser[]; outgoing: PublicUser[] }` (1 query + sign-in)
  - `POST /api/friends/requests { username }` → `{ relation: 'pending_out' | 'friend' }`; 404 `not_found`, 400 `self`, 409 `already_friends`
  - `POST /api/friends/add/:code` → `{ relation: 'friend'; user: PublicUser }`; `GET /api/friends/code/:code` → `PublicUser` (preview); 404 for unknown code; 400 `self` for your own
  - `POST /api/friends/:userId/accept` → 204 (404 if no incoming request); `DELETE /api/friends/:userId` → 204 (decline, cancel, remove; 404 if no row)
  - `GET /api/users/search?q=` → `PublicUser[]` (username prefix, `q` 2–20 chars of `[a-z0-9_]`, max 10, you excluded, ordered by username)
  - `GET /api/users/:username` → `{ user: PublicUser; memberSince: string | null; relation: Relation }`
  - `GET /api/users/:id/avatar` → bytes (self or friend) else 404
  - `GET /api/me/invite` → `{ code: string }` (creates on first call); `POST /api/me/invite` → `{ code }` (new code); `PUT /api/me/display-name` → `Me`

- [ ] **Step 1: Write the failing tests:** `username request creates pending; the other side's request makes it accepted`; `request to self → 400 self; unknown → 404; existing friend → 409`; `accept only works for the receiver` (requester's accept → 404); `DELETE by either side removes the row, then GET /api/friends is empty for both`; `invite code is 12 chars [a-z0-9], stable across GETs; POST changes it; the old code → 404, the new adds as accepted`; `adding by your own code → 400 self`; `search "re" finds ren, not you, max 10; q "r" → 400`; `GET /api/users/ren as a stranger → relation none, no entries field`; `avatar: friend 200, pending 404, stranger 404`; `display-name trims, rejects 41 chars, null clears`; `each route's query count ≤ 6 with spyD1`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- friends`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pending→accepted on a crossing request is one `INSERT … ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted', accepted_at = ? WHERE status = 'pending' AND requested_by <> ?` then read back. Code generation retries once on a unique-index clash. Register `/users/search` before `/users/:username`.
- [ ] **Step 4: Run** the worker tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(friends): requests, invite links, search, display name`.

### Task 4: Friend reads and the wider cover proxy — **parallel-safe**

**Files:**
- Modify: `packages/worker/src/api/friends.ts`, `packages/worker/src/api/cover.ts`
- Test: `packages/worker/test/friendReads.test.ts`, `packages/worker/test/cover.test.ts` (add cases)

**Interfaces:**
- Consumes: `visibleEntrySql`, `toFriendEntry`, `relationOf` (Task 2).
- Produces:
  - `GET /api/users/:username/entries?category=` → `FriendEntry[]` (friend or self; 403 `not_friends` otherwise) — 2 queries + sign-in
  - `GET /api/users/:username/entries/:id` → `{ entry: FriendEntry; seasons: { id: string; label: string; rating: number | null; notes: string | null }[] }` (season notes null when the entry's `notes_private`); 404 when not visible
  - `GET /api/friends/entries?category=` → `{ userId: string; entries: FriendEntry[] }[]` for every accepted friend, rated and visible only (for group Top 5) — 1 query + sign-in
  - Cover proxy: URL must be the `cover_url` of an entry matching `visibleEntrySql('e', '?1')`

- [ ] **Step 1: Write the failing tests** (the §8 permission tests): `stranger and pending friend → 403 on entries and 404 on an entry`; `friend list omits the private entry, notes null on the private-notes one`; `friend asking for the private entry by id → 404`; `no friend response contains "strength", "priorMean", "scoreLocked" or a comparisons key` (scan the JSON text); `GET /api/ratings/anime as B returns only B's titles and comparisons after A saved picks` (picks never readable); `friends/entries leaves out unrated and private rows and non-friends`; cover: `a friend's public cover → 200`, `a friend's private-entry cover → 404 and fetch never called`, `a stranger's cover → 404`; `queries ≤ 5`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- friendReads cover`. Expected: FAIL.
- [ ] **Step 3: Implement** with `ENTRY_SELECT` + `WHERE e.user_id = ?2 AND ${visibleEntrySql('e', '?1')}`, every row through `toFriendEntry`.
- [ ] **Step 4: Run** the worker tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(friends): read-only friend lists and covers through the visibility rule`.

### Task 5: Feed: posts, scoped activity, unread — **parallel-safe**

**Files:**
- Modify: `packages/worker/src/api/activity.ts`, `packages/shared/src/activity.ts`, `packages/web/src/screens/ActivityScreen.tsx` (swap `mergeActivity` for `foldPosts` only; the redesign is Task 11)
- Test: `packages/worker/test/activity.test.ts`, `packages/shared/test/activity.test.ts`

**Interfaces:**
- Consumes: `FRIEND_IDS_SQL`, `visibleEntrySql`, `publicUser` (Task 2).
- Produces (shared): `ActivityItem` + `postId: string; userId: string`; `ActivityLine` + `userId: string` (`key` = post id); `foldPosts(items: ActivityItem[]): ActivityLine[]` (newest post first; `mergeActivity` deleted); `ActivityPage` + `users: Record<string, PublicUser>; social: Record<string, PostSocial>`; `type FeedScope = 'you' | 'friends' | 'everyone'`.
- Produces (worker): every builder (`activityForCreate`, `activityForPatch`, `activityForRatingsSave`) sets `post_id` per S5 with the subquery `(SELECT a.id FROM activity a WHERE a.user_id = e.user_id AND a.entry_id = e.id AND a.post_id IS NULL AND a.created_at >= ?cutoff ORDER BY a.created_at DESC LIMIT 1)`, `cutoff = now − ACTIVITY_MERGE_MS`; `GET /api/activity?show=&before=&beforeId=` → `ActivityPage` (30 posts; 1 anchor query + 1 batch of 4: rows, users, reaction counts with mine, comment counts); `GET /api/activity/unread` → `{ feed: number; requests: number }` (1 query); `POST /api/activity/seen` → 204.

- [ ] **Step 1: Write the failing tests:**
  - Worker: `7→8 at t and 8→9 at t+8 min share one post_id; a change at t+11 min starts a new post` (insert times via a `now` the builders accept, or direct rows); `a rating+status PATCH makes two rows in one post`; `a ratings save of 3 titles makes 3 posts`; `B (friend) sees A's posts on everyone and friends, not on you`; `B never sees A's private-entry posts; turning the entry private hides existing posts at once`; `pending C sees none`; `A's bare "added" post (no rating, no status) is hidden from B, shown to A`; `social carries reaction counts, mine and comment counts`; `unread counts B's new posts for A, then 0 after seen; A's comments on A's own entry don't count`; `120 posts page 30/30/30/30 with no duplicates`; `≤ 10 queries`.
  - Shared: `foldPosts` folds rows with one postId to first `from` / last `to`; 7→8→7 drops the post; two postIds for one entry give two lines; key = postId.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- activity` and `npx -y npm@11 test -w packages/shared -- activity`. Expected: FAIL.
- [ ] **Step 3: Implement.** The bare-added filter is in SQL (`EXISTS` a row in the post whose type is not `added`, or the anchor's payload has `rating`/`status`). Swap `mergeActivity` → `foldPosts` in `ActivityScreen.tsx` so the web still builds.
- [ ] **Step 4: Run** all tests (`npx -y npm@11 test`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(feed): stable posts, friends' feed and unread count`.

### Task 6: Reactions and comments API — **parallel-safe**

**Files:**
- Create: `packages/worker/src/api/social.ts`; modify `packages/worker/src/index.ts`
- Test: `packages/worker/test/social.test.ts`

**Interfaces:**
- Consumes: `relationOf`, `canView`, `publicUser` (Task 2); post ids (Task 5).
- Produces: `resolveTarget(db, viewerId, target: Target): Promise<{ ownerId: string; entryId: string } | null>` (null when missing or not visible); `POST /api/reactions { activityId? | entryId?, emoji }` → `PostSocial` (toggle); `GET /api/reactions?entryId=` → `PostSocial`; `GET /api/comments?activityId=|entryId=` → `Comment[]`; `POST /api/comments { activityId? | entryId?, body }` → `Comment` (201); `DELETE /api/comments/:id` → 204.

- [ ] **Step 1: Write the failing tests:** `friend reacts ❤️ then again → toggled off`; `emoji not in REACTIONS → 400`; `both or neither target → 400`; `stranger or pending → 404 on react, list and comment`; `private entry's post → 404 for the friend, 200 for the owner`; `body "  " → 400, 501 chars → 400, 500 → 201 and trimmed`; `author deletes own → 204; entry owner deletes a friend's comment → 204; a third friend → 403`; `deleted comments are not listed`; `canDelete is true for author and entry owner`; `unfriending hides the thread from the ex-friend`; `≤ 6 queries`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- social`. Expected: FAIL.
- [ ] **Step 3: Implement.** `resolveTarget` reads the entry through the activity row (`SELECT e.user_id, e.id, e.is_private FROM activity a JOIN entries e …`) and applies `canView(await relationOf(…))`. Accept only a post id that is an anchor (`post_id IS NULL`).
- [ ] **Step 4: Run** the worker tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(social): reactions and comments`.

### Task 7: Admin invites through the Cloudflare API, plus SETUP — **parallel-safe**

**Files:**
- Create: `packages/worker/src/cloudflare/access.ts`, `packages/worker/src/api/admin.ts`; modify `packages/worker/src/index.ts`, `packages/worker/wrangler.toml` (`CF_ACCOUNT_ID = ""`, `ACCESS_POLICY_ID = ""` in `[vars]` and `[env.production.vars]`), `packages/worker/.dev.vars.example` (comment only), `docs/SETUP.md`
- Test: `packages/worker/test/admin.test.ts`, `packages/worker/test/prodConfig.test.ts` (CF_API_TOKEN must not appear in `wrangler.toml`)

**Interfaces:**
- Produces: `allowEmail(env: Env, email: string): Promise<{ added: boolean }>` (throws `CloudflareError { status: number; message: string }`, or `NotConfigured`); `requireAdmin` middleware (403 `forbidden`); `POST /api/admin/invites { email }` → `{ email: string; link: string; alreadyAllowed: boolean }` (`link` per S2); `GET /api/admin` → `{ seats: { used: number; total: 50 }; invites: { email: string; invitedAt: string; joined: PublicUser | null }[]; users: (PublicUser & { email: string; joinedAt: string | null })[] }`.

- [ ] **Step 1: Write the failing tests** (`vi.spyOn(globalThis, 'fetch')`, env with fake `CF_*`): `non-admin → 403 and fetch never called`; `adds an email: GET then PUT to /client/v4/accounts/acc/access/policies/pol, Bearer header, PUT body keeps name, decision, exclude, require and old include and appends {email:{email:"ren@x.com"}}, drops id/created_at/updated_at`; `email already in include (different case) → no PUT, alreadyAllowed true`; `"not an email" → 400`; `Cloudflare 403 {success:false, errors:[{message:"Authentication error"}]} → 502 {error:'cloudflare', message:'Authentication error'} and no invites row`; `timeout → 502`; `missing CF_API_TOKEN → 503 not_configured`; `GET /api/admin lists invites with joined user once that email signs in, and seats.used counts users`; `link is <origin>/add/<admin's code>`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- admin prodConfig`. Expected: FAIL.
- [ ] **Step 3: Implement** per S1. Lower-case and trim the email; validate with `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and ≤ 254 chars.
- [ ] **Step 4: Write SETUP §12 "Let friends in (admin invites)"** for Dan, Windows-friendly, each with a **Success** line:
  1. Cloudflare dashboard → profile icon → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**. Name `media-tracker access`. Permissions: **Account** · **Access: Apps and Policies** · **Edit**. Account Resources: Include · your account. No other permissions. Create, copy the token (shown once).
  2. `npm exec -w packages/worker -- wrangler secret put CF_API_TOKEN --env production`, paste. Success: `Success! Uploaded secret CF_API_TOKEN`.
  3. Account ID: Workers & Pages overview, right side (**Account ID**) → `CF_ACCOUNT_ID` in `[env.production.vars]`.
  4. Zero Trust → **Access** → **Policies** → open "Dan only" (rename it "Friends" if you like); the policy ID is in the address bar after `/policies/` → `ACCESS_POLICY_ID`. If the policy isn't listed there, create one there (Allow, Include Emails = your email), attach it to the app, and remove the old one.
  5. Check before deploying (PowerShell): `curl.exe -s -H "Authorization: Bearer <token>" https://api.cloudflare.com/client/v4/accounts/<account id>/access/policies/<policy id>` → Success: the reply contains `"success":true` and your email.
  6. `npm run deploy`. Success: More → **Admin** → approve a test email shows a link.
  Add to "Updating to a new version": apply migration `0006_social.sql` (`wrangler d1 migrations apply media-tracker --remote --env production`) before deploying.
- [ ] **Step 5: Run** the worker tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(admin): approve emails through the Access policy`.

### Task 8: Shared comparisons and group Top 5 — **parallel-safe**

**Files:**
- Create: `packages/shared/src/compareFriends.ts`; modify `packages/shared/src/index.ts`
- Test: `packages/shared/test/compareFriends.test.ts`

**Interfaces:**
- Consumes: `normTitle` (matching.ts), `FriendEntry` (Task 2).
- Produces: `type Comparable = Pick<FriendEntry, 'id' | 'category' | 'title' | 'rating' | 'coverUrl' | 'source' | 'sourceId'> & { isPrivate?: boolean }`; `sameTitle(a: Comparable, b: Comparable): boolean` (S12); `interface BothRatedRow { title: string; category: Category; coverUrl: string; mine: number; theirs: number; diff: number; myId: string; theirId: string }`; `bothRated(mine: Comparable[], theirs: Comparable[]): BothRatedRow[]`; `theirsNotYours(mine: Comparable[], theirs: Comparable[], limit = 20): Comparable[]`; `interface GroupRow { title: string; coverUrl: string; average: number; raters: number }`; `groupTop5(people: { userId: string; entries: Comparable[] }[], minRaters = GROUP_MIN_RATERS): GroupRow[]` (one category's rows in; ≤ 5 out).

- [ ] **Step 1: Write the failing tests:** `matches by source+sourceId even when titles differ`; `matches "Frieren: Beyond Journey's End" ≈ normTitle equal only within one category`; `bothRated sorts 9 vs 5 before 8 vs 7, then title`; `your private entry is left out of bothRated and groupTop5 but still blocks it from theirsNotYours`; `theirsNotYours skips unrated, orders by rating, stops at 20`; `groupTop5 averages, needs 2 raters, ties by raters then title, returns ≤ 5`; `a person with two entries of one title counts once (their higher rating)`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/shared -- compareFriends`. Expected: FAIL.
- [ ] **Step 3: Implement** with a `Map` per match key (`src:<source>:<id>` and `t:<category>:<normTitle>`) so each list is indexed once.
- [ ] **Step 4: Run** the shared tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): friend comparisons and group Top 5`.

### Task 9: Friends UI: Friends screen, Add friend, `/add/<code>`, Profile and Settings (after Task 0)

**Files:**
- Create: `packages/web/src/data/social.ts`, `packages/web/src/screens/social/FriendsScreen.tsx`, `AddFriendSheet.tsx`, `AddByCodeScreen.tsx`
- Modify: `routes.tsx` (`friends`, `add/:code`), `ProfileScreen.tsx` (Friends tile = count, links to `/friends`, "N requests" line), `shell/comingWithFriends.ts` (delete; `useAddFriend` opens `AddFriendSheet`), `SettingsScreen.tsx` (Display name row, Invite link row), `shell/SessionGate.tsx` + `screens/UsernameSetup.tsx` (return path), `design/components/Avatar.tsx` (accept `PublicUser`: `/api/users/:id/avatar?v=` for others)
- Test: `FriendsScreen.test.tsx`, `AddFriendSheet.test.tsx`, `AddByCodeScreen.test.tsx`, updates to `ProfileScreen.test.tsx`, `SettingsScreen.test.tsx`, `UsernameSetup.test.tsx`

**Interfaces:**
- Consumes: Task 3 routes.
- Produces (`data/social.ts`): `useFriends()`, `useInviteCode()`, `useRegenerateCode()`, `useUserSearch(q)`, `useSendRequest()`, `useAccept()`, `useRemoveFriend()`, `useAddByCode()`, `useProfile(username)`, `inviteLink(code: string): string` (`${location.origin}/add/${code}`); query keys under `['social', …]`, `staleTime: 30_000`; mutations invalidate `['social']`. `AFTER_SETUP_KEY = 'mt-after-setup'` (sessionStorage).

- [ ] **Step 1: Write the failing tests:** `Friends lists incoming with Accept / Decline, outgoing with Cancel, friends linking to /u/<username>`; `empty → "No friends yet" with Add friend`; `Add friend sheet: typing "re" lists @ren with Add → POST requests, row shows "Requested"`; `invite link shows, Copy writes it to the clipboard and toasts "Link copied"; Make a new link asks "The old link will stop working" then POSTs`; `/add/abc shows "Add @dan as a friend?" → Add → toast "You and @dan are friends" → /u/dan`; `unknown code → "This link no longer works"`; `own code → "That's your own link"`; `a user without a username opening /add/abc goes to setup, then back to /add/abc`; `Profile Friends tile shows 3 and links to /friends`; `Settings saves display name`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- Friends AddFriend AddByCode Profile Settings UsernameSetup`. Expected: FAIL.
- [ ] **Step 3: Implement** to the approved boards. SessionGate stores the attempted path in `AFTER_SETUP_KEY` before redirecting to setup; UsernameSetup navigates there (then clears it) instead of `homePath` when set.
- [ ] **Step 4: Run** `npx -y npm@11 test -w packages/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): friends, invite links and requests`.

### Task 10: Friend profile, friend entry, Add to mine, comparisons and group Top 5 (after Task 0)

**Files:**
- Create: `packages/web/src/screens/social/FriendProfile.tsx`, `FriendEntryDetail.tsx`, `CompareWithFriend.tsx`
- Modify: `routes.tsx` (`u/:username`, `u/:username/entry/:id`), `data/social.ts` (`useFriendEntries(username, category)`, `useFriendEntry`, `useFriendsEntries(category)`, `useAddToMine()`), `ratings/topFive.ts` and `ratings/stats.ts` (parameter types widened to `Pick<Entry, …>` that `FriendEntry` satisfies), `Top5Screen.tsx` ("Mine | Friends" toggle → group Top 5)
- Test: `FriendProfile.test.tsx`, `FriendEntryDetail.test.tsx`, `CompareWithFriend.test.tsx`, update `Top5Screen.test.tsx`

**Interfaces:**
- Consumes: Task 4 routes, Task 8 functions, S10, S11.
- Produces: `useAddToMine(): (e: FriendEntry) => Promise<{ entryId: string; duplicate: boolean }>`.

- [ ] **Step 1: Write the failing tests:** `friend profile shows tabs Lists / Top 5 / Stats / Compare and rows without edit controls`; `a stranger's profile shows only the header and Add friend`; `Remove friend asks first, then DELETE and back to /friends`; `friend entry shows notes, or nothing when notes is null, and Add to mine`; `Add to mine POSTs the friend's fields with status "Plan to watch", no rating, then opens /entry/<new id>`; `duplicateOf → "Already on your list" linking to your entry`; `Compare tab: Both rated shows "You 9.0 · Ren 5.0" first; Theirs, not yours lists their top titles with Add to mine`; `empty states: "Nothing you've both rated in Anime yet"`; `Top 5 "Friends" shows group rows "8.9 · 3 ratings" and "Rate more together…" when empty`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- FriendProfile FriendEntry CompareWithFriend Top5`. Expected: FAIL.
- [ ] **Step 3: Implement** to the boards. Mine side of comparisons = the device's own entries (`useAllEntries`), with `isPrivate` passed through so Task 8 drops them.
- [ ] **Step 4: Run** `npx -y npm@11 test -w packages/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): friend profiles, Add to mine, comparisons and group Top 5`.

### Task 11: Feed UI, reactions, comments, unread badge, privacy copy (after Task 0)

**Files:**
- Create: `packages/web/src/screens/social/ReactionBar.tsx`, `CommentsSheet.tsx`
- Modify: `ActivityScreen.tsx` (scopes, friends' lines, reactions, comments; default `everyone`), `data/useActivity.ts` (`useFeed(scope)`), `data/social.ts` (`useUnread()`, `useMarkSeen()`, `useComments(target)`, `useReact()`, `usePostComment()`, `useDeleteComment()`), `design/components/BottomTabs.tsx` + `SideNav.tsx` (Activity count), `shell/ProfileButton.tsx` (requests dot), `EntryDetail.tsx` (privacy card copy, reactions + comments on your entry), `FriendEntryDetail.tsx` (reactions + comments), `screens/list/EntryCards.tsx` + `EntryTable.tsx` (lock icon on private rows)
- Test: updates to `ActivityScreen.test.tsx`, `EntryDetail.test.tsx`; new `CommentsSheet.test.tsx`, `ReactionBar.test.tsx`, `AppShell.test.tsx` (badge)

**Interfaces:**
- Consumes: Task 5 and Task 6 routes, `foldPosts`.

- [ ] **Step 1: Write the failing tests:** `Everyone shows "Ren rated Frieren 9.0" with Ren's avatar, the name linking to /u/ren and the title to /u/ren/entry/<id>`; `your own lines still read "You …" and link to /entry/<id>`; `tapping 🔥 toggles aria-pressed and the count optimistically, rolls back on error with a toast`; `"2 comments" opens the sheet; posting shows the comment, the counter reads "480 left", the button is disabled at 0 or over 500`; `Delete on your own comment asks then removes it`; `opening Everyone calls POST /api/activity/seen`; `the Activity tab reads "Activity, 3 new" when unread.feed is 3 and shows nothing at 0; "99+" above 99`; `profile button has a dot and "Profile, 1 friend request" when requests is 1`; `EntryDetail privacy switches read "Private — only you see this title" and "Keep notes private"`; `a private row shows a lock labelled "Private"`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- Activity Comments Reaction EntryDetail AppShell`. Expected: FAIL.
- [ ] **Step 3: Implement** to the boards. `useUnread` refetches on window focus and every 60 s (`refetchInterval: 60_000`, `refetchIntervalInBackground: false`).
- [ ] **Step 4: Run** `npx -y npm@11 test -w packages/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): friends' feed with reactions, comments and an unread badge`.

### Task 12: Admin screen (after Task 0)

**Files:**
- Create: `packages/web/src/screens/AdminScreen.tsx`
- Modify: `routes.tsx` (`admin`, rendered only when `me.isAdmin`, else redirect `/`), `MoreScreen.tsx` + `SideNav.tsx` (an "Admin" row for the admin only), `data/social.ts` (`useAdmin()`, `useApproveEmail()`)
- Test: `AdminScreen.test.tsx`, updates to `MoreScreen.test.tsx`

**Interfaces:**
- Consumes: Task 7 routes.

- [ ] **Step 1: Write the failing tests:** `non-admin: no Admin row and /admin redirects`; `approve "Ren@X.com" shows "Approved ren@x.com" with the link and Copy`; `alreadyAllowed → "ren@x.com could already sign in" with the link`; `502 → "Cloudflare refused: Authentication error"`; `503 → "Admin invites aren't set up yet. See SETUP step 12."`; `list rows "Joined as @ren" / "Not joined yet" and "4 of 50"`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- Admin More`. Expected: FAIL.
- [ ] **Step 3: Implement** to the board.
- [ ] **Step 4: Run** `npx -y npm@11 test -w packages/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Admin screen`.

### Task 13: End-to-end, rulings and docs

**Files:**
- Create: `e2e/seed-friend.sql`, `docs/decisions-phase4.md`
- Modify: `e2e/serve.mjs` (apply the seed after migrations with `wrangler d1 execute media-tracker --local --persist-to <state> --file`), `packages/web/e2e/core.spec.ts`, `docs/polish-backlog.md` (anything deferred)

- [ ] **Step 1: Seed:** user `e2e@example.com` (fixed id, `username` NULL so the first-visit test still sets it up), user `ren` with a public rated Frieren (9.0, cover), a private rated title "Secret Show", an accepted friendship, one `rated` activity row for Frieren.
- [ ] **Step 2: Write the tests:** `Everyone shows "Ren rated Frieren 9.0", react ❤️, comment "Same!" survives a reload`; `Ren's profile lists Frieren and never "Secret Show"`; `Add to mine puts Frieren on your Anime list as Plan to watch`; `Settings → invite link → Make a new link changes the link`; existing tests still pass (Activity "You" test selects You first).
- [ ] **Step 3: Run** `npx -y npm@11 run e2e`. Expected: PASS.
- [ ] **Step 4: Write `docs/decisions-phase4.md`:** S1–S14 one line each with any value changed while building, and Task 1's iPhone answers.
- [ ] **Step 5: Run** `npx -y npm@11 test` and `npx -y npm@11 run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `test(e2e): friends flows; docs: Phase 4 rulings`.

## Open questions for Dan

1. Should Admin also be able to **remove** someone (take their email off the policy and delete their account)? Planned: no; you'd do it in the dashboard.
2. Group Top 5 needs **at least 2 people** to have rated a title. Fine, or count single ratings too?
3. An invite link adds the friend **straight away** (no accept step), while a username request needs accepting. OK?

---

## Dan's answers (2026-11-16)
1. Admin **can remove access**: add a Remove button on the Admin screen (Task 7 API: read policy, drop the email rule, PUT back; Task 12 UI with a confirm). Removing access also ends their friendships' visibility only via Access — their data stays.
2. Group Top 5 counts a title only when **at least 2 people** rated it.
3. Invite link = instant friendship; username request needs acceptance.
