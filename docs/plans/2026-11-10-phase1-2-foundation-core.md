# Media Tracker App, Phases 1–2 (Foundation and Dan-only Core): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, private, installable web app where Dan signs in, imports his Sheet, adds entries that auto-fill from the same sources as `MediaTrackerCovers.gs`, and browses and edits his lists on Windows and Android.

**Architecture:** An npm-workspaces monorepo with three packages: `shared` (pure TypeScript: types and title matching), `worker` (a Cloudflare Worker using Hono: the API, the lookup relay and D1 access, plus serving the built web app as static assets on the same address behind Cloudflare Access), and `web` (React and Vite as a PWA, with an IndexedDB cache through Dexie).

**Tech Stack:** TypeScript, Hono, Cloudflare Workers + D1 + Access, `jose` (JWT checking), React, React Router, TanStack Query, Dexie, vite-plugin-pwa, SheetJS (xlsx), Vitest, `@cloudflare/vitest-pool-workers`, Playwright. Use the latest stable versions at install time and pin them in `package.json`.

**Spec:** `docs/specs/media-tracker-app-spec.md`. The source behavior to port is `reference/MediaTrackerCovers.gs` v2026-11-06i. Port its logic faithfully; where this plan says "port X", read that function in the script.

## Global Constraints

- Runs on Cloudflare free plans only: 100,000 Worker requests a day, 10 ms CPU per request, 50 D1 queries per Worker invocation, 500 MB per D1 database. **D1 allows at most 100 bound parameters per query (verify in the current D1 limits docs in Task 2 and adjust the chunk sizes if it differs).**
- Every `/api/*` request except `/api/health` must have a verified Cloudflare Access identity. The `DEV_EMAIL` bypass only works when `ENVIRONMENT === "dev"`.
- Secrets (`TMDB_KEY`, `IGDB_ID`, `IGDB_SECRET`) live only in Worker secrets and never appear in a response.
- Wait between requests to the same source (ms): anilist 700 between query variants (and on a 429, retry once after the `Retry-After` value or 2 s, never 61 s); tvmaze 800; others don't need a wait within a single lookup. IGDB: at most 4 requests per second.
- Match thresholds (from the script): accept a top score of at least 0.45 (Steam 0.6). Choices are results within 0.1 of the top (Anime 0.15, IGDB 0.12). A year match adds +0.2. Singles and EPs get −0.15. IGDB DLC (`parent_game`) gets −0.1.
- Category fields, labels and statuses are exactly as in spec §5.1. Status values are `Completed`, `Watching / In Progress`, `Rewatching`, `On Hold`, `Dropped`, `Plan to watch`.
- Default theme is Midnight, using the `THEMES.Midnight` and `CF_SETS.Midnight` hex values from the script exactly. Light, Ocean, Forest and Sakura also come straight from the script. The 7 new themes use these values (role order: Background, Alternate rows, Header row, Cards, Panels, Text, Bright text, Muted text, Grid lines, Highlight). Dark ones use `CF_SETS.Midnight`, light ones use `CF_SETS.Light`:
  - Ember: `#1c1917 #211d1a #14110f #28221e #312a25 #ede6e1 #ffffff #b3a69c #3a322c #ff9f43`
  - Twilight: `#1a1726 #1f1b2e #12101c #262140 #2e2850 #e8e4f4 #ffffff #aaa3c4 #332d4d #c4a7ff`
  - Crimson: `#161214 #1b1618 #0f0c0d #231b1e #2c2226 #ece4e6 #ffffff #b0a2a6 #352a2e #ff5c6c`
  - OLED Black: `#000000 #0a0a0a #000000 #121212 #1a1a1a #e8e8e8 #ffffff #a0a0a0 #222222 #ffd166`
  - Matcha: `#fbfaf3 #f3f2e8 #e7ead8 #f6f6ec #e8ecd9 #2a2e24 #14170f #6a705c #dde2cc #4f7a28`
  - Arctic: `#f7f9fc #eef2f7 #e1e7f0 #f4f7fb #e4eaf3 #26303d #0f1620 #5f6b7a #d5dde8 #2563c9`
  - Sand: `#fbf7f0 #f4eee3 #ebe2d2 #f8f2e8 #ece3d3 #3a3026 #1f1810 #77695a #e2d7c4 #8a5a2b`
- Attribution copy on About: "This product uses the TMDB API but is not endorsed or certified by TMDB." and "Game data from IGDB.com."
- Start Here / About copy: header "WELCOME TO MEDIA TRACKER", sub-line "Created by Dan" (italic), and the intro paragraphs verbatim from the recap.
- Lookups never block saving an entry.

## Review Focus

