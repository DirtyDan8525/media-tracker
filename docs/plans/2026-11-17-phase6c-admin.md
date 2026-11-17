# Phase 6c: Admin powers (all 10, Dan 2026-11-16/17)

Source: docs/plans/phase6-admin-ideas.md. Dan wants everything; this plan builds 2–10 now and the list builder (1) as its own step after, because custom lists touch every screen that knows the fixed list types.

## Rulings
- **AD1 One settings record.** Migration `0013_app_settings.sql`: `app_settings (key TEXT PK, value_json TEXT, updated_at)`. `GET /api/app` (any signed-in user, also signed-out for the sign-in page's text/look) returns the public subset; `PUT /api/admin/app/:key` (admin) validates per key. Cached in the Worker per request only (no stale caches).
- **AD2 Feature switches** (`features`): signups (open/closed — closed: Create account says "Sign-ups are closed"; sign-up links still work), friends, feed, comments, reactions, messages, closeCalls, walkthrough, installBanner. All on by default. Off hides the UI and the server refuses the matching writes (403 `feature_off`); reads of old data stay possible where harmless.
- **AD3 Announcement** (`announcement`): text ≤ 280, optional link, optional end date; shows as a dismissible banner at the top of Home for everyone (dismiss remembered per announcement id).
- **AD4 What's new / Coming soon / About** (`whatsNew`, `comingSoon`, `about`): edited in Admin as simple lists/text (markdown-free plain text with line breaks); the app falls back to the built-in whatsNew.ts content when unset.
- **AD5 App text and look** (`brand`): app name (≤ 40), sign-in welcome text (≤ 200), accent colour (one of the theme's safe accents, checked for AA contrast), default theme for new people.
- **AD6 Defaults for new people** (`defaults`): which lists are on, theme, private-by-default for new titles, notes-private-by-default. Applied at sign-up.
- **AD7 Moderation:** admin can delete any comment, any post (activity anchor), any message; see who reacted/commented (already visible); a "Recent comments" list in Admin.
- **AD8 Lookup tools:** "Check sources" runs one known search per source (Kitsu anime/manga, AniList, TMDB/TVmaze, Deezer, IGDB, books, YouTube oEmbed) and shows ok / slow / failing with the error; "Why didn't it find this?" takes a list + title and shows each step the lookup chain tried (source, query, results count, chosen match or reason).
- **AD9 Numbers:** members, active in the last 7 days, titles added this week, most-rated titles (top 10 across everyone, counting only non-private entries), messages this week.
- **AD10 Backup:** "Download a backup" streams a JSON file of every table except secrets (password hashes, session/reset/sign-up-link token hashes excluded); plus a short restore guide in SETUP (wrangler d1 export/import).
- **AD11 List order/visibility for everyone** (`lists`): the order lists appear in and which are hidden for everyone (a person's own Settings can still turn lists off).
- **Admin screen layout:** sections in this order — Requests, Sign-up links, Members, Numbers, Announcement, Switches, Lists, App text and look, Defaults, What's new / Coming soon / About, Moderation, Lookup tools, Backup. Long sections open as their own sub-pages (/admin/<section>).

## Later step
- **List builder** (custom lists with chosen fields and lookup source) — after this phase; needs its own wireframes.
