# Phase 3c build decisions (tier ratings)

Judgement calls and rulings for Phase 3c, which replaced the Sheet-style Compare with per-list tiers and a Bradley-Terry fit, and switched Compare back on. The plan is `docs/plans/2026-11-15-phase3c-tier-ratings.md`; Dan's answers of 2026-11-15 are in `docs/specs/decisions-2026-11-15.md`. Each entry says what it costs if wrong.

## Values to know

- **`PRIOR_SD = 1.0` is provisional.** It lives in `packages/shared/src/ratings/score.ts`. Task 9 (tuning it on Dan's own lists with `scripts/tune-prior-sd.ts`) has not run, because it needs Dan's "Export my data" file. Compare ships with 1.0, the plan's starting value. Larger values make each pick count more and typed numbers count less. When Dan sends the export, tuning is a constant change plus one line here. Tests that pin 9.98 / 9.96 pass `priorSd: 1` explicitly, so they keep passing. Cost if wrong: after the change, scores that picks have already moved shift a little on the next fit.
- **Simulation threshold 0.03.** The simulation test requires the question chooser to beat random pairs by at least 0.03 (the margin sits below every seed's result; the standard error is about 0.007 each). It is held fixed. Cost if wrong: a harmless change to the chooser could trip the test, which is the reason for the margin.
- **Default tiers** for every list: Loved 9 to 10, Liked 7.5 to 9, Fine 6 to 7.5, Didn't like 0 to 6. Tiers are per list.

## Rulings from the plan (Q1 to Q23)

- **Q1: the Sheet engine is deleted** (Task 12): `packages/shared/src/compare/*` and its tests, `POST /api/compare/save` (now answers 410), `COMPARE_SAVE_MAX_CHANGES`, and the Re-rating style, When there's no room and Compare within settings. The queue stays. The old engine is recoverable from the local tag `phase3-sheet-compare`. `reference/MediaTrackerCovers.gs` stays.
- **Q2: tier numbering.** `Tier = 0 | 1 | 2 | 3`, 3 = Loved. A boundary value belongs to the higher tier (6.0 is Fine, 7.5 Liked, 9.0 Loved); 10 is Loved, 0 is Didn't like.
- **Q3: tier settings shape.** `UserSettings.tiers: Partial<Record<Category, TierSet>>` (missing means defaults), `TierSet = { names, bounds }`. Names are 1 to 20 characters and unique ignoring case. Bounds have one decimal, `0 < b1 < b2 < b3 < 10`, each tier at least 0.5 wide. Only `PUT /api/ratings/tiers/:list` writes them.
- **Q4: season tabs use their parent list's tiers** (Anime Seasons use Anime, TV Seasons use TV), with comparisons kept apart. Confirmed by Dan.
- **Q5: `strength` column.** Entries and seasons store the last fit's strength (null when unrated), so equal shown scores can be ordered without running the model. With no picks, strength equals `prior_mean`.
- **Q6: when `rating` is rewritten.** A fitted title (at least one counted pick with a title now in its tier) gets the shown-score value. An unfitted, unlocked title keeps its stored number, which is why the Sheet's 9.97 and 8.25 show unchanged until a pick involves them. Exceptions: stored strength differs from its prior, rating is null, or the tier's range just changed. Locked titles are never rewritten.
- **Q7: two-decimal rule.** Sort the tier by strength. A fitted title shows two decimals only when an adjacent title shows the same one-decimal text and their strengths differ by more than 1e-9. Unfitted titles never switch to two decimals, which keeps Dan's top-14 regression true.
- **Q8: typing a new number on a title keeps its picks** (confirmed by Dan). The number becomes the new prior. Lock pins it exactly. Changing tier (by typing, chip, Re-tier or "Belongs in another tier") unlocks the title and its old picks stop counting; they are kept and count again if it moves back.
- **Q9: the Worker re-fits the whole rating set** on every write that can move a score, and writes only changed rows, in one `json_each` UPDATE per table. Import and the backfill never fit.
- **Q10: the backfill is lazy, in the Worker.** Migration 0005 only adds columns and a table. `GET /api/me` runs `ensureTiers`, which gives rated rows a tier, prior and strength and leaves `rating` alone. Every read path tolerates null tiers.
- **Q11: save payload** `{ picks, moves, done }`, at most 1000 picks, 1000 moves and 50 done. Picks undone by Back are sent with `undone: true`. The Worker stamps `created_at` itself. Unknown or foreign ids are dropped silently.
- **Q12: fit determinism.** Titles sorted by id and comparisons by (winner, loser, tie) before summing, Newton steps until max change is below 1e-12 or 100 steps. Device and Worker get bit-identical strengths.
- **Q13: placement** is a binary search over the tier order frozen at the start. Moving the placed title to another tier restarts placement there; picks so far still count.
- **Q14: Back** pops the last pick, tier move or tier choice, plus any skips after it.
- **Q15: Ask to compare.** "Place it" and the queue run when Ask is Both or Only for new ratings. Fix my ratings is offered when Ask is Both or Only when I start it. A tier-only rating counts as a new rating for the queue.
- **Q16: rate-new UI.** Four tier buttons and "or type a number" replace the slider. When Q15 allows, the footer has "Add" and "Add and place it".
- **Q17: Fix my ratings scope.** Enabled lists with at least two rated titles, plus season tabs when on. The unrated flow covers list entries only (Completed, or any title on lists without Status).
- **Q18: settledness bar** is "N of M neighbours checked", per tier in scope; with M = 0 the bar is full.
- **Q19: Re-tier review** is its own list of changes with "was Liked" on moved rows. Reached from Settings and the Import done screen. Covers lists and season tabs.
- **Q20: the `COMPARE_ENABLED` flag is deleted** (Task 16), with `features.ts`, `test/flags.ts` and its mock. A flag fixed to true would be dead config.
- **Q21: feed.** The plan said nothing is recorded before Phase 4. Superseded by the merge ruling below: a ratings save logs activity per spec §5.2.
- **Q22: deleting an entry** deletes the comparisons that name it. Comparisons naming a deleted season stay; the fit ignores unknown ids.
- **Q23: a moved title keeps its rough place** (Dan, amends spec §5.2). Its new prior is `priorFromScore(shown score, new range)`, so the top of Liked (8.9) lands at 9.03 in Loved, and the bottom of Loved (9.0) lands at 8.955 in Liked. An unrated title given a tier still starts in the middle.

## Rulings made while building

- Ruling: tier change by typing unlocks unless lock explicit (Q8).
- Ruling: moves = applyMove(base, finalTier); back-to-origin restores and drops from payload; same-tier move no-op; a property test checks the device preview against the Worker's replay.
- Ruling: non-top tiers clamp shown score below upper bound (e.g. 8.9 / 8.99); tier stored explicitly, never re-derived from unchanged number.
- Ruling: fit cost: refit touched tiers only, per connected component; no cap and no warm start; guard 150 titles / 600 picks at 8 ms or less (measured median about 5 ms); conjugate-gradient deferred.
- Ruling: simulation threshold 0.03.
- Ruling: ratings save logs activity per spec §5.2 feed rule: "re-rated" when Save changes a title's shown score by 0.5 or more or moves it to another tier; never log rows changed only by re-fit side effects. Supersedes Q21.
- Ruling: Task 16 proceeds with PRIOR_SD = 1.0; Task 9 tuning runs when Dan sends his export (constant change only).
- Merge rules between the nav/profile branch (migrations 0003 and 0004) and this one (0005): POST/PATCH /entries put the activity statement first, then the update and rating statements, and activity uses the final rating (covers tier-chip moves); the old compare save goes (Task 12 deleted it) and so does the nav branch's activity statement in it; migrations 0003, 0004 and 0005 coexist and apply in order. How the merge applied them is below.
- Worker hardening after review: `ensureTiers` failures are caught so sign-in never breaks; the old compare save answers 410; timing guards are deterministic (strict performance assertions are opt-in); optimistic guard on set writes (`rating_rev` with a CHECK); `rating` is written only when changed; deletes re-fit; tiers are derived on `GET /entries` and in the export for rows not yet backfilled. Deletes may answer 409, and the client reloads and retries.
- Web data layer: the 409 path awaits the list reload before retrying; saved tier edits update the seasons and neighbours; cached pre-3c rows (no tier, strength or lock) are normalised and render as unrated.
- "Save picks" is the button on an "All good" review when picks or moves should be kept even though no shown score changed. Accepted.
- Parked: two clamped titles can both show 8.99 (order comes from the tiebreak). Narrow; left as is.
- Re-tier review (Task 14 review minors, fixed before Task 16): leaving with unsaved moves asks first (chips, Back, nav); "Check your tiers" appears only when rated rows were imported and points at the first list that has one; moves are locked while a save is in flight; if the reload after a save fails the moves stay with an error and a Reload button, and Save stays off because they are already saved; the Settings link goes to the first enabled list and the route sends a disabled list to the first enabled one; the row's drag styling follows state. A very large drag session (over 1000 moves) is not handled; the Worker's limit would reject it.
- Task 16: Compare is on for everyone. The Settings Comparing row, the Appearance Comparing section, the More and side-nav Compare links, the banner and the Add sheet's "Add and place it" no longer check a flag. The old "Compare is hidden" tests were removed; the enabled tests stay. The e2e test starts from an empty queue (the first e2e test leaves one rating in it), adds three Liked ratings, places and saves them, checks the banner returns to zero, then stops a run with a "Belongs in another tier" move and checks `GET /api/entries?category=anime` is unchanged after "Don't save".

## Merged with the navigation and profile branch (phase3b-nav, 2026-11-16)

Phase 3b (navigation, profile, activity, avatars, search, share) and this branch were merged with a merge commit. Dan's `docs/specs/decisions-2026-11-15.md` governed; both branches had made the same edit to it. What the merge decided:

- **Migrations.** `0003_activity.sql`, `0004_avatars.sql` and `0005_tier_ratings.sql` touch separate tables and columns, so neither was edited. They apply in order on a fresh database (the Worker tests and the e2e servers both start from one). `docs/SETUP.md` "Updating" lists all three and the read-only D1 probe.
- **Activity on entry writes.**
  - `POST /entries` batches the INSERT, then the `added` row, then the set UPDATE and the queue. The `added` row has to follow the INSERT because of its foreign key. It carries the final rating: the middle score for a tier-only add, or the re-fitted number.
  - `PATCH /entries/:id` batches the activity rows first, then the update, then the rating statements. A rating row is written only when the request edits the rating (a typed number or a tier chip) and the edited title's final rating differs from the stored one. It records that final rating. A lock-only edit logs nothing.
  - Neighbours re-written by either write never log.
- **Activity on a ratings save** (`POST /api/ratings/:set/save`). It follows the spec §5.2 feed rule, which supersedes Q21.
  - Only titles the session named are logged: either side of a counted (not undone) pick, or a move. Of those, a title logs when its shown score moved by 0.5 or more, when it changed tier, or when it got its first rating.
  - It writes one INSERT before the set UPDATE, with three parameters and the rows as one JSON parameter. The payload is `{ from, to, via: 'compare' }`, the same shape `mergeActivity` already folds.
  - A save that answers 409 rolls the rows back with the batch.
  - Season sets log nothing, because activity rows name entries.
  - A 1000-pick, 1000-move save stays at 10 queries or fewer and 100 parameters or fewer per statement.
  - Re-tier review saves through the same route, so its moves log the same way. Changing a list's tier ranges (`PUT /api/ratings/tiers/:list`) logs nothing.
- **The old compare save.** It is gone along with the nav branch's `activityForCompareSave`. The `compare_queue` routes stay, because the banner, the bottom bar, the side nav and More still read the queue.
- **`COMPARE_ENABLED`.**
  - The flag is gone from the nav branch too. Bottom-bar slot 4 and the PC side nav always show Compare, per the Amendments.
  - The nav branch's flag-off tests were dropped, and its flag-on tests now run unconditionally.
- **Settings and More.**
  - The rating tier links (Rating tiers and Re-tier review) are in Profile → Settings, in the "Appearance and comparing" group next to Comparing. They are also on the Appearance page's Comparing section.
  - More keeps the B20 board: Ratings (Compare, Top 5, Stats), Your data, and App. The board has no Re-tier review row, so More has none.
- **Profile button (B9).** The Compare and Re-tier headers carry the profile button (phone).
- **Settings shape.** `UserSettings` keeps the nav branch's `searchScope` and this branch's `tiers`. The removed Sheet compare keys stay dropped. `sanitizeSettings` accepts `compareAsk` and `searchScope`.
- **`GET /api/me`.** It runs the lazy tier backfill (failures are logged and never break sign-in) and returns the nav branch's `meBody`, which includes `avatarAt` and `createdAt`.
