# Media Tracker App, Phase 3c (Tier ratings): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sheet-style Compare with per-list rating tiers and a Bradley-Terry fit: rate-new by tier ("Place it"), Fix my ratings, rate unrated, Re-tier review and a per-list tier editor. Dan's imported scores must show exactly as they do now. Compare is switched back on at the end.

**Architecture:** A pure `ratings` module in `packages/shared/src/ratings/` holds everything that decides a score: tiers, the prior, the fit, the shown-score rule, question choice, placement and the session. The device runs it to preview a session. The Worker runs the same code on every write that can move a score, so the Worker is authoritative. It saves the shown score into `rating` and the fitted strength into a new `strength` column, so lists, sorting, Top 5 and Stats never run the model. The Phase 3 Compare UI shell (question card, review, Save, keys/swipe, queue banner, nav links) is reused. The Sheet engine and its three settings are deleted.

**Tech Stack:** As Phase 3 (TypeScript, Hono, Cloudflare Workers + D1, React, React Router, TanStack Query, Dexie, Vitest, Testing Library, Playwright). No new runtime dependencies.

**Spec:** `/home/claude/scratch/decisions-2026-11-15.md` wins over `/home/claude/scratch/spec-v1.2-ratings-excerpt.md`; executors read both. The repo's `docs/specs/media-tracker-app-spec.md` is OUT OF DATE (it still describes porting the Sheet's compare), so do not plan or build from it. Also binding: `docs/decisions-phase3.md` (P1–P15, still in force except where a ruling below replaces one), `docs/design-notes.md`, and the approved calm v2 boards in `docs/design/mockups/*.v2.dc.html`.

## Global Constraints

- npm commands run as `npx -y npm@11 …`. Work on branch `phase3c`, cut from `phase3`.
- D1 free plan: ≤ 100 bound parameters per statement; ≤ 50 queries per Worker invocation (every statement in `db.batch()` counts, and sign-in costs up to 3). Bulk writes send their rows as one JSON parameter through `json_each`, as `/api/compare/save` did (Ruling P14).
- Workers free plan: 10 ms CPU per request. The Worker fits only the one rating set (list or season tab) being written.
- Default tiers for every list (decision 2026-11-15): Loved 9–10, Liked 7.5–9, Fine 6–7.5, Didn't like 0–6. **Tiers are per list.** Changing a boundary moves no titles between tiers; their scores spread over the new range.
- Score = `low + (high − low) × sigmoid(strength)`. Prior from a typed number: the strength that gives back that number, clamped to 3–97% of the range. Tier only: the middle (strength 0). A title moved to another tier keeps its rough place (Ruling Q23). `PRIOR_SD` starts at 1.0 and is tuned in Task 9.
- "A is better" = a win for A. "About the same" = half a win each. Picks only count between two titles that are in the same tier now.
- Shown score: one decimal. When two neighbours would show the same number but picks ordered them, both show two decimals. A locked score shows exactly the number typed and still counts as an opponent.
- Answers: A, B, About the same, Skip, Stop, Back. PC keys: ← →, ↓ for About the same, S, Backspace. Phone: tap, swipe left/right (P5). Nothing is saved until Save. Back undoes the last pick and fits again.
- Ask to compare values stay `COMPARE_ASK` (Both / Only when I start it / Only for new ratings / Off). The Sheet's Re-rating style, When there's no room and Compare within are dropped everywhere.
- Comparisons are never shown to friends. "Export my data" includes tiers and comparisons.
- UI: calm v2 style, Inter only, tap targets ≥ 44 px, every control named, motion inside `prefers-reduced-motion: no-preference`, WCAG AA, and every empty, loading and error state gets friendly text and a next step. UI tasks wait for Task 0 approval.
- Out of scope: the phone navigation/profile redesign (decisions 2026-11-15, separate plan), the offline write queue (deferred, Phase 3 decisions), Phase 4 feed and friends.

## Review Focus

1. **Devices still holding pre-3c cached entries** (Dexie rows with no `tier`/`strength`/`scoreLocked`). Lists, sorting, Top 5 and Stats must render them as unrated-tier rows and must not crash. Test in Task 10.
2. **The list changes under an open session.** If a title is deleted, re-typed or moved on another device while the PC compares, Save must ignore unknown ids, the Worker's re-fit must win, and the cache must take the Worker's numbers, not the preview's. Test in Task 7.
3. **Typed values on tier edges and the Sheet's two-decimal values** (0, 5.99, 6.0, 7.49, 7.5, 9.0, 9.97, 10, 8.25). Each must land in the right tier, and its shown score must stay exactly the same after backfill, import and a re-fit with no picks. Tests in Tasks 1, 3 and 6.
4. **Sessions that run out of questions.** These are a tier with one title, a tier where every title is locked, and every neighbour pair skipped or already asked. `nextPair` must return null rather than repeat a skipped pair forever, and the screen must say there is nothing left to ask. Tests in Tasks 4 and 11.
5. **A big tier against the Worker's 10 ms CPU limit.** Fitting a 120-title tier with 480 picks must stay well under budget. Test in Task 2 (a loose bound that catches a complexity regression, not a benchmark).

## Rulings

