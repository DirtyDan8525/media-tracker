# Media Tracker App: Design Spec

*Version 1.1, 2026-11-10. Status: approved by Dan. v1.1 adds looked-up details (release date, synopsis, length, origin) and 7 more themes.*

## 1. Goal

Replace Dan's Media Tracker Google Sheet (Apps Script `MediaTrackerCovers.gs` v2026-11-06i) with a polished, private app that Dan and a small group of friends use on Windows, Android and (in a later phase) iPhone. Everything the Sheet does today carries over, and the Sheet's pain points go away. A social layer lets friends see, compare and react to each other's lists.

**Success looks like:**
- Dan uses the app daily in place of the Sheet, on his PC and his Android phone.
- Adding a title (type it, rate it) is as fast as or faster than the Sheet, and the lookup results are at least as accurate.
- Friends join with a link, see each other's lists, and comment on the feed.
- It feels like a finished, polished app, not a spreadsheet: easy for non-technical friends.
- It costs $0 a month to run.

**Out of scope:** app store publishing, public sign-up, monetization, two-way sync with Google Sheets.

## 2. Decisions made

| Topic | Decision |
|---|---|
| App type | Installable web app (PWA). No app stores, updates are automatic |
| Platforms | Windows and Android first; iPhone is a later phase (Phase 5) |
| Access | Private and invite-only through Cloudflare Access (free for up to 50 users); only Dan can approve new people |
| Backend | Everything on Cloudflare: hosting, a Worker (API and lookup relay), and D1 (SQLite) |
| Social | Browse friends' lists, compare ratings, an activity feed with reactions and comments |
| Friends | Added by username or personal invite link |
| Privacy | Per-entry "private" flag and per-entry "private notes" flag, enforced on the server |
| Existing Sheets | One-time .xlsx import per person, then the Sheets are retired |
| Who builds | Claude writes the code, tests and setup steps; Dan deploys and tests on devices |
| Quality bar | A polished, easy-to-use app: screens are mocked up before they're built, plus a consistent design system |
| Looked-up details | Besides cover, genres and creator: release date, synopsis, length and origin (see §5.1) |
| Themes | 12: Midnight (default), Ember, Twilight, Crimson, OLED Black, Ocean, Forest (dark); Light, Sakura, Matcha, Arctic, Sand (light); plus Custom |

## 3. Architecture

```
Installed web app (React + TypeScript + Vite, PWA)
   │  every request passes through the Cloudflare Access sign-in check
   ▼
Cloudflare Worker
   ├── /api/*     → D1 database (users, entries, friends, feed)
   └── /lookup/*  → AniList, TMDB, TVmaze, Deezer, iTunes, Open Library,
                     Steam, IGDB, Wikipedia/Wikidata, Kitsu, Spotify pages
```

**Units and their responsibilities:**

- **`auth`**: turns a request into a user. In v1 it reads and verifies the Cloudflare Access token, then maps the verified email to a user. It's the only module that knows how sign-in works, so if Access turns out to be clumsy on iPhone, swapping it for in-app Google sign-in changes only this module.
- **`api`**: endpoints for entries, seasons, settings, friends, the feed, comments and import. Each endpoint checks permissions through one shared `canView` / `canEdit` function.
- **`lookup`**: ported from the script. One adapter per source, the fallback chain per category, title matching and scoring, choices for the picker, per-source spacing between requests, and a result cache in D1.
- **`matching`** (shared, pure functions): `normTitle`, `similarity` (Dice), `splitYear`, duplicate detection.
- **`compare`** (on the device, pure functions): full-list insertion, placing one title, ranking unrated titles, `rescore` (the order-keeping score adjustment), `placeScore`, and replay-based Back.
- **`web`**: the app's screens, a local cache of your data (IndexedDB) for instant loads and offline browsing, and updates that show on screen before the server confirms.

Secrets (the TMDB key, and the IGDB Client ID and secret) are stored as Worker secrets and are never sent to the device. IGDB requests stay under 4 per second. TMDB and IGDB attribution appears on an About screen, as their terms require.

## 4. Data model (D1)

- `users`: id, email (from Access), username (unique, changeable), display_name, avatar, theme, settings_json (tab toggles, compare options, custom colors), is_admin, invite_code
- `friendships`: user_a, user_b, status (pending / accepted), requested_by, created_at
- `entries`: id, user_id, category (anime, movies, tv, albums, songs, games, books), title, typed_title, status, rating (decimal, nullable), genres, creator, album, cover_url, notes, release_date (ISO date, or just YYYY when only the year is known), synopsis, length_label, origin, details_state (none / filled / needs_review), is_private, notes_private, source, source_id, created_at, updated_at
- `seasons`: id, entry_id, label, rating, notes (Season Avg is calculated from these)
- `compare_queue`: user_id, entry_id, added_at
- `activity`: id, user_id, entry_id, type (rated, re-rated, status changed, added), payload_json, created_at, updated_at
- `reactions`: activity_id or entry_id, user_id, emoji
- `comments`: id, activity_id or entry_id, user_id, body, created_at, deleted_at
- `lookup_cache`: source, query_key, result_json, fetched_at

