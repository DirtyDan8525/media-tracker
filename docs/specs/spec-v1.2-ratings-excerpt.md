# Media Tracker App: Design Spec v1.2 — ratings-relevant excerpt (authoritative; copied from the claude.ai Project 2026-11-15)

Amended by docs in this folder: `decisions-2026-11-15.md` (wins on conflict). Notably: **tiers are per list** (not shared).

## 3. Architecture (ratings module)
- **`ratings`** (shared, pure functions; replaces the Sheet's `rescore` / `placeScore`): `tierFor(score, tiers)`, `priorFromScore(score, tier)`, `fitTier(titles, comparisons)` (the Bradley-Terry fit, §5.2), `scoreOf(strength, tier)`, `nextPair(titles, comparisons)` (picks the most useful question), and `placementSearch` (binary search inside a tier). Same code on the device and in the Worker, so both always agree on a score.

## 4. Data model (D1) — ratings parts
- `users.settings_json` holds tab toggles, Ask to compare, rating tiers (now per list), custom colors.
- `entries`: … rating (decimal, nullable: the shown score, saved after every fit so lists, sorting, Top 5, Stats and friends never need to run the model), tier (0–3, null when unrated), prior_mean (real: where the title starts inside its tier, §5.2), score_locked (boolean), …
- `seasons`: id, entry_id, label, rating, tier, prior_mean, score_locked, notes (Season Avg is calculated from these)
- `comparisons`: id, user_id, category (including anime_seasons and tv_seasons), winner_id, loser_id, is_tie, created_at, undone_at (Back sets this rather than deleting)
- `compare_queue`: user_id, entry_id, added_at  (already exists — migration 0002)
- Comparisons are never shown to friends.

## 5.1 (sorting)
- Sorting by rating: highest first, unrated at the bottom, then by title. Within the same shown score, titles are ordered by their strength (§5.2), so a pick always shows up in the order.

## 5.2 Ratings and Compare ("fix my ratings")

**Why this replaces the Sheet's system.** In the Sheet, every pick re-fits the whole list with a fixed 0.1 gap between neighbours and a cap at 10, and the only way to make room at the top is down. Run on Dan's top 14 Anime, one pick ("FMA: Brotherhood beats Cyberpunk: Edgerunners", both 10.0) lowered 12 titles by 0.1 each. Placing a new title also only compares it with titles within ±1 of its typed score, so a badly typed score can't be fixed. The design below has neither problem.

**Tiers.** Every rated title sits in one of four tiers, and each tier is a score range:

| Tier | Default range |
|---|---|
| Loved | 9.0 – 10.0 |
| Liked | 7.5 – 9.0 |
| Fine | 6.0 – 7.5 |
| Didn't like | 0.0 – 6.0 |

Names and boundaries are editable in Settings — **per list** (decision 2026-11-15; spec v1.2 said shared). Changing a boundary moves no titles between tiers; their scores spread over the new range.

**How a score is worked out.** Each title has a hidden strength. Its score is `low + (high − low) × sigmoid(strength)`, so a score can never leave its tier's range. Strengths come from a Bradley-Terry fit (the model behind Elo) over that tier's comparisons, with a starting point per title:
- **Starting point (`prior_mean`):** if you typed a number, it's the strength that gives back that number, clamped to 3–97% of the range; if you only picked a tier, it's the middle of the range. Prior spread 1.0 (one constant, `PRIOR_SD`, tuned in Phase 3).
- **Picks:** "A is better" is a win for A, and "About the same" is half a win each. The fit maximizes the likelihood of all the tier's picks plus the starting points (Newton steps, deterministic, a few milliseconds for hundreds of titles).
- **What this guarantees (each one is a test):** a score stays in its tier's range; picks in one tier never change scores in another tier; a pick never lowers the winner or raises the loser; a pick has no built-in push in either direction (titles linked to the two by earlier picks can move a little, either way, but across 2,000 random test cases the tier average went up 50.7% of the time and down the rest, with an average change of 0.00004 of a point); there's no fixed gap and no capping, so ties are allowed; an imported score with no picks shows exactly as it was.
- **Shown score:** one decimal. When two neighbours would show the same number but your picks ordered them, both show two decimals, as the Sheet does today.
- **Locked score:** an option on any title. It shows exactly the number you typed, and it still counts as an opponent for the others.

**Flows.**
- **Rate a new title:** tap a tier (four large buttons) or type a number, which picks the tier for you. If Ask to compare allows it, "Place it" runs a binary search against the **whole tier**, ordered by strength (no ±1 window): about log₂(tier size) + 1 picks, so about 6 for a tier of 40. Skip or Stop keeps the estimate so far.
- **Fix my ratings:** choose a category (and optionally one tier). The app asks the most useful question each time: the two titles in the same tier with the closest strengths, preferring pairs not asked yet. A bar shows how settled the order is. Keep going as long as you like.
- **Rate finished titles with no score:** each one gets a tier, then is placed as above.
- **Re-tier review:** every tier listed with its titles. On PC, drag titles between tiers; on a phone, use "Move to…". Offered right after import, and from Settings.
- **During any comparison**, each title has a "Belongs in another tier" button.
- **Answers:** A, B, About the same, Skip, Stop, Back. Back undoes the last pick (sets `undone_at`) and fits again. On PC: arrow keys, ↓ for About the same, S and Backspace. On a phone: tap, and swipe left or right.
- **Review and Save:** the end of a session shows each changed title as old → new. Nothing is saved until you press Save.
- New ratings join the queue, and a home banner shows "N new ratings to double-check".
- **Feed:** a "re-rated" post is created when Save changes a title's shown score by 0.5 or more, or moves it to another tier. (Feed is Phase 4; record what's needed.)

