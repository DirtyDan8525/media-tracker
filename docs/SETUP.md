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
git clone https://github.com/DirtyDan8525/media-tracker
cd media-tracker
git checkout phase1-2
npm ci
```

The `git checkout phase1-2` line is needed only until this work is merged to `main`; once it is, skip it.

**Success:** `npm ci` finishes with no red `ERR!` lines (yellow warnings are fine).

## 4. Log in to Cloudflare

```
npm exec -w packages/worker -- wrangler login
```

A browser tab opens. Click **Allow**.

**Success:** PowerShell says `Successfully logged in`. Check with `npm exec -w packages/worker -- wrangler whoami`.

## 5. Create the database

```
npm exec -w packages/worker -- wrangler d1 create media-tracker
```

It prints a `database_id` (letters, numbers and dashes). Open `packages/worker/wrangler.toml` in Notepad and find the `[env.production]` part near the bottom. Replace `REPLACE_ME_D1_DATABASE_ID` with that id, keeping the quotes. Save.

**Success:** the `database_id` line under `[[env.production.d1_databases]]` shows your real id.

## 6. Create the tables

```
npm exec -w packages/worker -- wrangler d1 migrations apply media-tracker --remote --env production
```

Type `y` when asked.

**Success:** it lists `0001_init.sql` with a green check.

## 7. Deploy the app

```
npm run deploy
```

**Success:** it ends with a line like `https://media-tracker.<your-subdomain>.workers.dev`. Copy that address. Don't treat the app as ready yet: until step 9 is done, the app's pages load but every `/api` request is refused (that is intended).

Production uses `ENVIRONMENT = "prod"` (already set in `wrangler.toml`). **Never add `DEV_EMAIL` (or `LOOKUP_FAKE`) to the production settings.** `DEV_EMAIL` is a sign-in shortcut for testing on your own PC and would let anyone in. A test fails if it ever appears there.

## 8. Add the lookup keys (secrets)

Get free keys first: TMDB (movies and TV) from <https://www.themoviedb.org/settings/api>, and IGDB (games) by registering an app at <https://dev.twitch.tv/console> (the Client ID is `IGDB_ID`, the Client Secret is `IGDB_SECRET`). Then run each line and paste the value when asked:

```
npm exec -w packages/worker -- wrangler secret put TMDB_KEY --env production
npm exec -w packages/worker -- wrangler secret put IGDB_ID --env production
npm exec -w packages/worker -- wrangler secret put IGDB_SECRET --env production
```

The Worker exists now (step 7), so these attach to it. Secrets take effect right away; the redeploy in step 9 picks up everything else.

**Success:** each command prints `Success! Uploaded secret ...`.

## 9. Lock it with Cloudflare Access

Menu names in the dashboard can differ slightly from what is written here; look for the words in bold.

1. In the Cloudflare dashboard open **Zero Trust**. If asked, pick a team name (this becomes your team domain) and choose the **Free** plan.
2. Find **Access** > **Applications** and add an application of type **Self-hosted**.
3. For the application domain enter your whole workers.dev host, `media-tracker.<your-subdomain>.workers.dev`, with no path. One application covering the whole host is what you want: it protects the pages, `/api/*`, `/api/auth/reauth` and `/cdn-cgi/*` together.
4. Add a policy: name `Dan only`, action **Allow**, under **Include** choose **Emails** and enter your email address. Add nothing else.
5. Save, then open the application's overview or settings and copy the **Application Audience (AUD) tag** (a long string). The **team domain**, `<team>.cloudflareaccess.com`, is shown in the Zero Trust settings.
6. In `packages/worker/wrangler.toml`, under `[env.production.vars]`, set:
   - `ACCESS_AUD` = the AUD tag
   - `ACCESS_TEAM_DOMAIN` = the team domain (no `https://`)
   - `ADMIN_EMAIL` = your email (the one in the policy)
7. Deploy again: `npm run deploy`. (`wrangler.toml` already turns off Preview URLs for the Worker with `preview_urls = false`, so no second address bypasses the lock.)

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

## Updating to a new version

Do this each time there is new code (for example, Phase 3: Compare, Top 5, Stats, themes, Export and search). Run the commands one at a time from the `media-tracker` folder, in the Codespace terminal (or PowerShell on your PC).

1. Get the new code:
   ```
   git pull
   ```
   If this work is not merged to `main` yet, run `git checkout phase3` first.
2. Install anything new:
   ```
   npx -y npm@11 ci
   ```
3. Log in to Cloudflare again **only if the terminal was restarted** (a new Codespace session forgets it). Paste your Cloudflare API token in place of `PASTE_TOKEN_HERE`:
   ```
   export CLOUDFLARE_API_TOKEN=PASTE_TOKEN_HERE
   ```
   (In PowerShell on your PC use `$env:CLOUDFLARE_API_TOKEN="PASTE_TOKEN_HERE"`, or just run `npm exec -w packages/worker -- wrangler login`.)
4. Update the database tables. This is the same command as step 6:
   ```
   npm exec -w packages/worker -- wrangler d1 migrations apply media-tracker --remote --env production
   ```
   Type `y` when asked. Phase 3 adds one table, `compare_queue` (the list of new ratings waiting to be double-checked). **Success:** it lists `0002_compare_queue.sql` with a green check. It is safe to run more than once: Wrangler records every migration it has applied (in a `d1_migrations` table in your database) and only runs the ones not yet applied, so a second run says there is nothing to apply. Do this step **before** step 5, so the new app never runs against missing tables.
5. Put the new app online:
   ```
   npm run deploy
   ```
   **Success:** it ends with a `Deployed` message and your workers.dev address.
6. Close the installed app completely and open it again (on Android, swipe it away from recent apps). The app updates itself in the background, so it can take one more close and reopen before the new screens appear.

Do not copy `DEV_EMAIL` or `LOOKUP_FAKE` into `wrangler.toml` for production. They exist only for local development and the end-to-end test, and the Worker ignores them unless `ENVIRONMENT` is `dev`.

## The three most likely problems

1. **`npm ci` fails or crashes, or says the engine is not supported.** You have an old Node. Run `node -v`; if it is not 24, reinstall Node.js 24 LTS (step 2), reopen PowerShell, and run `npm ci` again.
2. **Wrangler says "Authentication error" or `No such database` / a database id error.** Run `npm exec -w packages/worker -- wrangler login` again, and re-check that the `database_id` in the `[env.production]` section matches the one `d1 create` printed (`npm exec -w packages/worker -- wrangler d1 list` shows it).
3. **After deploy you see a blank "Signed out" page or sign-in loops.** `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` doesn't match Access exactly (no `https://`, no spaces), or the Access application doesn't cover the whole workers.dev host. Fix `wrangler.toml` or the application's hostname and run `npm run deploy` again. Check that the application's host is exactly your workers.dev host.

## Good to know

- Lookups use at most 19 outbound requests per call, which fits the Workers Free limit of 50 per request. This setup assumes that limit.
- Developing locally, testing and the end-to-end test are covered in the README.
