# Setting up Media Tracker (for Dan, on Windows)

You will put the app on Cloudflare (free plan), create your account (the first account is the admin; everyone after waits for you to approve them), install it on your PC and phone, and import your Google Sheet. Allow about an hour. Each step ends with what success looks like.

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
npm ci
```

This installs the version on `main`. To try a new version before it is merged, run `git checkout phase3` (the branch name I give you; for now `phase3`) before `npm ci`; the "Updating to a new version" section below covers moving between versions.

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

**Success:** it lists every migration (`0001_init.sql` up to `0013_app_settings.sql`) with a green check.

## Pictures in messages (create the picture storage once, before step 7)

Messages can carry pictures. They are stored in Cloudflare R2 (a bucket named `media-tracker-media`), and the app expects the bucket to exist when you deploy:

```
npm exec -w packages/worker -- wrangler r2 bucket create media-tracker-media
```

Cloudflare may ask you to add a payment method once before it turns R2 on. The free tier is 10 GB, far more than a few friends' pictures will use, so you are not charged for normal use.

**Success:** it prints `Created bucket 'media-tracker-media'`. If it says the bucket already exists, that is fine.

Then turn pictures on: in `packages/worker/wrangler.toml`, find the three commented lines under `# Pictures in messages` (`# [[env.production.r2_buckets]]`, `# binding = "MEDIA"`, `# bucket_name = "media-tracker-media"`) and remove the `# ` at the start of each, then deploy. (Until you do, everything else works and sending a picture says pictures aren't set up. With the lines uncommented but no bucket, the deploy stops with an error about `media-tracker-media`.)

## 7. Deploy the app

```
npm run deploy
```

**Success:** it ends with a line like `https://media-tracker.<your-subdomain>.workers.dev`. Copy that address.

Production uses `ENVIRONMENT = "prod"` (already set in `wrangler.toml`). **Never add `DEV_EMAIL` (or `LOOKUP_FAKE`) to the production settings.** `DEV_EMAIL` is a sign-in shortcut for testing on your own PC and would let anyone in. A test fails if it ever appears there.

## 8. Add the lookup keys (secrets)

Get free keys first: TMDB (movies and TV) from <https://www.themoviedb.org/settings/api>, and IGDB (games) by registering an app at <https://dev.twitch.tv/console> (the Client ID is `IGDB_ID`, the Client Secret is `IGDB_SECRET`). Then run each line and paste the value when asked:

```
npm exec -w packages/worker -- wrangler secret put TMDB_KEY --env production
npm exec -w packages/worker -- wrangler secret put IGDB_ID --env production
npm exec -w packages/worker -- wrangler secret put IGDB_SECRET --env production
```

The Worker exists now (step 7), so these attach to it. Secrets take effect right away.

**Success:** each command prints `Success! Uploaded secret ...`.

### YouTube search (optional)

The YouTube list works without any setup when you paste a video link (the title, channel and thumbnail fill in). Searching by title needs a free Google key:

1. Go to <https://console.cloud.google.com/> and create a project.
2. Open "APIs & Services" > "Library", find **YouTube Data API v3** and click Enable.
3. Open "APIs & Services" > "Credentials", click "Create credentials" > "API key", then restrict the key to the YouTube Data API v3 only.
4. Store it as a secret (paste the key when asked):

```
npm exec -w packages/worker -- wrangler secret put YOUTUBE_API_KEY --env production
```

The free quota is 10,000 units a day. One title search costs 100 units, so that is about 100 searches a day (pasting a link costs nothing). Until the key is set, the app says "Paste a YouTube link (search needs setup)".

### Notifications (optional)

The app can send a notification to your phone or computer for new messages, friend requests, comments and reactions (and, for you as admin, a new sign-up waiting). Without these keys the app works exactly as before and Settings shows "Not set up yet" under Notifications.

1. Make a pair of keys (one time). This prints a **Public Key** and a **Private Key (JWK)**, a single line starting with `{`:

