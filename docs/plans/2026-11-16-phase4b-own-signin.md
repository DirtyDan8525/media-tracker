# Phase 4b: own sign-in with approval (replaces Cloudflare Access)

**Why (Dan, 2026-11-16):** friends should sign up easily on a normal-looking page, and Dan approves them inside Media Tracker. Chosen: **username + password** (no email service, no domain, works inside an iPhone home-screen app because nothing redirects away). Options weighed: Access branded (rejected: still Cloudflare's card, Dan must pre-approve emails), Google sign-in (iPhone home-screen apps often bounce to Safari and lose the session), email codes (needs a domain plus the paid Workers plan or a mail service), passkeys (less familiar).

**Supersedes:** Phase 4 Task 7 and S1 (Cloudflare API policy edits), S2's admin link, the `invites` table, `CF_*` config and SETUP §12; Task 1 (iPhone Access check) is replaced by a check after deploy. Phase 5's "swap the auth module" is pulled forward. Everything else in Phase 4 stands.

## Rulings

- **A1 Accounts.** `POST /api/auth/signup { username, password, displayName? }` creates `status = 'pending'` and signs in. Username rules as today (`PUT /api/me/username`); password 8–128 chars. `users.email` stays NOT NULL UNIQUE: password-only users get `u:<id>` (never shown). The admin is the user whose `email = ADMIN_EMAIL` (Dan's existing row) or, on a fresh install, the first signup — created `active`, `is_admin = 1`.
- **A2 Passwords.** PBKDF2-SHA256 via WebCrypto, 100,000 iterations (Workers' maximum), 16-byte salt, stored `pbkdf2$100000$<salt b64>$<hash b64>`; constant-time compare. Unknown username still runs one hash (no timing oracle).
- **A3 Sessions.** 32 random bytes, base64url, in cookie `mt_session` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`). Table `sessions (token_hash PK, user_id FK CASCADE, created_at, expires_at, last_used_at)`; only the SHA-256 is stored. Expiry 365 days, extended (rolling) when used more than a day after `last_used_at`. `POST /api/auth/logout` deletes the row and clears the cookie.
- **A4 CSRF.** Every non-GET `/api/*` request must carry `Origin` equal to the request's own origin (else 403 `bad_origin`). SameSite=Lax as a second wall.
- **A5 Brute force.** `login_failures (username, at)`: 10 failures for one username within 15 min → 429 `too_many_attempts` for 15 min. Success clears them. Errors never say whether the username exists (`bad_credentials`).
- **A6 Status.** `users.status 'pending' | 'active' | 'removed'`. `requireUser` loads it; `pending` may only call `/api/me`, `/api/auth/*`, `PUT /api/me/username`, `PUT /api/me/display-name` (403 `pending` otherwise); `removed` sessions are deleted and get 401 `removed`; login as removed → 403 `removed`.
- **A7 Admin.** `GET /api/admin` → `{ pending: (PublicUser & { requestedAt })[]; active: (PublicUser & { joinedAt; isAdmin })[]; removed: PublicUser[] }`. `POST /api/admin/users/:id/approve` (pending|removed → active), `POST …/decline` (deletes a pending user), `POST …/remove` (active → removed, sessions deleted; never self), `POST …/reset-link` → `{ link }` (one-time token, 24 h, stored hashed in `password_resets`; `/reset/<token>` page sets a new password, kills other sessions). Unread for the admin: `requests` in `GET /api/activity/unread` also counts pending signups.
- **A8 Visibility.** Friends must be `active`: `FRIEND_IDS_SQL` joins `users.status = 'active'`; search and profiles skip non-active users. Removed users' data stays but no one else sees it.
- **A9 Existing users.** Dan (and anyone already in D1) has no password. `npm run set-password -w packages/worker -- <username>` (prompts, hashes locally, runs `wrangler d1 execute --remote`) sets one and marks the user active. SETUP gets a cut-over section: deploy, set password, sign in, then delete the Access application in Zero Trust.
- **A10 Dev and tests.** `DEV_EMAIL` bypass unchanged (dev only, user auto-created `active`). Remove `jose`/Access verification code.
- **A11 Web.** Signed-out users see **Sign in / Create account** (one screen, two tabs) at any path; after signup → **Waiting for Dan to approve** (polls `/api/me` every 30 s, Log out). `/add/<code>` and other paths resume after sign-in (reuse `AFTER_SETUP_KEY`). Log out calls `/api/auth/logout`. Admin screen: Requests (Approve / Decline), Members (Remove access, Reset link), Removed (Restore). No seat count.

## Tasks

- **B0 Wireframes** (approval gate for B2): `SignIn.wf.dc.html` (sign in + create account tabs, error states), `Waiting.wf.dc.html`, `ResetPassword.wf.dc.html`, `Admin.v2.wf.dc.html` (replaces Admin.wf).
- **B1 Server** (parallel with B0): migration edits (0006 not yet deployed: drop `invites`, add `users.password_hash`, `users.status DEFAULT 'active'`, `sessions`, `login_failures`, `password_resets`), `auth/` module, admin rewrite, A8, set-password script, SETUP, remove Cloudflare API code. Tests for every ruling.
- **B2 Web** (after B0 approval): sign-in screens, waiting screen, reset page, Admin rewrite, logout, SessionGate.
- **B3** Phase 4 Task 13 (e2e) with sign-up → approve → friends flows; final review.
