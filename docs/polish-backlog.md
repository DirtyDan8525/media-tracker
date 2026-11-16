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