```
npx @pushforge/builder vapid
```

2. Store three secrets. Paste the value when asked: the public key, the whole private key line, and `mailto:` plus your email address (for example `mailto:you@example.com`):

```
npm exec -w packages/worker -- wrangler secret put VAPID_PUBLIC_KEY --env production
npm exec -w packages/worker -- wrangler secret put VAPID_PRIVATE_KEY --env production
npm exec -w packages/worker -- wrangler secret put VAPID_SUBJECT --env production
```

3. Deploy again (`npm run deploy`, as in step 7) so the app has the notifications screen, then open Settings > Notifications and turn on **Notifications on this device**. Each person does this on each phone or computer they want notifications on.

**iPhone and iPad:** notifications only work in the app installed on the Home Screen (iOS 16.4 or newer; see step 10), and the browser asks permission only after you tap the switch. In Safari, Settings shows "Install the app to get notifications" instead.

Keep the private key secret and do not replace the keys later: a new pair silently stops every device's notifications until each one turns the switch off and on again.

## 9. Create your account

1. Open your workers.dev address in a browser.
2. On **Create account**, choose a username and a password (8 to 128 characters). Write the password down somewhere private.

The first account on a new database is the admin and is let in straight away. (If you already used the app before Phase 4b, do not do this: follow "Switching to the app's own sign-in" below instead.)

**Success:** the app opens on the Anime list, and the menu has **Admin**.

## 10. Open it and install the app

- **Windows (Edge or Chrome):** open the address, sign in with your username and password, then click the install icon at the right of the address bar (or the three dots > **Apps** > **Install this site as an app**).
- **Android (Chrome):** open the address, sign in, tap the three dots > **Install app** (or **Add to Home screen**).

**Success:** the app opens in its own window, or from an icon on your phone, and shows the Anime list.

## 11. Import your Sheet

1. In Google Sheets open your Media Tracker: **File** > **Download** > **Microsoft Excel (.xlsx)**.
2. In the app open **Import** (side menu on PC, **More** on the phone), choose the file, check the counts against your Sheet's row counts, and press **Import**.
3. When it offers to fill in details (covers, genres), press **Start**.

**Success:** "Imported N titles" appears and your lists fill up. Undo is available right after if something looks wrong.

## 12. Sign-in and approving friends

Everyone signs in with a username and a password. Nobody gets in until you say so.

1. Send a friend the app's address (your workers.dev address).
   **Success:** they see **Sign in / Create account**.
2. They choose **Create account**, pick a username and a password. They then see "Waiting for Dan to approve".
   **Success:** in your app, More > **Admin** lists them under **Requests**.