1. **Non-Latin and accented titles** ("進撃の巨人", "Pokémon", "Amélie"): `normTitle` keeps letters from every script, so these match themselves and don't become empty strings. Test in Task 1.
2. **Spotify links with extras** (`/intl-de/album/…`, `?si=…`): still recognized and turned into a clean title. Test in Task 9.
3. **Messy Sheet exports:** blank rows, ratings stored as text ("8.5", "8,5"), ratings outside 0–10, the Cover column containing an `=IMAGE()` formula, hidden or renamed tabs. Rows import with the problem shown in the preview; nothing crashes. Test in Task 14.
4. **A source that is down or rate-limited** (429, 500, timeout, bad JSON): the chain moves to the next source, and the entry is still saved with a "Couldn't find it" state. Test in Tasks 5 and 13.
5. **Duplicate check before the creator is known:** a title-only match on a non-anime tab is not flagged until the creator is filled in; Anime flags on title alone. Test in Task 1.

---

## File Structure

```
package.json                      workspaces: packages/*
packages/shared/src/
  types.ts                        Category, Status, Entry, Season, LookupInfo, CATEGORY_CONFIG, UserSettings
  matching.ts                     normTitle, similarity, splitYear, stripEdition, findDuplicate
  theme.ts                        THEMES, CF_SETS, ratingColor, statusColor
packages/worker/
  wrangler.toml                   D1 binding DB, assets dir ../web/dist, vars
  migrations/0001_init.sql        users, entries, seasons, lookup_cache, imports
  src/index.ts                    Hono app, routes mounted, static assets fallback
  src/env.ts                      Env interface
  src/auth/access.ts              verifyAccess, requireUser middleware
  src/api/me.ts                   GET /api/me, PUT /api/me/username, PUT /api/me/settings
  src/api/entries.ts              entries + seasons CRUD
  src/api/import.ts               POST /api/import, DELETE /api/import/:id
  src/lookup/http.ts              fetchJson, paced
  src/lookup/cache.ts             getCached, putCached
  src/lookup/chain.ts             lookupChain, POST /api/lookup handler
  src/lookup/sources/*.ts         anilist, kitsu, tmdb, wiki, tvmaze, deezer, itunes, spotify, openlibrary, steam, igdb
  scripts/record-fixtures.ts      records real API responses into test/fixtures
  test/                           *.test.ts, fixtures/<source>/<case>.json, fakeFetch.ts
packages/web/src/
  main.tsx, App.tsx, routes.tsx
  api/client.ts                   typed fetch wrapper
  db/local.ts                     Dexie cache
  design/tokens.css, components/  design system
  screens/ListScreen.tsx, AddEntry.tsx, PickerSheet.tsx, EntryDetail.tsx, ImportScreen.tsx, SettingsScreen.tsx, AboutScreen.tsx, UsernameSetup.tsx
  import/parseWorkbook.ts         xlsx → ImportPreview
packages/web/e2e/core.spec.ts     Playwright
docs/SETUP.md                     Dan's step-by-step Cloudflare setup
```

---

### Task 0: Screen mockups (approval gate, no code)

**Deliverable:** Design artifacts for: home with a bottom tab bar (phone), the Anime list (phone cards and PC table), Add entry, the "Which one did you mean?" picker, entry details, Import preview, and Settings. Use the Midnight tokens and the Start Here copy from the Global Constraints.