**Season tabs** (Anime Seasons, TV Seasons) use the same tiers and model, and their comparisons are kept apart from the main tabs.

**Settings:** Ask to compare (Both / Only when I start it / Only for new ratings / Off) and the tier names and boundaries. The Sheet's Re-rating style, When there's no room and Compare within settings are dropped.

## 5.3 (Stats addition)
- Stats: … Also a count per tier.

## 5.5 Import (ratings parts)
- Brings over … Settings (theme, tab toggles, Ask to compare). The Sheet's other compare settings are ignored.
- Each rated title goes into the tier whose range contains its score, with its starting point set so the shown score is exactly what the Sheet had. No comparisons are imported.
- After import, the app offers the Re-tier review (§5.2), explaining that scores from the Sheet may have been lowered by its old compare system. (Dan's data is ALREADY imported: existing rated entries need tiers + prior_mean assigned by a migration/backfill, scores unchanged.)

## 5.6 Settings
- Settings: theme and custom colors, tab toggles, Ask to compare, rating tiers, username and display name, invite link.

## 6. Design
- Screens are mocked up first and Dan approves them before they're built: … Compare, tier picker and Re-tier review …

## 7. Errors and limits (ratings parts)
- Writes go into a queue on the device while offline …; comparisons made offline are sent in order and the tier is fitted again on the server with the same `ratings` code.
- "Export my data" includes tiers and comparisons.

## 8. Testing — ratings
- Each guarantee in §5.2 as its own test (stays in range, no effect across tiers, winner never lowered and loser never raised, import keeps scores exactly), plus a no-drift test: over 2,000 random tiers and picks, the average change in tier average is under 0.001 and it goes up in 45–55% of cases.
- A regression test using Dan's top 14 Anime and the pick "FMA: Brotherhood beats Edgerunners": no other title's shown score changes.
- Back followed by the same pick gives the same scores.
- The fit is deterministic.
- A simulation test: simulated people with hidden true scores type noisy scores, then answer picks with some noise. Over 50 simulated people, agreement between the fitted order and the true order (Kendall tau) must rise as picks are added, and the questions chosen by `nextPair` must beat random pairs. The pass threshold is set from the first run and then held fixed.
- A friend can never read comparisons.

## 10. Risks
- **How far one pick moves a score depends on `PRIOR_SD`.** At 1.0, one pick moved FMA: Brotherhood and Edgerunners from 9.97 each to 9.98 and 9.96 in the prototype: the order changed, but the shown scores barely did. A larger value makes each pick count more and typed numbers count less. Tuned on Dan's lists.