3. Press **Approve** (or **Decline** if you don't know them; that deletes the request).
   **Success:** within a minute their screen opens the app. They can now add you with your username or your invite link.
4. To take someone's access away, press **Remove access** next to them under **Members**. They are signed out everywhere at once and cannot sign in again. Their lists stay in the database but nobody sees them. **Restore** under **Removed** lets them back in with their old password.
   **Success:** they move to **Removed**.
5. To let a friend in without waiting for you to approve them, press **Make a sign-up link** under **Sign-up links** in Admin and send them the link. It works once, for 7 days; whoever creates an account with it is approved at once. **Revoke** cancels an unused link. (In the Members ⋯ menu, **Delete account** removes a person and all their lists for good.)
   **Success:** they open the link, see "You're invited", create an account and land straight in the app.
6. If a friend forgets their password, press **Reset link** next to them and send them the link. It works once, for 24 hours, and signs them out on every other device.
   **Success:** they open the link, choose a new password and are signed in.

If you forget your own password, run this in the Codespace terminal or PowerShell (after logging in to Cloudflare as in "Updating to a new version", step 3), with your username in place of `dan`:
```
npm run set-password -w packages/worker -- dan
```
Type the new password twice when asked (nothing shows as you type; that is on purpose).
**Success:** it prints `Done: @dan has a new password and is active.`

Ten wrong passwords for one username within 15 minutes lock that username for 15 minutes ("Too many attempts"). Waiting is the fix.

---

## Updating to a new version

Do this each time there is new code (for example, Phase 3: rating tiers and Compare, Top 5, Stats, themes, Export; and Phase 3b: the new bottom bar, Search, Activity and your Profile). Run the commands one at a time from the `media-tracker` folder, in the Codespace terminal (or PowerShell on your PC).

1. Get the new code. Your copy may be on an older branch (for example `phase1-2`) and may never have heard of newer ones, so do these four commands in order:
   ```
   git fetch origin
   git checkout main
   git pull
   git branch --show-current
   ```
   Use `main` once the new version is merged. If I give you a branch name to try before it is merged, put that name in place of `main` in the second command (for example `git checkout phase3`). **Success:** the last command prints the branch you meant (`main`, or the branch name I gave you). If it prints anything else, stop and tell me before going on; otherwise you would redeploy the old app and everything would look fine.
2. Install anything new:
   ```
   npx -y npm@11 ci
   ```
3. Log in to Cloudflare. Every new terminal forgets the login, so do this at the start of each update. The simplest way, if a browser can open, is `npm exec -w packages/worker -- wrangler login` and **Allow**. In a Codespace (where that browser step is awkward) use an API token instead:
   - Create it once: Cloudflare dashboard > your profile icon > **My Profile** > **API Tokens** > **Create Token**, use the **Edit Cloudflare Workers** template, and pick your account. This update runs `wrangler deploy` and `wrangler d1 migrations apply`, so the token needs Workers Scripts **Edit** and D1 **Edit**; if D1 is not in the template's list, add **D1 > Edit** under account permissions. Copy the token when it is shown (it is shown only once; keep it somewhere private, not in the repo).
   - Use it: paste the token in place of `PASTE_TOKEN_HERE`. The token only lasts for the terminal where you ran this, so repeat it in any new terminal:
     ```
     export CLOUDFLARE_API_TOKEN=PASTE_TOKEN_HERE
     ```
     (In PowerShell on your PC use `$env:CLOUDFLARE_API_TOKEN="PASTE_TOKEN_HERE"`.)
4. Check the database first (read-only; it changes nothing). The new rating code needs two things from the live database: `UPDATE … FROM`, and decimal numbers coming back exactly as stored (9.97 must stay 9.97). Run these two commands:
   ```
   npm exec -w packages/worker -- wrangler d1 execute media-tracker --remote --env production --command "SELECT (SELECT value FROM json_each('[9.97,7.49,8.25]') WHERE key = 0) = 9.97 AS two_decimals_ok, (SELECT value FROM json_each('[-3.4760986898352724]')) = -3.4760986898352724 AS long_decimals_ok"
   ```
   ```
   npm exec -w packages/worker -- wrangler d1 execute media-tracker --remote --env production --command "EXPLAIN UPDATE entries SET rating = j.t FROM (SELECT 1 AS t, 'x' AS id) j WHERE entries.id = j.id"
   ```
   **Success:** the first prints a small table where both `two_decimals_ok` and `long_decimals_ok` show 1; the second prints a table of steps (a long list of `opcode` rows) and no error. `EXPLAIN` only describes what the command would do; it does not run it. If either command fails or shows a 0, stop and tell me before going on. It touches only columns that already exist, so it works before the update in step 5.
5. Update the database tables. This is the same command as in section 6, "Create the tables":
   ```
   npm exec -w packages/worker -- wrangler d1 migrations apply media-tracker --remote --env production
   ```
   Type `y` when asked. This one command applies every migration your database is missing, in order. Coming from the Phase 3 version it applies these:
   - `0003_activity.sql`: the `activity` table (the Activity screen), with one "added" line for each title you already have.
   - `0004_avatars.sql`: the `avatars` table and `users.avatar_at` (your profile photo).
   - `0005_tier_ratings.sql`: new columns for each title's tier and score, and the table that keeps your Compare picks.
   - `0008_plan_order.sql`: the order of your Plan to watch lists (a new `plan_order` column on titles; titles already planned are numbered in the order you added them) and the profile bio (a new `bio` column on users). Apply it **before** deploying: the new app reads and writes these columns.
   - `0013_app_settings.sql`: the admin's app settings (a new table, `app_settings`: announcement, switches, app text and look, defaults for new people). Apply it **before** deploying.
   - `0012_push.sql`: notifications (new tables `push_subscriptions` and `push_throttle`). Apply it **before** deploying. Turning notifications on is optional: see "Notifications (optional)" after step 8.
   - `0011_messages.sql`: messages, group chats and recommendations (new tables `conversations`, `conversation_members` and `messages`). Apply it **before** deploying. Pictures are optional: see "Pictures in messages" after section 6.
   - `0010_progress.sql`: episode progress (two new columns on titles, `progress` and `progress_total`; titles you already have start with none). Apply it **before** deploying: the new app reads and writes these columns.
   - `0009_number_first.sql`: the number-first rating model (Phase 5). Apply it **before** deploying.
   - `0007_signup_links.sql`: the table behind pre-approved sign-up links (Admin > Sign-up links). Apply it **before** deploying.
   - `0006_social.sql`: friends, invite links, reactions, comments, and the app's own sign-in (passwords, sessions, approvals) (Phase 4). Apply it **before** deploying: the new app reads these tables. Coming from a version before Phase 4b, do the whole update with "Switching to the app's own sign-in" below instead.

   (An older database also gets `0002_compare_queue.sql`, the list of new ratings waiting to be double-checked.) **Success:** it lists each of these with a green check. It is safe to run more than once: Wrangler records every migration it has applied (in a `d1_migrations` table in your database) and only runs the ones not yet applied, so a second run says there is nothing to apply. Do this step **before** step 6, so the new app never runs against missing tables. Your existing scores do not change: tiers are filled in the first time you open the app afterwards, and a score only moves when you make a pick that involves it.
6. Put the new app online:
   ```
   npm run deploy
   ```
   **Success:** it ends with a `Deployed` message and your workers.dev address.
7. Close the installed app completely and open it again (on Android, swipe it away from recent apps). The app updates itself in the background, so it can take one more close and reopen before the new screens appear.

Do not copy `DEV_EMAIL` or `LOOKUP_FAKE` into `wrangler.toml` for production. They exist only for local development and the end-to-end test, and the Worker ignores them unless `ENVIRONMENT` is `dev`.

## Switching to the app's own sign-in (one time, Phase 4b)

Until now Cloudflare Access (the emailed code) guarded the app. From Phase 4b the app has its own **Sign in / Create account** screen and you approve friends inside the app, so Access goes away. Do this once, in this order, only with the version I tell you has the sign-in screen. Your lists, ratings and username stay as they are. Run the commands one at a time in the Codespace terminal (or PowerShell on your PC), from the `media-tracker` folder.

1. Get the new code and log in to Cloudflare: do steps 1, 2 and 3 of "Updating to a new version" above.
   **Success:** `git branch --show-current` prints the branch I gave you, and `npm exec -w packages/worker -- wrangler whoami` shows your account.
2. Update the database tables (the new app needs them; the version online now ignores them, so nothing breaks in between):
   ```
   npm exec -w packages/worker -- wrangler d1 migrations apply media-tracker --remote --env production
   ```
   Type `y` when asked.
   **Success:** it lists `0006_social.sql` and `0007_signup_links.sql` with a green check (and any older ones you were missing).
3. Give your account a password. Put your username in place of `dan` (it is the name the app shows as `@dan`):
   ```
   npm run set-password -w packages/worker -- dan
   ```
   Type a new password (8 to 128 characters), press Enter, type it again. Nothing shows as you type; that is on purpose. Write it down somewhere private.
   **Success:** it prints `Done: @dan has a new password and is active.` If it says `There is no account called @dan`, check the spelling: the message shows a command that lists the usernames.
4. Put the new app online:
   ```
   npm run deploy
   ```
   **Success:** it ends with a `Deployed` message and your workers.dev address.
5. Sign in. Open your workers.dev address. Cloudflare Access still asks for the emailed code first (one last time); then the app shows **Sign in**. Sign in with your username and the password from step 3.
   **Success:** your lists appear, and More > **Admin** opens. If the password is refused, run step 3 again.
6. Delete the Access application. In the Cloudflare dashboard open **Zero Trust** > **Access** > **Applications**, find the Media Tracker application (your workers.dev address), open its **⋯** menu (or **Configure**) and choose **Delete**, then confirm. Menu names can differ slightly; look for the words in bold.
   **Success:** in a private (incognito) window your address goes straight to the app's **Sign in** screen, with no Cloudflare page in front.
7. Tidy up (optional): on **Zero Trust** > **Access** > **Policies** delete the "Dan only" (or "Friends") policy, and if you made the `media-tracker access` API token for the old admin invites, delete it under your profile icon > **My Profile** > **API Tokens**.
   **Success:** neither is listed any more.
8. Reinstall the app on your phone if it keeps showing a Cloudflare page: remove the home-screen icon, open the address in the browser, sign in, and install again (step 10).
   **Success:** the icon opens the app signed in.
9. Tell your friends the address. They create an account and you approve them (section 12).

## Backing up and restoring

Two kinds of backup. **Keep the SQL one**; the JSON one is for reading.

1. **Full backup (this is the one you can restore from).** In PowerShell, in the project folder:
   ```
   npm exec -w packages/worker -- wrangler d1 export media-tracker --remote --env production --output media-tracker-backup.sql
   ```
   **Success:** a file `media-tracker-backup.sql` appears in the folder. It has everything, including password and sign-in data, so keep it private (not in a shared folder, not in Git).
2. **JSON backup (for reading and keeping).** In the app: Admin > Backup > Download a backup. It holds every list, friendship, post, comment, message and setting, but **not** secrets: password hashes, sign-in sessions, reset links, sign-up link codes, push addresses and keys, and profile picture bytes. People cannot sign in from it, and it cannot be loaded back as is. Use it to look something up or to keep a copy of everyone's lists.

**Restoring the SQL backup** (only into an empty database, for example after a mistake or a move). Make a new database first (step 5, with a new name, and update `database_id` in the `[env.production]` section of `packages/worker/wrangler.toml`), then:
```
npm exec -w packages/worker -- wrangler d1 execute media-tracker --remote --env production --file media-tracker-backup.sql
```
**Success:** it reports the number of queries run and no error. The export already contains the table definitions and the migration record, so do **not** run `migrations apply` first on that database. Pictures sent in messages live in the separate storage bucket and are not in either backup.

## The three most likely problems

1. **`npm ci` fails or crashes, or says the engine is not supported.** You have an old Node. Run `node -v`; if it is not 24, reinstall Node.js 24 LTS (step 2), reopen PowerShell, and run `npm ci` again.
2. **Wrangler says "Authentication error" or `No such database` / a database id error.** Run `npm exec -w packages/worker -- wrangler login` again, and re-check that the `database_id` in the `[env.production]` section matches the one `d1 create` printed (`npm exec -w packages/worker -- wrangler d1 list` shows it).
3. **Your password is refused, or it says "Too many attempts".** Check the username (no `@`). After ten wrong tries, wait 15 minutes. To set a new password, run `npm run set-password -w packages/worker -- <your username>` (section 12). A friend who forgot theirs gets a **Reset link** from you in Admin.

## Good to know

- Lookups use at most 19 outbound requests per call, which fits the Workers Free limit of 50 per request. This setup assumes that limit.
- Developing locally, testing and the end-to-end test are covered in the README.