- **Q1 — the Sheet engine is deleted** (Task 12): `packages/shared/src/compare/*`, its tests and `scriptCompare.ts` helper, `POST /api/compare/save`, `COMPARE_SAVE_MAX_CHANGES`, `COMPARE_STYLE`/`COMPARE_ROOM` and the `compareStyle`/`compareRoom`/`compareWindow` settings (UI, import parsing, validation). The queue (`compare_queue`, `GET/DELETE /api/compare/queue`, `enqueueStatements`) stays. Before deleting, tag `phase3-sheet-compare` at the current `phase3` head so the engine can be recovered. `reference/MediaTrackerCovers.gs` stays (import still cites it). Cost if wrong: restore from the tag.
- **Q2 — tier numbering:** `Tier = 0 | 1 | 2 | 3`, 3 = Loved (top). Boundary values belong to the higher tier (6.0 is Fine, 7.5 Liked, 9.0 Loved); 10 is Loved, 0 is Didn't like.
- **Q3 — tier settings shape:** `UserSettings.tiers: Partial<Record<Category, TierSet>>` (missing = defaults), with `TierSet = { names: [string, string, string, string]; bounds: [number, number, number] }`. Names are indexed by tier and bounds are `[b1, b2, b3]`, giving `[0,b1) [b1,b2) [b2,b3) [b3,10]`. Valid sets: names are 1–20 characters after trimming and unique ignoring case. Bounds have one decimal, with `0 < b1 < b2 < b3 < 10` and each tier at least 0.5 wide. Only `PUT /api/ratings/tiers/:list` writes them; `sanitizeSettings` ignores the key.
- **Q4 — season tabs use their parent list's tiers** (Anime Seasons → Anime, TV Seasons → TV), with comparisons kept apart (`category` = `anime_seasons` / `tv_seasons`). `RatingSet = Category | 'anime_seasons' | 'tv_seasons'`. (Confirmed by Dan, 2026-11-15.)
- **Q5 — `strength` column:** besides the spec's `tier`, `prior_mean` and `score_locked`, entries and seasons get `strength REAL` (the last fit, null when unrated). §5.1 needs it to order equal shown scores without running the model. For a title with no picks, strength = prior_mean.
- **Q6 — when `rating` is rewritten** (the "exactly as now" guarantee). A *fitted* title has at least one counted pick with a title now in its tier. Its `rating` is the shown-score rule's value (one decimal, or two). An *unfitted*, unlocked title keeps its stored `rating`, which is the typed or imported number. The exceptions: its stored strength ≠ its prior (it was fitted before and lost its picks), or its rating is null (tier only), or the tier's range just changed. In those cases it gets `round1(scoreOf(prior))`. Locked titles are never rewritten, even when the range changes (their number may then sit outside the range, and the in-range guarantee covers unlocked titles). The Sheet's stored values (9.97, 8.25, …) therefore show unchanged until a pick involves them.
- **Q7 — two-decimal rule, made exact:** sort the tier by strength (desc, ties by id). A fitted title shows `round2(score)` when an adjacent title shows the same one-decimal text and the two strengths differ by more than 1e-9. Otherwise it shows `round1(score)`. An unfitted neighbour's text is `formatRating(rating)` rounded to one decimal. Unfitted titles never switch to two decimals, which is what keeps the top-14 regression true.
- **Q8 — typing a new number on a title keeps its picks** (confirmed by Dan, 2026-11-15). The number becomes the new prior, and its tier is `tierFor(number)`. If the title has picks, the re-fit may shift it slightly, and Lock is the way to pin it exactly. Whenever a title changes tier (by typed number, tier chip, Re-tier or "Belongs in another tier"), it is unlocked and its old picks stop counting. They are kept, and count again if it moves back.
- **Q9 — the Worker re-fits the whole rating set** (all four tiers) on every write that can move a score. That covers rating/tier/lock edits on entries and seasons, ratings save, and tier settings change. It writes only the rows whose `rating`, `tier`, `prior_mean`, `strength` or `score_locked` changed, in one `json_each` UPDATE per table. Import and the backfill never fit, because they add no picks.
- **Q10 — the backfill is lazy, in the Worker, not SQL.** Migration 0005 only adds columns and the table. `GET /api/me` runs `ensureTiers`, which assigns `tier`/`prior_mean`/`strength` to rated rows that have none and leaves `rating` untouched. This keeps one implementation (`priorFromScore`), and it does not depend on whether D1 builds include SQLite's math functions (`ln`), which was not verified. Every Worker read path also tolerates null tiers (it derives them on the fly), so ordering doesn't matter.
- **Q11 — save payload:** the client sends `{ picks: {winnerId, loserId, isTie, undone}[], moves: {id, tier}[], done: string[] }`, at most 1000 picks, 1000 moves and 50 done. Picks undone by Back in the session are sent with `undone: true` and stored with `undone_at` (the spec's history). The Worker stamps `created_at` = request time + index ms to keep order and ignores client clocks. There is no separate undo route: nothing is saved before Save. Unknown or foreign ids are dropped silently.
- **Q12 — fit determinism:** `fitTier` sorts titles by id and counted comparisons by (winnerId, loserId, isTie) before summing. It starts from the priors and stops when max |Δ| < 1e-12 or after 100 Newton steps. The device and the Worker therefore get bit-identical strengths from the same data in any order.
- **Q13 — placement:** the binary search runs over the tier order frozen at placement start (by strength, without the placed title). An `a` answer sets `hi = mid`, `b` sets `lo = mid + 1`, and `same` ends the search. It ends when `lo ≥ hi` (≤ ⌈log₂(n+1)⌉ picks). If the placed title is moved to another tier, placement restarts there, and the picks so far still count in the fit.
- **Q14 — Back** pops the last pick, tier move or tier choice, plus any skips after it. Skips are not picks.
- **Q15 — Ask to compare:** "Place it" and the queue happen when Ask is Both or Only for new ratings. A tier-only rating counts as a new rating for the queue. Fix my ratings is offered when Ask is Both or Only when I start it. Off shows the existing "Comparing is off" screen.
- **Q16 — rate-new UI:** the Add sheet's slider is replaced by four large tier buttons and an "or type a number" field (typing highlights the tier it falls in). When Q15 allows, the footer shows "Add" and "Add and place it". The second creates the entry, then opens `/compare?place=<id>`. After Save or Don't save it returns to `/list/<category>`.
- **Q17 — Fix my ratings scope:** the home lists the enabled lists that have ≥ 2 rated titles, plus Anime Seasons / TV Seasons when that tab is on (no count until opened). Picking one offers "All tiers" or one tier (with counts). The unrated flow covers list entries only, as in Phase 3: Completed, or any title on lists without Status. Seasons are rated by typing in the seasons editor.
- **Q18 — settledness bar:** "N of M neighbours checked". Within each tier in scope, sort by strength and count the adjacent pairs. A pair is checked if it has a counted pick between the two titles directly, or if both are locked. With M = 0 the bar is full.
- **Q19 — Re-tier review** is its own list of changes: moved rows show "was Liked". Save posts the moves; there is no extra old→new screen. It is reached from Settings (per list) and from the Import screen's done state, with the spec's explanation. It covers lists and season tabs.
- **Q20 — the `COMPARE_ENABLED` flag is deleted** when Compare comes back (Task 16), along with `test/flags.ts` and the hidden-Compare e2e test. A flag fixed to true would be dead config.
- **Q21 — feed:** Phase 4 adds the activity record. Nothing is recorded now, and re-rates before Phase 4 make no posts (no friends yet).
- **Q23 — a moved title keeps its rough place (amends spec §5.2; Dan, 2026-11-15).** The spec puts a tier-only title in the middle of its tier. A title *moved* by a tier chip, Re-tier review or "Belongs in another tier" is different. Its new prior is `priorFromScore(s, newRange)`, where `s` is its current shown score, so `priorFromScore`'s 3–97% clamp puts it near the matching edge. The top of Liked (8.9) lands at 9.03 in Loved, and the bottom of Loved (9.0) lands at 8.955 in Liked. Its strength is set equal to that prior and its rating to `round1(scoreOf(prior, newRange))`. An unrated title given a tier (unrated flow, tier-only add) still starts in the middle.
- **Q22 — deleting an entry** also deletes the comparisons that name it. Comparisons that name a deleted season stay, and the fit ignores ids it doesn't know.

---

## File Structure

```
packages/shared/src/ratings/
  types.ts      Tier, TierSet, RatingSet, RatedItem, SetItem, Comparison, PickInput, SavePayload, RatingChange
  tiers.ts      DEFAULT_TIERS, tierFor, tierRange, validateTierSet, tiersFor, listOfSet, seasonSetOf, RATING_SETS
  score.ts      PRIOR_SD, PRIOR_CLAMP, sigmoid, priorFromScore, scoreOf, round1, round2
  fit.ts        fitTier (Bradley-Terry MAP, Newton)
  shown.ts      refitTier, refitSet, applyMove, applyTyped, compareRated
  questions.ts  nextPair, settledness, placement (startPlacement / placementNext / placementAnswer)
  session.ts    createRatingSession
  index.ts
packages/shared/test/ratings.*.test.ts, test/fixtures/danTop14.ts
packages/worker/migrations/0005_tier_ratings.sql
packages/worker/src/ratings/store.ts     loadSet, setWriteStatements, ensureTiers, refitAndWrite
packages/worker/src/api/ratings.ts       GET /:set, POST /:set/save, PUT /tiers/:list
packages/worker/scripts/tune-prior-sd.ts
packages/web/src/data/ratings.ts         useRatingSet, saveRatings, saveTiers
packages/web/src/screens/compare/useRatingFlow.ts (replaces useCompareFlow.ts), TierQuestion.tsx, MoveMenu.tsx
packages/web/src/screens/RetierScreen.tsx, screens/settings/TierEditor.tsx
packages/web/src/design/components/TierPicker.tsx
```

---

### Task 0: Wireframe mockups (approval gate, no code)

**Deliverable:** wireframe-level boards in the calm v2 style (Midnight, the existing tokens and Inter, placeholder covers, no new graphics). Build them with the generator the v2 boards came from (`/home/claude/v2gen`, `lib.py` helpers) if it is still there. Otherwise hand-write small HTML files against `packages/web/src/design/tokens.css`. Save them to `docs/design/mockups/` and add them to `canvas.json`:
- `TierPicker.dc.html` (phone): the Add sheet with four large tier buttons (name + range, e.g. "Loved · 9–10"), the "or type a number" field with "Liked" highlighted for 8.4, and the footer "Add" / "Add and place it".
- `FixRatings.dc.html` (phone) and `FixRatingsPC.dc.html`: one question with a "Belongs in another tier" button under each card, one of them open as a small menu of the other three tiers, and the settledness bar "18 of 40 neighbours checked". The PC board has the keyboard line. A small inset shows the Fix my ratings home: list tiles, then "All tiers / Loved 14 / Liked 22 / …" chips.
- `Retier.dc.html` (phone, "Move to…" sheet open) and `RetierPC.dc.html` (four columns, one card mid-drag). Both show the intro line and "Save (3 moved)".
- `TierEditor.dc.html` (phone): Settings → Rating tiers, list chips (Anime selected), four rows (name field, "from" number; top row reads "to 10"), "Reset to defaults", Save, and the line "Changing a boundary moves no titles between tiers; their scores spread over the new range."

- [ ] **Step 1:** Build the six boards from the copy in Tasks 11, 13, 14 and 15.
- [ ] **Step 2:** Send them to Dan. Record approval and any changes in `docs/design-notes.md` under "Phase 3c mockups".
- [ ] **Step 3:** Tasks 11 and 13–15 do not start until Dan approves. Tasks 1–10 and 12 may go ahead.

### Task 1: Tiers and the score mapping — **parallel-safe (no UI)**

**Files:**
- Create: `packages/shared/src/ratings/types.ts`, `tiers.ts`, `score.ts`, `index.ts`
- Modify: `packages/shared/src/index.ts` (`export * from './ratings'`), `packages/shared/src/types.ts` (`UserSettings.tiers`, `DEFAULT_USER_SETTINGS.tiers = {}`)
- Test: `packages/shared/test/ratings.tiers.test.ts`

**Interfaces:**
- Produces:
  - `type Tier = 0 | 1 | 2 | 3`; `interface TierSet { names: [string, string, string, string]; bounds: [number, number, number] }`
  - `type RatingSet = Category | 'anime_seasons' | 'tv_seasons'`; `RATING_SETS: readonly RatingSet[]`; `listOfSet(s: RatingSet): Category`; `seasonSetOf(c: Category): RatingSet | null`
  - `interface RatedItem { id: string; title: string; rating: number | null; tier: Tier | null; priorMean: number | null; strength: number | null; scoreLocked: boolean }`
  - `interface SetItem extends RatedItem { cover: string; square: boolean; status: Status | null }`
  - `interface Comparison { id: string; winnerId: string; loserId: string; isTie: boolean; createdAt: string; undoneAt: string | null }`
  - `interface PickInput { winnerId: string; loserId: string; isTie: boolean; undone: boolean }`; `interface SavePayload { picks: PickInput[]; moves: { id: string; tier: Tier }[]; done: string[] }`
  - `interface RatingChange { id: string; title: string; old: number | null; rating: number; oldTier: Tier | null; tier: Tier }`
  - `DEFAULT_TIERS: TierSet` = `{ names: ["Didn't like", 'Fine', 'Liked', 'Loved'], bounds: [6, 7.5, 9] }`
  - `tierFor(score: number, t: TierSet): Tier`; `tierRange(t: TierSet, tier: Tier): [number, number]`
  - `validateTierSet(x: unknown): TierSet | null` (rules in Q3; returns trimmed names)
  - `tiersFor(settings: Pick<UserSettings, 'tiers'>, set: RatingSet): TierSet`
  - `PRIOR_SD = 1.0`; `PRIOR_CLAMP = 0.03`; `sigmoid(x)`; `priorFromScore(score: number, range: [number, number]): number`; `scoreOf(strength: number, range: [number, number]): number`; `round1`, `round2` (`Math.round(x*10)/10`, `Math.round(x*100)/100`)
  - Export constants `RATINGS_SAVE_MAX_PICKS = 1000`, `RATINGS_SAVE_MAX_MOVES = 1000`, `RATINGS_SAVE_MAX_DONE = 50` from `importLimits.ts` beside the D1 limits.

- [ ] **Step 1: Write the failing tests**

```ts
test('tierFor: boundaries belong to the higher tier', () => {
  expect([0, 5.99, 6, 7.49, 7.5, 8.99, 9, 9.97, 10].map((s) => tierFor(s, DEFAULT_TIERS))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
});
test('tierRange', () => {
  expect([0, 1, 2, 3].map((t) => tierRange(DEFAULT_TIERS, t as Tier))).toEqual([[0, 6], [6, 7.5], [7.5, 9], [9, 10]]);
});
test('priorFromScore inverts scoreOf inside 3-97%', () => {
  for (const s of [9.5, 9.03, 9.97, 8.25]) expect(scoreOf(priorFromScore(s, tierRange(DEFAULT_TIERS, tierFor(s, DEFAULT_TIERS))), tierRange(DEFAULT_TIERS, tierFor(s, DEFAULT_TIERS)))).toBeCloseTo(s, 12);
});
test('priorFromScore clamps to 3-97%', () => {
  expect(scoreOf(priorFromScore(10, [9, 10]), [9, 10])).toBeCloseTo(9.97, 12);
  expect(scoreOf(priorFromScore(9, [9, 10]), [9, 10])).toBeCloseTo(9.03, 12);
  expect(scoreOf(priorFromScore(0, [0, 6]), [0, 6])).toBeCloseTo(0.18, 12);
});
test('validateTierSet', () => {
  expect(validateTierSet({ names: [' Meh ', 'Ok', 'Good', 'Great'], bounds: [5, 7, 8.5] })).toEqual({ names: ['Meh', 'Ok', 'Good', 'Great'], bounds: [5, 7, 8.5] });
  for (const bad of [
    { names: ['a', 'A', 'b', 'c'], bounds: [6, 7.5, 9] },      // duplicate ignoring case
    { names: ['', 'b', 'c', 'd'], bounds: [6, 7.5, 9] },       // empty name
    { names: ['a', 'b', 'c', 'd'], bounds: [6, 6.4, 9] },      // tier narrower than 0.5
    { names: ['a', 'b', 'c', 'd'], bounds: [6, 7.55, 9] },     // two decimals
    { names: ['a', 'b', 'c', 'd'], bounds: [0, 7.5, 9] },      // b1 must be > 0
    { names: ['a', 'b', 'c', 'd'], bounds: [6, 9.6, 9] },      // not increasing
  ]) expect(validateTierSet(bad)).toBeNull();
});
test('tiersFor: per list, seasons use the parent list, defaults when unset', () => {
  const mine: TierSet = { names: ['a', 'b', 'c', 'd'], bounds: [5, 7, 8.5] };
  expect(tiersFor({ tiers: { anime: mine } }, 'anime_seasons')).toBe(mine);
  expect(tiersFor({ tiers: { anime: mine } }, 'movies')).toBe(DEFAULT_TIERS);
});
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/shared -- test/ratings.tiers.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the Produces list. `priorFromScore`: `p = clamp((score − low)/(high − low), 0.03, 0.97)`, return `ln(p/(1−p))`.
- [ ] **Step 4:** Run the test again, then `npx -y npm@11 run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ratings): tiers and the score mapping`.

### Task 2: `fitTier` — **parallel-safe (no UI)**

**Files:**
- Create: `packages/shared/src/ratings/fit.ts`
- Test: `packages/shared/test/ratings.fit.test.ts` (uses `test/helpers/prng.ts`)

**Interfaces:**
- Consumes: Task 1 types, `sigmoid`, `PRIOR_SD`.
- Produces: `fitTier(items: Pick<RatedItem, 'id' | 'priorMean' | 'scoreLocked'>[], comparisons: Pick<Comparison, 'winnerId' | 'loserId' | 'isTie' | 'undoneAt'>[], opts?: { priorSd?: number }): Map<string, number>`. The map has a strength for every item. Items with `priorMean === null` are treated as 0.

- [ ] **Step 1: Write the failing tests.** Every test uses `range = [9, 10]` and `sc = (s) => scoreOf(s, range)`. The random generator `randomCase(R)` builds n ∈ [2, 40] items with priors `logit(0.03 + 0.94·R())` and `⌊R()·3n⌋` earlier picks between random distinct items (15% ties). The new pick is between two random distinct items, `winner = a`, `loser = b`. Seed `rng(42)`, 2,000 cases.

```ts
test('no picks: every strength is exactly its prior', ...)            // toBe, not toBeCloseTo
test('undone picks and picks naming unknown ids are ignored', ...)
test('locked items keep their prior and still pull the others', ...)  // locked A beats B: B's strength drops, A's is exactly prior
test('one pick between two 10.0s gives 9.98 and 9.96 (spec §10)', () => {
  const p = priorFromScore(10, range);
  const s = fitTier([{ id: 'f', priorMean: p, scoreLocked: false }, { id: 'c', priorMean: p, scoreLocked: false }],
    [{ winnerId: 'f', loserId: 'c', isTie: false, undoneAt: null }], { priorSd: 1 });
  expect(round2(sc(s.get('f')!))).toBe(9.98); expect(round2(sc(s.get('c')!))).toBe(9.96);
});
test('ties: two equal priors tied stay equal (no gap, no cap)', ...)
test('deterministic: shuffled items and comparisons give bit-identical strengths', ...)
test('stays in range: a title that wins 50 times stays below 10, one that loses 50 times above 9', ...)
test('a pick never lowers the winner or raises the loser (2,000 random cases)', ...)       // ±1e-12
test('no drift: over 2,000 random cases the mean change of the tier average is < 0.001 and it rises in 45–55% of cases', ...)
test('a 120-title tier with 480 picks fits in under 50 ms', ...)       // complexity guard (Review Focus 5)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/shared -- test/ratings.fit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `fitTier`** (MAP of Bradley-Terry with a Gaussian prior; the objective is strictly concave, so Newton converges to the one optimum):