**Visibility rule (one function, tested):** a viewer can see an entry if they own it, or if they're an accepted friend of the owner and the entry isn't private. Notes are left out of the response when `notes_private` is set. Private entries never create feed posts and are excluded from friend comparisons.

## 5. Features

### 5.1 Lists and adding entries
- Tabs: Anime, Movies, TV, Albums, Songs, Games, Books, plus Anime Seasons and TV Seasons. Each tab can be turned off in Settings, which also hides its Top 5 block and its Season Avg.
- Fields per category are the same as the Sheet's (see the recap table). Status values are Completed, Watching / In Progress, Rewatching, On Hold, Dropped, Plan to watch.
- Adding: type a title, plus optionally a creator, a year, or a Spotify album or track link. The lookup runs, and a clear winner fills in automatically; close results open the "Which one did you mean?" cover grid with a search box.
- Same fallback chains as the script: AniList (plus Kitsu for spelling correction); TMDB, then Wikipedia/Wikidata; TVmaze, then Wikipedia; Deezer, then iTunes; Deezer tracks; Open Library, then iTunes; IGDB, then Steam, then Wikipedia.
- The official title replaces what you typed, and what you typed is kept as `typed_title`. Renaming a show also updates its Seasons.
- Duplicate rule: title and creator must both match, except Anime (title only). Duplicates get a warning, not a block.
- Lookups never block saving. If every source fails, the entry is saved with "Couldn't find it" and offers Retry or "paste an image link".
- **Extra details** are fetched once a match is chosen (a single extra request for that one title, not for every choice in the picker). Fields are left empty when the source doesn't have them:

  | Category | Release date | Synopsis | Length | Origin (label shown) |
  |---|---|---|---|---|
  | Anime (AniList) | start date | description | "24 ep · 24 min" | Format, e.g. "TV · Fall 2023" |
  | Movies (TMDB; Wikipedia/Wikidata fallback) | release date | overview, or the intro of the Wikipedia article | "2 h 17 min" | Studio (production companies, up to 2) |
  | TV (TVmaze) | premiere date | summary | "45 min episodes · Ended" | Network or streaming service |
  | Albums (Deezer; iTunes fallback) | release date | none | "10 tracks · 43 min" | Label |
  | Songs (Deezer) | album release date | none | "3:42" | Label |
  | Games (IGDB; Steam fallback) | first release date | summary | none in v1 | Platforms, e.g. "Switch, PC" |
  | Books (Open Library; iTunes fallback) | first publish year | work description | "432 pages" | Publisher |

- Lists can also be sorted by release date. Synopses longer than 600 characters are cut at a sentence boundary, with a "More" link to the source.
- **Filling in details for imported titles:** the Sheet doesn't record which source an entry came from, so imported rows have no details at first. "Fill in details" (Settings, and a prompt after import) works through them in the background, one title every 1.5 seconds while the app is open. It fills only empty detail fields and never changes your title, rating, creator, notes or cover. A result is applied only when its title matches closely (similarity ≥ 0.9) and the creator matches where you have one; otherwise the entry is marked "needs review" so you can pick the right match yourself.
- Re-fetch (with an optional custom search term) is available on any entry.
- Sorting: by rating, highest first, with unrated entries at the bottom, then by title. Other sorts are available.

### 5.2 Compare ("fix my ratings")
A direct port of the current behavior, with tests that check it gives the same results as the script:
- Modes: go through a whole list (insertion within the "compare within" window), place a new rating (binary search), rank unrated titles (Completed, or every row on tabs without a Status column).
- Answers: A, B, About the same, Skip, Stop. Back replays every answer except the last. On PC: arrow keys, S and Backspace. On a phone: tap, and swipe left or right.
- Rescoring: the order-keeping adjustment with a minimum 0.1 gap, in tenths (or hundredths if any score already uses two decimals). Placing a new title changes only that title's score.
- Settings: Ask to compare (Both / Only when I start it / Only for new ratings / Off), Re-rating style (Meet in the middle / Swap the numbers), When there's no room (Use in-between scores / Give the same score / Push others down), Compare within (default 1).
- New ratings join the queue, and a home banner shows "N new ratings to double-check". Nothing is saved until you press Save.

### 5.3 Top 5, Stats, themes
- Top 5: a block per category with cover, title, creator and rating; turned-off categories are hidden.
- Stats: per category, entries, rated count, average, completed count and highest rating; an All media total; and Anime by genre.
- Themes: 12 built-in, plus Custom, all using the same 10 color roles. Dark: Midnight (the default, with gold), Ember (charcoal and orange), Twilight (deep purple and lavender), Crimson (near-black and red), OLED Black (pure black and gold), Ocean, Forest. Light: Light, Sakura, Matcha (cream and green), Arctic (cool grey and blue), Sand (beige and brown). Every theme must pass WCAG AA contrast for text and muted text on its background. Rating, status and duplicate colors come from each theme's sets. Colors are worked out from the data, so nothing can break when pasting.