- [ ] **Step 1:** Build the mockups as a Design artifact (list artifact types first; use the Design type if it's listed).
- [ ] **Step 2:** Send them to Dan and record his changes in `docs/design-notes.md`.
- [ ] **Step 3:** Don't start Task 12 until Dan approves. Tasks 1–11 may go ahead in parallel.

### Task 1: Monorepo and the `shared` matching module

**Files:** Create `package.json`, `tsconfig.base.json`, `packages/shared/{package.json,src/types.ts,src/matching.ts,src/theme.ts}`. Tests: `packages/shared/test/matching.test.ts`, `theme.test.ts`.

**Interfaces – Produces:**
- `type Category = 'anime'|'movies'|'tv'|'albums'|'songs'|'games'|'books'`
- `type SourceId = 'anilist'|'tmdb'|'wiki'|'tvmaze'|'deezer'|'itunes'|'spotify'|'openlibrary'|'steam'|'igdb'`
- `interface LookupInfo { title: string; trusted: boolean; cover: string; genres: string; creator: string; album?: string; sub?: string; source: SourceId; sourceId?: string; choices?: LookupInfo[] }`
- `interface Details { releaseDate: string /* 'YYYY-MM-DD' or 'YYYY' or '' */; synopsis: string; lengthLabel: string; origin: string }`
- `ORIGIN_LABEL: Record<Category, string>` = anime 'Format', movies 'Studio', tv 'Network', albums 'Label', songs 'Label', games 'Platforms', books 'Publisher'
- `interface Entry { id: string; userId: string; category: Category; title: string; typedTitle: string; status: Status|null; rating: number|null; genres: string; creator: string; album: string; coverUrl: string; notes: string; releaseDate: string; synopsis: string; lengthLabel: string; origin: string; detailsState: 'none'|'filled'|'needs_review'; isPrivate: boolean; notesPrivate: boolean; source: SourceId|null; sourceId: string|null; lookupState: 'ok'|'not_found'|'pending'; importId: string|null; seasonAvg: number|null; createdAt: string; updatedAt: string }`
- `interface Season { id: string; entryId: string; label: string; rating: number|null; notes: string }`
- `CATEGORY_CONFIG: Record<Category, { titleLabel: 'Title'|'Album'|'Song'; creatorLabel: 'Studio'|'Director'|'Artist'|'Author'|'Developer'|null; hasStatus: boolean; creatorIsSearchHint: boolean; square: boolean; hasSeasons: boolean }>`. Values come from the script's `TABS`: anime Studio, status, seasons; movies Director, no status; tv no creator, status, seasons; albums Artist, hint, square; songs Artist, hint, square; games Developer, status; books Author, hint, status.
- `interface UserSettings { theme: string; colors: Record<string,string>; tabs: Record<string, boolean>; compareAsk: string; compareStyle: string; compareRoom: string; compareWindow: number }` with defaults Midnight / all tabs on / 'Both' / 'Meet in the middle' / 'Use in-between scores' / 1
- `normTitle(s: string): string`, `similarity(a: string, b: string): number`, `splitYear(t: string, now?: Date): { name: string; year: string }`, `stripEdition(t: string): string`, `trimSynopsis(s: string, max: number): string`
- `findDuplicate(rows: { id: string; title: string; creator: string }[], cand: { id?: string; title: string; creator: string }, category: Category): string | null`
- `ratingColor(r: number, cf: CfSet): string`, `statusColor(s: Status, cf: CfSet): string | null`, plus `THEMES` and `CF_SETS` copied from the script.

- [ ] **Step 1: Write the failing tests** (`matching.test.ts`):
  - `normTitle('The Dark Side of the Moon') === 'dark side of the moon'`; `normTitle("JoJo's Bizarre Adventure") === 'jojos bizarre adventure'`; `normTitle('Pokémon') === 'pokémon'`; `normTitle('進撃の巨人') === '進撃の巨人'`; `normTitle('The') === 'the'`
  - `similarity('abc','abc') === 1`; `similarity('', 'x') === 0`; `similarity('frieren','frieen')` is between 0.7 and 0.75 (0.727); `similarity('進撃の巨人','進撃の巨人') === 1`
  - `splitYear('Chuck (2007)')` → `{name:'Chuck',year:'2007'}`; `splitYear('Speed Racer 2008')` → `{name:'Speed Racer',year:'2008'}`; `splitYear('Blade Runner 2049', new Date('2026-11-10'))` → `{name:'Blade Runner 2049',year:''}`
  - `stripEdition('Abbey Road (Remastered 2019)') === 'Abbey Road'`
  - `findDuplicate([{id:'1',title:'Blue',creator:'Joni Mitchell'}], {title:'Blue',creator:'Weezer'}, 'albums') === null`; same creator gives `'1'`; `{title:'Blue',creator:''}` on albums gives `null` (Review Focus 5); anime `{title:'Frieren',creator:''}` against `{id:'2',title:'Frieren',creator:'Madhouse'}` gives `'2'`
  - `theme.test.ts`: `ratingColor(1, CF_SETS.Midnight) === '#6b2a35'`, `(6) === '#6b5a22'`, `(10) === '#1f6b45'`; `ratingColor(8, …)` is a hex value strictly between mid and high. `Object.keys(THEMES)` has exactly 12 names. For every theme, the contrast ratio of Text, Bright text and Muted text against Background is at least 4.5 (write a small `contrast(a, b)` helper using the WCAG relative-luminance formula).
  - `trimSynopsis(s, 600)` cuts at the last sentence end (". ", "! ", "? ") before 600 characters and appends "…"; text under 600 is unchanged; HTML tags and entities from AniList and TVmaze are removed (`"<p>Hi &amp; bye</p>"` becomes `"Hi & bye"`).
- [ ] **Step 2:** Run `npm test -w packages/shared`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement by porting `normTitle_`, `similarity_`, `splitYear_` and `duplicateRow_` (only the comparison logic) from the script. `ratingColor` interpolates linearly between low (1), mid (6) and high (10) in RGB.
- [ ] **Step 4:** Run `npm test -w packages/shared`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): types, title matching, theme colors`.

### Task 2: Worker skeleton, D1 schema, Access sign-in

**Files:** Create `packages/worker/{wrangler.toml,migrations/0001_init.sql,src/env.ts,src/index.ts,src/auth/access.ts}`. Test: `test/auth.test.ts`.

**Interfaces – Produces:**
- `interface Env { DB: D1Database; ASSETS: Fetcher; ENVIRONMENT: 'dev'|'prod'; DEV_EMAIL?: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAIL: string; TMDB_KEY?: string; IGDB_ID?: string; IGDB_SECRET?: string }`
- `verifyAccess(req: Request, env: Env): Promise<{ email: string } | null>`, which reads the `Cf-Access-Jwt-Assertion` header and verifies it with `jose.jwtVerify` against `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, with issuer `https://${ACCESS_TEAM_DOMAIN}` and audience `ACCESS_AUD`.
- `requireUser`: Hono middleware that sets `c.var.user: { id: string; email: string; username: string|null; isAdmin: boolean; settings: UserSettings }`. It creates the user row on first sign-in, with `is_admin = (email === ADMIN_EMAIL)`, and returns 401 JSON `{error:'unauthorized'}` otherwise.
- `0001_init.sql`:
  - tables `users(id TEXT PK, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE COLLATE NOCASE, display_name TEXT, settings_json TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT)`
  - `entries(...)`, with columns matching `Entry` in snake_case plus `import_id`
  - `seasons(...)`
  - `lookup_cache(source TEXT, query_key TEXT, result_json TEXT, fetched_at TEXT, PRIMARY KEY(source, query_key))`
  - `imports(id TEXT PK, user_id TEXT, created_at TEXT, counts_json TEXT)`
  - indexes `entries(user_id, category)` and `seasons(entry_id)`

