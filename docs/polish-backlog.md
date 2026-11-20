# Polish backlog

Items still open after the 2026-11-19 pass. Everything else from the earlier list was fixed, found already done, or dropped as no longer applicable.

## Skipped
- Stats / lists: Retry shows the full skeleton briefly (TanStack pending state); the alternative (keep the error card visible with a busy button) is a design choice, not a bug fix.
- Phase 4 / 4b: no e2e test of the full social flow (sign up, approve, add friend, react/comment, Add to mine); a large test needing the multi-user dev setup, not a small item.
- Phase 4 / 4b: raise PBKDF2 rounds (30,000 now, for the Workers Free CPU budget) only if the plan becomes Paid (verification already accepts 10k-100k; consider rehash-on-login). Deliberately left as is.
- Phase 4 / 4b: an ex-friend can't see or delete their own old comments on your posts (whole thread hidden); needs a visibility-rule decision.
- Phase 4 / 4b: feed says "marked Elden Ring Playing" where the wireframe says "started"; no "last seen" divider; unread isn't refetched after a reaction. Wording and design calls, left for Dan.
- Phase 4 / 4b: Compare lists have no paging; group Top 5 rows don't link (no ids); friend Stats tab omits histogram and tier lines; exact `@name` search isn't offered when it isn't a prefix match. Feature-sized.
- Phase 4 / 4b: Add to mine (from Compare) stays on the list instead of opening the new entry. DELIBERATE (for adding several); keep as is.
- Phase 4 / 4b sign-in: default to the Sign in tab on devices that signed in before; rate-limit countdown; keep the username after a failed sign-in; in-app Change password; "Done" on the reset-link card. Feature-sized.
- Navigation: no requests dot on the PC side-nav profile row; the PC Friends row already carries the requests count, and a dot needs nav.css (another worker's file).
- Phase 5: Profile and Stats still show Loved/Liked counts (derived from the typed number); replace with number bands or remove, which is a visible design decision.
- Phase 5: titles fitted under Phase 3c get their typed number from the fitted value (a 10 may show 9.97); no code fix, Dan can retype.
- Phase 5: Home tap-to-top, Add-to remembering the last list, Activity's + opening the sheet in place. New behaviour, not polish.
- Phase 5: imported planned titles have no Plan to watch position until the first reorder; assigning one needs an extra import statement, and a full chunk already uses the 50-query D1 budget (packages/shared/src/importLimits.ts), so it needs a re-budget.

## Left to the messages worker (not touched here)
- Chat list preview for a recommendation says "Recommended a title" (the server snippet has no title); include the title.
- "Recommended to you · N" counts all recs, not unread ones.
- Admin Delete account leaves that user's message pictures in R2 (rows cascade); an emptied group stays as an empty row.
- Real R2 pictures and the phone chat height against the bottom bar weren't checked on a device.

## Shelved ideas (Dan, 2026-11-20)
- Pop-out messenger on PC. Options: (1) "Pop out" opens a chat in its own small browser window (easy, about half a day); (2) docked chat boxes bottom-right that stay open across pages (medium, about a day); (3) Document Picture-in-Picture always-on-top window (harder; Chrome/Edge only). Suggested order: 1, then 2.