### 5.4 Social
- **Usernames:** chosen at first sign-in, unique, can be changed.
- **Adding friends:** search by username, or open someone's personal invite link (`/add/<code>`, which can be regenerated to stop the old link from working). Friendships go both ways and can be removed.
- **Admin invite (Dan only):** enter a friend's email; the Worker adds it to the Cloudflare Access policy through the Cloudflare API and returns that person's link to send.
- **Friend profile:** read-only tabs, Top 5 and Stats, with private items left out. Every entry has "Add to mine".
- **Comparisons:** "Both rated" (side by side, sorted by how much you disagree), "Theirs, not yours" (their best-rated titles you haven't logged), and a group Top 5 per category.
- **Feed:** posts are created automatically for new ratings, status changes and big re-ratings from Compare. Changes to the same entry within 10 minutes merge into one post. Imports and note edits post nothing.
- **Reactions** (a fixed set of 6 emoji) and **comments** (up to 500 characters) on feed items and entries. You can delete your own comments, and anything on your own entries.
- **Notifications:** an unread badge in the app. Web push is Phase 6.

### 5.5 Import
- Each person uploads their Sheet's .xlsx file. Tabs are found by their header row, as `findColumns_` does today.
- Brings over titles, ratings, statuses, genres, creators, cover URLs, notes, season rows and Settings (theme, tab toggles, compare options).
- A preview shows counts per tab and the rows that would be skipped, with reasons, before anything is saved. No lookups run during import, and nothing posts to the feed. The whole import can be undone with one click.

### 5.6 Settings and admin
- Settings: theme and custom colors, tab toggles, compare options, username and display name, invite link.
- Admin (Dan): approve emails, see who has joined, check lookup source health (the old "Test connection"), and diagnose a lookup with a step-by-step log (the old "Diagnose row").
- About: Start Here-style welcome in Dan's voice ("WELCOME TO MEDIA TRACKER", "Created by Dan", the intro text), plus the TMDB and IGDB credits.

## 6. Design and polish requirements
- Screens are mocked up first and Dan approves them before they're built: home, a list (on phone and on PC), entry details, the "which one?" picker, Compare, friend profile, feed and import.
- A design system: shared tokens for spacing, type sizes, corner rounding and the 10 color roles; shared components.
- Built for phones first: a bottom tab bar, tap targets of at least 44 px, list rows as cover cards. On PC, a wider table view with inline editing and keyboard shortcuts.
- Speed: changes appear immediately, loading placeholders instead of blank screens, an app shell that loads instantly from the local cache, and transitions that respect the device's reduce-motion setting.
- Every empty, loading and error state has friendly text and a next step.
- Accessibility: WCAG 2.1 AA contrast, screen-reader labels, full keyboard use on PC.

## 7. Errors and limits
- Lookups: each source has a timeout and moves to the next source in the chain. AniList's 429 errors are retried with a delay on the server (the device never waits 61 seconds). Cached results are reused.
- Free-plan limits (100,000 Worker requests a day; D1's 5M rows read and 100K rows written a day) are far above what a few users need. The admin page shows daily usage.
- Writes go into a queue on the device while offline and are sent when it reconnects; if the server copy changed in the meantime, the newer change wins.
- Backups: D1 has 7 days of point-in-time restore on the free plan, plus an "Export my data" (.json/.csv) button for each user.

## 8. Testing
- Unit tests: matching and scoring, every lookup adapter (against recorded API responses, including the cases already fixed: Chuck (2007), We Are Legion, Live at Electric Lady, Nintendo games), and the compare and rescoring functions (checked against outputs from the current script).
- Permission tests: a non-friend, a pending friend, and a friend trying to read a private entry or private notes all get the right result.
- Import tests: sample .xlsx exports of the Sheet template.
- End-to-end tests (Playwright) on a phone-sized and a desktop-sized screen for the main flows.
- Manual device checks by Dan on Windows and Android before each phase is called done.

## 9. Rollout phases
1. **Foundation:** design mockups approved; Cloudflare setup; sign-in; data model; usernames.
2. **Dan only:** lists, adding entries, lookups, the picker, entry details, import. Dan moves his own Sheet over and uses the app.
3. **Ratings:** Compare, Top 5, Stats, themes, Settings, tab toggles.
4. **Social:** admin invites, friends, profiles, comparisons, feed, reactions, comments, privacy. Friends on Windows and Android can join.
5. **iPhone:** test how Access sign-in behaves in an app installed to the iPhone home screen; swap the `auth` module for in-app Google sign-in if needed; device checks on iPhone; iPhone friends join.
6. **Optional:** web push notifications.

## 10. Risks and open items
- **Phase 5 sign-in on iPhone is unknown.** Mitigated by keeping sign-in in its own module. Most of Dan's friends use iPhones, so the social features won't reach them until Phase 5.
- **Spotify link parsing relies on page tags, not an official API,** so it can break if Spotify changes its pages. It's kept as a fallback only.
- **Wikipedia, Deezer and iTunes have no formal guarantees** of staying available or free. Each sits behind an adapter and can be swapped.
- **Dan's TMDB and IGDB keys serve every user.** Non-commercial use is within both providers' terms. Attribution is required, and is included on the About screen.
