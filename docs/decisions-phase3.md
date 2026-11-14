# Phase 3 build decisions

Judgement calls made while building Phase 3 (Ratings), with what each costs if wrong. The plan's own rulings (P1–P15) are in `docs/plans/2026-11-13-phase3-ratings.md`; this file records the values and calls made while building.

## Theme colours (Task 9)

Method for every value below (Rulings P10 and P15): convert the script's hex to HLS, lower only the lightness in steps of 0.0001 until the colour reaches 4.5:1 against both the theme's Background and its Cards, and round each channel to the nearest 0–255 value. Steps of 0.00002 and 0.00001 give the same three hex values, so they are the smallest such darkening. Coarser steps are not safe: steps of 0.001 and 0.0005 jump past Sakura's `#ce2e68` straight to `#ce2d68`, which is one byte of green darker. That was the first value pinned, and the review caught it. Hue and saturation are unchanged.

| Theme | Role | Script value | New value | On Background | On Cards |
|---|---|---|---|---|---|
| Sakura | Muted text (P10, supersedes R1's `#8b6a77`) | `#8d6b78` | `#876773` | 4.72:1 | 4.51:1 |
| Light | Highlight (P15) | `#b7791f` | `#9b671a` | 4.83:1 | 4.52:1 |
| Sakura | Highlight (P15) | `#d6457a` | `#ce2e68` | 4.73:1 | 4.51:1 |

- Every other theme's Highlight already reached 4.5:1 on Background and Cards, so none changed. The lowest are Matcha (4.84 / 4.66), Arctic (5.37 / 5.27) and Sand (5.50 / 5.27). The shared theme test checks all 12.
- After P15, the primary-button label (`--on-highlight`: whichever of Header row, Background or Bright text reads best on Highlight) reaches 4.5:1 on Highlight in all 12 themes. Before the change Sakura was 3.99:1. The lowest are now Sakura at 4.73:1 (Background `#fff7f9`) and Light at 4.83:1. Light's label changes from Bright text `#111216` to Background `#ffffff`, because white reads better on the darker gold. The web theme test checks all 12.
- `--on-highlight-small` now equals `--on-highlight` in all 12 built-in themes. It stays because a Custom Highlight can still need the black/white fallback, and a test covers that case. Cost if wrong: none.
- Ruling (Task 9): a contrast warning's ratio is rounded **down** to one decimal, so 4.47:1 reads "4.4:1; aim for 4.5:1" rather than "4.5:1; aim for 4.5:1". Cost if wrong: one function.

## Rulings from the plan (P1–P15)

Full wording and reasoning are in `docs/plans/2026-11-13-phase3-ratings.md`. Where building changed one, the final value is in the next section.

- P1: No approved mockups existed for the new screens, so the calm v2 boards Dan approved on 2026-11-14 are the reference for every UI task; Search and filter follow the earlier approved boards.
- P2: Item identity is the entry id; rated items sort by rating (high first), then title (`Intl.Collator`, base sensitivity), then id.
- P3: The compare queue is the `compare_queue` table (migration `0002_compare_queue.sql`). The Worker enqueues a hand-typed rating on create and edit when Ask is Both or Only for new ratings, and keeps the 50 most recent. Import, seasons and Compare saves never enqueue.
- P4: Queue items in a turned-off list are skipped (left queued) and not counted in the banner.
- P5: Swiping on a phone picks the side you swipe toward.
- P6: The "N new ratings to double-check" banner shows at the top of every list screen.
- P7: Top 5 and Stats show enabled lists only, in nav order; "All media" totals the enabled lists.
- P8: Stats "Completed" shows "—" for lists without a Status column (Movies, Albums, Songs).
- P9: Compare copy is the script's, with "Tap it." on phones and "Settings tab" replaced by "Settings".
- P10: Sakura Muted text is `#876773` (supersedes R1's `#8b6a77`).
- P11: A Custom theme saves even when its colours fail contrast; the editor warns per failing role.
- P12: Display name and invite link wait for Phase 4.
- P13: Search matches title, typed title, creator, album and genres, ignoring case and accents; every word must appear. Search and filters live in the URL (`?q=&status=&genre=`).
- P14: Compare Save writes every change in one `UPDATE` with the changes as a single JSON parameter (always 3 bound parameters). The per-request limit was changed to 1000 (see below).
- P15: Highlight is darkened on Light (`#9b671a`) and Sakura (`#ce2e68`) to reach 4.5:1 on Background and Cards (details under Theme colours).

## Decisions made during the build

- Dan's answers, 2026-11-13: "Export my data" is in Phase 3 (Task 13); the offline write queue and the admin source-health/diagnose pages stay deferred. The Light and Sakura Highlight darkening is P15. Mockups were "bland", so the calm v2 boards replaced the first ones and a style-refresh task (Task 14) for the Phase 1–2 screens ran before the new screens.
- Tie ruling (Task 2): a run only passes rated items as the tie, and `score.ts` documents it. Cost if wrong: one guard.
- The shared package is now covered by `npm run typecheck` (Task 2, with DOM types in its tsconfig for `lookup/http.ts`). Cost if wrong: a small config change.
- `COMPARE_SAVE_MAX_CHANGES` is **1000**, not 2000 (Task 4): about 55 KB of JSON, safely under D1's documented 100 KB statement limit. Whether bound values count toward that limit is unverified. Cost if wrong: more chunks, nothing else. The client splits a larger save into requests of at most 1000 changes.
- The client omits `doneEntryId` rather than sending `null`.
- Stop is never recorded: Back after Stop lands on the last real pick, and the effect of Stop on the rest of the queue stays (the script empties its queue for good). The "waiting" count after Stop reads the session, not a stale value.
- Top 5 and Stats are derived on the device from the cached entries.
- Stats distribution uses **floor buckets**: 9.0–9.9 counts as 9, and 10.0 as 10, so the chart reads as "9s". Cost if wrong: one line.
- Phone Stats follows the approved board's compact per-list cards (no sideways-scrolling table); PC keeps the table.
- If one list fails to load, Top 5 and Stats show the lists that did load, with an inline Retry notice. Stats genres show the top 10 with "Show all".
- Where the approved calm boards and a first build disagreed (banner border, cover stack, count pill, Settings layout), the boards won.
- Settings has a separate **Appearance** sub-page (`/settings/appearance`: theme picker, Custom colours, Comparing options), reached from both More and Settings.
- **Export my data** is on both More and Settings (harmless duplicate, same action).
- Checkbox borders use Muted text for 3:1 or better against the surface; AA is binding per spec §6, so this was not Dan's call. Cost if wrong: one CSS value.
- Search (Task 11): Dan asked for it explicitly, so review minors were fixed in the build: input kept in local state, native clear button, Latin-only accent folding, invalid URL params ignored, focus handling and tests.
- **Anime lookups run on the device, with Kitsu as the server backup.** AniList blocks Cloudflare's IPs, so the browser calls AniList (using the shared adapter) and the Worker's chain falls back to Kitsu when the device finds nothing. Cost if wrong: anime lookups lose AniList when the device is offline.
- End-to-end tests (Task 12): the compare test reads the starting count from `/api/compare/queue` and expects that count plus 3 after adding three rated anime, so it does not depend on what earlier tests left waiting. The tests still run in order (serial mode). "Stop and review" followed by "Don't save" is tested by calling the lower-rated of the pair better, so the review has a change to discard. The dev shortcuts `DEV_EMAIL` and `LOOKUP_FAKE` are passed on the command line (`--var`) by `e2e/serve.mjs` for the e2e run, and for local development they live in the gitignored `packages/worker/.dev.vars` (copied from `.dev.vars.example`), never in `wrangler.toml`. The Worker honours them only when `ENVIRONMENT` is `dev`.
- Parked, not built: a warning for a Custom label colour that is hard to read on Highlight; the Retry button briefly showing the full skeleton; no flush of the search debounce on unmount.
