# Setting up Media Tracker (for Dan, on Windows)

You will put the app on Cloudflare (free plan), lock it so only your email can open it, install it on your PC and phone, and import your Google Sheet. Allow about an hour. Each step ends with what success looks like.

Commands go in **PowerShell**: press the Windows key, type `PowerShell`, press Enter. Run them one at a time from the project folder (see step 3).

## 1. Create a Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and sign up with your email. Verify the email.
2. On the left, open **Workers & Pages**. If it asks you to pick a **workers.dev subdomain**, choose one (for example `dan-media`). Write it down.

**Success:** you see the Cloudflare dashboard with Workers & Pages in the menu.

## 2. Install Node.js 24 LTS and Git

1. Go to <https://nodejs.org>, download the **24 LTS** Windows installer, run it, and accept the defaults. It includes npm 11. (npm 10 crashes on this project, so do not use an older Node.)
2. Go to <https://git-scm.com/download/win>, download and run the installer, accept the defaults.
3. Close PowerShell and open it again, then run:
   ```
   node -v
   npm -v
   git --version
   ```

**Success:** `node -v` starts with `v24`, `npm -v` starts with `11`, and Git prints a version.

## 3. Get the code and install it

```
git clone <the repository address> media-tracker
cd media-tracker
npm ci
```

**Success:** `npm ci` finishes with no red `ERR!` lines (yellow warnings are fine).

## 4. Log in to Cloudflare

```
npx wrangler login
```

A browser tab opens. Click **Allow**.

**Success:** PowerShell says `Successfully logged in`. Check with `npx wrangler whoami`.

## 5. Create the database

```
npx wrangler d1 create media-tracker
```

It prints a `database_id` (letters, numbers and dashes). Open `packages/worker/wrangler.toml` in Notepad and find the `[env.production]` part near the bottom. Replace `REPLACE_ME_D1_DATABASE_ID` with that id, keeping the quotes. Save.

**Success:** the `database_id` line under `[[env.production.d1_databases]]` shows your real id.

## 6. Create the tables

```
npm exec -w packages/worker -- wrangler d1 migrations apply media-tracker --remote --env production
```

Type `y` when asked.

**Success:** it lists `0001_init.sql` with a green check.

## 7. Add the lookup keys (secrets)

Get free keys first: TMDB (movies and TV) from <https://www.themoviedb.org/settings/api>, and IGDB (games) by registering an app at <https://dev.twitch.tv/console> (the Client ID is `IGDB_ID`, the Client Secret is `IGDB_SECRET`). Then run each line and paste the value when asked:

```
npm exec -w packages/worker -- wrangler secret put TMDB_KEY --env production
npm exec -w packages/worker -- wrangler secret put IGDB_ID --env production
npm exec -w packages/worker -- wrangler secret put IGDB_SECRET --env production
```

If it says the Worker doesn't exist yet and asks to create it, answer `y`.

**Success:** each command prints `Success! Uploaded secret ...`.

## 8. Deploy

```
npm run deploy
```

**Success:** it ends with a line like `https://media-tracker.<your-subdomain>.workers.dev`. Copy that address. Don't use it yet, since the lock comes next. Until step 9 is done the app will refuse every request (that is intended).

Production uses `ENVIRONMENT = "prod"` (already set in `wrangler.toml`). **Never add `DEV_EMAIL` (or `LOOKUP_FAKE`) to the production settings.** `DEV_EMAIL` is a sign-in shortcut for testing on your own PC and would let anyone in. A test fails if it ever appears there.

## 9. Lock it with Cloudflare Access

1. In the Cloudflare dashboard open **Zero Trust** (left menu). If asked, pick a team name (this becomes your team domain, `<team>.cloudflareaccess.com`) and choose the **Free** plan.
2. Go to **Access controls** > **Applications** > **Add an application** > **Self-hosted**.
3. Name: `Media Tracker`. Under **Public hostname** enter your whole workers.dev host, for example `media-tracker.dan-media.workers.dev`, leaving the path empty. One application covering the whole host is what you want: it protects the pages, `/api/*`, `/api/auth/reauth` and `/cdn-cgi/*` together.
4. Add a policy: name `Dan only`, action **Allow**, rule **Emails** = your email address. Add nothing else.
5. Save. Open the application again and copy two things:
   - **Application Audience (AUD) Tag** (a long string).
   - Your **team domain**, from Zero Trust > **Settings** > **Custom Pages** (or the top of Settings): `<team>.cloudflareaccess.com`.
6. In `packages/worker/wrangler.toml`, under `[env.production.vars]`, set:
   - `ACCESS_AUD` = the AUD tag
   - `ACCESS_TEAM_DOMAIN` = the team domain
   - `ADMIN_EMAIL` = your email (the one in the policy)
7. Deploy again: `npm run deploy`

**Success:** opening your workers.dev address in a private window first shows a Cloudflare sign-in page asking for your email. Only a code sent to your allowed email gets through.

## 10. Open it and install the app

- **Windows (Edge or Chrome):** open the address, sign in with the emailed code, then click the install icon at the right of the address bar (or the three dots > **Apps** > **Install this site as an app**).
- **Android (Chrome):** open the address, sign in, tap the three dots > **Install app** (or **Add to Home screen**).

Choose a username when the app asks.

**Success:** the app opens in its own window, or from an icon on your phone, and shows the Anime list.

## 11. Import your Sheet

1. In Google Sheets open your Media Tracker: **File** > **Download** > **Microsoft Excel (.xlsx)**.
2. In the app open **Import** (side menu on PC, **More** on the phone), choose the file, check the counts against your Sheet's row counts, and press **Import**.
3. When it offers to fill in details (covers, genres), press **Start**.

**Success:** "Imported N titles" appears and your lists fill up. Undo is available right after if something looks wrong.

---

## The three most likely problems

1. **`npm ci` fails or crashes, or says the engine is not supported.** You have an old Node. Run `node -v`; if it is not 24, reinstall Node.js 24 LTS (step 2), reopen PowerShell, and run `npm ci` again.
2. **Wrangler says "Authentication error" or `No such database` / a database id error.** Run `npx wrangler login` again, and re-check that the `database_id` in the `[env.production]` section matches the one `d1 create` printed (`npx wrangler d1 list` shows it).
3. **After deploy you see a blank "Signed out" page or sign-in loops.** `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` doesn't match Access exactly (no `https://`, no spaces), or the Access application doesn't cover the whole workers.dev host. Fix `wrangler.toml` or the application's hostname and run `npm run deploy` again.

## Good to know

- Lookups use at most 19 outbound requests per call, which fits the Workers Free limit of 50 per request. This setup assumes that limit.
- Developing locally, testing and the end-to-end test are covered in the README.
