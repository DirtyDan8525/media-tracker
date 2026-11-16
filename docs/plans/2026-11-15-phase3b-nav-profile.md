# Media Tracker App, Phase 3b (Navigation and Profile): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone gets the new bottom bar (Add, Activity, raised Search, Compare, More), a floating Lists button with a see-through list picker, and a profile button that opens a Profile screen (banner, photo, stat tiles, Add friend, My #1s, tier counts, My Top 5, Stats, Settings, Log out); there is a global Search screen, an Activity screen built for friends (showing your own changes until Phase 4), list titles on a themed bar, Top 5 and "My #1s" share images, and PC side-nav equivalents for all of it.

**Architecture:** The Worker gains three things: an `activity` table written in the same `db.batch()` as the change it records (so Phase 4's feed reads the same rows), a profile photo stored as a D1 BLOB beside a `users.avatar_at` version stamp, and a same-origin cover proxy limited to the caller's own covers so a share card can draw covers on a canvas without tainting it. Everything else is on the device: Search reuses `matchesFilter` over `useAllEntries`, the share card is drawn with Canvas 2D from theme colours, the "current list" is a small localStorage-backed store, and Log out clears Dexie and the query cache before going to Cloudflare Access's logout URL.

**Tech Stack:** As Phase 3 (TypeScript, Hono, Workers + D1, React 19, React Router 8, TanStack Query 5, Dexie 4, Vitest, Testing Library, Playwright). Canvas 2D, `createImageBitmap`, Web Share API (all built into browsers). No new dependencies.

**Spec:** `docs/specs/decisions-2026-11-15.md`, sections "Phone navigation and profile" and "Amendments" (Dan, 2026-11-15; they amend spec v1.2 and win on conflict). Approved wireframes: `docs/design/mockups/*.wf.dc.html` and `docs/design-notes.md` "Navigation, profile and tier-rating wireframes" (layouts from the boards, visual language from the calm v2 boards). Also binding: spec §4 (`activity` table), §5.4 (feed merge rule), §6 (design and polish); `docs/design-notes.md` "Phase 3 mockups"; `docs/decisions-phase3.md` (P1–P15 and build decisions). The repo copy `docs/specs/media-tracker-app-spec.md` is v1.1 and out of date; v1.2 lives in the claude.ai Project, but nothing this plan touches differs between them.

## Global Constraints

- npm commands run as `npx -y npm@11 …` (R7).
- D1 free plan: ≤ 100 bound parameters per statement, ≤ 50 queries per Worker invocation (every statement in `db.batch()` counts), SQL statement ≤ 100 KB, string/BLOB/row ≤ 2 MB, 500 MB per database (developers.cloudflare.com/d1/platform/limits).
- Every `/api/*` mutation is a same-origin JSON request (the CSRF guard in `packages/worker/src/index.ts` answers 415 otherwise); uploads travel as base64 inside JSON.
- Style: the approved calm v2 boards. Inter only (already bundled via `@fontsource/inter`), no new font, no glows, no gradients. Body and muted text only on Background or Cards (the see-through Lists menu counts as Cards; Task 7 checks its composite).
- WCAG 2.1 AA: text 4.5:1 on all 12 built-in themes; Custom themes warn, never block (P11). Tap targets ≥ 44 px (`test/tapTargets.test.ts` reads new selectors too). Motion only inside `prefers-reduced-motion: no-preference`. Every empty, loading and error state has friendly text and a next step.
- 3b ships together with 3c (Amendments). `COMPARE_ENABLED` (`packages/web/src/features.ts`) stays `false` on this branch and 3c's Task 16 removes it (Compare on). Every Compare or tier entry point 3b adds (bar slot 4, side nav, More, Profile tier counts) sits behind the flag, so that removal turns them all on; nothing Compare-related renders or fetches while it is false.
- Ratings display through `formatRating`; statuses through `statusLabel(status, category)`.
- No new runtime or dev dependencies.
- Migrations: this plan owns `0003_activity.sql` and `0004_avatars.sql`; the tier-ratings plan takes `0005`. Nothing here reads or writes ratings-tier columns.
- Out of scope: usernames changes beyond what exists, display name and invite link (P12, Phase 4), friends, feed, reactions, comments, the tier system, push.

## Review Focus

1. **A full-size phone photo as the avatar.** A 12 MP JPEG with EXIF rotation, a PNG screenshot, or a HEIC the browser can't decode must give an upright 256 px square under 64 KB, or a friendly "Couldn't read that image" toast; never a stuck spinner. Tests in Tasks 2 and 6.
2. **Share card with awkward data.** Very long titles, an empty creator, a list with 1–4 rated titles, a cover URL that 404s or hangs, and a light theme must still produce a readable card with ellipses and placeholder tiles. Tests in Tasks 3 and 9.
3. **The current list is stale.** A fresh install (nothing stored), a stored list that has since been turned off, and every list turned off must fall back to the first enabled list or hide Add and Lists, never navigate to a list that redirects. Tests in Tasks 4 and 7.
4. **Rapid edits and bulk saves in Activity.** Five slider changes to one title within a minute, a rating changed and changed back, and a Compare save of 300 titles sharing one timestamp must show one merged line (or none) and page without duplicates or gaps. Tests in Tasks 1 and 5.
5. **Log out when storage fails.** IndexedDB throwing or the network being down must still clear what it can and go to the logout URL, and the next visit must show nothing from the previous user. Test in Task 6.

## Rulings

- Ruling B1: Task 0 is done: Dan approved the wireframes on 2026-11-15 with the Amendments. Where a board and this plan differ, the board and the Amendments win. Tasks 1–3 are built (a8dcbcb, afd9b79, 473698e); the Amendments need no change to them.
- Ruling B2 (Amendments): Bottom bar, left to right: **Add**, **Activity**, **Search** (raised centre), **Compare**, **More**. Compare (`/compare`, with 3c's waiting count) is behind the flag; while the flag is off (this branch only, never released) slot 4 is an empty `aria-hidden` cell so Search stays centred. No interim Top 5 slot: Top 5 is under Profile and More. The Activity tab shows no count badge until Phase 4 (the board's "3" is friends' unread activity).
- Ruling B3: Add opens the Add sheet of the current list by navigating to `/list/<current>?add=1`; ListScreen opens the sheet and removes `add` from the URL with `replace`. Its accessible name is `Add ${ADD_NOUN[current]}` ("Add anime"), its visible label "Add".
- Ruling B4: The current list is the list screen last shown, kept in localStorage under `mt-current-list`. A missing or turned-off value falls back to the first enabled list; with no list enabled there is no current list, and Add and the Lists button are hidden.
- Ruling B5: The Lists button (56 px round, bottom right above the bar, where Add was) shows on every phone screen inside the frame except `/entry/:id`. Its menu opens just above it on the right: every enabled list with its icon and cached count, the current one marked (the board's Anime Seasons / TV Seasons rows are not lists in the app, so they are left out); max-height 60vh and scrolls. "See-through" = Cards at `--see-through` alpha 0.9 with `backdrop-filter: blur(16px)`; opaque under `prefers-reduced-transparency: reduce`. Escape, a tap outside, or picking a list closes it and focus returns to the button.
- Ruling B6: The phone list header loses its Search button and field (Status/Genre chips and Sort stay; a `q` in a phone list URL is ignored). The PC list keeps its "/" filter box: it filters a table, and the PC has no bottom bar. Global search lives at `/search?q=` on both.
- Ruling B7 (default confirmed by Dan): New setting `searchScope: 'all' | 'current'`, default `'all'`, in Settings (group "Search") and as a two-option toggle on the Search screen; both write the same setting. "Current" means the current list (B4).
- Ruling B8: Search results: grouped per list in nav order (scope all), each group sorted by rating (`sortEntries(rows, 'rating')`), first 50 per group then "Show N more". Matching is `matchesFilter(e, { q, status: '', genre: '' })` (P13). `q` lives in the URL by `replace`, 150 ms after typing (same pattern as the list).
- Ruling B9: Every main screen keeps the profile button and the Lists button (design notes): lists, Activity, Search, More, and Compare once it is on. The profile button (44 px round, avatar inside) sits top right, on the themed bar on list screens. Sub-screens keep their Back button. On PC the side nav's first row is the profile link (avatar + @username).
- Ruling B10: The photo is a D1 BLOB in a new `avatars` table, plus `users.avatar_at` as its version. R2 was rejected: it needs a bucket, a new binding, a setup step and switching R2 on in the dashboard (Cloudflare asks for billing details for that, unverified here). D1 needs nothing new, and a few users at ≤ 64 KB each is nothing against 500 MB. Limits: `AVATAR_MAX_BYTES = 65_536`, types `image/webp` or `image/jpeg`, checked by magic bytes. Served from `GET /api/me/avatar?v=<avatarAt>` with `Cache-Control: private, max-age=31536000, immutable`.
- Ruling B11 (Dan, 2026-11-15): The person picks the square by drag and zoom: a 280 px square viewport over the photo (pointer drag, two-finger pinch on phones, drag + mouse wheel on PC), a zoom slider (`<input type="range">`, 1–4×, labelled "Zoom") and arrow keys on the focused viewport (10 px a press) so it works by keyboard. The photo always covers the square (clamped). A preview of the result shows before saving; then the chosen square is resized on the device to 256 × 256, WebP at quality 0.85 (JPEG when the browser returns another type, e.g. Safari), and quality steps down by 0.15 to no lower than 0.4 until it fits. No crop library: the maths is three small pure functions (below) and a library such as react-easy-crop would add a dependency for the same ~60 lines.
- Ruling B12 (Profile board + Amendments): top to bottom: a banner band with the blurred cover of your highest-rated title that has a cover across enabled lists (`CoverBackdrop` under the usual scrim; plain Header row colour when there is none), a 96 px avatar overlapping it with "Change photo", @username, "Member since <Month YYYY>" (`users.created_at`; no email, as on the board); four tiles Titles / Rated / Avg / Friends (Friends is 0 until Phase 4); an **Add friend** button that shows the toast "Coming with friends" until Phase 4; a My #1s strip (each enabled list's #1 cover with its list name, linking to the entry); tier counts (B23); rows My Top 5 / Stats / Settings; Log out. Display name stays Phase 4 (P12). The initial in an empty avatar is the username's first character, uppercased (the email's when there is no username).
- Ruling B13: Activity rows are the spec §4 `activity` table. Types: `added`, `rated`, `re-rated`, `status`. The Worker writes them in the same batch as the change, comparing against the stored row: create → `added` with payload `{rating, status}`; a PATCH with a numeric rating that differs → `rated` (old null) or `re-rated` with `{from, to}`; a PATCH with a non-null status that differs → `status` with `{from, to}`; a Compare save → `rated`/`re-rated` per changed title with `via: 'compare'`. Not logged: import, seasons, lookups and filled details, notes, cover changes, clearing a rating or status. Deleting an entry deletes its rows (`ON DELETE CASCADE`). Private entries are logged (it's your own view); Phase 4 filters them out of the feed. Ids are `lower(hex(randomblob(16)))`.
- Ruling B14: The migration seeds one `added` row with payload `{}` for each existing entry that wasn't imported (`import_id IS NULL`), at its `created_at`, so Activity isn't empty on day one. Imported entries stay silent (spec §5.5).
- Ruling B15: The spec's 10-minute merge (§5.4) is applied when reading, by the shared `mergeActivity`; rows stay one per change and `updated_at` equals `created_at`. Phase 4 may move the merge to write time when reactions attach to rows.
- Ruling B16: Activity is online only (no Dexie copy): 50 rows per page by a `(created_at, id)` cursor, "Show more" for the next page, and an error state with Retry when offline. The query refetches on every visit, so no mutation needs to invalidate it.
- Ruling B17 (Dan + Amendments): Share makes per-list images (each Top 5 block with at least one rated title gets "Share <List> Top 5") **and** one "My #1s" image ("Share my #1s" under the Top 5 header: the #1 of every enabled list that has a rated title, in nav order, each row labelled with its list). Styled like Top5.v2 and the ShareTop5 / ShareNumberOnes boards: headings "My <List> Top 5" / "My #1s"; on the Top 5 card the #1 is a large poster over its own blurred cover backdrop, 2 and 3 are standard rows, 4 and 5 compact; ranks 1/2/3 are medal discs gold `#f2c14e`, silver `#c9cfd9`, bronze `#e0925a` with the numeral in `#1b1b25` (≥ 4.5:1 on all three), 4–5 plain numerals in Muted text; on the #1s card every row has a gold "1" disc and its list name; a small footer "Media Tracker · @<username>" in Muted text. Each is a 1080 × 1350 PNG in the current theme's colours; a preview sheet then offers **Share** (only when `navigator.canShare({ files })` is true) and **Save image** (download). The preview step also gives the Web Share call a fresh tap, which browsers require.
- Ruling B18: Covers on the card load through `GET /api/cover?url=`, which fetches only URLs equal to the `cover_url` of one of the caller's own entries (http or https), images up to 5 MB, 8 s timeout. A cover that fails draws as a Panels-coloured tile with the title's first letter.
- Ruling B19: Log out has no confirmation (signing back in is easy). It clears every Dexie table, the query cache, the re-auth flag and `mt-current-list`, each step best-effort, then `location.assign('/cdn-cgi/access/logout')` (already in the service worker's navigation denylist).
- Ruling B20: Settings moves under Profile: `/settings` and `/settings/appearance` keep working; Settings' Back goes to `/profile` and Appearance's to `/settings` (both with history). Top 5's and Stats' Back go to `/profile` (with history). More keeps Ratings (Compare behind the flag, Top 5, Stats), Your data (Import, Export) and About; its Settings, Appearance and "Other lists" rows go. The PC side nav follows the SideNavPC board: profile row, Add, Search, Activity, Compare (flag), the lists, then Import, Export my data, About; Top 5, Stats and Settings are reached through Profile.
- Ruling B21: The bottom bar and the side nav are `nav aria-label="Main"`; the Lists menu is `nav aria-label="Lists"`.
- Ruling B22 (Amendments): List screens use the **themed bar**: a solid band in the theme's Header row colour holding the list icon, the title and (phone) the profile button; it replaces the list header's cover backdrop. The title and icon use whichever of Bright text and Text has more contrast on Header row (`barTextColor(colors)`), checked ≥ 4.5:1 in all 12 themes; the sub-line and chips stay below the band on Background. Phone and PC.
- Ruling B23: Tier counts ("Loved 14 · Liked 22 · Fine 8 · Didn't like 4", highest tier first, over enabled lists, each rated entry counted by `tierFor(rating, tiersFor(settings, category))` from 3c) need 3c's shared tiers module, so they are their own Task 11, built after 3c Task 1 is merged and shown behind the flag. Labels are the shared names when every enabled list uses the same names, else the default names.
- Ruling B24 (Amendments): Activity has an **Everyone / Friends / You** filter (a radiogroup of chips, choice kept in `?show=`). Until Phase 4 only You has data, and it is the default; Everyone and Friends show the ActivityEmpty board's state ("Nothing here yet" / "Add friends to see what they rate and finish. Your own activity shows here too." / **Add friend** → the "Coming with friends" toast). Lines read as on the Activity board: "You re-rated **Steins;Gate** 7.0 → 8.5" with the time of day; Phase 4 swaps "You" for the friend's name.

---

## File Structure

```
packages/shared/src/activity.ts            ACTIVITY_TYPES, ActivityItem, ActivityPage, ActivityLine, mergeActivity
packages/shared/src/avatar.ts              AVATAR_MAX_BYTES, AVATAR_SIZE, AVATAR_TYPES
packages/shared/src/types.ts               + searchScope, SEARCH_SCOPE
packages/worker/migrations/0003_activity.sql, 0004_avatars.sql
packages/worker/src/api/activity.ts        statement builders + GET /api/activity
packages/worker/src/api/me.ts              + avatar routes, meBody
packages/worker/src/api/cover.ts           GET /api/cover
packages/web/src/shell/currentList.ts      current-list store
packages/web/src/shell/ListsButton.tsx, ProfileButton.tsx
packages/web/src/design/components/Avatar.tsx
packages/web/src/screens/SearchScreen.tsx, ActivityScreen.tsx, ProfileScreen.tsx
packages/web/src/screens/activity/format.ts
packages/web/src/screens/profile/AvatarEditor.tsx, avatarImage.ts
packages/web/src/screens/top5/ShareSheet.tsx
packages/web/src/share/top5Card.ts, shareImage.ts
packages/web/src/lists/search.ts, useUrlText.ts
packages/web/src/data/useActivity.ts, useAvatar.ts, logout.ts
packages/web/src/design/nav.css            bottom bar v3, Lists button/menu, profile button, themed list bar, profile
```

---

### Task 0: Wireframe mockups — done

Approved by Dan on 2026-11-15 (boards `docs/design/mockups/*.wf.dc.html`, notes in `docs/design-notes.md`, changes in the decisions file's "Amendments"). Nothing to do.

### Task 1: Activity table, writes and `GET /api/activity`

**Files:**
- Create: `packages/worker/migrations/0003_activity.sql`, `packages/worker/src/api/activity.ts`, `packages/shared/src/activity.ts`
- Modify: `packages/shared/src/index.ts`, `packages/worker/src/api/entries.ts` (POST, PATCH), `packages/worker/src/api/compare.ts` (save), `packages/worker/src/index.ts` (mount)
- Test: `packages/worker/test/activity.test.ts`, `packages/shared/test/activity.test.ts`

**Interfaces:**
- Produces (shared):
  - `ACTIVITY_TYPES = ['added', 'rated', 're-rated', 'status'] as const`; `type ActivityType`
  - `interface ActivityItem { id: string; type: ActivityType; entryId: string; category: Category; title: string; coverUrl: string; payload: { rating?: number | null; status?: string | null; from?: number | string | null; to?: number | string; via?: 'compare' }; createdAt: string }`
  - `interface ActivityPage { items: ActivityItem[]; next: { before: string; beforeId: string } | null }`
  - `interface ActivityLine { key: string; entryId: string; category: Category; title: string; coverUrl: string; at: string; added: boolean; rating: { from: number | null; to: number } | null; status: { from: string | null; to: string } | null }`
  - `ACTIVITY_MERGE_MS = 600_000`; `mergeActivity(items: ActivityItem[], windowMs?: number): ActivityLine[]` (items newest first)
- Produces (worker): `activityForCreate(db, userId, entryId, values: { rating?: number | null; status?: string | null }, now: string): D1PreparedStatement`; `activityForPatch(db, userId, entryId, patch: { rating?: number | null; status?: string | null }, now: string): D1PreparedStatement[]` (0–2; batch them **before** the UPDATE); `activityForCompareSave(db, userId, changesJson: string, now: string): D1PreparedStatement` (before the UPDATE); `GET /api/activity?before=&beforeId=` → `ActivityPage`.

- [ ] **Step 1: Write the migration.** `activity (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`, index `idx_activity_user_created ON activity(user_id, created_at DESC, id DESC)`, then the B14 seed: `INSERT INTO activity SELECT lower(hex(randomblob(16))), user_id, id, 'added', '{}', created_at, created_at FROM entries WHERE import_id IS NULL`.
- [ ] **Step 2: Write the failing Worker tests** (`activity.test.ts`, same `as(email, …)` helper as `entries.test.ts`; `afterEach` deletes users):
  - `create logs added with rating and status` → one item, `type: 'added'`, `payload: { rating: 8, status: 'Completed' }`, joined `title`, `category`.
  - `patch rating null→8 logs rated; 8→9 logs re-rated {from:8,to:9}; 9→9 logs nothing; 9→null logs nothing`.
  - `patch status Watching→Completed logs status {from,to}; same status logs nothing; a rating+status patch logs two rows`.
  - `notes, coverUrl, lookup fills and seasons log nothing`; `import logs nothing`.
  - `compare save logs re-rated with via compare only for titles whose rating changed`.
  - `deleting the entry removes its rows`; `B never sees A's rows`.
  - `pages 120 rows sharing one created_at in 50/50/20 with no duplicates` (insert directly with `env.DB`), `next` null on the last page; `before` without `beforeId` → 400.
- [ ] **Step 3: Write the failing shared tests** (`activity.test.ts`): five `re-rated` rows for one entry within 4 min merge to one line `{from: first from, to: last to}`; 7→8→7 within the window gives no line; rows 11 min apart stay two lines; interleaved A, B, A within the window gives one A line and one B line, ordered by newest `at`; `added` + `rated` merge to `added: true, rating: {from: null, to}`; `status` merges keep first `from`, last `to`; `key` is the newest row's id.
- [ ] **Step 4: Run** `npx -y npm@11 test -w packages/worker -- activity` and `npx -y npm@11 test -w packages/shared -- activity`. Expected: FAIL.
- [ ] **Step 5: Implement.** Builders use `INSERT … SELECT … FROM entries WHERE id = ? AND user_id = ? AND <differs>` so the old value comes from the stored row in the same batch (`rating IS NULL OR rating <> ?` for ratings, `status IS NOT ?` for status); the Compare one joins `json_each(?1)` like the save's UPDATE. The GET joins `entries` for `category, title, cover_url`, orders `created_at DESC, id DESC`, uses the row-value cursor `(a.created_at, a.id) < (?, ?)`, `LIMIT 51`. `mergeActivity` groups by entry with a `Map`: a row joins its entry's open group when `group.at − row.at ≤ windowMs` (B15).
- [ ] **Step 6: Run** both test commands and `npx -y npm@11 test -w packages/worker`. Expected: PASS (existing entry and compare tests unchanged).
- [ ] **Step 7: Commit** `feat(activity): record own activity and serve it`.

### Task 2: Profile photo API and the extra `me` fields

**Files:**
- Create: `packages/worker/migrations/0004_avatars.sql`, `packages/shared/src/avatar.ts`
- Modify: `packages/worker/src/auth/access.ts`, `packages/worker/src/api/me.ts`, `packages/web/src/api/types.ts` (`Me`), `packages/web/src/test/mockApi.ts` (`makeMe` defaults `avatarAt: null, createdAt: null`)
- Test: `packages/worker/test/avatar.test.ts`

**Interfaces:**
- Produces: `AVATAR_MAX_BYTES = 65_536`, `AVATAR_SIZE = 256`, `AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const`, `type AvatarType`; `AppUser` and `Me` gain `avatarAt: string | null; createdAt: string | null`; `meBody(user: AppUser)` used by every `/api/me*` response; `decodeAvatar(body: unknown): { type: AvatarType; bytes: Uint8Array } | null`; routes `PUT /api/me/avatar` body `{ type, data }` (base64) → `Me`, `GET /api/me/avatar` → bytes, `DELETE /api/me/avatar` → `Me`.

- [ ] **Step 1: Migration** `avatars (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL, updated_at TEXT NOT NULL)` and `ALTER TABLE users ADD COLUMN avatar_at TEXT`.
- [ ] **Step 2: Write the failing tests:** `GET /api/me includes avatarAt null and createdAt`; `PUT a small WebP (bytes 'RIFF'+4+'WEBP'…) → 200, avatarAt set; GET /api/me/avatar returns the same bytes, content-type image/webp, cache-control contains immutable`; `JPEG (FF D8 FF) accepted`; `PNG bytes, mismatched type and magic, bad base64, 65,537 bytes → 400 invalid`; `PUT twice keeps one row and a newer avatarAt`; `DELETE → avatarAt null and GET avatar 404`; `B can't read A's photo (each GET is the caller's own)`; `PUT username response carries avatarAt`.
- [ ] **Step 3: Run** `npx -y npm@11 test -w packages/worker -- avatar`. Expected: FAIL.
- [ ] **Step 4: Implement.** `requireUser`'s SELECT adds `avatar_at, created_at`. PUT batches `INSERT … ON CONFLICT(user_id) DO UPDATE` and `UPDATE users SET avatar_at = ?` (2 queries). Decode base64 with `atob` inside try/catch.
- [ ] **Step 5: Run** the worker tests and `npx -y npm@11 run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(me): profile photo stored in D1`.

### Task 3: Same-origin cover proxy

**Files:**
- Create: `packages/worker/src/api/cover.ts`; modify `packages/worker/src/index.ts`
- Test: `packages/worker/test/cover.test.ts`

**Interfaces:**
- Produces: `GET /api/cover?url=<encoded cover_url>` → image bytes with the upstream `content-type` and `Cache-Control: private, max-age=86400`; errors `400 invalid` (missing, unparseable, not http/https), `404 not_found` (not the `cover_url` of one of the caller's entries), `502 upstream` (fetch error, timeout, non-2xx, non-`image/*`, over `COVER_MAX_BYTES = 5_000_000`). `COVER_TIMEOUT_MS = 8000`.

- [ ] **Step 1: Write the failing tests** (stub `globalThis.fetch` with `vi.spyOn`): `serves an own cover with its content type`; `someone else's cover URL → 404 and fetch never called`; `javascript: or ftp: → 400`; `upstream 404 → 502`; `text/html → 502`; `content-length 6 MB → 502`; `a hanging upstream → 502 after the timeout` (use fake timers or a short injected timeout).
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- cover`. Expected: FAIL.
- [ ] **Step 3: Implement** with one `SELECT 1 FROM entries WHERE user_id = ? AND cover_url = ? LIMIT 1`, then `fetch(url, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) })`; read the body with a byte cap (stop and 502 past it, since `content-length` can be absent).
- [ ] **Step 4: Run** the worker tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): cover proxy for on-device image rendering`.

### Task 4: Global Search screen and the search-scope setting

**Files:**
- Create: `packages/web/src/screens/SearchScreen.tsx`, `packages/web/src/lists/search.ts`, `packages/web/src/lists/useUrlText.ts`, `packages/web/src/shell/currentList.ts`
- Modify: `packages/shared/src/types.ts`, `packages/worker/src/api/me.ts` (`sanitizeSettings` enum), `packages/web/src/nav.ts` (`SEARCH_PATH`), `packages/web/src/routes.tsx` (`search`), `packages/web/src/screens/SettingsScreen.tsx` (Search group), `packages/web/src/screens/ListScreen.tsx` (`useUrlText`, `rememberList`)
- Test: `packages/web/src/screens/SearchScreen.test.tsx`, `packages/web/src/lists/search.test.ts`, `packages/web/src/shell/currentList.test.ts`, updates to `ListScreen.test.tsx`, `packages/worker/test/me.test.ts` (or the existing settings test file)

**Interfaces:**
- Produces: `SEARCH_SCOPE = ['all', 'current'] as const`; `UserSettings.searchScope: string` defaulting to `'all'`; `searchEntries(byCategory: Partial<Record<Category, Entry[]>>, lists: Category[], q: string): { category: Category; rows: Entry[] }[]` (empty `q` → `[]`; groups with no rows dropped); `useUrlText(key: string, delayMs?: number): { text: string; setText(v: string): void; clear(): void }`; `CURRENT_LIST_KEY = 'mt-current-list'`, `rememberList(c: Category): void`, `forgetCurrentList(): void`, `useCurrentList(): Category | null` (B4); `SEARCH_PATH = '/search'` in `nav.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `search.test.ts`: `"pokemon" finds Pokémon in Games and Anime, grouped in nav order`; `groups sorted by rating, unrated last`; `empty q → []`.
  - `currentList.test.ts`: `nothing stored → first enabled`; `stored list turned off → first enabled`; `all lists off → null`; `rememberList updates subscribers`.
  - `SearchScreen.test.tsx`: `typing "fri" shows Frieren under "Anime" and not Bleach, and the URL gets ?q=fri`; `the toggle "All lists | Anime" saves searchScope 'current' (PUT /api/me/settings) and narrows to the current list`; `no match in current scope offers "Search all lists"`; `51 matches in one list shows 50 and "Show 1 more"`; `an empty field shows the hint text`.
  - `ListScreen.test.tsx`: the existing search tests still pass on the extracted `useUrlText`; visiting `/list/books` stores `books`.
  - Worker: `searchScope 'current' saves; 'everywhere' → 400`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- search currentList ListScreen` and the worker settings test. Expected: FAIL.
- [ ] **Step 3: Implement.** `useUrlText` is ListScreen's existing local-text + 150 ms `replace` logic moved out unchanged; ListScreen keeps its behaviour on top of it (the phone search box goes in Task 7, when the bar's Search arrives). Search screen: `PageHeader title="Search"`, an autofocused `type="search"` input labelled "Search your lists", a `radiogroup` "Search in" with "All lists" and the current list's name, results as rows (cover, title, creator, `RatingBadge`) linking to `/entry/:id`, group headings `"<List> · <n>"`. Hint copy: "Search titles, creators, albums and genres." No-match copy: `No matches for “<q>”.`
- [ ] **Step 4: Run** the same commands plus `npx -y npm@11 test -w packages/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(search): global search screen with an all-lists or current-list setting`.

### Task 5: Activity screen

**Files:**
- Create: `packages/web/src/screens/ActivityScreen.tsx`, `packages/web/src/screens/activity/format.ts`, `packages/web/src/data/useActivity.ts`
- Modify: `packages/web/src/routes.tsx` (`activity`), `packages/web/src/design/components/Icon.tsx` (`activity`)
- Create (shared with Task 6): `packages/web/src/shell/comingWithFriends.ts` — `COMING_WITH_FRIENDS = 'Coming with friends'`, `useAddFriend(): () => void` (shows that toast)
- Test: `packages/web/src/screens/ActivityScreen.test.tsx`, `packages/web/src/screens/activity/format.test.ts`

**Interfaces:**
- Consumes: `ActivityPage`, `mergeActivity` (Task 1).
- Produces: `useActivity()` = `useInfiniteQuery` on `['activity']` over `GET /api/activity`, `staleTime: 0`; `dayLabel(iso: string, now: Date): string` ("Today", "Yesterday", else `Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })`); `timeAgo(iso: string, now: Date): string` ("just now" < 1 min, "5 min ago", "3 h ago", else the time of day); `type ActivityFilter = 'everyone' | 'friends' | 'you'`.

- [ ] **Step 1: Write the failing tests:** `format.test.ts` covers the day and time boundaries (local midnight, 59 s, 60 min). `ActivityScreen.test.tsx`: `renders "You re-rated Steins;Gate 7.0 → 8.5" with the title as a link to /entry/:id`; `"You rated Frieren 9.5 · marked Completed" for a merged line`; `status wording uses statusLabel ("marked Playing" for games)`; `added shows "You added Mob Psycho 100 to Anime"`; `the filter radiogroup "Show" has Everyone, Friends, You with You checked; choosing Friends sets ?show=friends and shows "Nothing here yet" with Add friend, which toasts "Coming with friends", and makes no request`; `lines sit under "Today" / "Yesterday" headings`; `Show more fetches with before & beforeId and appends`; `You with no rows → "Nothing here yet" with "Add or rate something and it shows up here." and a link to the current list`; `offline → "Couldn't load your activity" with Retry`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- Activity format`. Expected: FAIL.
- [ ] **Step 3: Implement.** Merge across all loaded pages (`mergeActivity(pages.flatMap(p => p.items))`). Each line per the Activity board: 40 px avatar initial, sentence ("You" + verb + bold title + rating/status), `<time dateTime>` with `timeAgo`, 40 px cover on the right. `PageHeader title="Activity" profile`; the filter chips sit under the title (44 px). Fetch only when the filter is You.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(activity): activity screen with Everyone / Friends / You`.

### Task 6: Profile screen, photo editor, Settings under Profile, Log out

**Files:**
- Create: `packages/web/src/screens/ProfileScreen.tsx`, `packages/web/src/screens/profile/AvatarEditor.tsx`, `packages/web/src/screens/profile/avatarImage.ts`, `packages/web/src/design/components/Avatar.tsx`, `packages/web/src/data/useAvatar.ts`, `packages/web/src/data/logout.ts`, `packages/web/src/design/nav.css` (profile part)
- Modify: `routes.tsx` (`profile`), `SettingsScreen.tsx`, `AppearanceScreen.tsx`, `Top5Screen.tsx`, `StatsScreen.tsx` (Back targets, B20), `Icon.tsx` (`user`, `logout`)
- Test: `ProfileScreen.test.tsx`, `profile/avatarImage.test.ts`, `data/logout.test.ts`, updates to `SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `Me.avatarAt`, `Me.createdAt`, avatar routes (Task 2); `computeStats` (`ratings/stats.ts`), `topFive`; `useAddFriend` (Task 5); `numberOnes` (Task 9 — define it here in `packages/web/src/ratings/topFive.ts` and Task 9 imports it).
- Produces: `Avatar({ me: Pick<Me, 'username' | 'email' | 'avatarAt'>, size: number })` (img `/api/me/avatar?v=<encoded avatarAt>`, `alt=""`; initial on Highlight with `--on-highlight` when there is no photo or the image errors); `initialOf(me): string`; `interface CropState { scale: number; x: number; y: number }` (scale ≥ 1 relative to "photo just covers the viewport"; x/y = offset of the photo's top-left from the viewport's, in viewport px); `initialCrop(imgW: number, imgH: number, view: number): CropState` (centred, scale 1); `clampCrop(s: CropState, imgW: number, imgH: number, view: number): CropState` (scale clamped to 1–4, offsets so the photo covers the square); `zoomAt(s: CropState, scale: number, fx: number, fy: number, imgW: number, imgH: number, view: number): CropState` (keeps the point under the focal point fixed, then clamps); `cropRect(s: CropState, imgW: number, imgH: number, view: number): { sx: number; sy: number; side: number }` (source pixels); `readImage(file: Blob): Promise<ImageBitmap>` throwing `AvatarReadError`; `makeAvatar(img: CanvasImageSource, rect: { sx: number; sy: number; side: number }, encode?: (canvas: HTMLCanvasElement, type: string, quality: number) => Promise<Blob>): Promise<{ type: AvatarType; data: string; blob: Blob }>` throwing `AvatarTooBigError`; `CropSheet({ image: ImageBitmap; onUse(rect): void; onCancel(): void })` in `AvatarEditor.tsx`; `useSaveAvatar()`, `useRemoveAvatar()` (on success `setQueryData(ME_KEY)` + `storeMe`); `LOGOUT_PATH = '/cdn-cgi/access/logout'`, `logOut(qc: QueryClient): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - `avatarImage.test.ts`: `initialCrop + cropRect on 4000 × 3000 in a 280 view → {sx: 500, sy: 0, side: 3000}`, portrait and square cases; `at scale 2 the side halves`; `clampCrop never leaves a gap (drag far right → x = 0) and clamps scale to 1–4`; `zoomAt keeps the focal source pixel under the focal point`; `makeAvatar` with a stub `encode` returning 90 KB at 0.85, 70 KB at 0.7, 50 KB at 0.55 → resolves at 0.55; always over the limit → `AvatarTooBigError`; encoder returning `image/png` for webp → retries as `image/jpeg`; `readImage` with `createImageBitmap` rejecting → `AvatarReadError` (stub it with `vi.stubGlobal`).
  - `AvatarEditor` (in `ProfileScreen.test.tsx`): `the crop sheet has a slider named "Zoom"; changing it and pressing ArrowLeft on the viewport change the rect passed to onUse`; `a pointer drag (pointerdown/move/up) moves the crop`.
  - `ProfileScreen.test.tsx`: `shows @dan and "Member since November 2026" and no email`; `tiles Titles 3 / Rated 2 / Avg 8.8 / Friends 0`; `Add friend toasts "Coming with friends"`; `the banner uses the highest-rated cover; none → no backdrop`; `the My #1s strip links each list's #1 entry, labelled with the list name, and skips lists with nothing rated`; `no tier counts are rendered (Task 11)`; `rows link to /top5, /stats, /settings`; `no photo → initial "D"`; `choosing a file opens the crop sheet; Use photo shows the preview; Save PUTs {type, data} and the profile avatar becomes an img` (mock `readImage` and `makeAvatar`); `a read error toasts "Couldn't read that image. Try a JPEG or PNG."`; `Remove photo DELETEs`; `Log out calls location.assign('/cdn-cgi/access/logout')`.
  - `logout.test.ts`: `clears entries and me tables, the query cache, mt-reauth and mt-current-list, then assigns LOGOUT_PATH`; `still assigns when Dexie clear throws`.
  - `SettingsScreen.test.tsx`: Back (phone) goes to `/profile`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- Profile avatarImage logout Settings`. Expected: FAIL.
- [ ] **Step 3: Implement.** Profile layout per B12 and the Profile board: banner, avatar with "Change photo" (and "Remove photo" when set; hidden `<input type="file" accept="image/*">` → `CropSheet` → preview → Save, as on the PhotoCrop board), `@username`, member since, four tiles, Add friend, My #1s strip (horizontal scroll, 64 px covers), an empty slot for Task 11's tier counts, a group card with My Top 5, Stats, Settings; then a full-width secondary **Log out** button. `numberOnes(byCategory: Partial<Record<Category, Entry[]>>, lists: Category[]): Entry[]` = the first of `topFive` per list, lists with none skipped, nav order (test it in `topFive.test.ts`). `PageHeader title="Profile" backTo` = current list path (history). Crop viewport: `touch-action: none`, pointer events with `setPointerCapture`; two active pointers = pinch (scale by distance ratio around their midpoint via `zoomAt`); `wheel` zooms by `1.1^(-deltaY/100)` around the cursor; the photo is drawn as a CSS-transformed `<canvas>` or `<img>` from an object URL; a circle outline shows what the round avatar will show. Save toast "Photo saved"; failure "Couldn't save your photo. Try again."; too big "That photo has too much detail to shrink. Try another."
- [ ] **Step 4: Run** the tests and `npx -y npm@11 test -w packages/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(profile): profile screen, photo, settings under profile, log out`.

### Task 7: Phone shell: new bottom bar, Lists button, profile button, list title style

**Files:**
- Create: `packages/web/src/shell/ListsButton.tsx`, `packages/web/src/shell/ProfileButton.tsx`
- Modify: `packages/web/src/design/components/BottomTabs.tsx`, `packages/web/src/shell/AppFrame.tsx`, `packages/web/src/shell/PageHeader.tsx`, `packages/web/src/screens/ListScreen.tsx` (`?add=1`, `icon`, `profile`, FAB and phone search removed, B6), `packages/web/src/screens/list/ListFilters.tsx` (drop `SearchToggle`, `useSearchOpen`), `packages/web/e2e/core.spec.ts` (helper waits for `navigation` named `Main`), `ActivityScreen.tsx`, `SearchScreen.tsx`, `MoreScreen.tsx`, `Top5Screen.tsx` (`profile`), `packages/web/src/nav.ts` (`addPath`), `Icon.tsx` (`lists`), `packages/web/src/design/nav.css`, `packages/web/src/design/tokens.css` (`--see-through: 0.9`)
- Test: `packages/web/src/AppShell.test.tsx`, `packages/web/src/shell/ListsButton.test.tsx`, `packages/web/test/tapTargets.test.ts` and `test/v2Contrast.test.ts` (read `nav.css` too)

**Interfaces:**
- Consumes: `useCurrentList`, `rememberList` (Task 4); `Avatar` (Task 6).
- Produces: `addPath(c: Category): string` = `/list/${c}?add=1`; `barTextColor(colors: ThemeColors): string` in `design/theme.ts` (B22); `BottomTabs({ current: Category | null; compareCount: number })`; `ListsButton({ lists: Category[]; current: Category | null; counts: Partial<Record<Category, number>> })`; `ProfileButton()` (phone only, renders nothing on PC); `PageHeaderProps.icon?: IconName` (themed bar, B22) and `PageHeaderProps.profile?: boolean`.

- [ ] **Step 1: Write the failing tests:**
  - `ListScreen.test.tsx`: phone has no "Search" button and ignores `?q=`; PC still filters with `?q=`; `?add=1` opens "Add to Anime" and leaves the URL without `add`.
  - `AppShell.test.tsx` (phone): `with the flag off the Main nav's links read Add, Activity, Search, More, and slot 4 is an empty aria-hidden cell`; `with the flag on they read Add, Activity, Search, Compare, More, Compare named "Compare, 2 waiting"`; `Activity has no count badge`; `Add on /activity navigates to /list/<current> and opens "Add to Anime"`; `Add's name is "Add movies" after visiting /list/movies`; `all lists off → no Add, no Lists button`; `Search is current on /search, Activity on /activity, More on /import`; `the profile button (name "Profile") and the Lists button are on /list/anime, /search, /activity, /more and the profile button is not on /settings`; `the list header is a .page-header--bar containing the icon, the h1 and the profile button, and has no cover backdrop`.
  - `ListsButton.test.tsx`: `button "Lists" has aria-expanded false→true; the Lists nav shows every enabled list with counts and marks the current one aria-current="page"`; `choosing Books navigates and closes`; `Escape closes and refocuses the button`; `a tap on the backdrop closes`; `not rendered on /entry/:id`.
  - `v2Contrast.test.ts`: `Text and Muted text on Cards at --see-through over #ffffff and #000000 ≥ 4.5:1 in all 12 themes` (use the file's `over()` helper); `barTextColor on Header row ≥ 4.5:1 in all 12 themes`.
  - `tapTargets.test.ts`: `.bottom-tabs__item`, `.bottom-tabs__search`, `.lists-fab`, `.lists-menu__item`, `.profile-btn` ≥ `--tap`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- AppShell ListsButton ListScreen tapTargets v2Contrast`. Expected: FAIL.
- [ ] **Step 3: Implement.** BottomTabs: five equal columns; Add is a `Link` to `addPath(current)` styled as a tab; Search's 56 px circle (Highlight fill, `--on-highlight` icon) sits 16 px above the bar with "Search" under it; slot 4 follows B2 (Compare stays lazy: no queue fetch while disabled, as today). AppFrame (phone) renders `ListsButton` and `BottomTabs`; the old list FAB and its `.fab` rule go (PC keeps `btn--add` in the list header). ListScreen opens the Add sheet when `add=1` is present and strips it with `setParams(…, { replace: true })`. The Lists menu pops in (scale 0.96 → 1, 120 ms) only under `prefers-reduced-motion: no-preference`.
- [ ] **Step 4: Run** the tests and the whole web suite (existing list, compare-banner and More tests updated to the new nav names). Expected: PASS.
- [ ] **Step 5: Commit** `feat(nav): new phone bottom bar, Lists button, profile button, themed list bar`.

### Task 8: PC side nav equivalents and the slimmer More

**Files:**
- Modify: `packages/web/src/design/components/SideNav.tsx`, `packages/web/src/shell/AppFrame.tsx`, `packages/web/src/screens/MoreScreen.tsx`
- Test: `packages/web/src/AppShell.test.tsx`, `packages/web/src/screens/MoreScreen.test.tsx`

**Interfaces:**
- Consumes: `Avatar`, `addPath`, `useCurrentList`, `SEARCH_PATH`.
- Produces: `SideNav({ lists, counts, compareCount, current: Category | null, me: Me })`.

- [ ] **Step 1: Write the failing tests:** PC `Main` nav reads, in order (SideNavPC board): `Profile` (link to `/profile` named "Profile", showing the avatar and `@dan`), `Add anime` (button-styled link to `addPath(current)`), `Search`, `Activity`, the enabled lists with counts, then `Import`, `Export my data`, `About`; `Compare` appears after `Activity` only with the flag on. More (phone): sections "Ratings" (Top 5, Stats; Compare first with the flag on), "Your data" (Import, Export) and "App" (About); no Settings, Appearance or Other lists rows.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- AppShell More`. Expected: FAIL.
- [ ] **Step 3: Implement** per B20/B21. The side nav's profile row uses a 32 px `Avatar`.
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(nav): PC side nav per the approved board; More trimmed`.

### Task 9: Top 5 share image

**Files:**
- Create: `packages/web/src/share/top5Card.ts`, `packages/web/src/share/shareImage.ts`, `packages/web/src/screens/top5/ShareSheet.tsx`
- Modify: `packages/web/src/screens/Top5Screen.tsx` (Share per block, plus "Share my #1s" under the header), `Icon.tsx` (`share`)
- Test: `packages/web/src/share/top5Card.test.ts`, `packages/web/src/share/shareImage.test.ts`, `packages/web/src/screens/Top5Screen.test.tsx`

**Interfaces:**
- Consumes: `GET /api/cover` (Task 3); `topFive`, `numberOnes` (Task 6), `ratingColor`, `formatRating`, `labelColorOn`, `useThemeColors`, `useCfSet`.
- Produces: `CARD_W = 1080`, `CARD_H = 1350`; `MEDALS = ['#f2c14e', '#c9cfd9', '#e0925a'] as const`, `MEDAL_INK = '#1b1b25'`; `interface CardRow { rank: number; listLabel?: string; title: string; creator: string; rating: number; square: boolean; cover: CanvasImageSource | null }`; `interface CardInput { kind: 'top5' | 'ones'; heading: string; username: string; rows: CardRow[]; colors: ThemeColors; cf: CfSet }`; `type CardCtx = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textBaseline' | 'textAlign' | 'fillRect' | 'fillText' | 'measureText' | 'drawImage' | 'beginPath' | 'roundRect' | 'fill' | 'save' | 'restore' | 'clip' | 'globalAlpha' | 'filter'>`; `fitText(ctx: CardCtx, text: string, maxWidth: number): string`; `cardLayout(input: Pick<CardInput, 'kind'> & { n: number }): { y: number; h: number; style: 'poster' | 'row' | 'compact' }[]` (row boxes; every box ends ≤ `CARD_H − 72 − 60`); `drawShareCard(ctx: CardCtx, input: CardInput): void`; `coverProxyUrl(url: string): string`; `loadCover(url: string): Promise<ImageBitmap | null>`; `renderCardPng(input: Omit<CardInput, 'rows'> & { rows: (Omit<CardRow, 'cover'> & { coverUrl: string })[] }): Promise<Blob>`; `shareOrSave(blob: Blob, filename: string, title: string): Promise<'shared' | 'saved' | 'cancelled'>`.

- [ ] **Step 1: Write the failing tests:**
  - `top5Card.test.ts` with a recording fake `CardCtx` (`measureText` width = `text.length × 20`): `fitText keeps short text and ends long text with "…" within maxWidth`; `draws "My Anime Top 5", the footer "Media Tracker · @dan", ranks 1–5, each title, creator and formatRating(rating)`; `the first fill is the theme's Background and row fills are Cards`; `a badge fill is ratingColor(rating, cf) and its label colour labelColorOn(fill, colors)`; `a null cover draws a Panels tile and the title's first letter`; `three rows draw three rows (no empty slots)`; `top5 layout is poster, row, row, compact, compact`; `the poster draws its cover twice (backdrop with filter blur, then sharp) under a Background scrim at globalAlpha 0.75`; `rank discs 1/2/3 fill #f2c14e/#c9cfd9/#e0925a with the numeral in #1b1b25; rank 4 has no disc`; `a "My #1s" card with 7 rows fits (cardLayout) and every row has a gold disc and its list name`; `contrast(MEDAL_INK, each medal) ≥ 4.5`; `no fillText call uses a font other than Inter`.
  - `shareImage.test.ts`: `coverProxyUrl encodes the URL`; `loadCover returns null on 404 and on a rejected fetch`; `shareOrSave shares when canShare({files}) is true`; `AbortError → 'cancelled'`; `no canShare → clicks a download link named the filename → 'saved'`.
  - `Top5Screen.test.tsx`: `each block with a rated title has "Share Anime Top 5"`; `"Share my #1s" opens the preview with heading "My #1s"; hidden when nothing is rated`; `heading text for a list is "My Anime Top 5"`; `a block with nothing rated has no Share`; `Share opens the preview sheet; "Save image" calls shareOrSave` (mock `renderCardPng`); `render failure toasts "Couldn't make the image. Try again."`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- top5Card shareImage Top5`. Expected: FAIL.
- [ ] **Step 3: Implement.** Card layout (px on the 1080 × 1350 canvas, per the ShareTop5 / ShareNumberOnes boards): 72 padding; heading Inter 800 64 in Bright text; rows on Cards with radius 24 and 16 gaps. Top 5: poster box 520 high (cover 260 × 390, or 390 square, left; blurred copy of the cover fills the box behind a Background scrim at 0.75; if `ctx.filter` is unsupported, draw the cover through a 24 px offscreen canvas and scale it back up), rows 2–3 of 170 (cover 96 × 144), rows 4–5 compact of 110 (cover 60 × 90). #1s: rows share the height evenly (`min(170, …)`), list name Inter 700 28 Muted text above the title. Medal disc 64 px with Inter 800 36 numeral; title Inter 700 44 (poster 52), creator Inter 400 32 Muted text, rating badge 128 × 72 radius 16 with Inter 700 40; footer "Media Tracker · @<username>" Inter 500 28 Muted text, centred. Text colours are the theme's Text / Bright text / Muted text, which pass 4.5:1 on Background and Cards. `renderCardPng` awaits `document.fonts.load` for 400/700/800 Inter, loads covers in parallel, draws on a fresh canvas, `toBlob('image/png')`. Filenames `top5-<category>.png` / `my-number-ones.png`; share titles `My <List> Top 5` / `My #1s`. The sheet shows the PNG via an object URL (revoked on close) with `alt="Preview of your <heading> image"`.
- [ ] **Step 4: Run** the tests and the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(top5): share your Top 5 as an image`.

### Task 10: End-to-end flows and docs

**Files:**
- Modify: `packages/web/e2e/core.spec.ts`, `docs/SETUP.md` (Phase 3b update: run the migrations step, new tables `activity`, `avatars`), `docs/decisions-phase3.md` (new section "Phase 3b rulings (B1–B24)" with one line each and any values changed while building)

- [ ] **Step 1: Update and add e2e tests** (both projects): `search narrows to Frieren` goes through the `Search` link (bottom bar or side nav) and `/search`; new `Add from the bottom bar or side nav opens Add anime`; new `Activity (You) shows "You added Frieren to Anime"`; new `Lists button switches to Books` (phone project only); new `Profile → Log out goes to /cdn-cgi/access/logout` (assert the request URL with `page.waitForRequest`; the dev server answers with the SPA, which is fine).
- [ ] **Step 2: Run** `npx -y npm@11 run e2e`, `npx -y npm@11 test`, `npx -y npm@11 run typecheck`. Expected: all pass.
- [ ] **Step 3: Write the docs** (SETUP step: `wrangler d1 migrations apply media-tracker --remote --env production` lists `0003_activity.sql` and `0004_avatars.sql`; run it before deploying).
- [ ] **Step 4: Commit** `test(e2e): phase 3b navigation, search, activity, log out; docs`.

---

### Task 11: Tier counts on Profile (after 3c Task 1 is merged)

**Files:**
- Create: `packages/web/src/screens/profile/TierCounts.tsx`; modify `ProfileScreen.tsx` (fill the slot)
- Test: `packages/web/src/screens/profile/TierCounts.test.tsx`

**Interfaces:**
- Consumes: 3c Task 1's `tierFor`, `tiersFor`, `DEFAULT_TIERS`, `TierSet` (`@media-tracker/shared`); `useAllEntries`.
- Produces: `tierCounts(byCategory: Partial<Record<Category, Entry[]>>, lists: Category[], settings: UserSettings): { name: string; count: number }[]` (highest tier first, B23); `TierCounts()`.

- [ ] **Step 1: Write the failing tests:** `ratings 9.5, 9, 8, 6.5, 3 → Loved 2 · Liked 1 · Fine 1 · Didn't like 1`; `unrated entries don't count`; `a list with its own tier names → default names`; `with the flag off nothing renders; on, the line reads "Loved 2 · Liked 1 · Fine 1 · Didn't like 1"`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- TierCounts`. Expected: FAIL.
- [ ] **Step 3: Implement** behind `COMPARE_ENABLED` (3c Task 16 removes the check with the flag). One muted line on Background under the My #1s strip.
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(profile): tier counts`.

## Dan's answers (2026-11-15)

1. Photo: drag and zoom to pick the square (B11).
2. Slot 4: superseded by the Amendments — always Compare, 3b ships with 3c (B2).
3. Search defaults to all lists (B7).
4. Share: per-list Top 5 images and one "My #1s" image (B17).
6. Wireframes approved with the Amendments (B1, B2, B9, B12, B17, B20, B22–B24).
5. Migrations: 0003 and 0004 here; 0005 belongs to the tier-ratings plan.
