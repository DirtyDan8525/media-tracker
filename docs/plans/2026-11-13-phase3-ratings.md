# Media Tracker App, Phase 3 (Ratings): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dan can fix his ratings with Compare (a direct port of the Sheet's "Compare ratings" dialog), see Top 5 and Stats, choose any of the 12 themes or a Custom one, set the compare options, and search and filter every list.

**Architecture:** The compare engine is pure TypeScript in `packages/shared/src/compare/` (it runs on the device; nothing in the Worker imports it). Its runs are generators that yield questions and receive answers, so Back is the script's replay: rerun from the start, feeding every answer but the last. A test helper loads the real `COMPARE_HTML` code out of `reference/MediaTrackerCovers.gs` into a `node:vm` context and drives both implementations with the same answers; the tests require identical questions and identical new ratings. The Worker adds a `compare_queue` table, enqueues hand-typed ratings, and saves a whole review in one `UPDATE` whatever its size. Top 5, Stats and search are derived on the device from the cached entries.

**Tech Stack:** As Phases 1–2 (TypeScript, Hono, Cloudflare Workers + D1, React, React Router, TanStack Query, Dexie, Vitest, Testing Library, Playwright). `node:vm` in tests only. No new runtime dependencies.

**Spec:** `docs/specs/media-tracker-app-spec.md` (§5.2, §5.3, §5.6, §9 item 3). Also binding: `docs/decisions-phase1-2.md` (R1–R52), `docs/design-notes.md`, the approved mockups in `docs/design/mockups/`, and the script being ported, `reference/MediaTrackerCovers.gs` v2026-11-06i (compare code at lines 1786–2168).

## Global Constraints

- npm commands run as `npx -y npm@11 …` (R7: npm 10 crashes on this tree).
- D1 free plan: at most 100 bound parameters per statement and 50 queries per Worker invocation; every statement inside `db.batch()` counts toward the 50 (R6, `packages/shared/src/importLimits.ts`).
- Compare is a direct port: same questions in the same order, same new ratings, as the script for the same answers. Port float comparisons exactly as written (`y.rating - x.rating > window`, `Math.abs(o.rating - me.rating) <= window`, `Math.round(x * U)`); never add an epsilon or "fix" a rounding.
- Compare option values are the existing `COMPARE_ASK`, `COMPARE_STYLE`, `COMPARE_ROOM` constants; `compareWindow` is a finite number with 0 < n ≤ 10 (R10).
- Nothing Compare changes is saved until the person presses **Save new ratings**. Leaving the screen discards the session.
- Ratings display through `formatRating` (one decimal minimum, two maximum).
- Themes: the 12 names and hex values in `packages/shared/src/theme.ts` stay exactly as they are, except Sakura's Muted text (Ruling P10). Every theme's Text, Bright text and Muted text pass 4.5:1 on Background **and on Cards**. New screens put body or muted text only on Background or Cards, never on Panels or Header row.
- Tap targets ≥ 44 px; every new control has an accessible name; transitions respect `prefers-reduced-motion`; every empty, loading and error state has friendly text and a next step (spec §6).
- Bottom bar stays "first 4 enabled lists + More" (R8). New screens are reached from More on phones and the side nav on PC.
- Out of scope: Phase 4 social (friends, feed, invite link, display name), Phase 5 iPhone, push.

## Review Focus

1. **Floating-point edges and two-decimal lists.** A window of exactly 1 with ratings like 9.9 / 8.9, lists that mix 8.25 with 9.0 (hundredths mode), and runs of equal ratings must give the script's results, not "nicer" ones. Pinned by the randomized differential tests in Tasks 1–2.
2. **Back after Stop, and Back from the review screen.** Back must land on the last real pick (Stop is never recorded) and a Stop's effect on the rest of the queue stays (the script empties `S.queue` for good). Test in Task 2.
3. **The list changes under an open session** (an entry deleted or unrated on the phone while the PC compares). Save ignores ids that no longer exist or aren't yours and the response refreshes the cache; a queued entry that has vanished is skipped. Tests in Tasks 3 and 5.
4. **A big list hits D1's limits.** A full pass on a 400-title list can rescore hundreds of ratings; one Save of 1,500 changes must succeed in ≤ 6 queries. Test in Task 3.
5. **Search text that isn't plain ASCII.** "pokemon" finds "Pokémon", "  frieren " finds "Frieren", "進撃" finds "進撃の巨人", "ac/dc" doesn't throw. Test in Task 11.

## Rulings

