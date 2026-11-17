# Phase 5 requests (Dan, 2026-11-16) — to plan and wireframe

Changes the 2026-11-15 nav decision (docs/specs/decisions-2026-11-15.md) and S7 (fixed 6 reactions).

## Navigation and Home
1. Bottom-left tab becomes **Home** (house icon), replacing Add; Lists move here.
2. Home opens the **last list you had selected**.
3. The list title at the top (e.g. "Anime") becomes a **dropdown** to switch lists.
4. **Add** goes back to a floating bubble, bottom right; hidden on Profile, More, Compare, Settings.
5. Add asks **which list** (dropdown) so it can add to any list.

## New users
6. Short **walkthrough** after the first sign-in.
7. An **"Install as an app"** prompt with steps (for when the browser popup doesn't show).

## Feed (Activity)
8. Show **profile pictures** on posts.
9. Posts look bland: redesign them.
10. Replace the 6-emoji row with one **React** button that opens the emoji picker, plus a **+** for any emoji typed from the keyboard (custom reactions; validate one emoji, cap length).

## Friends
11. **Messages** from a friend's profile (later; bigger feature).
    - **Group chats** (name + members, add/leave) and **pictures** in chats (resized on the phone before upload, stored in Cloudflare R2; free tier 10 GB; R2 may ask for a payment method once as verification). Live updates via a Durable Object (available on Workers Free, SQLite-backed) or simple polling first.
    - **Notifications** (Phase 6 web push) cover messages too; Settings gets switches per type (messages, friend requests, comments, reactions) and a master off switch.
    - **Recommendations (built with Messages):** a small **Share** button on any title's page → pick one or more friends → sends a recommendation into your chat with them. In a chat, a **Recommend** button picks a title from your lists. The message shows as a card: cover, title, list, your rating and an optional note, with **Add to mine** (and "On your list" if they have it). Lists of what friends recommended you, for later.

## More tab
13. **What's new / Coming soon** list in More, updated with every release (static list in the app; each future update adds its new features and moves items from Coming soon).

## PC
12. Pages like Profile are too small on a full-screen PC; they should **scale up** to use the space.

## Bugs / polish already logged
- Rating and Status tiles squished side by side on phone.
- Re-rating one title several times made 5–6 posts (should fold into one within 10 minutes).

## Rating: "number first" (Dan chose option A, 2026-11-16)
14. You type or slide a number, as now; **your number is the truth**. Dan thinks in numbers, not Loved/Liked; the hard part is titles that are **close**.
    - After saving a rating, if other titles in that list sit **close** to it (within ±0.3 of the typed number), ask **1–2 "Which was better?"** taps right there (sheet over the entry; Skip always visible). Nothing to ask → nothing shown.
    - Picks only order close titles: a pick nudges scores by at most ±0.2 from the typed numbers, enough to separate near-ties (shown with two decimals when needed).
    - Tiers vanish from the UI (no Loved/Liked chips, no tier editor, no Re-tier review, no locks). They can stay inside the math.
    - The Compare tab goes; an optional **"Sharpen my ratings"** in More asks only about close pairs, one list at a time, with a simple "Done".
    - Settings: one switch "Ask me to compare close ratings" (on by default).

## Plan to watch (Dan, 2026-11-16)
15. A small **"Plan to watch" toggle** at the top of each list, next to the filters. On: the list shows only planned titles; off: as now.
    - Planned titles **don't need a rating** (no rating field or close-call question while Planned).
    - The planned view has **its own order**: drag to rearrange (with a handle; keyboard and "Move up/down" alternatives for accessibility), so the top is what's next. Saved per list on the server; new planned titles go to the bottom.
    - A friend's recommendation can be saved straight into Plan to watch.
16. **Filters take too much room on phones:** shrink the filter area (e.g. one compact row: search + "Filters" button opening a sheet, with active filters as small chips).

## Profile bio (Dan, 2026-11-16)
17. A short **bio** on profiles (like Instagram): plain text, up to 150 characters, line breaks and emoji allowed, no links. Edit it from your Profile; friends see it under your name on your profile.

## Header (Dan, 2026-11-16)
18. Top-left: the small Media Tracker **star logo**; tapping it opens **About**. The list dropdown moves to the **centre** of the top bar (or just below on narrow phones), between logo and profile.
19. **About text editable by Dan** in Admin (goes with Phase 6 item 5, app text).

## Later (Dan, 2026-11-16)
20. **Previews:** play a song preview (~30 s clip, e.g. from the iTunes Search API's preview URLs) and movie/TV/game trailers (e.g. TMDB videos → YouTube embed) on a title's page.