```
counted = comparisons with undoneAt === null, both ids in items, winner ≠ loser; sort by (winnerId, loserId, isTie)
s_i = priorMean_i (items sorted by id); free = items in ≥1 counted pick and not locked  (all others stay exactly at prior)
repeat ≤ 100: g_i = −(s_i − μ_i)/σ²;  H_ii = 1/σ²
  for each pick (w, l, y = isTie ? 0.5 : 1): p = sigmoid(s_w − s_l); r = y − p; h = p(1 − p)
    g_w += r; g_l −= r; H_ww += h; H_ll += h; H_wl −= h; H_lw −= h   (rows/cols of free items only)
  solve H·Δ = g by Cholesky (dense over free items); s += Δ; stop when max|Δ| < 1e-12
```

- [ ] **Step 4:** Run the tests. Expected: PASS. (A prototype of exactly this gave 0 violations, 52.2% up, mean change 7.7e-6, and 2.5 ms for 120 titles.)
- [ ] **Step 5:** Commit `feat(ratings): Bradley-Terry fit with Newton steps`.

### Task 3: Shown scores, re-fit, moves and order — **parallel-safe (no UI)**

**Files:**
- Create: `packages/shared/src/ratings/shown.ts`, `packages/shared/test/fixtures/danTop14.ts`
- Test: `packages/shared/test/ratings.shown.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `refitTier(items: RatedItem[], comparisons: Comparison[], range: [number, number], opts?: { rangeChanged?: boolean; priorSd?: number }): RatedItem[]`. `items` are the rated items of one tier. It returns only the items whose `rating` or `strength` changed, with new values (Q6, Q7).
  - `refitSet(items: RatedItem[], comparisons: Comparison[], tiers: TierSet, opts?: { rangeChanged?: boolean; priorSd?: number }): RatedItem[]`: every tier, using only comparisons whose two ids are both in that tier.
  - `applyTyped(item: RatedItem, rating: number | null, tiers: TierSet, lock?: boolean): RatedItem`. A number sets the tier, the prior from the number, strength = prior, rating = the number, and lock = `lock ?? item.scoreLocked`. Null clears all of them to null/false.
  - `applyMove(item: RatedItem, tier: Tier, tiers: TierSet): RatedItem`. Sets the tier and unlocks. The prior is `priorFromScore(item.rating, newRange)` (Q23), or 0 (the middle) when `item.rating` is null. Strength = prior, and `rating = round1(scoreOf(prior, newRange))`.
  - `compareRated(a, b): number` for `Pick<RatedItem, 'rating' | 'tier' | 'strength' | 'title' | 'id'>`: rating desc (null last), then tier desc, then strength desc (null last), then title (`Intl.Collator`, base), then id.

The fixture `danTop14.ts` is not Dan's real data: none is in the repo. Its titles come from the approved mockup boards (`docs/design/mockups/ListPC.v2.dc.html`). Its scores are reconstructed from spec §5.2: two 10.0s, then twelve titles 0.1 apart. The file opens with a comment saying so.

```ts
export const DAN_TOP14: [string, number][] = [
  ['Cyberpunk: Edgerunners', 10], ['Fullmetal Alchemist: Brotherhood', 10], ['Naruto: Shippuden', 9.9],
  ['My Hero Academia', 9.8], ['Gurren Lagann', 9.7], ['Evangelion (Shinsaku Series)', 9.6],
  ['JoJo’s Bizarre Adventure (TV)', 9.5], ['Mob Psycho 100', 9.4], ['FLCL', 9.3], ['Vivy -Fluorite Eye’s Song-', 9.2],
  ['Frieren: Beyond Journey’s End', 9.1], ['Steins;Gate', 9.0], ['Code Geass', 8.9], ['Attack on Titan', 8.8],
];
```

- [ ] **Step 1: Write the failing tests**

```ts
test('import keeps every score exactly: no picks, no changes', () => {
  const items = [0, 5.99, 6, 7.49, 7.5, 8.25, 9, 9.97, 10].map((r, i) => applyTyped(blank(`t${i}`), r, DEFAULT_TIERS));
  expect(refitSet(items, [], DEFAULT_TIERS)).toEqual([]);
});
test("Dan's top 14: FMA beats Edgerunners changes only those two, to 9.98 and 9.96", () => {
  const items = DAN_TOP14.map(([t, r]) => applyTyped(blank(t), r, DEFAULT_TIERS));
  const out = refitSet(items, [pick('Fullmetal Alchemist: Brotherhood', 'Cyberpunk: Edgerunners')], DEFAULT_TIERS, { priorSd: 1 });
  expect(out.map((i) => [i.id, i.rating])).toEqual([['Cyberpunk: Edgerunners', 9.96], ['Fullmetal Alchemist: Brotherhood', 9.98]]);
});
test('one decimal unless an ordered neighbour collides', ...)       // fitted 8.62 vs fitted 8.58 → 8.6 and 8.6 → both two decimals
test('an unfitted neighbour never switches to two decimals', ...)    // fitted 9.04 next to imported 9.0: 9.04 and 9.0
test('picks in one tier never change another tier', ...)             // pick inside Loved: no Liked/Fine/Didn't like item returned
test('a cross-tier pick counts for nothing', ...)
test('locked: never rewritten, still an opponent', ...)
test('rangeChanged spreads unfitted titles over the new range; locked keep their number', ...)
test('a title that lost its picks goes back to round1(scoreOf(prior))', ...)
test('applyMove keeps the rough place: top of Liked → bottom of Loved, bottom of Loved → top of Liked (Q23)', () => {
  const up = applyMove(applyTyped(blank('x'), 8.9, DEFAULT_TIERS, true), 3, DEFAULT_TIERS);
  expect(up).toMatchObject({ tier: 3, rating: 9, scoreLocked: false });
  expect(up.priorMean).toBe(priorFromScore(9.03, [9, 10])); expect(up.strength).toBe(up.priorMean);
  const down = applyMove(applyTyped(blank('y'), 9.0, DEFAULT_TIERS), 2, DEFAULT_TIERS);
  expect(down).toMatchObject({ tier: 2, rating: round1(scoreOf(down.priorMean!, [7.5, 9])) });
  expect(scoreOf(down.priorMean!, [7.5, 9])).toBeCloseTo(8.955, 12);
  expect(applyMove(applyTyped(blank('z'), 5, DEFAULT_TIERS), 1, DEFAULT_TIERS).priorMean).toBe(priorFromScore(6, [6, 7.5])); // clamps to 3%
  expect(applyMove({ ...blank('u'), rating: null }, 2, DEFAULT_TIERS)).toMatchObject({ priorMean: 0, rating: 8.3 }); // unrated → middle
});
test('compareRated: equal shown score → higher tier, then stronger first', ...)
test('shown scores stay within the tier range (2,000 random cases)', ...)   // low ≤ rating ≤ high for unlocked
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/shared -- test/ratings.shown.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The `refitTier` algorithm, because the tests don't pin its order:

```
strengths = fitTier(items, comparisons, opts); fitted(i) = i appears in a counted pick (Task 2's filter)
order = items by strength desc, id asc
oneText(i) = fitted(i) ? round1(score_i) : round1(i.rating ?? round1(scoreOf(prior_i)))
new rating: locked → i.rating
            fitted → neighbour (prev/next in order) with same oneText and |Δstrength| > 1e-9 ? round2(score_i) : round1(score_i)
            unfitted → (rangeChanged || i.rating === null || i.strength !== i.priorMean) ? round1(scoreOf(prior_i)) : i.rating
return items where new rating !== i.rating or new strength !== i.strength
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ratings): shown scores, re-fit, moves and order`.

### Task 4: Questions, settledness and placement — **parallel-safe (no UI)**

**Files:**
- Create: `packages/shared/src/ratings/questions.ts`
- Test: `packages/shared/test/ratings.questions.test.ts`, `packages/shared/test/ratings.simulation.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `pairKey(a: string, b: string): string` (ids sorted, joined by `~`)
  - `nextPair(items: RatedItem[], comparisons: Comparison[], strengths: Map<string, number>, skipped: ReadonlySet<string>): [string, string] | null`. Candidates are adjacent pairs inside each tier, sorted by strength desc then id. It drops pairs in `skipped` and pairs where both titles are locked. It picks the minimum of (count of counted picks between the two, |Δstrength|, −tier, index), and returns [stronger, weaker].
  - `settledness(items: RatedItem[], comparisons: Comparison[], strengths: Map<string, number>): { checked: number; total: number }` (Q18)
  - The spec's `placementSearch`, as three pure steps: `interface Placement { order: string[]; lo: number; hi: number; done: boolean }`; `startPlacement(order: string[]): Placement`; `placementNext(p): string | null`; `placementAnswer(p, a: 'a' | 'b' | 'same'): Placement` (Q13; `a` = the placed title is better)

- [ ] **Step 1: Write the failing tests**

```ts
test('nextPair: closest neighbours in the same tier, unasked first', ...)
test('nextPair: never across tiers; null for a single-title tier, an all-locked tier, or everything skipped', ...)
test('settledness counts direct picks between neighbours only', ...)
test('placement in a tier of 40 takes at most 6 picks and lands in order', () => {
  const order = Array.from({ length: 40 }, (_, i) => `t${i}`);   // t0 strongest
  let p = startPlacement(order), n = 0;
  while (!p.done) { const o = placementNext(p)!; n++; p = placementAnswer(p, Number(o.slice(1)) >= 17 ? 'a' : 'b'); }
  expect(n).toBeLessThanOrEqual(6); expect(p.lo).toBe(17);
});
test("'same' ends placement at once", ...)
```

The simulation test (spec §8): 50 simulated people, seeds `rng(1000 + p)`. Each tier has 30 titles with true strengths `N(0, 1.2)`, and the typed priors are truth + `N(0, 0.8)`. An answer is right with probability `sigmoid(2.5·Δtruth)`, and a pair under 0.1 apart is tied 30% of the time. Run 60 picks with `nextPair` and 60 picks with random pairs (seed `rng(5000 + p)`). Measure the mean Kendall tau between fitted strengths and the truth at 0, 10, 30 and 60 picks.

```ts
test('simulation: order agreement rises with picks, and nextPair beats random pairs', () => {
  const { smart, random } = simulate();
  expect(smart[1]).toBeGreaterThan(smart[0]); expect(smart[2]).toBeGreaterThan(smart[1]); expect(smart[3]).toBeGreaterThan(smart[2]);
  expect(smart[3] - random[3]).toBeGreaterThanOrEqual(THRESHOLD); // set from the first run, then held fixed
});
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/shared -- test/ratings.questions.test.ts test/ratings.simulation.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the Produces list.
- [ ] **Step 4:** Run once and print `smart` and `random`. Set `THRESHOLD` to the measured `smart[3] − random[3]` rounded **down** to 2 decimals (the prototype measured 0.783 vs 0.727, so about 0.05). Write the measured values in a comment. Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ratings): next question, settledness and placement`.

### Task 5: Rating session — **parallel-safe (no UI)**

**Files:**
- Create: `packages/shared/src/ratings/session.ts`
- Test: `packages/shared/test/ratings.session.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

