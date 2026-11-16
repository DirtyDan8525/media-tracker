# Phase 4 decisions (2026-11-16)

Plans: `docs/plans/2026-11-16-phase4-social.md` (S1–S14) and `docs/plans/2026-11-16-phase4b-own-signin.md` (A1–A11, wins on conflict).

- S1/S2 (Cloudflare API admin invites) and Task 1 (iPhone Access check): **dropped**. Dan chose the app's own username + password sign-in with in-app approval (4b). No Cloudflare API token, no `invites` table.
- S3–S14 built as written, with: friend lists take 3 queries (relation needed for 403); `GET /api/friends/entries` omits friends with no rated visible entries; group Top 5 drops any private entry; a bare "added" post shows only under You (also your own); unread counts posts by when they started.
- A2: 30,000 PBKDF2 rounds (Dan stays on Workers Free, 10 ms CPU); verification accepts any stored 10k–100k.
- A4: Origin check on POST/PUT/PATCH/DELETE. A8 also hides comments, reactions and requests from non-active users. Extra route `GET /api/auth/reset/:token` (username for the reset page).
- Dan's answers: Admin can remove access (data stays); group Top 5 needs 2 raters; invite link = instant friendship, username request needs accepting.