- [ ] **Step 1: Write the failing tests:**
  - `GET /api/me` with no header in prod returns 401
  - In prod with `DEV_EMAIL` set, still 401 (the bypass must not work in prod)
  - In dev with `DEV_EMAIL='dan@example.com'`, returns 200, and the user row exists with `is_admin=1` when `ADMIN_EMAIL` matches
  - A token signed by the wrong key returns 401 (generate a local key pair with jose and point the JWKS fetch at it)
  - `GET /api/health` returns 200 without auth
- [ ] **Step 2:** Run `npm test -w packages/worker`. Expected: FAIL.
- [ ] **Step 3:** Implement. Set up the vitest pool so it applies `migrations/` to the test D1. While you're here, check D1's bound-parameter and queries-per-invocation limits in the docs and put the confirmed values at the top of `env.ts` as `D1_MAX_PARAMS` and `D1_MAX_QUERIES`.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker): skeleton, schema, Access auth`.

### Task 3: Me API (profile, username, settings)

**Files:** `src/api/me.ts`, `test/me.test.ts`. **Consumes:** `requireUser`. **Produces:** `GET /api/me → { id, email, username, isAdmin, settings }`; `PUT /api/me/username {username} → 200 | 400 {error:'invalid'} | 409 {error:'taken'}`; `PUT /api/me/settings {settings: Partial<UserSettings>} → merged settings`.

- [ ] **Step 1: Write the failing tests:**
  - username `'dan_r'` → 200
  - `'Dan_R'` for a second user → 409 (case-insensitive)
  - `'ab'`, `'has space'` and `'émoji😀'` → 400 (rule `^[a-z0-9_]{3,20}$` after lowercasing)
  - partial settings merge keeps the other keys
  - unknown settings keys are dropped
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 4: Entries and seasons API

**Files:** `src/api/entries.ts`, `test/entries.test.ts`. **Consumes:** `findDuplicate`, `requireUser`.

**Produces:**
- `GET /api/entries?category=anime → Entry[]` (own entries only; `seasonAvg` is the average of non-null season ratings rounded to 2 decimals, or null)
- `POST /api/entries {category,title,…} → 201 { entry: Entry, duplicateOf: string|null }`
- `PATCH /api/entries/:id → Entry`
- `DELETE /api/entries/:id → 204`
- `GET|POST /api/entries/:id/seasons`
- `PATCH|DELETE /api/seasons/:id`
- Renaming an entry's title also renames nothing in seasons, because seasons point at `entry_id` (a deliberate improvement over the script's title-based link).
- `GET /api/export → { entries: Entry[], seasons: Season[], settings }` as a JSON download (the spec's "Export my data"; CSV comes in Phase 3).

- [ ] **Step 1: Write the failing tests:**
  - Create, then list. `rating` must be null or 0–10 with at most 2 decimals, otherwise 400. `status` must be null or one of the six values, otherwise 400, and must be null for categories where `hasStatus` is false.
  - Another user's `PATCH`/`DELETE`/`GET seasons` on your entry returns **404** (doesn't reveal that it exists).
  - A duplicate album with the same title and creator still saves, with `duplicateOf` set.
  - `seasonAvg` with seasons rated 8, 9 and null is 8.5.
  - Deleting an entry deletes its seasons.
  - `GET /api/export` returns only your own entries and never includes secrets.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: Lookup infrastructure (HTTP, pacing, cache, chain, endpoint)

**Files:** `src/lookup/{http.ts,cache.ts,chain.ts}`, `test/fakeFetch.ts`, `test/chain.test.ts`.

**Produces:**
- `interface LookupQuery { term: string; typedTitle: string; hint: string }`
- `interface LookupDeps { fetch: typeof fetch; env: Env; log?: string[] }`
- `type SourceFn = (q: LookupQuery, d: LookupDeps) => Promise<LookupInfo | null>`
- `fetchJson<T>(url: string, init: RequestInit, d: LookupDeps, opts?: { timeoutMs?: number /*8000*/ }): Promise<{ status: number; body: T | null }>`. It never throws: a timeout, a network error or a JSON error comes back as `{status: 0, body: null}` and is logged.
- `paced(source: SourceId, minGapMs: number, fn: () => Promise<T>): Promise<T>` (per isolate)
- `getCached(db, source, key): Promise<LookupInfo|null>` (time to live 30 days), `putCached(db, source, key, info)`
- `lookupChain(category: Category, q: LookupQuery, d: LookupDeps): Promise<LookupInfo | null>`. A Spotify album or track link is checked first in every category. Otherwise the chains are exactly the script's `lookup_`. Sources that need a key are skipped when the key isn't set.
- `POST /api/lookup {category, term, typedTitle, hint, debug?} → { info: LookupInfo|null, log?: string[] }`. `log` is returned only when `debug` is set and the user is an admin.
- `fakeFetch(map: Record<string, string /*fixture path*/ | number /*status*/>): typeof fetch`, which matches URLs by prefix.
- `type DetailsFn = (sourceId: string, d: LookupDeps) => Promise<Details | null>`. Each source registers `{ search: SourceFn, details?: DetailsFn }` in `SOURCES`; a source with no `details` returns what its search result already carries (e.g. Steam and iTunes put the release date in the search response).
- `POST /api/lookup/details {source, sourceId} → { details: Details | null }`, cached in `lookup_cache` under key `details:<sourceId>`. It's called once for the chosen result, never for every choice.

- [ ] **Step 1: Write the failing tests** using stub `SourceFn`s registered for the test:
  - Movies: TMDB returns 500, then wiki returns info → the result is wiki's (Review Focus 4)
  - A source that takes longer than the timeout → the chain moves on, and the log has `"timeout"`
  - The second identical lookup is served from `lookup_cache` with no fetch calls
  - No `TMDB_KEY` → TMDB is never called
  - A non-admin `debug:true` gets no `log`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Sources are registered in a `SOURCES` map so Tasks 6–11 just fill it in.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

**Fixture recording (used by Tasks 6–11):** `scripts/record-fixtures.ts <source> <case> <url…>` saves real responses to `test/fixtures/<source>/<case>/<n>.json` along with a URL index. It needs network access and keys, so run it on Dan's PC or in a session that has network access. Commit the fixtures, and never commit a secret: the script removes `api_key` and `Authorization` before saving.

### Tasks 6–11: Source adapters

The same cycle applies to each one: record fixtures, write failing tests against `fakeFetch`, port the matching function from the script, run the tests until they pass, then commit. Each adapter is a `SourceFn` and is registered in `SOURCES`. Each test asserts the exact `title`, `creator`, a `cover` URL prefix, whether `choices` is present, and its length bounds.

Each task also implements that source's `DetailsFn` and tests it against a recorded fixture, asserting all four `Details` fields (an empty string where the spec §5.1 table says "none"):
- **6, AniList:** `releaseDate` from `startDate` (Frieren → `'2023-09-29'`); `lengthLabel` like `'28 ep · 24 min'`; `origin` like `'TV · Fall 2023'`; `synopsis` HTML stripped.
- **7, TMDB:** `/movie/{id}` gives `release_date`, `overview`, `runtime` → `'1 h 15 min'` / `'2 h 17 min'` format, and `production_companies` (first 2). **Wiki fallback:** Wikidata P577 (publication date) and P2047 (duration), with the synopsis from the article intro (`prop=extracts&exintro&explaintext&exsentences=3`).
- **8, TVmaze:** `premiered`, `summary` (stripped), `lengthLabel` `'<averageRuntime> min episodes · <status>'`, `origin` from `network.name` or `webChannel.name`.
- **9, Deezer:** album `release_date`, `label`, `nb_tracks` plus `duration` → `'10 tracks · 43 min'`; song length as `'m:ss'`. **iTunes:** `releaseDate` and `trackCount`.
- **10, Open Library:** `first_publish_year` → `'YYYY'`; `number_of_pages_median` → `'432 pages'`; the first `publisher`; `synopsis` from `/works/{key}.json` `description` (a string, or an object's `.value`).
- **11, IGDB:** add `summary,first_release_date,platforms.abbreviation` to the search fields, so no extra call is needed; `origin` from platform abbreviations joined with `', '` (up to 4); `lengthLabel` `''`. **Steam:** `release_date.date`, `short_description`, platforms from `appdetails`.

| Task | Files (`src/lookup/sources/`) | Port from the script | Required fixture cases and assertions |
|---|---|---|---|
| 6 | `anilist.ts`, `kitsu.ts` | `anime_`, `anilistCandidates_`, `scoreInto_`, `toInfo_`, `describe_`, `kitsuTitle_` | "frieren" → title contains "Frieren", creator "Madhouse"; "jojos bizzare" (typo) → JoJo with `choices` that include other entries in the series; 429 on the first call → retried once after Retry-After, no 61 s sleep |
| 7 | `tmdb.ts`, `wiki.ts` | `tmdbFetch_`, `tmdbMovie_`, `wikiSearch_`, `wiki_`, `wikidataFacts_` | "Speed Racer 2008" → the 2008 film, director contains "Wachowski"; TMDB key longer than 40 chars → Bearer header used; no key → wiki result for "speed racer" |
| 8 | `tvmaze.ts` | `tvmaze_` | "Chuck (2007)" → the Chuck premiered in 2007 ranked first |
| 9 | `deezer.ts`, `itunes.ts`, `spotify.ts` | `deezer_`, `deezerTrack_`, `itunes_`, `itunesInfo_`, `spotifyAlbum_`, `spotifyTrack_` | album "dark side of the moon" + hint "pink floyd" → creator "Pink Floyd", not a single; Clairo "Live at Electric Lady" Spotify link `https://open.spotify.com/intl-de/album/<id>?si=abc` → title "Live At Electric Lady", creator "Clairo" (Review Focus 2); Deezer 0 results → iTunes result |
| 10 | `openlibrary.ts` | `openLibrary_`, `BOOK_GENRES` | "We Are Legion (We Are Bob)" + hint "Dennis E. Taylor" → creator contains "Dennis E. Taylor", genres include "Science Fiction"; sends the `User-Agent` header |
| 11 | `igdb.ts`, `steam.ts` (games chain: igdb → steam → wiki) | `igdbToken_`, `igdbFetch_`, `igdb_`, `steam_` | "breath of the wild" → a Nintendo platform in `sub`, cover from `images.igdb.com`; a 401 response → token refreshed once and retried; IGDB token cached in `lookup_cache` under source `igdb`, key `__token`; "portal 2" with IGDB off → Steam result, with a fallback to `header.jpg` when the 600x900 art is missing (fixture returns 404) |

