# Polish backlog

Minor items that were noticed and deliberately not fixed (lean mode, 2026-11-16). None is a known bug. Items that were later done, or that went away with the old Sheet compare, are left out.

## Profile and photo
- Log out: each step has its own 2 s timeout, so the worst case is about 12 s; add one overall deadline.

## Share cards
- `fitText` cuts by character, so it can split an emoji or combined character; cut by grapheme (`Intl.Segmenter`).
- `ShareSheet`'s `share()` has no `catch`: a share that throws something other than the user cancelling is unhandled.
- No regression test that the cover scrim keeps card text at 4.5:1.

## Navigation and shell
- `useExportData` lives in `screens/settings/ExportRow.tsx` but the side nav imports it; move it to `data/`.
- No test for the layout at the phone/PC resize boundary (the bottom bar and Lists button swapping for the side nav).
- A divider in the side nav, and a token comment, were left as they were.
- Preload Inter 500 to avoid a font swap on first paint.

## Search
- The 150 ms search debounce is not flushed when the screen unmounts, so a fast tap away can drop the last keystrokes from the URL.
- Pressing "/" inside a text input (should type, not focus the filter box) is untested.

## Activity
- Season ratings (Anime Seasons, TV Seasons) never reach the feed, from a save, a PATCH or a create, because activity rows name entries.
- A ratings save compares the stored `rating`, which is the shown score at one or two decimals, not the rounded text (8.24 → 8.74 counts as a 0.5 move).

## Stats and lists
- Retry briefly shows the full skeleton (TanStack's pending state).
- The ListCard's average `dl` row is inconsistent with the other rows (it is left out when there is no average, while Stats shows a dash).

## Settings
- A Custom theme gives no warning when the label colour is hard to read on Highlight.
- The disabled Export row loses keyboard focus while exporting.

## Data layer and tests
- `writeEntry` → `useAllEntries` cache update is not tested.
- `packages/shared/tsconfig.json` has `types: ["node"]`, which also applies to `src` (meant for tests only).

## Phase 4 / 4b (social, own sign-in)
- No e2e test yet for the full social flow (sign up → approve → add friend → react/comment → Add to mine); unit/API tests cover each piece.
- `GET /api/admin` has no spyD1 query-count assertion.
- Raise PBKDF2 rounds (30,000 now, for the Workers Free CPU budget) if the plan becomes Paid; verification already accepts 10k–100k; consider rehash-on-login.
- An ex-friend can't see or delete their own old comments on your posts (whole thread hidden).
- Feed says "marked Elden Ring Playing" where the wireframe says "started"; no "last seen" divider; unread isn't refetched after a reaction; feed avatars use a small local component instead of `Avatar`.
- Friend profile has no back button on PC; Compare lists have no paging; group Top 5 rows don't link (no ids); friend Stats tab omits histogram and tier lines; exact `@name` search isn't offered when it isn't a prefix match.
- Add to mine (from Compare) stays on the list instead of opening the new entry (deliberate, for adding several).
- Sign-in: default to the Sign in tab on devices that signed in before; rate-limit countdown; keep the username after a failed sign-in; in-app Change password; "Done" on the reset-link card.
- No requests dot on the PC side-nav profile row.

## Reported by Dan (2026-11-16)
- ~~Entry detail on phone: Rating and Status tiles squished~~ — fixed: stacked below 640px.
- **Checked:** the Phase 4 server folds 6 re-rates into one post (test `rerate.test.ts`); likely seen on the older version. Recheck after deploying Phase 4. Original report: re-rating Invincible several times before settling on 9.6 made 5–6 Activity posts. Edits to one title within 10 minutes should fold into one post (S5). Check which version was deployed and which path wrote the rows (detail PATCH, slider, or a Compare save).

## Phase 5
- Profile and Stats still show Loved/Liked counts (derived from the typed number) though tiers left the rest of the UI; replace with number bands or remove.
- e2e: the first-run walkthrough once covered the Add button on Pixel 7 (passed on rerun); make the helper wait for and dismiss it reliably.
- Titles fitted under Phase 3c get their typed number from the fitted value (a 10 may show 9.97); Dan can retype.
- Sharpen on PC is only in Settings; add it to the side nav.
- Home: tap Home on a list to scroll to top; Add-to could remember the last list; Activity's + opens the sheet in place.
- Imported planned titles have no Plan to watch position until first reorder (listed last by date added).