```ts
type SessionMode = { kind: 'fix'; tier: Tier | null } | { kind: 'place'; ids: string[] } | { kind: 'unrated'; ids: string[] };
type SessionQuestion =
  | { kind: 'pick'; a: RatedItem; b: RatedItem; placing: RatedItem | null; nth: number; total: number }
  | { kind: 'tier'; item: RatedItem; nth: number; total: number };
interface RatingSession {
  readonly question: SessionQuestion | null;          // null: Stop pressed, or nothing left to ask
  readonly settled: { checked: number; total: number };
  readonly canBack: boolean;
  readonly asked: number;
  answer(a: 'a' | 'b' | 'same' | 'skip' | 'stop'): void;
  chooseTier(t: Tier): void;                          // answers a 'tier' question
  move(id: string, t: Tier): void;                    // "Belongs in another tier"
  back(): void;
  changes(): RatingChange[];                          // vs base, ordered by compareRated of the new values
  payload(): SavePayload;
}
createRatingSession(base: { items: RatedItem[]; comparisons: Comparison[]; tiers: TierSet }, mode: SessionMode, opts?: { priorSd?: number }): RatingSession
```

State is the base plus an action log (`pick` / `skip` / `move` / `tier` / `stop`). The current items come from replaying moves and tier choices through `applyMove`, then `refitSet` over base comparisons plus non-undone session picks. Back follows Q14 and marks the popped pick undone, so it is still in `payload()` as `undone: true`. Fix mode asks `nextPair` within `mode.tier` (or all tiers). It skips pairs skipped in this session, and Skip adds the pair to that set. Place and unrated modes follow Q13: unrated first asks a `tier` question, then places. In those modes, Skip and Stop keep the estimate so far: Skip moves to the next id and Stop ends the session. `payload().done` lists the place/unrated ids the session reached. `nth`/`total` are the title's position in place/unrated mode and `asked`/0 in fix mode.

- [ ] **Step 1: Write the failing tests**

```ts
test('Back then the same pick gives the same scores', ...)                 // toEqual on changes() before/after
test('Back after Stop returns to the last real pick', ...)
test('Back undoes a move; the undone pick is in payload() with undone: true', ...)
test('fix mode stays inside the chosen tier and ends with null when nothing is left', ...)
test('place mode: about log2(n)+1 picks, then the next id; Skip keeps the estimate', ...)
test('unrated mode: tier question first, then placement in that tier', ...)
test('moving the placed title restarts placement in its new tier, earlier picks still count', ...)
test('changes(): old → new with tiers; nothing for untouched titles', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/shared -- test/ratings.session.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and `npx -y npm@11 run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ratings): rating session with Back`.

### Task 6: Migration 0005, row fields, backfill and import — **parallel-safe (no UI)**

**Files:**
- Create: `packages/worker/migrations/0005_tier_ratings.sql`, `packages/worker/src/ratings/store.ts`
- Modify: `packages/shared/src/types.ts` (`Entry` and `Season` gain `tier: Tier | null; priorMean: number | null; strength: number | null; scoreLocked: boolean`), `packages/shared/src/importLimits.ts`, `packages/worker/src/api/entries.ts` (`EntryRow`/`SeasonRow`, `rowToEntry`, `rowToSeason`), `packages/worker/src/api/import.ts`, `packages/worker/src/api/me.ts` (`GET /` calls `ensureTiers`). Update the test fixtures that build `Entry` literals: `useAddEntry.ts`, `fakeBackend.ts`, `useEntries.test.tsx`, `web/test/backfill.test.ts`, `worker/test/entries.test.ts`, `worker/test/import.test.ts`, `data/compare.test.tsx`.
- Test: `packages/worker/test/ratingsBackfill.test.ts`, `packages/shared/test/importLimits.test.ts`, `packages/worker/test/import.test.ts`

**Interfaces:**
- Consumes: Task 1 (`tierFor`, `tierRange`, `priorFromScore`, `tiersFor`).
- Produces:
  - Migration:

```sql
ALTER TABLE entries ADD COLUMN tier INTEGER;
ALTER TABLE entries ADD COLUMN prior_mean REAL;
ALTER TABLE entries ADD COLUMN strength REAL;
ALTER TABLE entries ADD COLUMN score_locked INTEGER NOT NULL DEFAULT 0;
-- the same four on seasons
CREATE TABLE comparisons (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL,
  winner_id TEXT NOT NULL, loser_id TEXT NOT NULL, is_tie INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, undone_at TEXT);