Commit after each task: `feat(lookup): <source> adapter`.

### Task 12: Web app shell and design system (blocked by Task 0)

**Files:** `packages/web/{vite.config.ts,index.html,src/main.tsx,src/App.tsx,src/routes.tsx,src/api/client.ts,src/db/local.ts,src/design/tokens.css,src/design/components/*}`, `src/screens/{UsernameSetup,SettingsScreen,AboutScreen}.tsx`. Tests: `src/**/*.test.tsx` (Vitest + Testing Library).

**Interfaces – Produces:**
- `api.get<T>(path)`, `api.post<T>(path, body)`, `api.patch<T>`, `api.del`. Requests use `credentials: 'include'`. On a 401, do a full-page reload to `/` so Access shows its sign-in.
- `localDb` (Dexie) with tables `entries` (keyed by `id`, indexed by `[category+rating]`) and `me`.
- `useEntries(category)`: TanStack Query, seeded from `localDb`, writing successful results back to `localDb`.
- Design tokens are CSS variables for the 10 color roles plus the CF set. `applyTheme(settings)` sets them on `:root`.
- Components: `Button`, `IconButton`, `Sheet` (bottom sheet on phone, dialog on PC), `CoverImage` (2:3 or square, with a fallback), `RatingBadge` (uses `ratingColor`), `StatusPill`, `Skeleton`, `EmptyState`, `Toast`, `BottomTabs`.
- Routes: `/` → redirect to the first enabled tab; `/list/:category`; `/entry/:id`; `/import`; `/settings`; `/about`; `/setup/username`, shown first while `me.username` is null.
- PWA: manifest name "Media Tracker", `theme_color` set to the Midnight Background, a 512 px icon; the service worker precaches the app shell; never cache `/api/*`.