- Ruling P1: No approved mockups exist for Compare, Top 5, Stats, the theme picker or the compare settings; Task 0 makes them and the UI tasks wait for Dan's approval (spec §6 binds over "match the mockups"). Search and filter follow the already-approved `Main.dc.html` (search button, Status and Genre chips) and `ListPC.dc.html` (filter box).
- Ruling P2: Item identity is the entry id (script: `row|title`); rated items are ordered rating desc, then title (`Intl.Collator`, base sensitivity), then id (script: rating desc, then sheet row). The app has no row order; Dan's Sheet is normally sorted by rating then title (`sortSheetByRating_`, line 2183).
- Ruling P3: The queue is the spec's `compare_queue` table. The Worker enqueues on `POST /api/entries` and `PATCH /api/entries/:id` when the body carries a numeric rating and `compareAsk` is Both or Only for new ratings (script `queueNewRating_`, 1797–1812); it keeps the 50 most recent (`writeQueue_` `slice(-50)`, 1794). Import, seasons and Compare saves never enqueue.
- Ruling P4: Queue items in a turned-off list are skipped (left queued) and not counted in the banner. The script never hides queue items, but a turned-off list is hidden everywhere else in the app.
- Ruling P5: Swiping on a phone picks the side you swipe toward (swipe left = the left card, the same as ←).
- Ruling P6: The "N new ratings to double-check" banner shows at the top of every list screen (each is a home tab under R8).
- Ruling P7: Top 5 and Stats show enabled lists only, in nav order (`LIST_ORDER`), not the Sheet's Top 5 layout order. "All media" totals the enabled lists.
- Ruling P8: Stats "Completed" shows "—" for lists without a Status column (Movies, Albums, Songs); the All media completed count sums the lists that have one.
- Ruling P9: Compare copy is the script's, with "Click it." replaced by "Tap it." on phones and kept on PC, and "Settings tab" replaced by "Settings".
- Ruling P10: Sakura Muted text becomes `#876773` (4.72:1 on Background, 4.51:1 on Cards; the smallest HLS-lightness darkening of the script's `#8d6b78` that passes on both). This supersedes R1's `#8b6a77`, which is 4.30:1 on Sakura's Cards, where list cards already put muted text. Cost if wrong: one hex value.
- Ruling P11: A Custom theme saves even when its colors fail contrast; the editor shows a warning per failing role. It's Dan's own choice, and blocking a half-finished edit would be worse.
- Ruling P12: Display name and invite link are not built in Phase 3: only friends see them, so they arrive with Phase 4.
- Ruling P13: Search matches title, typed title, creator, album and genres; case- and accent-insensitive; every word typed must appear. Search and filters live in the URL (`?q=&status=&genre=`), so Back and reload keep them.
- Ruling P14: Save writes every change in one `UPDATE` whose changes travel as a single JSON parameter (`json_each`), so the statement always has 3 bound parameters; a request carries ≤ `COMPARE_SAVE_MAX_CHANGES` = 2000 changes and the client splits beyond that.

---

## File Structure

```
packages/shared/src/compare/
  types.ts        Answer, CompareOptions, CompareItem, RatingChange, Question, RunOutcome, CompareRun, pairKey, betterKey
  score.ts        rescore, placeScore                        (script 1959–2025)
  runs.ts         fullPass, placeOne, placeUnrated            (script 2048–2126)
  session.ts      createSession: history, replay-based Back   (script 1920–1951)
  items.ts        toCompareItem, ratedItems, unratedFinished, compareLists (script 1838–1872)
  index.ts
packages/shared/test/helpers/scriptCompare.ts   loads the script's compare code into node:vm
packages/shared/test/compare.*.test.ts
packages/worker/migrations/0002_compare_queue.sql
packages/worker/src/api/compare.ts              GET/DELETE queue, POST save, enqueueStatements
packages/web/src/data/compare.ts                useCompareQueue, saveCompareChanges, dropFromQueue
packages/web/src/screens/CompareScreen.tsx      route /compare
packages/web/src/screens/compare/               useCompareFlow.ts, PairView.tsx, ReviewView.tsx, CompareHome.tsx
packages/web/src/screens/CompareBanner.tsx
packages/web/src/ratings/topFive.ts, stats.ts   pure derivations
packages/web/src/screens/Top5Screen.tsx, StatsScreen.tsx
packages/web/src/screens/settings/ThemePicker.tsx, CustomColors.tsx, CompareOptions.tsx
packages/web/src/lists/filter.ts                ListFilter, foldText, matchesFilter, genreOptions, URL params
packages/web/src/screens/list/ListFilters.tsx
packages/web/src/design/compare.css, ratings.css
```

---

### Task 0: Mockups for the Phase 3 screens (approval gate, no code)

**Deliverable:** New artboards on the existing canvas (Midnight theme, same tokens and components as the approved boards), with sources copied into `docs/design/mockups/` and added to `canvas.json`:
- Compare, phone: a question (two cover cards, title, "Which one do you think is better? Tap it.", Back / About the same / Skip / Stop and review, progress line); the review list (title, old → new, up/down colours, Save new ratings / Don't save / ← Back to last pick); the Compare home (list buttons with counts, "Rate finished things with no rating").
- Compare, PC: the question with the keyboard hint line.
- Top 5 (phone): a block per list with rank, cover, title, creator, rating badge.
- Stats (phone and PC): per-list numbers, All media, Anime by genre.
- Settings additions: Appearance (theme grid of 12 swatches + Custom, the Custom colour editor with a contrast warning) and Comparing (the four options).
- The queue banner on the Anime list, and the phone list with the search field open and a Status filter applied.

- [ ] **Step 1:** List artifact types and build the boards (use the Design type if listed), from the copy in Tasks 5–11.
- [ ] **Step 2:** Send them to Dan; record approval and any changes in `docs/design-notes.md` under "Phase 3 mockups".
- [ ] **Step 3:** Tasks 5–11 don't start until Dan approves. Tasks 1–4 may go ahead.

### Task 1: Compare scoring port (`rescore`, `placeScore`) and the script oracle

**Files:**
- Create: `packages/shared/src/compare/types.ts`, `packages/shared/src/compare/score.ts`, `packages/shared/src/compare/index.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './compare'`)
- Create: `packages/shared/test/helpers/scriptCompare.ts`, `packages/shared/test/helpers/prng.ts`
- Test: `packages/shared/test/compare.score.test.ts`

**Interfaces:**
- Consumes: `COMPARE_STYLE`, `COMPARE_ROOM` from `types.ts`.
- Produces:
  - `type Answer = 'a' | 'b' | 'same' | 'skip' | 'stop'` ('a' = the first item passed to the question is better)
  - `type CompareStyle = (typeof COMPARE_STYLE)[number]`, `type CompareRoom = (typeof COMPARE_ROOM)[number]`
  - `interface CompareOptions { style: CompareStyle; room: CompareRoom; window: number }`
  - `interface CompareItem { id: string; title: string; rating: number | null; cover: string; square: boolean; isNew?: boolean }`
  - `interface RatingChange { id: string; title: string; old: number | null; isNew: boolean; rating: number }` (script `old: '—'` → `null`)
  - `pairKey(a: CompareItem, b: CompareItem): string` = the two ids sorted, joined by `~`; `betterKey(winner, loser): string` = `${winner.id}>${loser.id}`
  - `rescore(order: CompareItem[], better: Set<string>, ties: Set<string>, style: CompareStyle): RatingChange[]`
  - `placeScore(order: CompareItem[], idx: number, tie: CompareItem | null, room: CompareRoom): RatingChange[] | null` (null = "Push others down": the caller falls back to `rescore`)
  - test helper `loadScriptCompare(setup: { style: string; room: string; window: number; ask?: string; queueLength?: number }): ScriptCompare` with `rescore(order, better, ties)`, `placeScore(order, idx, tie)` and `run(kind, args, answers)` (Task 2), operating on script-shaped items `{ row, title, rating, cover, square, isNew? }`.

- [ ] **Step 1: Write the oracle helper** `scriptCompare.ts`. The mechanics the implementer can't infer:

```ts
// Read the script, evaluate the COMPARE_HTML template literal (it has no ${…}), keep the <script> body.
const src = readFileSync(new URL('../../../../reference/MediaTrackerCovers.gs', import.meta.url), 'utf8');
const a = src.indexOf('const COMPARE_HTML = `') + 'const COMPARE_HTML = `'.length;
const b = src.indexOf('</script></body></html>`;', a) + '</script></body></html>'.length;
const html = new Function('return `' + src.slice(a, b) + '`')() as string;
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
// Per setup: a fresh vm context with stubs, then the code with __SETUP__ replaced.
const v = { innerHTML: '' };
const ctx = vm.createContext({ document: { getElementById: (id: string) => (id === 'v' ? v : { onclick: null }), addEventListener() {} },
                              google: { script: { host: { close() {} } } } });
vm.runInContext(js.replace('__SETUP__', JSON.stringify({ ask: 'Both', queue: Array(queueLength).fill({}), tabs: [], unrated: [], style, room, window })), ctx);
vm.runInContext('Math.random = () => 0.99', ctx); // never flip: 'L' is always the first argument ('a')
```

  Top-level `function` declarations are properties of `ctx` (call `ctx.rescore(...)`); `id`/`pk` are `const`s, so build keys yourself: `id = row + '|' + title`, `pk = [id(a), id(b)].sort().join('~')`. Map port ids to `${row}|${title}` when comparing so `better`/`ties` sets line up.

- [ ] **Step 2: Write the failing tests** (`compare.score.test.ts`). Golden values below were produced by the script itself:

```ts
const it_ = (title: string, rating: number | null, row: number) => ({ id: `${row}|${title}`, title, rating, cover: '', square: false });
const A = it_('A', 8, 2), B = it_('B', 9, 3), C = it_('C', 7, 4), D = it_('D', 8.25, 5);
test('meet in the middle: smallest moves, 0.1 apart', () => {
  expect(rescore([A, B, C], new Set([betterKey(A, B)]), new Set(), 'Meet in the middle')).toEqual([
    { id: '2|A', title: 'A', old: 8, isNew: false, rating: 8.6 }, { id: '3|B', title: 'B', old: 9, isNew: false, rating: 8.5 }]);
});
test('hundredths when any score has two decimals', () => {
  expect(rescore([A, D, B], new Set([betterKey(A, D), betterKey(D, B)]), new Set(), 'Meet in the middle').map((c) => c.rating))
    .toEqual([8.52, 8.42, 8.32]);
});
test('swap the numbers', () => {
  expect(rescore([A, B, C], new Set([betterKey(A, B)]), new Set(), 'Swap the numbers').map((c) => [c.title, c.rating]))
    .toEqual([['A', 9], ['B', 8]]);
});
test('ties share the average in both styles', () => { /* [A,B,C], ties {pairKey(A,B)} → A 8.5, B 8.5 */ });
test.each([
  ['Use in-between scores', 9.45], ['Give the same score', 9.5],
])('placeScore with no whole-tenth room: %s → %d', (room, want) => {
  const N = { ...it_('N', null, 9), isNew: true };
  expect(placeScore([it_('H', 9.5, 2), N, it_('L', 9.4, 3)], 1, null, room)).toEqual([{ id: '9|N', title: 'N', old: null, isNew: true, rating: want }]);
});
// Also: top of list (below 9.5) → 9.7; bottom (above 9.4) → 9.1; between 9.0 and 8.0 → 8.5;
// between 9.41 and 9.4 (gap < 0.02) → 9.41 for both rooms; 'Push others down' → null;
// an existing rating that already fits → []; tie given → the tie's rating.
test('matches the script on 500 random orders per style and room', () => { /* see below */ });
```

  The random test: seeded PRNG (`prng.ts`: mulberry32, `rng(seed)`), 500 seeds; lists of 2–25 items, ratings in tenths 1.0–10.0 (a quarter of lists use hundredths), about 20% equal neighbours; a random permutation of the list as `order`; random `better` / `ties` keys over adjacent pairs; for each of the 2 styles assert `rescore` deep-equals the script's output after mapping `old: '—'` → `null` and `row|title` → `id`. Same for `placeScore` over the 3 rooms with a random `idx`, `isNew` true or false, and a random `tie`.

- [ ] **Step 3: Run** `npx -y npm@11 test -w packages/shared -- compare.score`. Expected: FAIL (`rescore` is not exported).
- [ ] **Step 4: Implement** `rescore` and `placeScore` in `score.ts` as line-by-line ports of script lines 1959–2000 and 2006–2025: `U` = 10 unless any `rating * 10` is off a whole number by ≥ 1e-6 (then 100), `G = U / 10`; the strict/tie pass; Swap = scores sorted descending; Meet in the middle = shift by `k[i]`, merge blocks with a stack while the previous block's mean is lower (pool-adjacent-violators), un-shift with `Math.round`; tie runs share their rounded average; clamp the top to `10 * U`, then each strict step to `v[i-1] - G` (Swap: `- 0`), each tie to `v[i-1]`; output `Math.max(0, v[i]) / U`, keeping only new items and changed scores. `placeScore` keeps `r10`, `r100`, the `+0.2` / `-0.3` ends, the `< 0.02` gap rule and the `Math.round(old*100) === Math.round(val*100)` "unchanged" check exactly.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(compare): port rescore and placeScore, checked against the script`.

### Task 2: Compare runs, the replay session, and item selection

**Files:**
- Create: `packages/shared/src/compare/runs.ts`, `session.ts`, `items.ts`; modify `compare/index.ts`
- Modify: `packages/shared/test/helpers/scriptCompare.ts` (add `run`)
- Test: `packages/shared/test/compare.runs.test.ts`, `packages/shared/test/compare.items.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `rescore`, `placeScore`; `Entry`, `Category`, `CATEGORY_CONFIG`.
- Produces:
  - `interface Question { a: CompareItem; b: CompareItem; title: string; progress: string }`
  - `type RunOutcome = { kind: 'review'; changes: RatingChange[] } | { kind: 'skipped' } | { kind: 'nothingToCompare' }`
  - `type CompareRun = Generator<Question, RunOutcome, Answer>`
  - `fullPass(items: CompareItem[], listName: string, opts: CompareOptions): CompareRun` (items = rated, best first)
  - `placeOne(items: CompareItem[], entryId: string, listName: string, waiting: number, opts: CompareOptions): CompareRun`
  - `placeUnrated(items: CompareItem[], u: CompareItem, listName: string, nth: number, total: number, opts: CompareOptions): CompareRun`
  - `createSession(start: () => CompareRun): Session` where `Session` has `current: { kind: 'ask'; question: Question } | { kind: 'done'; outcome: RunOutcome }`, `asked: number`, `canBack: boolean`, `stopRequested: boolean`, `answer(a: Answer): void`, `back(): void`
  - `toCompareItem(e: Entry): CompareItem` (cover = `coverUrl`, square from `CATEGORY_CONFIG`)
  - `ratedItems(entries: Entry[]): CompareItem[]` (Ruling P2 order)
  - `unratedFinished(byCategory: Partial<Record<Category, Entry[]>>, categories: Category[]): (CompareItem & { category: Category })[]`: rating null, non-empty title, and status `Completed` when the category has a Status column (any status otherwise); categories in the given order, titles by collator within each; at most 300 (script 1854–1872)
  - `compareLists(byCategory, categories): { category: Category; count: number }[]`: categories with ≥ 2 rated entries (script 1819–1826)
  - test helper `run(kind: 'fullPass' | 'placeOne' | 'placeUnrated', args: unknown[], answers: (Answer | 'back')[]): Promise<{ questions: { a: string; b: string; title: string; progress: string }[]; outcome: ScriptOutcome }>`

Behaviour to port exactly (the generators' `return` replaces the script's `review(...)` / `next()` calls):
- `fullPass` (2048–2069): `order = [items[0]]`; for each next item `x`, walk `pos` up while `order[pos-1].rating - x.rating <= window`; ask `(x, y)`: `a` → record `x>y`, move up, continue; `b` → record `y>x`, stop; `same` → tie, stop; `skip` → stop; `stop` → stop and ask nothing more for the rest of the pass; insert at `pos`. Title = `listName`; progress = `Going through ${i} of ${items.length - 1} · ${asked} picks so far` (`asked` = questions already asked in this run, replays included). Returns `review` with `rescore(order, better, ties, style)`.
- `placeOne` (2072–2096): `me` not in items → `skipped`. `near` = indices of others with `|rating - me.rating| <= window`; `lo` = first index whose rating is not above `me.rating`; binary search over `[near[0], near[last]+1)` with `a` → `H = mid`, `b` → `L = mid+1`, `same` → tie, `L = mid+1, H = L`; `skip`/`stop` → `L = max(L, min(lo, H)); H = L`. Title `Placing ${title} (${listName})`, progress `New rating · ${waiting} waiting`. Returns `review` with `placeScore(order, lo, tiedWith, room) ?? rescore(...)`.
- `placeUnrated` (2100–2126): no other items → `nothingToCompare`; binary search over all items; `skip`/`stop` → `skipped`; `est` = tie's rating, else mid of neighbours, else `max(1, above - 0.3)` / `min(10, below + 0.2)`; `placeScore` first, and for Push others down set `me.rating = Math.round(est * 10) / 10` then `rescore`. Title `Rating ${title} (${listName})`, progress `Unrated ${nth} of ${total}`.
- Session (1920–1951): `answer` pushes every answer except `stop` onto `history`; `back()` (no-op when `history` is empty) pops one and restarts the run, replaying the rest silently (each replayed answer is pushed again); `asked` resets on restart and counts replayed questions. `stopRequested` turns true on a live `stop` and stays true after Back (the script's `S.queue.length = 0` / `unratedList.length = 0` survive Back).

- [ ] **Step 1: Write the failing tests** (`compare.runs.test.ts`):

```ts
const items = [it_('A', 9, 2), it_('B', 8.8, 3), it_('C', 8.5, 4), it_('D', 8.5, 5), it_('E', 6, 6)];
const opts = { style: 'Meet in the middle', room: 'Use in-between scores', window: 1 } as const;
test('Back replays every answer but the last (script transcript)', () => {
  const s = createSession(() => fullPass(items, 'Anime', opts));
  const seen: string[] = [];
  for (const step of ['a', 'b', 'back', 'a', 'same', 'stop'] as const) {
    if (s.current.kind === 'ask') seen.push(`${s.current.question.a.title}|${s.current.question.b.title}|${s.current.question.progress}`);
    step === 'back' ? s.back() : s.answer(step);
  }
  expect(seen).toEqual([
    'B|A|Going through 1 of 4 · 0 picks so far', 'C|A|Going through 2 of 4 · 1 picks so far',
    'D|C|Going through 3 of 4 · 2 picks so far', 'C|A|Going through 2 of 4 · 1 picks so far',
    'C|B|Going through 2 of 4 · 2 picks so far', 'D|A|Going through 3 of 4 · 3 picks so far']);
  expect(s.current).toEqual({ kind: 'done', outcome: { kind: 'review', changes: [
    { id: '4|C', title: 'C', old: 8.5, isNew: false, rating: 8.8 }, { id: '2|A', title: 'A', old: 9, isNew: false, rating: 8.7 }] } });
});
test('Back from the review screen returns to the last real pick; stopRequested survives', () => { /* answer a, stop; back → asks the question answered 'a'; stopRequested === true */ });
test('back() with no history does nothing', () => { /* first question still current */ });
test.each(['fullPass', 'placeOne', 'placeUnrated'])('%s matches the script on 300 random sessions', async (kind) => {
  /* per seed: random list (as Task 1), random opts (style × room × window ∈ {0.3, 0.5, 1, 2, 10}),
     answer stream weights a 35, b 35, same 10, skip 8, back 8, stop 4, forced 'stop' after 200;
     drive the session and scriptCompare.run with the same stream; expect identical question lists
     (a.id, b.id, title, progress) and identical outcomes */
});
```

  `compare.items.test.ts`: `ratedItems` sorts `[{r:9,t:'b'},{r:9,t:'A'},{r:null},{r:10}]` to 10, A, b and drops the unrated one; `unratedFinished` takes a Movies entry with no status, skips an Anime entry with status `Watching / In Progress`, takes an Anime `Completed` one, and caps at 300; `compareLists` omits a list with one rated entry.

  Script-side driving in `run()`: start with `vm.runInContext('startRun(' + kind + ', __args)', ctx)` so the script's own `back()` works; wrap `ctx.ask` to record a question and schedule the next answer with `setTimeout(…, 0)` **only** when `vm.runInContext('answer !== null', ctx)` is true (a replayed question resolves without setting `answer`); send `'back'` as `pickSide('back')` and `'a'`/`'b'` as `pickSide('L')`/`pickSide('R')`; override `ctx.loadItems` to return the list, `ctx.review` to resolve `{ kind: 'review', changes }`, and pass a `next` that resolves `{ kind: 'skipped' }`; `nothingToCompare` is `v.innerHTML` containing "nothing to compare" after the run function settles.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/shared -- compare`. Expected: FAIL.
- [ ] **Step 3: Implement** `runs.ts`, `session.ts`, `items.ts`. `createSession` restarts by calling `start()` again and calling `next(answer)` for each replayed answer.
- [ ] **Step 4: Run** the tests. Expected: PASS (all of `packages/shared`).
- [ ] **Step 5: Commit** `feat(compare): port full pass, placing and unrated runs with replay-based Back`.

### Task 3: Worker: compare queue and batch save

**Files:**
- Create: `packages/worker/migrations/0002_compare_queue.sql`, `packages/worker/src/api/compare.ts`
- Modify: `packages/worker/src/api/entries.ts` (export `ENTRY_SELECT`; enqueue in POST and PATCH), `packages/worker/src/index.ts` (`api.route('/compare', compare)`), `packages/shared/src/importLimits.ts` (add `COMPARE_SAVE_MAX_CHANGES = 2000`)
- Test: `packages/worker/test/compare.test.ts`

**Interfaces:**
- Consumes: `isValidRating` (entryValidation), `rowToEntry`, `ENTRY_SELECT`, `c.var.user.settings.compareAsk`.
- Produces:
  - `CREATE TABLE compare_queue (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, added_at TEXT NOT NULL, PRIMARY KEY (user_id, entry_id));`
  - `enqueueStatements(db: D1Database, userId: string, entryId: string, compareAsk: string): D1PreparedStatement[]` → `[]` unless compareAsk is Both or Only for new ratings; else the upsert (`ON CONFLICT (user_id, entry_id) DO UPDATE SET added_at = excluded.added_at`, so a re-rated title moves to the end) and the trim (`DELETE … WHERE user_id = ?1 AND entry_id NOT IN (SELECT entry_id FROM compare_queue WHERE user_id = ?1 ORDER BY added_at DESC LIMIT 50)`)
  - `GET /api/compare/queue` → `{ items: { entryId: string; category: Category }[] }`: joined to the user's entries with `rating IS NOT NULL`, oldest first (`added_at, rowid`)
  - `DELETE /api/compare/queue/:entryId` → 204 (also when absent)
  - `POST /api/compare/save` body `{ changes: { id: string; rating: number }[]; doneEntryId?: string }` → `{ updated: number; entries: Entry[] }`. 400 `{error:'invalid'}` if `changes` isn't an array of ≤ 2000, an id isn't a 1–64-char string or repeats, or a rating fails `isValidRating` or is null.

- [ ] **Step 1: Write the failing tests** (`compare.test.ts`, same `as()` helper style as `entries.test.ts`):

```ts
it('queues a hand-typed rating and moves a re-rated title to the end', async () => { /* mk e1, e2; PATCH e1 {rating:8}; PATCH e2 {rating:7}; PATCH e1 {rating:8.5}
  → GET queue items.map(i => i.entryId) equals [e2.id, e1.id] */ });
it('does not queue when compareAsk is "Only when I start it" or "Off"', …);
it('does not queue on import or on a notes-only PATCH', …);
it('keeps only the 50 most recent', …);                  // 52 rated PATCHes → 50 items, the first two gone
it('hides queued titles that were unrated; deleting the entry removes them', …);
it('saves 1,500 changes in one request', async () => {
  const ids = await seedEntries(A, 1500);                  // bulk insert straight into env.DB
  const res = await as(A, '/api/compare/save', 'POST', { changes: ids.map((id, i) => ({ id, rating: (i % 100) / 10 })) });
  expect(res.status).toBe(200);
  expect((await res.json()).updated).toBe(1500);
});
it('ignores ids that are missing or belong to someone else', …); // B's id + a deleted id → updated counts only A's
it('drops doneEntryId from the queue in the same request', …);
it('rejects a null rating, 10.5, 8.333, a repeated id, and 2001 changes with 400', …);
it('returns the saved entries with their new ratings and updated_at', …);
```

- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/worker -- compare`. Expected: FAIL.
- [ ] **Step 3: Implement.** The save runs one `db.batch` of up to 3 statements (6 queries with sign-in, under the 50 limit), with the changes as one JSON parameter:

```sql
UPDATE entries SET
  rating = (SELECT json_extract(value, '$.rating') FROM json_each(?1) WHERE json_extract(value, '$.id') = entries.id),
  updated_at = ?3
WHERE user_id = ?2 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1));
-- then (if doneEntryId) DELETE FROM compare_queue WHERE user_id = ? AND entry_id = ?
-- then ENTRY_SELECT … WHERE e.user_id = ?2 AND e.id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
```

  `updated` = the UPDATE's `meta.changes`. In `entries.ts`, append `enqueueStatements(...)` to the POST's insert and to the PATCH's update when the validated body has a numeric `rating` (POST becomes a batch; PATCH stays ≤ 6 queries).
- [ ] **Step 4: Run** the worker tests. Expected: PASS (the whole worker suite, since entries routes changed).
- [ ] **Step 5: Commit** `feat(worker): compare queue and one-statement rating saves`.

### Task 4: Web data layer for Compare, Top 5 and Stats

**Files:**
- Modify: `packages/web/src/data/useEntries.ts` (extract `entriesQueryOptions(qc, category)`; add `useAllEntries`), `packages/web/src/data/entryMutations.ts` (invalidate the queue after a rating save), `packages/web/src/hooks/useAddEntry.ts` (same after a create with a rating)
- Create: `packages/web/src/data/compare.ts`
- Test: `packages/web/src/data/compare.test.tsx`, add a case to `packages/web/src/data/useEntries.test.tsx`

**Interfaces:**
- Consumes: Task 3 routes; `writeEntry` (`entryCache.ts`); `RatingChange`, `COMPARE_SAVE_MAX_CHANGES`.
- Produces:
  - `useAllEntries(categories: Category[]): { data: Partial<Record<Category, Entry[]>>; isPending: boolean; isError: boolean }`: one `useQueries` over the same `['entries', c]` queries and Dexie cache as `useEntries`, so any `writeEntry` shows up everywhere
  - `COMPARE_QUEUE_KEY = ['compare-queue'] as const`
  - `useCompareQueue(): UseQueryResult<{ entryId: string; category: Category }[]>`
  - `saveCompareChanges(qc: QueryClient, changes: RatingChange[], doneEntryId?: string): Promise<boolean>`: POSTs in chunks of ≤ `COMPARE_SAVE_MAX_CHANGES` (`doneEntryId` on the last chunk), `writeEntry` for every returned entry, invalidates the queue; `false` on any failure
  - `dropFromQueue(qc: QueryClient, entryId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests:** `saveCompareChanges` sends `{ changes: [{ id: 'e1', rating: 8.8 }], doneEntryId: 'e2' }` and the cached Anime list then shows 8.8; 2,500 changes go out as 2 requests with `doneEntryId` only on the second; a 500 answer returns `false` and leaves the cache unchanged; a successful rating PATCH via `saveEntryChange` refetches `/api/compare/queue`, a notes PATCH doesn't; `useAllEntries(['anime','movies'])` returns both lists from the cache before the network answers.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- src/data`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): compare queue, batch save and all-lists data hooks`.

### Task 5: Compare screen

**Files:**
- Create: `packages/web/src/screens/CompareScreen.tsx`, `packages/web/src/screens/compare/useCompareFlow.ts`, `PairView.tsx`, `ReviewView.tsx`, `CompareHome.tsx`, `packages/web/src/design/compare.css`
- Modify: `packages/web/src/routes.tsx` (lazy route `compare`, same Suspense pattern as Import)
- Test: `packages/web/src/screens/CompareScreen.test.tsx`, `packages/web/src/screens/compare/PairView.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`createSession`, runs, `ratedItems`, `unratedFinished`, `compareLists`), Task 4 hooks, `enabledLists`, `LIST_LABEL`, `useSessionMe`, `useIsWide`, `CoverImage`, `Button`, `useToast`.
- Produces:
  - `useCompareFlow(opts?: { random?: () => number }): { view: FlowView; startList(c: Category): void; startUnrated(c: Category): void; answer(a: Answer): void; back(): void; save(): Promise<void>; dontSave(): void; next(): void }` with `FlowView` = `loading | off | home{ afterQueue, lists, unrated, onlyNew } | ask{ question, left, right, canBack } | review{ changes, asked, canBack, hasNext } | nothingToCompare{ title, listName } | saving | saved`
  - `PairView({ question, left, right, canBack, onAnswer, onBack, wide })`: `left`/`right` are the question's items after the flip

Flow (script 2128–2167): `Off` → off. If Ask is Both or Only for new ratings and the queue has items in enabled lists → place each with `placeOne` (`waiting` = items left after this one), then home with `afterQueue`. A live Stop (`stopRequested`) drops the rest of the queue or unrated run for this visit. Review → **Save new ratings** → `saveCompareChanges(qc, changes, doneEntryId)` → next item, or `saved` after a full pass. **Don't save** → next item (the queued title stays queued) or home. "All good" (no changes) → **Next**/**Close** → `dropFromQueue` for a queued title, then next. Unrated: one run per title of that list, `nth`/`total` as the script; titles shown this visit drop out of the home counts. Card sides: `random() < 0.5` flips per new question.

Copy (Ruling P9):
- Question: h2 = title; sub "Which one do you think is better? Tap it." (PC: "Click it."); card line "now {rating}" or "not rated yet"; buttons "← Back" (disabled with no history), "About the same", "Skip", "Stop and review"; PC hint "Keyboard: ← left · → right · ↓ same · S skip · Backspace back".
- Review: "New ratings" / "Based on your picks ({style, lower-case}). Nothing is saved until you press Save."; rows "{title} {old or —} → {new}" with up (green) or down (red) using `--cf-high`/`--cf-low` text-safe tokens; "← Back to last pick", "Save new ratings", "Don't save". No changes: "All good" / "Your ratings already match your picks. Nothing changes." (+ " (nothing close enough to compare)" before the full stop when `asked` is 0) and "Next" or "Close". Saved: "Saved" / "Top 5 and Stats update by themselves."
- Home: "Compare ratings" / "Pick a list to go through. You only compare things rated within {window} of each other, and you can stop any time." (prefixed "New ratings are placed. " after the queue); buttons "{List} ({count})"; "Rate finished things with no rating" / "Completed titles with no score yet. Lists without a Status (Movies, Albums, Songs) count everything as finished. A few picks each." Only for new ratings: "All new ratings are placed." or "Nothing is waiting." + " Settings → “Ask to compare” is set to only check new ratings." and only the unrated buttons. Off: "Comparing is off" / "Turn it on in Settings: “Ask to compare”." with a link to Settings.
- Nothing to compare: "Nothing on {List} is rated yet, so there's nothing to compare with. Give a couple of things a rating first." + "Next".
- Save failure toast: "Couldn't save your new ratings. Try again." (stay on the review).

Input: tap/click a card; keys ArrowLeft / ArrowRight / ArrowDown / `s` `S` / Backspace (ignored while focus is in a text field; `preventDefault`); swipe on the pair area: horizontal travel ≥ 60 px and more than twice the vertical travel picks the side swiped toward (Ruling P5). Keyboard focus moves to the new question's heading after each answer so screen readers announce it.

- [ ] **Step 1: Write the failing tests** (`renderApp('/compare')` with `mockApi` and `random: () => 0.99`, so the first argument is always left):
  - Ask Off → heading "Comparing is off".
  - Home lists "Anime (3)" but not Movies with one rated title; unrated section shows "Movies (2)" for two unrated movies.
  - Full pass on Anime A 9, B 8.8, C 8.5 (script-verified): B vs A → click B; C vs A → click C; C vs B → click B → the review lists B 8.8 → 8.9, C 8.5 → 8.8, A 9.0 → 8.7; "Save new ratings" POSTs `{ changes: [{ id: B, rating: 8.9 }, { id: C, rating: 8.8 }, { id: A, rating: 8.7 }] }` and shows "Saved"; the Anime list now shows those ratings.
  - ArrowLeft answers the left card; Backspace returns to the previous question; `s` skips; Backspace on the first question does nothing.
  - A pointer swipe of −80 px picks the left card; +80 px the right; a 40 px or mostly vertical move does nothing.
  - Queue `['e2']` with Ask Both → opens on "Placing … (Anime)" with "New rating · 0 waiting"; "Don't save" sends no DELETE; "All good" → "Close" sends `DELETE /api/compare/queue/e2`.
  - Queue of 3 and Stop on the first → home "New ratings are placed." without asking about the other two.
  - Only for new ratings → no list buttons, the "only check new ratings" text.
  - Save answers 500 → the toast, and the review is still on screen.
  - A queued id missing from the loaded lists is skipped silently.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- Compare PairView`. Expected: FAIL.
- [ ] **Step 3: Implement**, matching the approved Task 0 boards.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Compare screen`.

### Task 6: Top 5

**Files:**
- Create: `packages/web/src/ratings/topFive.ts`, `packages/web/src/screens/Top5Screen.tsx`, `packages/web/src/design/ratings.css`
- Modify: `packages/web/src/routes.tsx` (`top5`)
- Test: `packages/web/src/ratings/topFive.test.ts`, `packages/web/src/screens/Top5Screen.test.tsx`

**Interfaces:**
- Consumes: `sortEntries` (`lists/sort.ts`), `useAllEntries`, `enabledLists`, `CoverImage`, `RatingBadge`, `CATEGORY_CONFIG`.
- Produces: `topFive(rows: Entry[]): Entry[]` = the rated rows, `sortEntries(…, 'rating')`, first 5.

- [ ] **Step 1: Write the failing tests:** `topFive` of 7 rows with one unrated and two 9.5s returns 5 rows, the 9.5s in title order, no unrated; the screen shows one block per enabled list in nav order with heading text = list name, an ordered list whose items read "1 {title} {creator} {rating}" and link to `/entry/:id`; turning Albums off removes its block; a list with nothing rated shows "Nothing rated yet." and a "Go to {List}" link.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- topFive Top5Screen`. Expected: FAIL.
- [ ] **Step 3: Implement** (square covers for Albums/Songs as elsewhere).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Top 5`.

### Task 7: Stats

**Files:**
- Create: `packages/web/src/ratings/stats.ts`, `packages/web/src/screens/StatsScreen.tsx`
- Modify: `packages/web/src/routes.tsx` (`stats`), `packages/web/src/design/ratings.css`
- Test: `packages/web/src/ratings/stats.test.ts`, `packages/web/src/screens/StatsScreen.test.tsx`

**Interfaces:**
- Consumes: `useAllEntries`, `enabledLists`, `CATEGORY_CONFIG`, `formatRating`.
- Produces:
  - `interface ListStats { entries: number; rated: number; average: number | null; completed: number | null; highest: number | null }`
  - `computeStats(byCategory: Partial<Record<Category, Entry[]>>, enabled: Category[]): { lists: (ListStats & { category: Category })[]; all: ListStats; animeGenres: { genre: string; count: number; average: number | null }[] }`

Rules: `average` = mean of the ratings (null when none rated); `completed` = count of status `Completed` for lists with a Status column, null otherwise (Ruling P8); `all` sums `entries`, `rated` and the non-null `completed`, averages over every rated entry (not a mean of means), takes the overall highest. Anime by genre (empty when Anime is off): split `genres` on commas, trim, drop empties, count each genre once per entry ignoring case (first spelling wins); `average` over that genre's rated entries; sorted by count desc, then genre by collator.

- [ ] **Step 1: Write the failing tests:** Anime [9, 8, unrated(Completed)] + Movies [7] → anime `{ entries: 3, rated: 2, average: 8.5, completed: 1, highest: 9 }`, movies `completed: null`, all `{ entries: 4, rated: 3, average: 8, completed: 1, highest: 9 }`; genres "Action, Drama" + "action,  Comedy" + "" → Action 2 first; a list with no rated entries shows "—" for average and highest; the screen labels its numbers ("Entries", "Rated", "Average", "Completed", "Highest") and on PC renders a table with those column headers and an "All media" row.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- stats StatsScreen`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Stats`.

### Task 8: Navigation and the queue banner

**Files:**
- Create: `packages/web/src/screens/CompareBanner.tsx`
- Modify: `packages/web/src/design/components/SideNav.tsx`, `packages/web/src/screens/MoreScreen.tsx`, `packages/web/src/screens/ListScreen.tsx`, `packages/web/src/design/components/Icon.tsx` (if a compare icon is needed)
- Test: `packages/web/src/screens/CompareBanner.test.tsx`, add cases to `packages/web/src/AppShell.test.tsx`

**Interfaces:**
- Consumes: `useCompareQueue`, `enabledLists`, `useSessionMe`.
- Produces: `CompareBanner()`; `waitingCount(queue, settings): number` = queue items in enabled lists when Ask is Both or Only for new ratings, else 0.

Layout: PC side nav footer becomes Compare (with the waiting count), Top 5, Stats, Import, Settings, About. Phone More gets a "Ratings" section (Compare with count, Top 5, Stats) before "Your data". The banner sits at the top of every list screen's body (Ruling P6): `{n} new rating(s) to double-check` + a "Compare" link to `/compare`; `role="status"`.

- [ ] **Step 1: Write the failing tests:** banner reads "1 new rating to double-check" / "3 new ratings to double-check"; hidden at 0, when Ask is Off or Only when I start it, and for items in a turned-off list; the side nav has links named "Compare", "Top 5", "Stats" in that order before "Import"; More has a "Ratings" section; on `/compare` the phone's More tab is current.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- CompareBanner AppShell`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Compare, Top 5 and Stats in the nav; queue banner`.

### Task 9: Settings: theme picker and Custom colours

**Files:**
- Create: `packages/web/src/screens/settings/ThemePicker.tsx`, `packages/web/src/screens/settings/CustomColors.tsx`
- Modify: `packages/shared/src/theme.ts` (Sakura Muted text `#876773`), `packages/shared/test/theme.test.ts` (also check Cards), `packages/web/src/design/theme.ts` (add `contrastWarnings`), `packages/web/src/design/theme.test.ts` (Sakura value), `packages/web/src/screens/SettingsScreen.tsx` (replace the "Theme: …" row), `packages/web/src/screens/SettingsScreen.test.tsx`
- Test: `packages/web/src/screens/settings/ThemePicker.test.tsx`

**Interfaces:**
- Consumes: `THEMES`, `themeColors`, `contrast`, `ROLE_VARS`, `useSaveSettings` (its optimistic update re-applies the theme through `SessionGate`).
- Produces: `contrastWarnings(colors: ThemeColors): { role: 'Text' | 'Bright text' | 'Muted text'; surface: 'Background' | 'Cards'; ratio: number }[]` (pairs under 4.5).

Behaviour: a radio group "Theme" of 13 options (12 in `THEMES` order, then Custom); each option shows a swatch (Background, Cards, Text, Highlight) and its name. Picking a theme saves `{ theme }`. Picking Custom with no saved colours saves `{ theme: 'Custom', colors: themeColors(current) }` so it starts from the theme on screen. The Custom editor (shown only for Custom) has one row per role, labelled with the role name: a colour input and a hex text box (`/^#[0-9a-f]{6}$/i`; an invalid hex shows "Use a colour like #1b1b25." and isn't saved); changes apply at once and save after 500 ms without further edits. Warnings under the editor: "{role} is hard to read on {surface} ({ratio, 1 decimal}:1; aim for 4.5:1)." (Ruling P11). "Reset to {theme}" isn't needed (pick the theme again).

- [ ] **Step 1: Write the failing tests:** shared theme test: Text, Bright text and Muted text ≥ 4.5 on Background and on Cards for all 12, and `THEMES.Sakura['Muted text'] === '#876773'`; web theme test now expects `#876773`; `contrastWarnings({ ...THEMES.Midnight, 'Muted text': '#55556a' })` contains `{ role: 'Muted text', surface: 'Background' }`; picking "Ocean" PUTs `{ settings: { theme: 'Ocean' } }` and `--bg` becomes `#0f1c2b`; picking Custom from Sakura PUTs Sakura's 10 colours; typing `#zzzzzz` shows the hex error and sends nothing; editing Text to `#333333` on Midnight shows the warning and (after 500 ms, fake timers) PUTs `{ settings: { colors: { Text: '#333333' } } }`.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/shared -- theme` and `npx -y npm@11 test -w packages/web -- theme ThemePicker SettingsScreen`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): theme picker and Custom colours; Sakura muted text passes on cards`.

### Task 10: Settings: compare options

**Files:**
- Create: `packages/web/src/screens/settings/CompareOptions.tsx`
- Modify: `packages/web/src/screens/SettingsScreen.tsx`
- Test: `packages/web/src/screens/settings/CompareOptions.test.tsx`

**Interfaces:**
- Consumes: `COMPARE_ASK`, `COMPARE_STYLE`, `COMPARE_ROOM`, `useSaveSettings`.
- Produces: `parseWindow(text: string): number | null` (accepts "1", "0.5", "1,5"; null unless finite, > 0 and ≤ 10).

A "Comparing" section with the Sheet's labels: "Ask to compare", "Re-rating style", "When there's no room" (selects over the constants) and "Compare within" (`inputMode="decimal"`, saved on blur or Enter; invalid shows "Enter a number above 0, up to 10." and isn't saved).

- [ ] **Step 1: Write the failing tests:** each select shows the current value and PUTs `{ settings: { compareStyle: 'Swap the numbers' } }` etc.; `parseWindow('1,5') === 1.5`, `parseWindow('0') === null`, `parseWindow('10') === 10`, `parseWindow('10.1') === null`, `parseWindow('abc') === null`; typing "0" and tabbing away shows the error and sends no PUT; a failed save shows the existing "Couldn't save your settings. Try again." toast and the old value returns.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- CompareOptions`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): compare options`.

### Task 11: Search and filters on every list

**Files:**
- Create: `packages/web/src/lists/filter.ts`, `packages/web/src/screens/list/ListFilters.tsx`
- Modify: `packages/web/src/screens/ListScreen.tsx`, `packages/web/src/design/lists.css`
- Test: `packages/web/src/lists/filter.test.ts`, add cases to `packages/web/src/screens/ListScreen.test.tsx`

**Interfaces:**
- Consumes: `Entry`, `Status`, `STATUSES`, `CATEGORY_CONFIG`, `useSearchParams`.
- Produces:
  - `interface ListFilter { q: string; status: Status | ''; genre: string }`
  - `foldText(s: string): string` (NFKD, strip combining marks `\p{M}`, lower-case, collapse whitespace, trim)
  - `matchesFilter(e: Entry, f: ListFilter): boolean` (Ruling P13: every folded word of `q` is a substring of the folded title + typed title + creator + album + genres; status equal; genre equal to one of the entry's comma-split genres, case-insensitively)
  - `genreOptions(rows: Entry[]): { genre: string; count: number }[]` (sorted by collator)
  - `readFilter(p: URLSearchParams): ListFilter`, `writeFilter(f: ListFilter): URLSearchParams` (empty fields omitted; an unknown status reads as '')

UI (approved `Main.dc.html` / `ListPC.dc.html`): phone header has the 44 px "Search" icon button, which opens a search field (label "Search {List}", placeholder "Search titles, {creator label lower-case}s, genres…"; Escape or the clear button empties and closes it; it stays open while `q` is set); a chip row of Sort (existing), "Status: All" (only lists with a Status column) and "Genre" (options from `genreOptions`, "Genre: All" first). PC: the always-visible filter input left of Add, "Filter titles, {creator label lower-case}s, genres…", and `/` focuses it when focus isn't in a field. URL updates use `replace`. With any filter on, the sub-line reads "{shown} of {total} titles"; no matches → EmptyState "No matches" / "Nothing in {List} matches your search." with a "Clear search and filters" button. Sorting applies after filtering.

- [ ] **Step 1: Write the failing tests:** `matchesFilter` finds "Pokémon" for "pokemon", "Frieren" for "  frieren ", "進撃の巨人" for "進撃", "Fullmetal Alchemist: Brotherhood" for "brotherhood fullmetal", Madhouse-studio entries for "madhouse", and doesn't throw on "ac/dc" or "(" ; genre "action" matches "Action, Drama" but not "Action-Adventure"; `readFilter(new URLSearchParams('status=Nope'))` gives `status: ''`; `writeFilter` round-trips. ListScreen: typing "fri" shows only Frieren, the URL has `?q=fri`, the sub-line reads "1 of 3 titles"; choosing "Status: On Hold" filters; no Status chip on Movies; "Clear search and filters" restores all rows; `/` focuses the PC filter.
- [ ] **Step 2: Run** `npx -y npm@11 test -w packages/web -- filter ListScreen`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lists): search and Status/Genre filters`.

### Task 12: End-to-end, setup notes, release

**Files:**
- Modify: `packages/web/e2e/core.spec.ts`, `docs/SETUP.md`, `README.md` (feature list, if it has one)
- Create: `docs/decisions-phase3.md` (this plan's Rulings plus any made during the build, same format as `decisions-phase1-2.md`)

- [ ] **Step 1: Write the end-to-end tests** (both device profiles, `LOOKUP_FAKE=1`): add three anime rated 9, 8.8 and 8.5 → the banner reads "3 new ratings to double-check" → Compare places them (answer "About the same" to every question; press "Save new ratings" or "Close", whichever the review shows) → back on the list, the banner is gone; open Compare → Anime → Stop and review → Don't save → nothing changes; type "fri" in the list search → only Frieren shows; Settings → Theme → Sakura → the page background is `#fff7f9`.
- [ ] **Step 2: Run** `npx -y npm@11 run e2e`. Expected: PASS.
- [ ] **Step 3: Run** `npx -y npm@11 test` and `npx -y npm@11 run typecheck`. Expected: all pass, no type errors.
- [ ] **Step 4: Update `docs/SETUP.md`** with an "Updating to a new version" section: pull, `npx -y npm@11 ci`, `npm exec -w packages/worker -- wrangler d1 migrations apply media-tracker --remote --env production` (adds `compare_queue`; success = "0002_compare_queue.sql ✅"), `npm run deploy`.
- [ ] **Step 5: Commit** `docs: Phase 3 setup notes and decisions`.
- [ ] **Step 6: Dan's acceptance** on Windows and Android: Compare a real list and spot-check the new ratings against the Sheet's dialog on the same picks; Top 5 and Stats match the Sheet's tabs; every theme looks right; search works on each list. Then tag `v0.3.0`.

---

## Open questions for Dan

1. The Phase 1–2 plan pencilled in the offline write queue (spec §7), "Export my data" (the approved Settings mockup shows the button; `GET /api/export` already exists) and the admin source-health and diagnose pages (§5.6) for Phase 3. This plan leaves them out. Add them now, or later?
2. On Light and Sakura, Highlight-coloured text (the Sort chip, links) is below AA on the background: Light `#b7791f` 3.6:1, Sakura `#d6457a` 4.0:1. Darken those two Highlight values, or show chip and link text in the Text colour on those themes?