CREATE INDEX idx_comparisons_user_category ON comparisons(user_id, category);
```

  - `ensureTiers(db: D1Database, userId: string, settings: UserSettings): Promise<number>` (rows assigned). It runs one batch of 2 SELECTs (rated rows with `tier IS NULL`: entries, and seasons joined to their entry's category). If any are found, a second batch of ≤ 2 UPDATEs via `json_each` sets `tier`, `prior_mean` and `strength = prior_mean`, and **never `rating`**.
  - Import rows carry `tier`, `prior_mean` and `strength` (from the importing user's tiers). `IMPORT_ENTRY_PARAMS = 19` (5 rows per statement, `IMPORT_CHUNK_ROWS` = 150). `IMPORT_SEASON_PARAMS = 9` (11 per statement, `IMPORT_CHUNK_SEASONS` = 165).

- [ ] **Step 1: Write the failing tests**

```ts
it('backfill keeps every rating exactly and assigns tier + prior', async () => {
  const ratings = [10, 10, 9.9, 9.97, 9, 8.25, 7.5, 7.49, 6, 5.99, 0];
  // seed rated anime entries and anime seasons straight into env.DB with tier NULL
  await as(A, '/api/me');
  const rows = await env.DB.prepare('SELECT rating, tier, prior_mean, strength FROM entries ORDER BY rowid').all();
  expect(rows.results.map((r) => r.rating)).toEqual(ratings);
  expect(rows.results.map((r) => r.tier)).toEqual([3, 3, 3, 3, 3, 2, 2, 1, 1, 0, 0]);
  for (const r of rows.results) expect(r.prior_mean).toBe(priorFromScore(r.rating, tierRange(DEFAULT_TIERS, r.tier)));
  for (const r of rows.results) expect(r.strength).toBe(r.prior_mean);
});
it('backfill is idempotent and costs 2 queries when nothing is left', ...)
it('backfill uses the parent list tiers for seasons', ...)
it('import writes tier, prior and strength; rating unchanged', ...)
test('import limits: 19 entry params → 5 rows per statement, chunk 150; 9 season params → 11, chunk 165', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/worker -- test/ratingsBackfill.test.ts test/import.test.ts` and `npx -y npm@11 test -w packages/shared -- test/importLimits.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `rowToEntry`/`rowToSeason` map `score_locked` 0/1 to boolean and the rest as-is.
- [ ] **Step 4:** Run the three test files, the whole worker suite and `npx -y npm@11 run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker): tier columns, comparisons table and lazy backfill`.

### Task 7: Worker ratings routes and re-fitting writes — **parallel-safe (no UI)**

**Files:**
- Create: `packages/worker/src/api/ratings.ts`; extend `packages/worker/src/ratings/store.ts`
- Modify: `packages/worker/src/index.ts` (`api.route('/ratings', ratings)`), `packages/worker/src/api/entries.ts` (create/patch/delete, seasons create/patch, export), `packages/worker/src/api/entryValidation.ts` (`tier`: 0–3, `scoreLocked`: boolean, on entries and seasons)
- Test: `packages/worker/test/ratings.test.ts`, `packages/worker/test/entries.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 and 6.
- Produces:
  - `loadSet(db, userId, set): Promise<{ items: (SetItem & { kind: 'entry' | 'season' })[]; comparisons: Comparison[] }>`: 1 batch of 2 queries. The items are titled entries of the category with status, or for a season set the seasons titled `` `${entry.title} · ${season.label}` `` with the entry's cover. The comparisons are the non-undone ones for that set. A row with a null tier but a rating gets its tier on the fly (Q10).
  - `setWriteStatements(db, userId, set, changed: RatedItem[]): D1PreparedStatement[]`: one `json_each` UPDATE of `tier, prior_mean, strength, score_locked, rating` (plus `updated_at` on entries). Seasons are guarded by `entry_id IN (SELECT id FROM entries WHERE user_id = ?)`.
  - `GET /api/ratings/:set` → `{ items: SetItem[]; comparisons: Comparison[] }` for the signed-in user only.
  - `POST /api/ratings/:set/save`, body `SavePayload` (limits in Q11) → `{ items: SetItem[]; entries: Entry[] }`. These are the changed items, plus the full Entry rows for entry sets. In memory it applies moves (`applyMove`) and then `refitSet` (base and new non-undone picks). It runs 1 batch: comparisons INSERT … SELECT FROM `json_each` (ids from `crypto.randomUUID()` inside the JSON), the set UPDATE, `DELETE FROM compare_queue … IN json_each(done)`, and the Entry re-select. Total ≤ 10 queries with sign-in.
  - Entry/season edits: `POST /entries` and `PATCH /entries/:id` accept `tier` (without `rating`, Q8) and `scoreLocked`. A `rating` key goes through `applyTyped`, a `tier` key that changes the tier through `applyMove`, and `scoreLocked` alone through lock at the current rating (prior from it) or unlock. Then the Worker calls `loadSet` and `refitSet` and batches the edit with the set UPDATE. A tier-only create enqueues like a typed rating (Q15). Seasons get the same through `POST /entries/:id/seasons` and `PATCH /seasons/:id`, with no enqueue.
  - `DELETE /entries/:id` also runs `DELETE FROM comparisons WHERE user_id = ? AND (winner_id = ? OR loser_id = ?)` (Q22).
  - `GET /api/export` adds `comparisons: Comparison[]` (all of them, undone included, every set) to its body (3 queries).

- [ ] **Step 1: Write the failing tests**

```ts
it('save stores picks, moves and done; returns the Worker fit, which matches refitSet', ...)
it('save keeps undone picks with undone_at and they count for nothing', ...)
it('save with a title deleted mid-session: unknown ids dropped, 200, others fitted', ...)   // Review Focus 2
it('save of 1000 picks and 1000 moves runs in ≤ 10 queries', ...)                           // count via a D1 spy as compare.test.ts does
it('400 for > 1000 picks, a bad tier, a non-boolean undone, an unknown set', ...)
it("B can't read or change A's comparisons", ...)    // GET returns only B's (empty); B's save naming A's ids changes nothing
it('PATCH rating keeps the picks and re-fits; PATCH tier moves keeping its rough place (Q23) and unlocks; scoreLocked pins the number', ...)
it('a typed number in another tier counts as a move: old picks stop counting', ...)
it('tier-only create gets the middle score and joins the queue when Ask allows', ...)
it('season edits re-fit the season set, never the list', ...)
it('deleting an entry deletes its comparisons', ...)
it('export includes tiers on rows and every comparison', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/worker -- test/ratings.test.ts test/entries.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add a `// N queries` comment on each route, as the existing ones have.
- [ ] **Step 4:** Run the whole worker suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker): ratings routes; every rating write re-fits its set`.

### Task 8: Per-list tier settings route — **parallel-safe (no UI)**

**Files:**
- Modify: `packages/worker/src/api/ratings.ts`, `packages/worker/src/api/me.ts` (`sanitizeSettings` drops `tiers`), `packages/worker/src/auth/access.ts` (keep only the known `UserSettings` keys when loading, so stale Sheet keys stop riding along)
- Test: `packages/worker/test/ratings.test.ts`, `packages/worker/test/me.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 and 7.
- Produces: `PUT /api/ratings/tiers/:list`, body `{ tiers: TierSet | null }` (null = back to defaults) → `{ settings: UserSettings; entries: Entry[] }` (the changed entries; season rows are updated too). It runs `refitSet(…, { rangeChanged: true })` over the list set and its season set, then 1 batch: settings UPDATE, entries UPDATE, seasons UPDATE, Entry re-select. Total ≤ 10 queries.

- [ ] **Step 1: Write the failing tests**

```ts
it('changing Loved to 8.5–10 moves no titles between tiers and spreads their scores', ...)
it('other lists keep their tiers and scores', ...)
it('null resets to defaults; an invalid TierSet is 400 and changes nothing', ...)
it('PUT /api/me/settings ignores a tiers key', ...)
it('the settings loader drops unknown stored keys', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/worker -- test/ratings.test.ts test/me.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the worker suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker): per-list rating tiers`.

### Task 9: `PRIOR_SD` tuning on Dan's lists — **parallel-safe (no UI); Dan's pick gates Task 16**

**Files:**
- Create: `packages/worker/scripts/tune-prior-sd.ts` (run with the worker's `tsx`; covered by `tsc -p scripts`)
- Modify (after Dan picks): `packages/shared/src/ratings/score.ts` (`PRIOR_SD`), and add the line to the new `docs/decisions-phase3c.md`

**Interfaces:**
- Consumes: Tasks 1–3. Input: Dan's "Export my data" JSON. Dan provides it when this task starts: ask him for it then. Save it to `/home/claude/scratch/` and keep it out of the repo.
- Produces: `npx -y npm@11 exec -w packages/worker -- tsx scripts/tune-prior-sd.ts <export.json> [category=anime]`. It prints, for `PRIOR_SD` ∈ {0.5, 0.75, 1, 1.5, 2, 3}, a table for each of three scenarios:
  (a) the two strongest titles of the top tier, the lower one wins (Dan's FMA/Edgerunners case);
  (b) two Liked titles about 0.3 apart, the lower one wins;
  (c) scenario (b) answered the same way 3 times.
  Each table shows the before and after shown scores of the two titles and how many other titles' shown scores changed.

- [ ] **Step 1:** Write the script. Check it with `--self-test`, which runs scenario (a) on `DAN_TOP14` and prints 9.98/9.96 at 1.0.
- [ ] **Step 2:** Run it on Dan's export and send Dan the tables with one line each on the trade-off: larger values make each pick count more and typed numbers count less (spec §10).
- [ ] **Step 3:** Set `PRIOR_SD` to Dan's pick and record it in `docs/decisions-phase3c.md`. Tests that pin 9.98/9.96 pass `priorSd: 1` explicitly, so they keep passing. Run `npx -y npm@11 test -w packages/shared`. Expected: PASS.
- [ ] **Step 4:** Commit `chore(ratings): PRIOR_SD tuned on Dan's lists`.

### Task 10: Web data layer, sorting and stale caches — **no UI; after Tasks 6–8**

**Files:**
- Create: `packages/web/src/data/ratings.ts`
- Modify: `packages/web/src/lists/sort.ts` (rating key uses `compareRated`), `packages/web/src/ratings/topFive.ts` (unchanged call, now strength-aware), `packages/web/src/ratings/stats.ts` (`ListStats.tiers: [number, number, number, number]`, counts by `tier`; All media has none), `packages/web/src/data/useEntries.ts` (normalize cached rows: missing tier/priorMean/strength → null, scoreLocked → false)
- Test: `packages/web/src/data/ratings.test.tsx`, `lists/sort.test.ts`, `ratings/stats.test.ts`, `ratings/topFive.test.ts`

**Interfaces:**
- Consumes: Task 7 and 8 routes.
- Produces:
  - `ratingSetKey(set: RatingSet)` = `['rating-set', set]`
  - `useRatingSet(set: RatingSet, enabled = true)`: the query for `GET /api/ratings/:set`
  - `saveRatings(qc, set, payload: SavePayload): Promise<boolean>`. It writes the returned entries to the entry cache (`writeEntry`), invalidates `ratingSetKey(set)`, the queue (`COMPARE_QUEUE_KEY`) and, for season sets, `['seasons']`. It returns false on failure.
  - `saveTiers(qc, list: Category, tiers: TierSet | null): Promise<boolean>`: writes the returned entries and settings (`ME_KEY`).

- [ ] **Step 1: Write the failing tests**

```ts
test('equal shown score: higher tier first, then stronger first', ...)                            // sort.test
test('a pre-3c cached row (no tier fields) sorts and counts as unrated tier without throwing', ...) // Review Focus 1
test('stats count titles per tier per list', ...)
test('saveRatings writes returned entries and invalidates the set, queue and seasons', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/web -- src/data/ratings.test.tsx src/lists/sort.test.ts src/ratings`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): ratings data layer; sort by strength within a score`.

### Task 11: Fix my ratings, placing and rating unrated (Compare screen) — **UI; after Task 0 approval, Tasks 5 and 10**

**Files:**
- Create: `packages/web/src/screens/compare/useRatingFlow.ts`, `screens/compare/TierQuestion.tsx`, `screens/compare/MoveMenu.tsx`, `packages/web/src/design/components/TierPicker.tsx`
- Modify: `screens/CompareScreen.tsx`, `screens/compare/CompareHome.tsx`, `PairView.tsx`, `ReviewView.tsx`, `design/compare.css`
- Delete: `screens/compare/useCompareFlow.ts` (Task 12 deletes the engine it imports)
- Test: `screens/CompareScreen.test.tsx` (rewrite), `screens/compare/PairView.test.tsx`

**Interfaces:**
- Consumes: `createRatingSession` (Task 5), `useRatingSet`/`saveRatings` (Task 10), `useCompareQueue`/`dropFromQueue` (existing), `tiersFor`.
- Produces:
  - `useRatingFlow(opts?: { place?: string; random?: () => number })` with views `loading | off | home | tiers (list chosen: All tiers + four tier chips with counts) | ask | tier | review | saving | saved | nothingLeft`. It starts on the queue as in Phase 3 (P3, P4) when Ask allows (Q15), or on `place`.
  - `TierPicker({ names, ranges, value, onPick })`: four large buttons, each showing the name and its range ("Loved · 9–10"). Task 13 reuses it.
  - `PairView` gains `settled?: { checked: number; total: number }`, `tierNames: string[]` and `onMove(id, tier)`. Each card gets a "Belongs in another tier" button as a sibling of the card button (never nested). It opens `MoveMenu` with the other three tiers. The existing keys, swipe and flip stay.
  - `ReviewView` drops `style`. A row with a tier change shows "Liked → Loved" under the title. The copy is "Based on your picks. Nothing is saved until you press Save."

Copy: home heading "Fix my ratings". Its sub reads "Pick a list. The app asks about the two closest titles in a tier; stop any time." The unrated section heading is "Rate finished things with no score". The tier question reads "Which tier is {title} in?". Nothing left: "Nothing left to ask in {list}{ · tier}. Your order is as settled as your picks make it." The bar label reads "{checked} of {total} neighbours checked". Placing progress reads "Placing {title} · pick {n} of about {⌈log₂(tier size+1)⌉}".

- [ ] **Step 1: Write the failing tests** (Testing Library with the fake backend):

```ts
it('home: lists with ≥2 rated, season tabs when on, tier chips with counts; Off and Only-for-new texts', ...)
it('fix: asks the two closest titles in the chosen tier; About the same, Skip, Stop, Back; review shows old → new; Save posts the payload', ...)
it('Belongs in another tier moves the title, the next question changes, and the review shows the tier change', ...)
it('the settledness bar shows checked of total and grows after a pick between neighbours', ...)
it('queue: places each new rating with ~log2 picks; Save drops it from the queue; Don\'t save keeps it', ...)
it('unrated: tier question, then placement, then review', ...)
it('nothing left to ask: a one-title tier ends at once with the friendly line', ...)   // Review Focus 4
it('a failed save keeps the review and shows the toast; Save again posts the same payload', ...)
it('/compare?place=<id> places that title only, then returns to its list', ...)
it('keys and swipe still answer (←, →, ↓, S, Backspace; ±80 px)', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/web -- src/screens/CompareScreen.test.tsx src/screens/compare`. Expected: FAIL.
- [ ] **Step 3:** Implement against the approved FixRatings boards.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): Fix my ratings on the tier model`.

### Task 12: Delete the Sheet engine and its settings — **after Task 11**

**Files:**
- Delete: `packages/shared/src/compare/` (all), `packages/shared/test/compare.*.test.ts`, `packages/shared/test/helpers/scriptCompare.ts`, `packages/web/src/data/compare.test.tsx` cases for `saveCompareChanges`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/types.ts` (drop `compareStyle`, `compareRoom`, `compareWindow`, `COMPARE_STYLE`, `COMPARE_ROOM`), `packages/shared/src/importLimits.ts` (drop `COMPARE_SAVE_MAX_CHANGES`), `packages/worker/src/api/compare.ts` (drop `/save` and `parseChanges`), `packages/worker/src/api/me.ts`, `packages/web/src/data/compare.ts` (drop `saveCompareChanges`), `packages/web/src/import/parseWorkbook.ts` (stop reading Re-rating style / When there's no room / Compare within), `packages/web/src/screens/ImportScreen.tsx` (the "compare options" check reads only `compareAsk`), `packages/web/src/screens/settings/CompareOptions.tsx` (Ask to compare only), and their tests (`me.test.ts`, `auth.test.ts`, `types.test.ts`, `parseWorkbook.test.ts`, `CompareOptions.test.tsx`, `compare.test.ts`)

- [ ] **Step 1:** Run `git tag phase3-sheet-compare phase3` (Q1).
- [ ] **Step 2:** Update the tests first: `parseWorkbook` returns no `compareStyle`/`compareRoom`/`compareWindow` from a Sheet that has them. `POST /api/compare/save` is 404. The Comparing card shows only "Ask to compare".
- [ ] **Step 3:** Run `npx -y npm@11 test`. Expected: the updated tests FAIL.
- [ ] **Step 4:** Delete and modify the files above. Then run `npx -y npm@11 run typecheck`, and `grep -rn "compareStyle\|compareRoom\|compareWindow\|rescore\|placeScore" packages --include=*.ts --include=*.tsx` (excluding node_modules). Expected: typecheck clean and no matches.
- [ ] **Step 5:** Run `npx -y npm@11 test`. Expected: PASS.
- [ ] **Step 6:** Commit `refactor: remove the Sheet compare engine and its settings`.

### Task 13: Rate a new title by tier, and the entry's tier and lock — **UI; after Task 0 approval and Task 11**

**Files:**
- Modify: `packages/web/src/screens/AddEntry.tsx`, `packages/web/src/hooks/useAddEntry.ts` (`AddInput.tier?: Tier`; `add` returns `Promise<Entry | null>`), `packages/web/src/screens/ListScreen.tsx` (wires "Add and place it" to `navigate('/compare?place=' + id)`), `packages/web/src/screens/EntryDetail.tsx` (rating tile: tier chips from the list's tier names and a "Lock score" switch with the hint "Shows exactly this number; picks won't move it.")
- Test: `packages/web/src/screens/AddEntry.test.tsx` (new), `EntryDetail.test.tsx`

**Interfaces:**
- Consumes: `TierPicker` (Task 11), `tiersFor`, `tierFor`, the Task 7 entry fields.

- [ ] **Step 1: Write the failing tests**

```ts
it('tapping Liked posts { tier: 2 } and no rating', ...)
it('typing 9.2 highlights Loved and posts { rating: 9.2 }', ...)
it('Add and place it shows only when Ask is Both or Only for new ratings and something is rated; it opens /compare?place=<id>', ...)
it('the list’s own tier names show (custom Anime tiers)', ...)
it('EntryDetail: a tier chip PATCHes { tier }; the lock switch PATCHes { scoreLocked: true }', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/web -- src/screens/AddEntry.test.tsx src/screens/EntryDetail.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement against `TierPicker.dc.html`.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): rate by tier, Add and place it, tier and lock on the entry`.

### Task 14: Re-tier review — **UI; after Task 0 approval and Task 10**

**Files:**
- Create: `packages/web/src/screens/RetierScreen.tsx` (route `retier/:set`)
- Modify: `packages/web/src/routes.tsx`, `packages/web/src/screens/ImportScreen.tsx` (done state: "Check your tiers" → `/retier/<first imported list>`), `packages/web/src/screens/settings/SettingsLinks.tsx` ("Re-tier review" → `/retier/anime`, with list chips on the screen to switch), `design/compare.css`
- Test: `packages/web/src/screens/RetierScreen.test.tsx`

**Interfaces:**
- Consumes: `useRatingSet`, `saveRatings` (moves only, `picks: []`, `done: []`), `tiersFor`, `MoveMenu` (Task 11).

Behaviour: four sections in tier order (Loved first), each with "name · count", and rows of cover, title and shown score, ordered by `compareRated`. On PC (`useIsWide`) rows drag between sections with HTML5 drag and drop. Every row also has a "Move to…" button (a `Sheet` on phone, `MoveMenu` on PC), which is the keyboard and screen-reader path. Moved rows show "was {old tier}". The footer reads "Save ({n} moved)" and is disabled at 0. Leaving discards the moves. Intro copy: "Check which tier each title is in. Scores from the Sheet may have been lowered by its old compare system, so some may belong higher. A moved title starts near the edge of its new tier closest to where it was."

- [ ] **Step 1: Write the failing tests**

```ts
it('lists every rated title under its tier with counts', ...)
it('phone: Move to… Loved marks the row "was Liked" and Save posts { moves: [{ id, tier: 3 }] }', ...)
it('PC: dropping a row on another section moves it', ...)   // fireEvent dragStart/dragOver/drop
it('Save disabled with nothing moved; failed save keeps the moves and shows the toast', ...)
it('Import done offers Check your tiers', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/web -- src/screens/RetierScreen.test.tsx src/screens/ImportScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement against `Retier.dc.html` / `RetierPC.dc.html`.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): Re-tier review`.

### Task 15: Tier editor in Settings, and Stats per tier — **UI; after Task 0 approval and Task 10**

**Files:**
- Create: `packages/web/src/screens/settings/TierEditor.tsx` (route `settings/tiers`)
- Modify: `packages/web/src/routes.tsx`, `screens/AppearanceScreen.tsx` (the Comparing card adds the "Rating tiers" and "Re-tier review" links under Ask to compare), `screens/StatsScreen.tsx` (per-list line "Loved 14 · Liked 22 · Fine 6 · Didn't like 2" in that list's names; phone cards and the PC table)
- Test: `packages/web/src/screens/settings/TierEditor.test.tsx`, `StatsScreen.test.tsx`

**Interfaces:**
- Consumes: `saveTiers` (Task 10), `validateTierSet`, `DEFAULT_TIERS`, `tiersFor`.

Behaviour: list chips across the top (enabled lists). The four rows run top tier first, each with a name field and a "from" number. Loved reads "from 9.0 to 10", and Didn't like reads "from 0". "Reset to defaults" sends `null`. Save stays disabled until the set is valid. Each invalid field shows its own error ("Each tier needs at least 0.5", "Names must be different", "One decimal"). After saving, the toast reads "Tiers saved. Scores on {list} spread over the new ranges."

- [ ] **Step 1: Write the failing tests**

```ts
it('shows the list’s current tiers; editing Loved to 8.5 and Save PUTs that list only', ...)
it('invalid sets block Save with the field errors', ...)
it('Reset to defaults PUTs null', ...)
it('Stats shows counts per tier with each list’s own names', ...)
```

- [ ] **Step 2:** Run `npx -y npm@11 test -w packages/web -- src/screens/settings/TierEditor.test.tsx src/screens/StatsScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement against `TierEditor.dc.html`.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): per-list tier editor; Stats per tier`.

### Task 16: Compare back on, end-to-end, setup and decisions — **after Tasks 9 and 11–15**

**Files:**
- Delete: `packages/web/src/features.ts`, `packages/web/src/test/flags.ts` (and its mock in `test/setup.ts`)
- Modify: every `COMPARE_ENABLED` use (`data/compare.ts`, `AppearanceScreen.tsx`, `MoreScreen.tsx`, `SettingsLinks.tsx`, `routes.tsx`, `SideNav.tsx`, `CompareBanner.tsx`) to the enabled branch; `packages/web/e2e/core.spec.ts`; `docs/SETUP.md` (the update steps apply `0005_tier_ratings.sql` before deploy, as for 0002); `docs/decisions-phase3c.md` (new: the rulings Q1–Q23, `PRIOR_SD`, the simulation threshold and anything decided while building); `README.md` if it mentions Compare
- Test: `packages/web/e2e/core.spec.ts`

- [ ] **Step 1: Write the failing e2e test.** Replace both Compare tests with one: add three rated anime in Liked (8.0, 8.1, 8.2) → the banner shows +3 → Compare → place each (answer the first card) → review old → new → Save → the banner count is back to the start. Then: Compare → Anime → Liked → one pick → "Belongs in another tier" → Loved → Stop and review → Don't save → nothing changed (compare `GET /api/entries?category=anime` before and after).
- [ ] **Step 2:** Run `npx -y npm@11 run e2e`. Expected: FAIL (Compare hidden).
- [ ] **Step 3:** Delete the flag and keep the enabled branches.
- [ ] **Step 4:** Run `npx -y npm@11 test`, `npx -y npm@11 run typecheck` and `npx -y npm@11 run e2e`. Expected: all PASS.
- [ ] **Step 5:** Write `docs/decisions-phase3c.md` and update `docs/SETUP.md`.
- [ ] **Step 6:** Commit `feat: tier ratings replace the Sheet compare; Compare is back`.

---

## Parallel work

Tasks 1 → 2 → 3 → 4 → 5 (shared, pure) and Tasks 6 → 7 → 8 (Worker, needing only Task 1, plus Task 3 for 7–8) touch no UI. They can run alongside the mockup approval (Task 0) and other phase3 work. Task 9 needs Tasks 1–3 and Dan's export. Task 10 needs Tasks 6–8. Tasks 11, 13, 14 and 15 wait for Task 0. Task 12 follows Task 11. Task 16 is last.

## Dan's answers (2026-11-15)

1. Typing a new number on a compared title keeps its picks; Lock pins it exactly (Q8).
2. A title moved to another tier keeps its rough place (Q23, amends spec §5.2).
3. Season tabs use their parent list's tiers (Q4).
4. The migration is `0005_tier_ratings.sql`, because the nav/profile plan takes 0003 and 0004. Apply them in order.