- [ ] **Step 1: Write the failing tests:**
  - `applyTheme` with Midnight sets `--bg` to `#1b1b25`
  - `UsernameSetup` shows the server's "taken" message from a mocked 409
  - About renders both attribution lines and "WELCOME TO MEDIA TRACKER" exactly
  - Turning a tab off in Settings removes it from `BottomTabs`
  - All interactive components have an accessible name (use `getByRole` queries)
- [ ] **Step 2:** Run `npm test -w packages/web`. Expected: FAIL.
- [ ] **Step 3:** Implement to match the approved mockups. Tap targets must be at least 44 px. Turn off motion under `prefers-reduced-motion`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npm run build -w packages/web`, which must succeed.
- [ ] **Step 5:** Commit.

### Task 13: Lists, adding entries, the picker, entry details

**Files:** `src/screens/{ListScreen,AddEntry,PickerSheet,EntryDetail}.tsx`, `src/hooks/useAddEntry.ts`, plus tests.

**Consumes:** `POST /api/lookup`, the entries API, `CATEGORY_CONFIG`, `findDuplicate`.

**Produces:** `useAddEntry(category) → { add(input: { title: string; creator?: string }): Promise<void>; state: 'idle'|'looking'|'choose'|'saved'; choices: LookupInfo[] }`

Add flow:
1. Save the entry right away with `lookupState: 'pending'`. It shows in the list instantly with a skeleton cover.
2. Run the lookup. The search term is the title plus the creator when `creatorIsSearchHint` is true.
3. One match: PATCH the entry with the result and `lookupState: 'ok'`. Replace the title only if `trusted` is true or `similarity(normTitle(typed), normTitle(official)) >= 0.5`, which is the rule from the script's `fixTitle_`.
4. Several matches: open the `PickerSheet` showing the closest match first, with a search box that runs the lookup again.
5. No match, or an error: `lookupState: 'not_found'`, and the row shows "Couldn't find it" with **Retry** and **Paste image link** (Review Focus 4).
6. Duplicate: a toast like "Already on your Albums list".
7. After a result is applied (automatically or from the picker), call `/api/lookup/details` for it and PATCH the four detail fields with `detailsState: 'filled'`. A failure here leaves the fields empty and changes nothing else.

List sorting: rating, highest first, with unrated at the bottom, then by title (the default). Release date (newest first, undated last) and title are also offered. The list shows as cards on screens under 768 px and as a table with inline editing of rating, status and notes on wider screens.

Entry details: large cover; a meta line with release year, length and origin, using `ORIGIN_LABEL` for the label; the synopsis, trimmed with "More"; all fields editable, seasons editor (anime and tv), **Re-fetch** with an optional search term (overwrites the fields that came from the lookup, as the script's re-fetch does), private toggles (they're stored now and enforced in Phase 4), delete with confirmation.

- [ ] **Step 1: Write the failing tests** (mocked API):
  - Adding "Frieren" with one result fills the cover and creator
  - Adding with 3 choices opens the picker, and choosing the 2nd saves the 2nd's title
  - A lookup that rejects leaves the entry saved with "Couldn't find it" and Retry visible
  - The list order for ratings `[null, 7, 9.5, 7]` with titles `[A, C, B, D]` is `9.5 B, 7 C, 7 D, null A`
  - Typing "jjba" with an untrusted official title "JoJo's Bizarre Adventure" (similarity under 0.5) keeps "jjba"
  - After picking a match, the details call fills release date, length, origin and synopsis; if the details call fails, the entry keeps its cover and title and shows no error
  - Sorting by release date puts `'2023-09-29'` before `'1998'`, and undated entries last
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 14: Import from the Sheet

**Files:** `packages/web/src/import/parseWorkbook.ts`, `src/screens/ImportScreen.tsx`, `packages/worker/src/api/import.ts`, tests in both packages, plus `packages/web/test/fixtures/sample-tracker.xlsx` (built by a test helper from the template's real headers, including the messy cases below).

**Interfaces:**
- `parseWorkbook(buf: ArrayBuffer): ImportPreview`
- `interface ImportRow { category: Category; title: string; status: Status|null; rating: number|null; genres: string; creator: string; album: string; coverUrl: string; notes: string; seasons?: { label: string; rating: number|null; notes: string }[] }`
- `interface ImportPreview { rows: ImportRow[]; counts: Partial<Record<Category, number>>; skipped: { tab: string; row: number; reason: string }[]; warnings: { tab: string; row: number; message: string }[]; settings: Partial<UserSettings> | null }`
- Tabs are identified by their header row, not their name. Exact header sets:
  - **Anime:** Title + Studio
  - **Movies:** Title + Director
  - **TV:** Title + Status + Season Avg with no creator column
  - **Albums:** Album + Artist without Song
  - **Songs:** Song + Artist
  - **Games:** Title + Developer
  - **Books:** Title + Author
  - **Anime Seasons:** Anime + Season
  - **TV Seasons:** Show + Season
  - **Settings:** labels in column B, read the way the script's `readSettings_` does
- Read the cover from the **"Cover URL"** column, never from a column with an `=IMAGE()` formula. Season rows attach to their show by `normTitle` match; unmatched season rows go into `skipped` with the reason "no matching show".
- Rating parsing: numbers as-is; text values with "," as the decimal point are converted; a value outside 0–10 or not a number sets the rating to null and adds a warning (the row still imports).
- Server: `POST /api/import { importId: string, rows: ImportRow[] }`. The client sends rows in chunks so each request stays within `D1_MAX_QUERIES` / `D1_MAX_PARAMS` (from Task 2), all under one `importId`. Returns `{ inserted }`. `DELETE /api/import/:id` deletes every entry and its seasons with that `import_id`, for that user only. Imports create no feed records (the feed tables don't exist yet; the rule is noted for Phase 4).

- [ ] **Step 1: Write the failing tests:**
  - The sample workbook gives the expected counts per category
  - Blank rows are ignored silently
  - A rating of "8,5" becomes 8.5
  - A rating of 11 imports with a warning and a null rating
  - A renamed "My Anime" tab is still detected as anime
  - A hidden tab still imports
  - `coverUrl` comes from Cover URL, not the IMAGE column
  - The Settings theme "Ocean" comes through
  - Server: an import of 600 rows across chunks inserts 600; undo removes exactly those, and another user's DELETE of the importId returns 404
- [ ] **Step 2:** Run the tests in both packages. Expected: FAIL.
- [ ] **Step 3:** Implement. The Import screen flow is: choose file → preview (counts, plus skipped and warning lists you can expand) → Import → progress → done, with an Undo button.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 15: Fill in details for imported titles

**Files:** `packages/web/src/backfill/backfill.ts`, `src/backfill/useBackfill.ts`, a progress row in `SettingsScreen.tsx`, a prompt on the Import "done" screen, plus tests.

**Interfaces:**
- **Consumes:** `POST /api/lookup`, `POST /api/lookup/details`, `PATCH /api/entries/:id`, `similarity`, `normTitle`.
- **Produces:**
  - `backfillOne(entry: Entry, deps: { lookup; details; patch }): Promise<'filled'|'needs_review'|'skipped'>`
  - `useBackfill(): { running: boolean; done: number; total: number; start(): void; stop(): void }`, which processes entries with `detailsState === 'none'`, one every 1500 ms, only while the app is open, and resumes where it left off next time.

Rules: never write to `title`, `rating`, `creator`, `notes`, `coverUrl` or `status`. Fill only the four detail fields, and only empty ones. Apply a result only when `similarity(normTitle(entry.title), normTitle(result.title)) >= 0.9` and, when the entry has a creator, `similarity(normTitle(creator), normTitle(result.creator)) >= 0.8`. Otherwise set `detailsState: 'needs_review'`; those entries show a "Pick the right match" button that opens the normal picker.

- [ ] **Step 1: Write the failing tests:**
  - An exact title and creator match → `'filled'`, and only the four detail fields are in the PATCH body
  - "Blue" by Joni Mitchell where the result is "Blue" by Weezer → `'needs_review'`
  - An entry whose `synopsis` is already set keeps it
  - A lookup error → `'skipped'`, and `detailsState` stays `'none'` so it's retried later
  - `stop()` halts after the current item
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 16: Deploy, setup guide, end-to-end smoke test

**Files:** `docs/SETUP.md`, `packages/worker/wrangler.toml` (prod values), `packages/web/e2e/core.spec.ts`, `playwright.config.ts` (devices "Pixel 7" and "Desktop Chrome").

- [ ] **Step 1: Write the end-to-end test** against `wrangler dev` with `ENVIRONMENT=dev` and `LOOKUP_FAKE=1`, which makes `/api/lookup` use the fixtures:
  - first visit → username setup → Anime tab empty state → add "Frieren" → card appears with cover → open the entry → set rating 9.5 → back → the badge shows 9.5
  - import `sample-tracker.xlsx` → the counts shown match the preview
  - runs on both device profiles
- [ ] **Step 2:** Run `npx playwright test`. Expected: FAIL until the wiring is done, then PASS.
- [ ] **Step 3: Write `docs/SETUP.md`** for Dan as numbered click-by-click steps:
  1. Create a Cloudflare account.
  2. Install Node LTS.
  3. `npm ci`
  4. `npx wrangler login`
  5. `npx wrangler d1 create media-tracker`, then paste the ID into `wrangler.toml`
  6. `npx wrangler d1 migrations apply media-tracker --remote`
  7. `npx wrangler secret put TMDB_KEY` / `IGDB_ID` / `IGDB_SECRET`
  8. `npm run deploy`
  9. In Zero Trust, add a self-hosted Access application for the workers.dev address, with a policy that allows only Dan's email. Copy the Application Audience (AUD) tag and the team domain into `wrangler.toml` vars, set `ADMIN_EMAIL`, and deploy again.
  10. Open the address on PC and Android, sign in, and install the app.
  11. Download the Sheet as .xlsx and import it.

  Include what success looks like after each step, and the three most likely errors with their fixes.
- [ ] **Step 4:** Dan runs SETUP.md. **Acceptance:**
  - The app installs on Windows (Edge or Chrome) and Android (Chrome).
  - A signed-out browser and an unapproved email both see only the Access page.
  - The import matches the Sheet's row counts.
  - Adding one title from each category fills it in correctly.
  - Lookups work on the deployed Worker, including IGDB.
- [ ] **Step 5:** Commit and tag `v0.2.0`.

---

## Later plans (not in this one)

- **Phase 3:** Compare (port plus golden tests against the script's outputs), Top 5, Stats, theme picker and custom colors, the offline write queue (spec §7; Phase 2 caches reads only), CSV export, and the admin source-health page.
- **Phase 4:** Social, privacy enforcement, admin invites through the Cloudflare API, feed.
- **Phase 5:** iPhone sign-in check and the possible `auth` module swap.
- **Phase 6:** Push notifications.
